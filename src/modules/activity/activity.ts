import { awardCompletedMissions } from '../aura/aura.service';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Catalog } from '../catalog/catalog';
import { ensureAnime } from '../catalog/catalog';
import type { Identity } from '../auth/auth';
import { ApiError } from '../../shared/errors';
import { activitySchemas, resourceIdSchema } from '../../shared/validation';
import { fingerprint, operationKeySchema, replay, saveOperation } from '../../shared/operations';
import { publicationDto, publicationInclude, ratingDto, ratingInclude } from '../../shared/serializers';

export function activityRouter(db: PrismaClient, catalog: Catalog, timeZone: string) {
  const router = Router();
  const schemas = activitySchemas(timeZone);

  router.post('/ratings', async (req, res) => {
    const input = schemas.ratingCreate.parse(req.body);
    const data = { ...input, watchedOn: input.watchedOn ?? null, rewatched: input.rewatched ?? false };
    const { userId } = res.locals.identity as Identity;
    const key = operationKeySchema.parse(req.get('Idempotency-Key'));
    const hash = fingerprint('rating', data);
    const saved = await replay(db, userId, key, hash);
    if (saved !== null) { res.status(201).json(saved); return; }
    await ensureAnime(db, catalog, data.animeId);
    const response = await saveOperation(db, userId, key, hash, async (tx) => {
      const rating = await tx.ratingEntry.create({ data: { ...data, userId }, include: ratingInclude });
      await tx.libraryEntry.upsert({
        where: { userId_animeId: { userId, animeId: data.animeId } },
        create: { userId, animeId: data.animeId, watched: true, currentRatingId: rating.id },
        update: { watched: true, currentRatingId: rating.id },
      });
      await awardCompletedMissions(tx, userId);
      return { rating: ratingDto(rating) };
    });
    res.status(201).json(response);
  });

  router.post('/reviews', async (req, res) => {
    const input = schemas.reviewCreate.parse(req.body);
    const data = { ...input, title: input.title || null, watchedOn: input.watchedOn ?? null,
      rewatched: input.rewatched ?? false, spoiler: input.spoiler ?? false };
    const { userId } = res.locals.identity as Identity;
    const key = operationKeySchema.parse(req.get('Idempotency-Key'));
    const hash = fingerprint('review', data);
    const saved = await replay(db, userId, key, hash);
    if (saved !== null) { res.status(201).json(saved); return; }
    await ensureAnime(db, catalog, data.animeId);
    const response = await saveOperation(db, userId, key, hash, async (tx) => {
      const rating = await tx.ratingEntry.create({ data: {
        userId, animeId: data.animeId, rating: data.rating,
        watchedOn: data.watchedOn, rewatched: data.rewatched, countryCode: data.countryCode,
      } });
      const publication = await tx.publication.create({ data: {
        userId, ratingEntryId: rating.id, text: data.text, title: data.title, spoiler: data.spoiler,
      }, include: publicationInclude(userId) });
      await tx.libraryEntry.upsert({
        where: { userId_animeId: { userId, animeId: data.animeId } },
        create: { userId, animeId: data.animeId, watched: true, currentRatingId: rating.id },
        update: { watched: true, currentRatingId: rating.id },
      });
      await awardCompletedMissions(tx, userId);
      return { publication: publicationDto(publication) };
    });
    res.status(201).json(response);
  });

  router.patch('/ratings/:id', async (req, res) => {
    const id = resourceIdSchema.parse(req.params.id);
    const changes = schemas.ratingEdit.parse(req.body);
    const { userId } = res.locals.identity as Identity;
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.ratingEntry.findUnique({ where: { id }, include: ratingInclude });
      if (!existing) throw new ApiError(404, 'RATING_NOT_FOUND', 'Valoración no encontrada.');
      if (existing.userId !== userId) throw new ApiError(403, 'NOT_OWNER', 'Solo el autor puede editar esta valoración.');
      if (existing.publication) throw new ApiError(409, 'EDIT_REVIEW', 'Editá esta valoración desde su review.');
      if (changes.rating !== undefined && changes.rating !== existing.rating) {
        await tx.libraryEntry.update({ where: { userId_animeId: { userId, animeId: existing.animeId } },
          data: { currentRatingId: id } });
      }
      return tx.ratingEntry.update({ where: { id }, data: { ...changes, updatedAt: new Date() }, include: ratingInclude });
    });
    res.json({ rating: ratingDto(result) });
  });

  router.patch('/reviews/:id', async (req, res) => {
    const id = resourceIdSchema.parse(req.params.id);
    const { userId } = res.locals.identity as Identity;
    const { title, text, spoiler, ...ratingChanges } = schemas.reviewEdit.parse(req.body);
    const publication = await db.$transaction(async (tx) => {
      const existing = await tx.publication.findUnique({ where: { id }, include: { ratingEntry: true } });
      if (!existing || existing.kind !== 'review' || existing.ratingEntryId === null) {
        throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Review no encontrada.');
      }
      if (existing.userId !== userId) throw new ApiError(403, 'NOT_OWNER', 'Solo el autor puede editar esta review.');
      const updatedAt = new Date();
      if (existing.ratingEntry && ratingChanges.rating !== undefined && ratingChanges.rating !== existing.ratingEntry.rating) {
        await tx.libraryEntry.update({ where: { userId_animeId: { userId, animeId: existing.ratingEntry.animeId } },
          data: { currentRatingId: existing.ratingEntryId } });
      }
      if (Object.keys(ratingChanges).length > 0) {
        await tx.ratingEntry.update({ where: { id: existing.ratingEntryId }, data: { ...ratingChanges, updatedAt } });
      }
      return tx.publication.update({ where: { id }, data: {
        title: title === undefined ? undefined : title || null, text, spoiler, updatedAt,
      }, include: publicationInclude(userId) });
    });
    res.json({ publication: publicationDto(publication) });
  });
  return router;
}
