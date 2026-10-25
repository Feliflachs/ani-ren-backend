import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Identity } from '../auth/auth';
import { ensureAnime, type Catalog } from '../catalog/catalog';
import { ApiError } from '../../shared/errors';
import { fingerprint, operationKeySchema, replay, saveOperation } from '../../shared/operations';
import { publicationDto, publicationInclude } from '../../shared/serializers';
import { uniqueAnimeIds, resourceIdSchema } from '../../shared/validation';

const postFields = {
  text: z.string().trim().min(3).max(2000),
  title: z.string().trim().max(100).nullable().optional(),
  spoiler: z.boolean().optional(),
  animeIds: uniqueAnimeIds(10).optional(),
};
const createSchema = z.object(postFields).strict();
const editSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, 'Indicá un cambio.');

export function postsRouter(db: PrismaClient, catalog: Catalog) {
  const router = Router();
  router.post('/posts', async (req, res) => {
    const input = createSchema.parse(req.body);
    const data = { ...input, title: input.title || null, spoiler: input.spoiler ?? false, animeIds: input.animeIds ?? [] };
    const { userId } = res.locals.identity as Identity;
    const key = operationKeySchema.parse(req.get('Idempotency-Key'));
    const hash = fingerprint('post', data);
    const saved = await replay(db, userId, key, hash);
    if (saved !== null) { res.status(201).json(saved); return; }
    // Resolver el catálogo antes de abrir la transacción SQLite.
    for (const id of data.animeIds) await ensureAnime(db, catalog, id);
    const response = await saveOperation(db, userId, key, hash, async (tx) => {
      const publication = await tx.publication.create({ data: {
        userId, kind: 'post', text: data.text, title: data.title, spoiler: data.spoiler,
        mentions: { create: data.animeIds.map((animeId, position) => ({ animeId, position })) },
      }, include: publicationInclude(userId) });
      return { publication: publicationDto(publication) };
    });
    res.status(201).json(response);
  });
  router.patch('/posts/:id', async (req, res) => {
    const id = resourceIdSchema.parse(req.params.id);
    const { userId } = res.locals.identity as Identity;
    const { animeIds, title, ...changes } = editSchema.parse(req.body);
    const existing = await db.publication.findUnique({ where: { id } });
    if (!existing || existing.kind !== 'post') throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Posteo no encontrado.');
    if (existing.userId !== userId) throw new ApiError(403, 'NOT_OWNER', 'Solo el autor puede editar este posteo.');
    for (const animeId of animeIds ?? []) await ensureAnime(db, catalog, animeId);
    const publication = await db.$transaction(async (tx) => {
      if (animeIds !== undefined) await tx.publicationAnime.deleteMany({ where: { publicationId: id } });
      return tx.publication.update({ where: { id }, data: {
        ...changes, title: title === undefined ? undefined : title || null, updatedAt: new Date(),
        mentions: animeIds === undefined ? undefined : {
          create: animeIds.map((animeId, position) => ({ animeId, position })),
        },
      }, include: publicationInclude(userId) });
    });
    res.json({ publication: publicationDto(publication) });
  });
  return router;
}
