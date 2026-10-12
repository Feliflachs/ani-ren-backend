import { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { profileSelect, type Identity } from './auth';
import type { Catalog } from './catalog';
import { ApiError } from './errors';
import { listDto, listInclude } from './lists';
import { pageFields } from './pagination';
import { publicationDto, publicationInclude } from './serializers';
import { animeIdSchema, extractTags, normalizeTag } from './validation';

export const normalizeText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function genresOf(value: Prisma.JsonValue): { id: string; name: string }[] {
  const result = z.array(z.object({ id: z.string(), name: z.string() })).safeParse(value);
  return result.success ? result.data : [];
}
const filters = {
  genres: z.string().max(200).transform((value) => [...new Set(value.split(','))])
    .pipe(z.array(animeIdSchema).min(1).max(10)).optional(),
  season: z.enum(['winter', 'spring', 'summer', 'fall']).optional(),
  year: z.string().regex(/^\d{4}$/).transform(Number).pipe(z.number().min(1900).max(2200)).optional(),
};
type Filters = { genres?: string[]; season?: string; year?: number };
function contextMatches(anime: { genres: Prisma.JsonValue; season: string | null; year: number | null }, query: Filters) {
  return (!query.genres || genresOf(anime.genres).some((genre) => query.genres!.includes(genre.id))) &&
    (!query.season || anime.season === query.season) && (!query.year || anime.year === query.year);
}
const animeContext = { id: true, title: true, genres: true, season: true, year: true } as const;

// La búsqueda inicial recorre textos locales para normalizar tildes de forma
// idéntica a la app, sin depender del LIKE ASCII de SQLite. Solo hidrata la página.
function selectPage<T extends { id: number | string }>(rows: T[], query: { limit?: number; cursor?: string }, scope: string) {
  let before: string | undefined;
  if (query.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
      const data = z.object({ scope: z.string(), id: z.string().min(1).max(100) }).strict()
        .parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      if (data.scope !== scope) throw new Error();
      before = data.id;
    } catch { throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a esta búsqueda.'); }
  }
  const limit = query.limit ?? 20;
  const candidates = rows.filter((row) => !before || (typeof row.id === 'number' ? row.id < Number(before) : row.id < before));
  const items = candidates.slice(0, limit);
  const last = items.at(-1);
  return { items, total: rows.length, nextCursor: candidates.length > limit && last
    ? Buffer.from(JSON.stringify({ scope, id: String(last.id) })).toString('base64url') : null };
}

export function searchRouter(db: PrismaClient, catalog: Catalog) {
  const router = Router();
  router.get('/search', async (req, res) => {
    const { userId } = res.locals.identity as Identity;
    if (req.query.type === 'anime') {
      // El catálogo global mantiene el contrato page/nextPage del adaptador.
      const query = z.object({ type: z.literal('anime'), q: z.string().trim().min(2).max(100),
        page: z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).default(1) }).strict().parse(req.query);
      res.json({ type: 'anime', ...await catalog.search(query.q, query.page) });
      return;
    }
    const query = z.object({ ...pageFields, ...filters, type: z.enum(['users', 'publications', 'lists']),
      q: z.string().trim().max(100).default('') }).strict().parse(req.query);
    if (query.type === 'users' && (query.genres || query.season || query.year)) {
      throw new ApiError(400, 'INVALID_SEARCH_FILTER', 'Los filtros de anime no se aplican a usuarios.');
    }
    const term = normalizeText(query.q);
    const contextFilter = !!(query.genres || query.season || query.year);
    const scope = JSON.stringify(['search', userId, query.type, term, query.genres?.slice().sort() ?? null, query.season ?? null, query.year ?? null]);
    const matches = (text: string) => normalizeText(text).includes(term);
    const result = await db.$transaction(async (tx) => {
      if (query.type === 'users') {
        const users = await tx.user.findMany({ orderBy: { id: 'desc' }, select: profileSelect });
        return selectPage(users.filter((user) => matches(`${user.handle} ${user.name} ${user.bio}`)), query, scope);
      }
      if (query.type === 'lists') {
        const rows = await tx.animeList.findMany({ orderBy: { id: 'desc' }, select: { id: true, title: true, description: true,
          items: { select: { anime: { select: animeContext } } } } });
        const page = selectPage(rows.filter((row) => matches(`${row.title} ${row.description}`) &&
          (!contextFilter || row.items.some((item) => contextMatches(item.anime, query)))), query, scope);
        const lists = await tx.animeList.findMany({ where: { id: { in: page.items.map((row) => row.id) } },
          orderBy: { id: 'desc' }, include: listInclude(userId) });
        return { ...page, items: lists.map(listDto) };
      }
      const rows = await tx.publication.findMany({ orderBy: { id: 'desc' }, select: {
        id: true, title: true, text: true, user: { select: { name: true, handle: true } },
        ratingEntry: { select: { anime: { select: animeContext } } },
        mentions: { select: { anime: { select: animeContext } } },
      } });
      const page = selectPage(rows.filter((row) => {
        const anime = row.ratingEntry ? [row.ratingEntry.anime] : row.mentions.map((mention) => mention.anime);
        const textMatches = term.startsWith('#') ? /^#[\p{L}\p{N}_-]+$/u.test(query.q) && extractTags(row.text).includes(normalizeTag(term))
          : matches(`${row.title ?? ''} ${row.text} ${row.user.name} ${row.user.handle} ${anime.map((item) => item.title).join(' ')}`);
        return textMatches && (!contextFilter || anime.some((item) => contextMatches(item, query)));
      }), query, scope);
      const publications = await tx.publication.findMany({ where: { id: { in: page.items.map((row) => row.id) } },
        orderBy: { id: 'desc' }, include: publicationInclude(userId) });
      return { ...page, items: publications.map(publicationDto) };
    });
    res.json({ type: query.type, ...result });
  });
  return router;
}
