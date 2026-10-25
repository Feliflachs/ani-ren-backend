import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from '../auth/auth';
import { animeIdSchema } from '../../shared/validation';
import { pageFields, readPage, pageResult } from '../../shared/pagination';
import { selectionPage } from '../../shared/selection';
import { initialGenres } from '../aura/aura.rules';
import { genresOf } from '../search/search';
import { publicationDto, publicationInclude } from '../../shared/serializers';
import { ratingEvents, animeTotals, sortTop, countryTotals, since } from './explore.service';
import { parseCountry, countryInfo } from './countries';

const periodSchema = z.enum(['week', 'month', 'all']);
const mapQuery = z.object({ period: periodSchema.default('all'),
  metric: z.enum(['reviews', 'views', 'popularity', 'anime']).default('views'), animeId: animeIdSchema.optional() }).strict()
  .refine(query => query.metric !== 'anime' || !!query.animeId, 'Indicá animeId para comparar un anime.');

export function exploreRouter(db: PrismaClient) {
  const router = Router();
  router.get('/explore', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const data = await db.$transaction(async tx => {
      const catalog = await tx.anime.findMany({ select: { genres: true } });
      const genres = new Map(initialGenres.map(genre => [genre.id, genre]));
      for (const anime of catalog) for (const genre of genresOf(anime.genres)) if (!genres.has(genre.id)) genres.set(genre.id, genre);
      const year = new Date().getUTCFullYear();
      return { genres: [...genres.values()], seasons: ['spring', 'summer', 'fall', 'winter'].map(season => ({ season, year })),
        trending: sortTop(animeTotals(await ratingEvents(tx, 'week')), 'trending').slice(0, 4), source: 'ani-ren', period: 'week' };
    });
    res.json(data);
  });
  router.get('/explore/tops', async (req, res) => {
    const query = z.object({ ...pageFields, period: periodSchema.default('week'),
      criterion: z.enum(['rating', 'views', 'trending']).default('rating'), genre: animeIdSchema.optional() }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    const page = await selectionPage(db, userId, JSON.stringify(['tops', query.period, query.criterion, query.genre ?? null]), query,
      async tx => sortTop(animeTotals(await ratingEvents(tx, query.period), query.genre), query.criterion)
        .map((row, index) => ({ ...row, position: index + 1 })));
    res.json({ ...page, source: 'ani-ren', period: query.period, criterion: query.criterion });
  });
  router.get('/explore/map', async (req, res) => {
    const query = mapQuery.parse(req.query);
    const events = await db.$transaction(tx => ratingEvents(tx, query.period));
    const selected = events.filter(event => !query.animeId || event.animeId === query.animeId);
    res.json({ source: 'ani-ren', ...query, items: countryTotals(events, query.metric, query.animeId),
      unknownCountryViews: selected.filter(event => !event.countryCode).length,
      generatedAt: new Date().toISOString() });
  });
  router.get('/explore/countries/:country', async (req, res) => {
    const code = parseCountry(z.string().parse(req.params.country));
    const query = z.object({ period: periodSchema.default('all'), animeId: animeIdSchema.optional() }).strict().parse(req.query);
    const result = await db.$transaction(async tx => {
      const all = await ratingEvents(tx, query.period);
      const local = all.filter(event => event.countryCode === code && (!query.animeId || event.animeId === query.animeId));
      const totals = animeTotals(local, undefined, true);
      const recent = await ratingEvents(tx, 'week', code, query.animeId);
      return { country: countryInfo(code), period: query.period, source: 'ani-ren',
        statistics: { views: local.length, reviews: local.filter(event => event.publication).length,
          averageRating: local.length ? local.reduce((sum, event) => sum + event.rating, 0) / local.length : null },
        topRated: sortTop(totals, 'rating').slice(0, 5),
        trending: sortTop(animeTotals(recent, undefined, true), 'trending').slice(0, 5), trendingPeriod: 'week',
        comparison: countryTotals(all, query.animeId ? 'anime' : 'views', query.animeId) };
    });
    res.json(result);
  });
  router.get('/explore/countries/:country/reviews', async (req, res) => {
    const code = parseCountry(z.string().parse(req.params.country));
    const query = z.object({ ...pageFields, period: periodSchema.default('all'), animeId: animeIdSchema.optional() }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    const page = readPage(query, JSON.stringify(['country-reviews', userId, code, query.period, query.animeId ?? null]));
    const where = { kind: 'review', ratingEntry: { countryCode: code, animeId: query.animeId, createdAt: { gte: since(query.period) } } };
    const [rows, total] = await db.$transaction([
      db.publication.findMany({ where: { ...where, id: page.before ? { lt: page.before } : undefined },
        orderBy: { id: 'desc' }, take: page.limit + 1, include: publicationInclude(userId) }), db.publication.count({ where }),
    ]);
    res.json(pageResult(rows, total, page, publicationDto));
  });
  return router;
}
