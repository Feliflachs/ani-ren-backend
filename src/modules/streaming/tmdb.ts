import { z } from 'zod';
import type { AnimeExtras } from '../catalog/anime-extras';
import type { RegionalProvider, RegionalResult, StreamingLink } from './streaming';
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const candidate = z.object({ id: z.number().int().positive(), name: z.string().optional(), original_name: z.string().optional(), title: z.string().optional(), original_title: z.string().optional(), first_air_date: z.string().optional(), release_date: z.string().optional(), genre_ids: z.array(z.number()) });
const provider = z.object({ provider_id: z.number().int(), provider_name: z.string() });
const region = z.object({ link: z.string(), flatrate: z.array(provider).optional(), free: z.array(provider).optional(), ads: z.array(provider).optional(), rent: z.array(provider).optional(), buy: z.array(provider).optional() });

export class TmdbStreaming implements RegionalProvider {
  private cache = new Map<string, { value: unknown; expires: number }>();
  private pending = new Map<string, Promise<unknown>>();
  private blockedUntil = 0;
  constructor(private token: string, private fetcher: typeof fetch = fetch, private authentication: 'bearer' | 'api-key' = 'bearer') {}
  private async request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL('https://api.themoviedb.org/3/' + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key)!;
    if (this.blockedUntil > Date.now()) throw Error('Proveedor temporalmente no disponible');
    if (this.authentication === 'api-key') url.searchParams.set('api_key', this.token);
    const task = (async () => {
      const response = await this.fetcher(url, { headers: { ...(this.authentication === 'bearer' ? { Authorization: 'Bearer ' + this.token } : {}), Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) this.blockedUntil = Date.now() + 60_000;
        throw Error('No se pudo consultar el proveedor');
      }
      const value: unknown = await response.json();
      if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { value, expires: Date.now() + 6 * 60 * 60_000 });
      return value;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  async get(id: string, identity: AnimeExtras['identity'], country: string): Promise<RegionalResult> {
    try { return await this.lookup(identity, country); }
    catch (error) { this.cache.clear(); throw error; }
  }
  private async resolve(identity: AnimeExtras['identity']) {
    const type = identity?.format === 'TV' ? 'tv' : identity?.format === 'MOVIE' ? 'movie' : null;
    if (!type || !identity?.year || !identity.titles.length) return null;
    const names = new Set(identity.titles.map(normalize));
    const matches = new Map<number, z.infer<typeof candidate>>();
    // Never choose the first fuzzy result, infer a sequel, or merge seasons.
    for (const title of identity.titles.slice(0, 2)) {
      const response = z.object({ results: z.array(candidate), total_pages: z.number().optional() }).parse(await this.request('search/' + type, {
        query: title, language: 'en-US', include_adult: 'false',
        [type === 'tv' ? 'first_air_date_year' : 'primary_release_year']: String(identity.year),
      }));
      if ((response.total_pages ?? 1) > 1) return null;
      for (const row of response.results) {
        const titles = [row.name, row.original_name, row.title, row.original_title];
        const date = type === 'tv' ? row.first_air_date : row.release_date;
        if (date?.slice(0, 4) === String(identity.year) && row.genre_ids.includes(16) && titles.some(name => name && names.has(normalize(name)))) matches.set(row.id, row);
      }
    }
    if (matches.size !== 1) return null;
    const matched = [...matches.values()][0];
    return { type, id: matched.id };
  }
  async spanishSynopsis(identity: AnimeExtras['identity']): Promise<string | null> {
    try {
      const match = await this.resolve(identity);
      if (!match) return null;
      const data = z.object({ translations: z.array(z.object({
        iso_639_1: z.string(), iso_3166_1: z.string(), data: z.object({ overview: z.string().optional() }),
      })) }).parse(await this.request(match.type + '/' + match.id + '/translations'));
      const priority = ['AR', 'MX', 'ES'];
      const spanish = data.translations.filter(row => row.iso_639_1 === 'es' && row.data.overview?.trim());
      spanish.sort((a, b) => (priority.indexOf(a.iso_3166_1) < 0 ? 99 : priority.indexOf(a.iso_3166_1)) - (priority.indexOf(b.iso_3166_1) < 0 ? 99 : priority.indexOf(b.iso_3166_1)));
      return spanish[0]?.data.overview?.trim() ?? null;
    } catch { this.cache.clear(); return null; }
  }
  private async lookup(identity: AnimeExtras['identity'], country: string): Promise<RegionalResult> {
    const matched = await this.resolve(identity);
    if (!matched) return { status: 'unmatched', links: [] };
    const type = matched.type;
    const data = z.object({ results: z.record(z.string(), region) }).parse(await this.request(type + '/' + matched.id + '/watch/providers'));
    const selected = data.results[country];
    if (!selected) return { status: 'no_data', links: [] };
    const url = new URL(selected.link);
    if (url.protocol !== 'https:' || !['www.themoviedb.org', 'themoviedb.org'].includes(url.hostname) || url.username || url.password) throw Error('Enlace inválido');
    const offers = { flatrate: 'Suscripción', free: 'Gratis', ads: 'Con anuncios', rent: 'Alquiler', buy: 'Compra' };
    const links: StreamingLink[] = [];
    const seen = new Set<string>();
    for (const [offer, label] of Object.entries(offers)) for (const item of selected[offer as keyof typeof offers] ?? []) {
      const id = item.provider_id + '-' + offer;
      if (!seen.has(id)) links.push({ id, site: item.provider_name, url: url.href, offer: label });
      seen.add(id);
    }
    return { status: links.length ? 'regional' : 'no_data', links };
  }
}
