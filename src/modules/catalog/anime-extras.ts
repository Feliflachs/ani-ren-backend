import { setTimeout as delay } from 'node:timers/promises';
import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../shared/errors';
import { animeIdSchema } from '../../shared/validation';
import { networkCodes } from './catalog-errors';

export const ANILIST_URL = 'https://graphql.anilist.co';
const query = `query AniRenExtras($idMal: Int!, $page: Int!) {
  Media(idMal: $idMal, type: ANIME) {
    id idMal
    externalLinks { id url site language type isDisabled }
    characters(page: $page, perPage: 10, sort: [ROLE, ID]) {
      pageInfo { hasNextPage }
      edges {
        role
        node { id name { full } image { medium } }
        voiceActors(language: JAPANESE) { id name { full } image { medium } }
      }
    }
  }
}`;
const person = z.object({ id: z.number().int().positive(), name: z.object({ full: z.string().nullable() }),
  image: z.object({ medium: z.string().nullable() }).nullable() });
const responseSchema = z.object({ data: z.object({ Media: z.object({
  id: z.number().int().positive(), idMal: z.number().int().positive(),
  externalLinks: z.array(z.object({ id: z.number().int(), url: z.string().nullable(), site: z.string(),
    language: z.string().nullable(), type: z.string().nullable(), isDisabled: z.boolean().nullable(),
  }).nullable()).nullable(),
  characters: z.object({ pageInfo: z.object({ hasNextPage: z.boolean() }),
    edges: z.array(z.object({ role: z.string().nullable(), node: person,
      voiceActors: z.array(person.nullable()).nullable(),
    }).nullable()),
  }),
}).nullable() }) });
const httpsUrl = z.url({ protocol: /^https$/ });
function safeUrl(value: string | null | undefined) {
  return value && httpsUrl.safeParse(value).success ? value : null;
}
function personDto(value: z.infer<typeof person>) {
  return { id: value.id, name: value.name.full, imageUrl: safeUrl(value.image?.medium) };
}

export type AnimeExtras = {
  animeId: string; source: 'anilist'; anilistId: number; fetchedAt: string;
  regionalAvailability: 'unknown';
  streamingLinks: { id: number; site: string; url: string; language: string | null }[];
  characters: { role: string | null; character: ReturnType<typeof personDto>; voiceActors: ReturnType<typeof personDto>[] }[];
  voiceActorLanguage: 'JAPANESE'; page: number; nextPage: number | null;
};
export interface AnimeExtrasProvider { get(id: string, page: number): Promise<AnimeExtras> }

// Metadatos complementarios: no cambia identidades, ratings ni el catálogo principal.
export class AniListExtras implements AnimeExtrasProvider {
  private cache = new Map<string, { value: AnimeExtras; expires: number }>();
  private pending = new Map<string, Promise<AnimeExtras>>();
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;
  private blockedUntil = 0;
  constructor(private fetcher: typeof fetch = fetch) {}

  async get(id: string, page = 1): Promise<AnimeExtras> {
    animeIdSchema.parse(id);
    const malId = z.number().int().positive().max(2147483647).parse(Number(id.slice(4)));
    z.number().int().min(1).max(1000).parse(page);
    const key = `${id}:${page}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    const pending = this.pending.get(key);
    if (pending) return structuredClone(await pending);
    if (this.blockedUntil > Date.now()) throw new ApiError(503, 'ANILIST_RATE_LIMIT', 'AniList alcanzó su límite. Reintentá más tarde.');
    if (this.pending.size >= 10) throw new ApiError(503, 'ANILIST_BUSY', 'La consulta de datos complementarios está ocupada.');
    const work = this.queue.then(async () => {
      await delay(Math.max(0, this.nextRequestAt - Date.now()));
      if (this.blockedUntil > Date.now()) throw new ApiError(503, 'ANILIST_RATE_LIMIT', 'AniList alcanzó su límite. Reintentá más tarde.');
      this.nextRequestAt = Date.now() + 2100;
      const result = await this.fetchExtras(id, malId, page);
      if (this.cache.size >= 50) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { value: result, expires: Date.now() + 3_600_000 });
      return result;
    });
    this.pending.set(key, work);
    this.queue = work.catch(() => undefined);
    try { return structuredClone(await work); } finally { this.pending.delete(key); }
  }

  private async fetchExtras(id: string, malId: number, page: number): Promise<AnimeExtras> {
    let response: Response;
    let body: unknown;
    try {
      response = await this.fetcher(ANILIST_URL, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { idMal: malId, page } }), signal: AbortSignal.timeout(8000) });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 60;
        this.blockedUntil = Date.now() + Math.max(60, Math.min(seconds, 3600)) * 1000;
        throw new ApiError(503, 'ANILIST_RATE_LIMIT', 'AniList alcanzó su límite. Reintentá más tarde.');
      }
      if (response.status === 404) throw new ApiError(404, 'ANILIST_NOT_FOUND', 'AniList no tiene datos para este anime.');
      if (!response.ok) throw new ApiError(502, 'ANILIST_ERROR', 'AniList no pudo responder la consulta.');
      body = await response.json();
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      if (cause instanceof SyntaxError) throw new ApiError(502, 'ANILIST_INVALID_RESPONSE', 'AniList devolvió JSON inválido.');
      const timeout = networkCodes(cause).some((code) => /TIMEOUT|TIMEDOUT/.test(code));
      throw new ApiError(503, timeout ? 'ANILIST_TIMEOUT' : 'ANILIST_UNAVAILABLE',
        timeout ? 'Se agotó el tiempo de espera de AniList.' : 'No pudimos conectar con AniList.', { cause });
    }
    // GraphQL puede devolver errores junto con HTTP 200 y datos parciales.
    const errors = z.object({ errors: z.array(z.unknown()).min(1) }).safeParse(body);
    if (errors.success) throw new ApiError(502, 'ANILIST_GRAPHQL_ERROR', 'AniList no pudo completar la consulta.');
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(502, 'ANILIST_INVALID_RESPONSE', 'AniList devolvió datos incompletos.');
    const media = parsed.data.data.Media;
    if (!media) throw new ApiError(404, 'ANILIST_NOT_FOUND', 'AniList no tiene datos para este anime.');
    if (media.idMal !== malId) throw new ApiError(502, 'ANILIST_INVALID_RESPONSE', 'AniList devolvió otro anime.');
    return { animeId: id, source: 'anilist', anilistId: media.id, fetchedAt: new Date().toISOString(),
      regionalAvailability: 'unknown', voiceActorLanguage: 'JAPANESE', page,
      nextPage: media.characters.pageInfo.hasNextPage ? page + 1 : null,
      streamingLinks: (media.externalLinks ?? []).flatMap((link) => {
        const url = safeUrl(link?.url);
        return link && link.type === 'STREAMING' && !link.isDisabled && url
          ? [{ id: link.id, site: link.site, url, language: link.language }] : [];
      }),
      characters: media.characters.edges.flatMap((edge) => edge ? [{ role: edge.role,
        character: personDto(edge.node), voiceActors: (edge.voiceActors ?? []).flatMap((actor) => actor ? [personDto(actor)] : []),
      }] : []),
    };
  }
}

export function animeExtrasRouter(provider: AnimeExtrasProvider) {
  const router = Router();
  router.get('/anime/:id/extras', async (req, res) => {
    const id = animeIdSchema.parse(req.params.id);
    const { page } = z.object({ page: z.string().regex(/^[1-9]\d{0,3}$/).transform(Number)
      .pipe(z.number().max(1000)).default(1) }).strict().parse(req.query);
    res.json({ extras: await provider.get(id, page) });
  });
  return router;
}
