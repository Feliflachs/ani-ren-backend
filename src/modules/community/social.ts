import { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { profileSelect, type Identity } from '../auth/auth';
import { ApiError } from '../../shared/errors';
import { pageFields, pageResult, readPage } from '../../shared/pagination';
import { fingerprint, operationKeySchema, saveOperation } from '../../shared/operations';
import { commentDto, commentInclude, publicationDto, publicationInclude } from '../../shared/serializers';
import { resourceIdSchema } from '../../shared/validation';
import { rankProgress } from '../aura/aura';

const userIdSchema = z.string().min(1).max(100);
const emptyBody = z.object({}).strict();
type Database = PrismaClient | Prisma.TransactionClient;

async function requireUser(db: Database, id: string) {
  const user = await db.user.findUnique({ where: { id }, select: profileSelect });
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  return user;
}
async function requirePublication(db: Database, id: number) {
  if (!await db.publication.findUnique({ where: { id }, select: { id: true } })) {
    throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Publicación no encontrada.');
  }
}
const reciprocal = (userId: string): Prisma.FollowWhereInput => ({
  followerId: userId, followed: { following: { some: { followedId: userId } } },
});

export function socialRouter(db: PrismaClient) {
  const router = Router();
  router.patch('/me/profile', async (req, res) => {
    const data = z.object({ name: z.string().trim().min(1).max(60).optional(),
      bio: z.string().trim().max(500).optional(),
      avatarId: z.string().min(1).max(100).nullable().optional(),
      avatarUrl: z.url({ protocol: /^https$/ }).max(2000).refine(value => {
        const url = new URL(value); return !url.username && !url.password;
      }).nullable().optional() }).strict()
      .refine((value) => Object.keys(value).length > 0, 'Indicá un cambio.').parse(req.body);
    const { userId } = res.locals.identity as Identity;
    if (data.avatarId !== undefined && data.avatarUrl !== undefined) {
      throw new ApiError(400, 'INVALID_AVATAR', 'Elegí un avatar del catálogo o una URL, no ambos.');
    }
    const user = await db.$transaction(async (tx) => {
      if (data.avatarId !== undefined) {
        const avatar = data.avatarId === null ? null : await tx.avatar.findFirst({ where: { id: data.avatarId, active: true } });
        if (data.avatarId !== null && !avatar) throw new ApiError(400, 'INVALID_AVATAR', 'Este avatar no está disponible.');
        data.avatarUrl = avatar?.imageUrl ?? null;
      } else if (data.avatarUrl !== undefined) data.avatarId = null;
      return tx.user.update({ where: { id: userId }, data, select: profileSelect });
    });
    res.json({ user });
  });
  router.get('/users/:id', async (req, res) => {
    const id = userIdSchema.parse(req.params.id);
    const { userId } = res.locals.identity as Identity;
    const user = await db.$transaction(async (tx) => {
      const profile = await requireUser(tx, id);
      const points = (await tx.missionClaim.aggregate({ where: { userId: id }, _sum: { points: true } }))._sum.points ?? 0;
      const watched = await tx.libraryEntry.count({ where: { userId: id, watched: true } });
      const watchlist = await tx.libraryEntry.count({ where: { userId: id, watchlist: true } });
      const reviews = await tx.publication.count({ where: { userId: id, kind: 'review' } });
      const posts = await tx.publication.count({ where: { userId: id, kind: 'post' } });
      const followers = await tx.follow.count({ where: { followedId: id } });
      const following = await tx.follow.count({ where: { followerId: id } });
      const friends = await tx.follow.count({ where: reciprocal(id) });
      const outgoing = await tx.follow.findUnique({ where: { followerId_followedId: { followerId: userId, followedId: id } } });
      const incoming = await tx.follow.findUnique({ where: { followerId_followedId: { followerId: id, followedId: userId } } });
      const favorites = await tx.libraryEntry.findMany({ where: { userId: id, favoritePosition: { not: null } },
        orderBy: { favoritePosition: 'asc' }, include: { anime: true } });
      return { ...profile, auraPoints: points, rank: rankProgress(points), statistics: { watched, watchlist, reviews, posts, followers, following, friends },
        isMe: userId === id, isFollowing: !!outgoing, followsMe: !!incoming, isFriend: !!outgoing && !!incoming,
        favorites: favorites.map((entry) => ({ anime: entry.anime, position: entry.favoritePosition })) };
    });
    res.json({ user });
  });

  for (const method of ['put', 'delete'] as const) {
    router[method]('/me/following/:userId', async (req, res) => {
      emptyBody.parse(req.body ?? {});
      const followedId = userIdSchema.parse(req.params.userId);
      const { userId: followerId } = res.locals.identity as Identity;
      if (followerId === followedId) throw new ApiError(400, 'SELF_FOLLOW', 'No podés seguirte a vos mismo.');
      const result = await db.$transaction(async (tx) => {
        await requireUser(tx, followedId);
        const pair = { followerId, followedId };
        if (method === 'put') await tx.follow.upsert({ where: { followerId_followedId: pair }, create: pair, update: {} });
        else await tx.follow.deleteMany({ where: pair });
        const incoming = await tx.follow.findUnique({ where: {
          followerId_followedId: { followerId: followedId, followedId: followerId },
        } });
        return { userId: followedId, isFollowing: method === 'put', followsMe: !!incoming,
          isFriend: method === 'put' && !!incoming };
      });
      res.json(result);
    });
  }

  for (const collection of ['followers', 'following', 'friends'] as const) {
    router.get(`/users/:id/${collection}`, async (req, res) => {
      const id = userIdSchema.parse(req.params.id);
      await requireUser(db, id);
      const query = z.object(pageFields).strict().parse(req.query);
      const page = readPage(query, `${collection}:${id}`);
      const where: Prisma.FollowWhereInput = collection === 'followers' ? { followedId: id }
        : collection === 'friends' ? reciprocal(id) : { followerId: id };
      const [rows, total] = await db.$transaction([
        db.follow.findMany({ where: { ...where, id: page.before ? { lt: page.before } : undefined },
          orderBy: { id: 'desc' }, take: page.limit + 1,
          include: { follower: { select: profileSelect }, followed: { select: profileSelect } } }),
        db.follow.count({ where }),
      ]);
      res.json(pageResult(rows, total, page, (row) => collection === 'followers' ? row.follower : row.followed));
    });
  }

  for (const method of ['put', 'delete'] as const) {
    router[method]('/publications/:id/like', async (req, res) => {
      emptyBody.parse(req.body ?? {});
      const publicationId = resourceIdSchema.parse(req.params.id);
      const { userId } = res.locals.identity as Identity;
      const result = await db.$transaction(async (tx) => {
        await requirePublication(tx, publicationId);
        const pair = { userId, publicationId };
        if (method === 'put') await tx.publicationLike.upsert({ where: { userId_publicationId: pair }, create: pair, update: {} });
        else await tx.publicationLike.deleteMany({ where: pair });
        return { publicationId: String(publicationId), likedByMe: method === 'put',
          likeCount: await tx.publicationLike.count({ where: { publicationId } }) };
      });
      res.json(result);
    });
  }

  router.get('/publications/:id/comments', async (req, res) => {
    const publicationId = resourceIdSchema.parse(req.params.id);
    await requirePublication(db, publicationId);
    const query = z.object({ ...pageFields, parentId: resourceIdSchema.optional() }).strict().parse(req.query);
    const parentId = query.parentId ?? null;
    if (parentId !== null && !await db.comment.findFirst({ where: { id: parentId, publicationId, parentId: null } }))
      throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comentario no encontrado.');
    const page = readPage(query, `comments:${publicationId}:${parentId ?? 'root'}`);
    const [rows, total] = await db.$transaction([
      db.comment.findMany({ where: { publicationId, parentId, id: page.before ? { lt: page.before } : undefined },
        orderBy: { id: 'desc' }, take: page.limit + 1, include: commentInclude }),
      db.comment.count({ where: { publicationId, parentId } }),
    ]);
    res.json(pageResult(rows, total, page, commentDto));
  });
  router.post('/publications/:id/comments', async (req, res) => {
    const publicationId = resourceIdSchema.parse(req.params.id);
    const { text, parentId = null } = z.object({ text: z.string().trim().min(1).max(2000),
      parentId: resourceIdSchema.optional() }).strict().parse(req.body);
    const { userId } = res.locals.identity as Identity;
    const key = operationKeySchema.parse(req.get('Idempotency-Key'));
    const hash = fingerprint('comment', { publicationId, text, ...(parentId === null ? {} : { parentId }) });
    const response = await saveOperation(db, userId, key, hash, async (tx) => {
      await requirePublication(tx, publicationId);
      if (parentId !== null && !await tx.comment.findFirst({ where: { id: parentId, publicationId, parentId: null } }))
        throw new ApiError(400, 'INVALID_REPLY', 'Respondé a un comentario principal de esta publicación.');
      const comment = await tx.comment.create({ data: { publicationId, userId, text, parentId }, include: commentInclude });
      return { comment: commentDto(comment) };
    });
    res.status(201).json(response);
  });
  router.delete('/publications/:id', async (req, res) => {
    const id = resourceIdSchema.parse(req.params.id);
    emptyBody.parse(req.body ?? {});
    const { userId } = res.locals.identity as Identity;
    await db.$transaction(async tx => {
      const publication = await tx.publication.findUnique({ where: { id } });
      if (!publication) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Publicación no encontrada.');
      if (publication.userId !== userId) throw new ApiError(403, 'NOT_OWNER', 'Solo el autor puede eliminar esta publicación.');
      await tx.publication.delete({ where: { id } });
      // DTO snapshots must not resurrect removed publications on later pages.
      await tx.querySnapshot.deleteMany({});
    });
    res.json({ deletedPublicationId: String(id) });
  });
  router.get('/feed', async (req, res) => {
    const query = z.object({ ...pageFields, type: z.literal('following') }).strict().parse(req.query);
    const { userId } = res.locals.identity as Identity;
    const page = readPage(query, `following-feed:${userId}`);
    const where: Prisma.PublicationWhereInput = { user: { followers: { some: { followerId: userId } } } };
    const [rows, total] = await db.$transaction([
      db.publication.findMany({ where: { ...where, id: page.before ? { lt: page.before } : undefined },
        orderBy: { id: 'desc' }, take: page.limit + 1, include: publicationInclude(userId) }),
      db.publication.count({ where }),
    ]);
    res.json(pageResult(rows, total, page, publicationDto));
  });
  return router;
}
