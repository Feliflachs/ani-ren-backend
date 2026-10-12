import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from './errors';

export const operationKeySchema = z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/, 'Enviá Idempotency-Key con un ID único del envío.');

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
export function fingerprint(kind: string, data: unknown) {
  return createHash('sha256').update(JSON.stringify([kind, canonical(data)])).digest('hex');
}

export async function replay(db: PrismaClient | Prisma.TransactionClient, userId: string, key: string, hash: string) {
  const existing = await db.operation.findUnique({ where: { userId_key: { userId, key } } });
  if (!existing) return null;
  if (existing.fingerprint !== hash) throw new ApiError(409, 'OPERATION_CONFLICT', 'Ese envío ya fue usado con otros datos.');
  return existing.response;
}

export async function saveOperation(
  db: PrismaClient, userId: string, key: string, hash: string,
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  try {
    return await db.$transaction(async (tx) => {
      const saved = await replay(tx, userId, key, hash);
      if (saved !== null) return saved;
      const response = JSON.parse(JSON.stringify(await write(tx))) as Prisma.InputJsonObject;
      await tx.operation.create({ data: { userId, key, fingerprint: hash, response } });
      return response;
    });
  } catch (error) {
    // Si otro envío ganó la restricción única, devolver su resultado confirmado.
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      const saved = await replay(db, userId, key, hash);
      if (saved !== null) return saved;
    }
    throw error;
  }
}
