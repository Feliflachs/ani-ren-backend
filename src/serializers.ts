import type { Prisma } from '@prisma/client';
import { profileSelect } from './auth';
import { extractTags } from './validation';

// Solo traer el like del lector, no todas las personas que dieron like.
export const publicationInclude = (viewerId: string) => ({
  user: { select: profileSelect }, ratingEntry: { include: { anime: true } },
  mentions: { orderBy: { position: 'asc' as const }, include: { anime: true } },
  likes: { where: { userId: viewerId }, select: { userId: true } },
  _count: { select: { likes: true, comments: true } },
}) satisfies Prisma.PublicationInclude;
type PublicationWithRelations = Prisma.PublicationGetPayload<{ include: ReturnType<typeof publicationInclude> }>;

export function publicationDto(row: PublicationWithRelations) {
  return {
    id: String(row.id), kind: row.kind, userId: row.userId, author: row.user,
    animeId: row.ratingEntry?.animeId ?? null, ratingEntryId: row.ratingEntryId === null ? null : String(row.ratingEntryId),
    anime: row.ratingEntry?.anime ?? null,
    rating: row.ratingEntry?.rating ?? null, watchedOn: row.ratingEntry?.watchedOn ?? null,
    rewatched: row.ratingEntry?.rewatched ?? false, title: row.title, text: row.text,
    animeIds: row.ratingEntry ? [row.ratingEntry.animeId] : row.mentions.map((mention) => mention.animeId),
    mentionedAnime: row.mentions.map((mention) => mention.anime),
    likeCount: row._count.likes, commentCount: row._count.comments, likedByMe: row.likes.length > 0,
    spoiler: row.spoiler, tags: extractTags(row.text),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export const commentInclude = { user: { select: profileSelect } } as const;
export function commentDto(row: Prisma.CommentGetPayload<{ include: typeof commentInclude }>) {
  return { id: String(row.id), publicationId: String(row.publicationId), userId: row.userId,
    author: row.user, text: row.text, createdAt: row.createdAt.toISOString() };
}

export const ratingInclude = { publication: { select: { id: true } } } as const;
type RatingWithPublication = Prisma.RatingEntryGetPayload<{ include: typeof ratingInclude }>;
export function ratingDto(row: RatingWithPublication) {
  return {
    id: String(row.id), userId: row.userId, animeId: row.animeId, rating: row.rating,
    watchedOn: row.watchedOn, rewatched: row.rewatched,
    publicationId: row.publication ? String(row.publication.id) : null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}
