import { z } from 'zod';

export const animeIdSchema = z.string().regex(/^mal:[1-9]\d{0,8}$/, 'Usá una referencia como mal:20.');
export const uniqueAnimeIds = (maximum: number) => z.array(animeIdSchema).max(maximum)
  .refine((ids) => new Set(ids).size === ids.length, 'No repetir animes.');
export const resourceIdSchema = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).refine(Number.isSafeInteger);
export const handleSchema = z.string().trim().regex(/^[a-zA-Z0-9_]{3,20}$/);
export const passwordSchema = z.string().min(8).max(128).regex(/[a-zA-Z]/).regex(/[0-9]/);
export const credentialsSchema = z.object({ handle: handleSchema, password: passwordSchema }).strict();
export const scoreSchema = z.number().min(0.5).max(5).multipleOf(0.5);

export function dateSchema(timeZone: string) {
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    return value >= '0001-01-01' && Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value && value <= today;
  }, 'La fecha debe existir y no puede ser futura.').nullable();
}

export function activitySchemas(timeZone: string) {
  const fields = {
    rating: scoreSchema,
    watchedOn: dateSchema(timeZone).optional(),
    rewatched: z.boolean().optional(),
  };
  const reviewFields = {
    ...fields,
    title: z.string().trim().max(100).nullable().optional(),
    text: z.string().trim().min(10).max(2000),
    spoiler: z.boolean().optional(),
  };
  const notEmpty = (value: object) => Object.keys(value).length > 0;
  return {
    ratingCreate: z.object({ animeId: animeIdSchema, ...fields }).strict(),
    reviewCreate: z.object({ animeId: animeIdSchema, ...reviewFields }).strict(),
    ratingEdit: z.object(fields).partial().strict().refine(notEmpty, 'Enviá algún cambio.'),
    reviewEdit: z.object(reviewFields).partial().strict().refine(notEmpty, 'Enviá algún cambio.'),
  };
}

export const normalizeTag = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9_]/g, '');

export function extractTags(text: string) {
  return [...new Set((text.match(/#[\p{L}\p{N}_-]+/gu) ?? []).map(normalizeTag))].filter(Boolean);
}
