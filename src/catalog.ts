import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from './errors';
import { catalogNetworkError } from './catalog-errors';
import { animeIdSchema } from './validation';

export const DEFAULT_CATALOG_URL = 'https://api.tenrai.org/v1';
export function catalogBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('CATALOG_BASE_URL debe ser HTTPS, sin credenciales, consulta ni fragmento.');
  }
  return url.toString().replace(/\/+$/, '');
}

const remoteImages = z.object({
  image_url: z.string().nullable().optional(),
  large_image_url: z.string().nullable().optional(),
});
const remoteAnime = z.object({
  mal_id: z.number().int().positive(), title: z.string().min(1),
  title_japanese: z.string().nullable().optional(),
  images: z.object({ jpg: remoteImages.optional(), webp: remoteImages.optional() }).optional(),
  synopsis: z.string().nullable().optional(), episodes: z.number().int().nullable().optional(),
  year: z.number().int().nullable().optional(), season: z.string().nullable().optional(),
  genres: z.array(z.object({ mal_id: z.number().int(), name: z.string() })).default([]),
});

function normalize(value: z.infer<typeof remoteAnime>) {
  const imageUrl = [value.images?.jpg?.image_url, value.images?.webp?.image_url,
    value.images?.jpg?.large_image_url, value.images?.webp?.large_image_url]
    .find((url) => url != null && z.url({ protocol: /^https$/ }).safeParse(url).success);
  return {
    id: `mal:${value.mal_id}`, externalId: value.mal_id, title: value.title,
    japanese: value.title_japanese ?? null,
    imageUrl: imageUrl ?? null,
    synopsis: value.synopsis ?? null, episodes: value.episodes ?? null,
    year: value.year ?? null, season: value.season ?? null,
    genres: value.genres.map((genre) => ({ id: `mal:${genre.mal_id}`, name: genre.name })),
  };
}
export type AnimeMetadata = ReturnType<typeof normalize>;
export interface Catalog {
  search(query: string, page: number): Promise<{ items: AnimeMetadata[]; nextPage: number | null }>;
  get(id: string): Promise<AnimeMetadata>;
}

export class JikanCatalog implements Catalog {
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private nextRequestAt = 0;
  private cache = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();

  private baseUrl: string;
  constructor(private fetcher: typeof fetch = fetch, baseUrl = DEFAULT_CATALOG_URL) {
    this.baseUrl = catalogBaseUrl(baseUrl);
  }

  private async request(path: string, valid: (value: unknown) => boolean): Promise<unknown> {
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) return cached.value;
    const pending = this.pending.get(path);
    if (pending) return pending;
    if (this.nextRequestAt - Date.now() > 2000) throw new ApiError(503, 'CATALOG_RATE_LIMIT', 'El proveedor alcanzó su límite. Reintentá más tarde.');
    if (this.waiting >= 10) throw new ApiError(503, 'CATALOG_BUSY', 'El catálogo está ocupado. Reintentá en un momento.');
    this.waiting++;
    const work = this.queue.then(async () => {
      const recent = this.cache.get(path);
      if (recent && recent.expires > Date.now()) return recent.value;
      if (this.nextRequestAt - Date.now() > 2000) throw new ApiError(503, 'CATALOG_RATE_LIMIT', 'El proveedor alcanzó su límite. Reintentá más tarde.');
      // Una petición cada 1,1 segundos respeta 3/s y 60/min en un único servidor.
      await delay(Math.max(0, this.nextRequestAt - Date.now()));
      this.nextRequestAt = Date.now() + 1100;
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(8000) });
      } catch (cause) {
        throw catalogNetworkError(cause);
      }
      if (response.status === 404) throw new ApiError(404, 'ANIME_NOT_FOUND', 'No encontramos ese anime.');
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 60;
        this.nextRequestAt = Date.now() + Math.max(60, seconds) * 1000;
        throw new ApiError(503, 'CATALOG_RATE_LIMIT', 'El proveedor alcanzó su límite. Reintentá más tarde.');
      }
      if (!response.ok) throw new ApiError(502, 'CATALOG_ERROR', `El proveedor respondió con un error HTTP ${response.status}.`);
      let value: unknown;
      try { value = await response.json(); }
      catch (cause) {
        if (cause instanceof SyntaxError) throw new ApiError(502, 'CATALOG_INVALID_RESPONSE', 'El catálogo devolvió JSON inválido.');
        throw catalogNetworkError(cause);
      }
      // Una respuesta mal formada no debe bloquear los reintentos durante un minuto.
      if (!valid(value)) throw new ApiError(502, 'CATALOG_INVALID_RESPONSE', 'El catálogo devolvió datos incompletos.');
      if (this.cache.size >= 50) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(path, { value, expires: Date.now() + 60_000 });
      return value;
    });
    this.queue = work.catch(() => undefined);
    this.pending.set(path, work);
    try { return await work; } finally { this.waiting--; this.pending.delete(path); }
  }

  async search(query: string, page: number) {
    const params = new URLSearchParams({ q: query, page: String(page), limit: '20', sfw: 'true' });
    const schema = z.object({
      data: z.array(remoteAnime), pagination: z.object({ has_next_page: z.boolean() }),
    });
    const parsed = schema.safeParse(await this.request(`/anime?${params}`, (value) => schema.safeParse(value).success));
    if (!parsed.success) throw new ApiError(502, 'CATALOG_INVALID_RESPONSE', 'El catálogo devolvió datos incompletos.');
    return { items: parsed.data.data.map(normalize), nextPage: parsed.data.pagination.has_next_page ? page + 1 : null };
  }

  async get(id: string) {
    animeIdSchema.parse(id);
    const schema = z.object({ data: remoteAnime }).refine((value) => `mal:${value.data.mal_id}` === id);
    const parsed = schema.safeParse(await this.request(`/anime/${id.slice(4)}`, (value) => schema.safeParse(value).success));
    if (!parsed.success || `mal:${parsed.data.data.mal_id}` !== id) {
      throw new ApiError(502, 'CATALOG_INVALID_RESPONSE', 'El catálogo devolvió datos incompletos.');
    }
    return normalize(parsed.data.data);
  }
}

export async function ensureAnime(db: PrismaClient, catalog: Catalog, id: string) {
  const existing = await db.anime.findUnique({ where: { id } });
  if (existing) return existing;
  const metadata = await catalog.get(id);
  return db.anime.upsert({ where: { id }, create: metadata, update: {} });
}

export async function animeDetail(db: PrismaClient, catalog: Catalog, id: string) {
  const existing = await db.anime.findUnique({ where: { id } });
  let anime = existing;
  let stale = false;
  if (!existing || Date.now() - existing.fetchedAt.getTime() > 86_400_000) {
    try {
      const metadata = await catalog.get(id);
      anime = await db.anime.upsert({
        where: { id }, create: metadata, update: { ...metadata, fetchedAt: new Date() },
      });
    } catch (error) {
      if (!existing || !(error instanceof ApiError) || error.status < 500) throw error;
      stale = true;
    }
  }
  const [ratings, reviews, users] = await db.$transaction([
    db.ratingEntry.aggregate({ where: { animeId: id }, _avg: { rating: true }, _count: true }),
    db.publication.count({ where: { ratingEntry: { animeId: id } } }),
    db.ratingEntry.groupBy({ by: ['userId'], where: { animeId: id }, orderBy: { userId: 'asc' } }),
  ]);
  return { ...anime, metadataStale: stale, statistics: {
    averageRating: ratings._avg.rating, ratingCount: ratings._count,
    reviewCount: reviews, ratingUserCount: users.length,
  } };
}
