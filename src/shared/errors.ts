import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  } else if (error instanceof ZodError) {
    res.status(400).json({ error: {
      code: 'VALIDATION_ERROR', message: 'Revisá los datos enviados.',
      fields: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    } });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'El registro ya existe.' } });
  } else if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo debe ser JSON válido.' } });
  } else if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'La solicitud es demasiado grande.' } });
  } else {
    // No registrar cuerpos, contraseñas ni Authorization.
    console.error('Error interno:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'No pudimos completar la operación.' } });
  }
};
