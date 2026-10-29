import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from './errors';

// Conserva el resultado completo, no ordena cada página de forma independiente.
// El cursor está ligado a cuenta, filtros y una selección que vence a los 20 minutos.
export async function selectionPage(
  db: PrismaClient, userId: string, scope: string,
  query: { limit?: number; cursor?: string },
  select: (tx: Prisma.TransactionClient) => Promise<unknown[]>,
) {
  return db.$transaction(async (tx) => {
    let cursor: { id: string; offset: number } | undefined;
    if (query.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
        cursor = z.object({ kind: z.literal('selection'), id: z.string().min(1).max(100),
          offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
          .parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      } catch { throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a esta selección.'); }
    }
    let snapshot;
    if (cursor) {
      snapshot = await tx.querySnapshot.findUnique({ where: { id: cursor.id } });
      if (snapshot && (snapshot.userId !== userId || snapshot.scope !== scope)) {
        throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a esta cuenta o filtros.');
      }
      if (!snapshot || snapshot.expiresAt <= new Date()) {
        throw new ApiError(410, 'SELECTION_EXPIRED', 'La selección venció. Volvé a cargar desde el inicio.');
      }
    } else {
      const items = JSON.parse(JSON.stringify(await select(tx))) as Prisma.InputJsonValue;
      await tx.querySnapshot.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      // Acotar almacenamiento por cuenta sin invalidar otras pestañas en cada refresco.
      const previous = await tx.querySnapshot.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 19, select: { id: true } });
      await tx.querySnapshot.deleteMany({ where: { id: { in: previous.map(row => row.id) } } });
      snapshot = await tx.querySnapshot.create({ data: { userId, scope, items, expiresAt: new Date(Date.now() + 20 * 60_000) } });
    }
    const all = snapshot.items as Prisma.JsonArray;
    const offset = cursor?.offset ?? 0;
    const items = all.slice(offset, offset + (query.limit ?? 20));
    const next = offset + items.length;
    return { items, total: all.length, generatedAt: snapshot.createdAt.toISOString(),
      expiresAt: snapshot.expiresAt.toISOString(), nextCursor: next < all.length
        ? Buffer.from(JSON.stringify({ kind: 'selection', id: snapshot.id, offset: next })).toString('base64url') : null };
  }, { timeout: 15_000 });
}
