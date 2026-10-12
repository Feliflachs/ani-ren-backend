import { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { profileSelect, type Identity } from './auth';
import { ensureAnime, type Catalog } from './catalog';
import { ApiError } from './errors';
import { fingerprint, operationKeySchema, replay, saveOperation } from './operations';
import { pageFields, pageResult, readPage } from './pagination';
import { animeIdSchema, resourceIdSchema, uniqueAnimeIds } from './validation';

export const listInclude = (userId: string) => ({
  user: { select: profileSelect },
  items: { orderBy: { position: 'asc' as const }, include: { anime: true } },
  likes: { where: { userId }, select: { userId: true } },
  _count: { select: { likes: true } },
}) satisfies Prisma.AnimeListInclude;
export function listDto(row: Prisma.AnimeListGetPayload<{ include: ReturnType<typeof listInclude> }>) {
  return { id: String(row.id), userId: row.userId, author: row.user, title: row.title,
    description: row.description, ordered: row.ordered, animeIds: row.items.map((item) => item.animeId),
    items: row.items.map((item) => ({ anime: item.anime, position: item.position })),
    itemCount: row.items.length, likeCount: row._count.likes, likedByMe: row.likes.length > 0,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt?.toISOString() ?? null };
}
const fields = {
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().max(2000),
  ordered: z.boolean(),
  animeIds: uniqueAnimeIds(100).min(1),
};
const createSchema = z.object({ ...fields, description: fields.description.default(''), ordered: fields.ordered.default(false) }).strict();
const editSchema = z.object(fields).partial().strict().refine((data) => Object.keys(data).length > 0, 'Indicá un cambio.');

export function listsRouter(db: PrismaClient, catalog: Catalog) {
  const router = Router();
  router.get('/lists', async (req, res) => {
    const { userId } = res.locals.identity as Identity;
    const query = z.object({ ...pageFields, userId: z.string().min(1).max(100).optional(), animeId: animeIdSchema.optional() }).strict().parse(req.query);
    const page = readPage(query, JSON.stringify(['lists', userId, query.userId ?? null, query.animeId ?? null]));
    const where: Prisma.AnimeListWhereInput = { userId: query.userId, items: query.animeId ? { some: { animeId: query.animeId } } : undefined };
    const [rows, total] = await db.$transaction([
      db.animeList.findMany({ where: { ...where, id: page.before ? { lt: page.before } : undefined },
        orderBy: { id: 'desc' }, take: page.limit + 1, include: listInclude(userId) }),
      db.animeList.count({ where }),
    ]);
    res.json(pageResult(rows, total, page, listDto));
  });
  router.get('/lists/:id', async (req, res) => {
    const id = resourceIdSchema.parse(req.params.id);
    const { userId } = res.locals.identity as Identity;
    const list = await db.animeList.findUnique({ where: { id }, include: listInclude(userId) });
    if (!list) throw new ApiError(404, 'LIST_NOT_FOUND', 'Lista no encontrada.');
    res.json({ list: listDto(list) });
  });
  router.post('/lists', async (req, res) => {
    const data = createSchema.parse(req.body);
    const { userId } = res.locals.identity as Identity;
    const key = operationKeySchema.parse(req.get('Idempotency-Key'));
    const hash = fingerprint('list', data);
    const saved = await replay(db, userId, key, hash);
    if (saved !== null) { res.status(201).json(saved); return; }
    for (const animeId of data.animeIds) await ensureAnime(db, catalog, animeId);
    const response = await saveOperation(db, userId, key, hash, async (tx) => {
      const { animeIds, ...attributes } = data;
      const list = await tx.animeList.create({ data: { ...attributes, userId,
        items: { create: animeIds.map((animeId, position) => ({ animeId, position })) },
      }, include: listInclude(userId) });
      return { list: listDto(list) };
    });
    res.status(201).json(response);
  });
  router.patch('/lists/:id', async (req, res) => {
    const id = resourceIdSchema.parse(req.params.id);
    const { userId } = res.locals.identity as Identity;
    const { animeIds, ...changes } = editSchema.parse(req.body);
    const existing = await db.animeList.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) throw new ApiError(404, 'LIST_NOT_FOUND', 'Lista no encontrada.');
    if (existing.userId !== userId) throw new ApiError(403, 'NOT_OWNER', 'Solo el autor puede editar esta lista.');
    for (const animeId of animeIds ?? []) await ensureAnime(db, catalog, animeId);
    const list = await db.$transaction(async (tx) => {
      if (animeIds !== undefined) await tx.listItem.deleteMany({ where: { listId: id } });
      return tx.animeList.update({ where: { id }, data: { ...changes, updatedAt: new Date(),
        items: animeIds === undefined ? undefined : { create: animeIds.map((animeId, position) => ({ animeId, position })) },
      }, include: listInclude(userId) });
    });
    res.json({ list: listDto(list) });
  });
  for (const method of ['put', 'delete'] as const) {
    router[method]('/lists/:id/like', async (req, res) => {
      z.object({}).strict().parse(req.body ?? {});
      const listId = resourceIdSchema.parse(req.params.id);
      const { userId } = res.locals.identity as Identity;
      const result = await db.$transaction(async (tx) => {
        if (!await tx.animeList.findUnique({ where: { id: listId }, select: { id: true } })) {
          throw new ApiError(404, 'LIST_NOT_FOUND', 'Lista no encontrada.');
        }
        const pair = { userId, listId };
        if (method === 'put') await tx.listLike.upsert({ where: { userId_listId: pair }, create: pair, update: {} });
        else await tx.listLike.deleteMany({ where: pair });
        return { listId: String(listId), likedByMe: method === 'put', likeCount: await tx.listLike.count({ where: { listId } }) };
      });
      res.json(result);
    });
  }
  return router;
}
