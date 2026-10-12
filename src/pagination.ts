import { z } from 'zod';
import { ApiError } from './errors';

export const pageFields = {
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(50)).optional(),
  cursor: z.string().max(1000).optional(),
};

// El cursor lleva el ámbito: no reutilizar una página de un usuario/filtro en otro.
export function readPage(query: { limit?: number; cursor?: string }, scope: string) {
  let before: number | undefined;
  if (query.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
      const parsed = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), scope: z.string() })
        .strict().parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      if (parsed.scope !== scope) throw new Error();
      before = parsed.id;
    } catch {
      throw new ApiError(400, 'INVALID_CURSOR', 'El cursor no corresponde a esta consulta.');
    }
  }
  return { limit: query.limit ?? 20, before, scope };
}

export function pageResult<T extends { id: number }, R>(
  rows: T[], total: number, page: ReturnType<typeof readPage>, serialize: (row: T) => R,
) {
  const selected = rows.slice(0, page.limit);
  const last = selected.at(-1);
  const nextCursor = rows.length > page.limit && last
    ? Buffer.from(JSON.stringify({ id: last.id, scope: page.scope })).toString('base64url') : null;
  return { items: selected.map(serialize), total, nextCursor };
}
