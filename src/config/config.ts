import 'dotenv/config';
import { z } from 'zod';
import { catalogBaseUrl, DEFAULT_CATALOG_URL } from '../modules/catalog/catalog';

const environment = z.object({
  TMDB_API_KEY: z.string().trim().default(''),
  TMDB_READ_ACCESS_TOKEN: z.string().trim().default(''),
  DATABASE_URL: z.string().startsWith('file:').default('file:./dev.db'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  APP_TIME_ZONE: z.string().default('America/Buenos_Aires'),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  CATALOG_BASE_URL: z.string().default(DEFAULT_CATALOG_URL).transform(catalogBaseUrl),
}).parse(process.env);

// Fallar al arrancar si la zona no existe, en lugar de fallar durante un guardado.
new Intl.DateTimeFormat('en-CA', { timeZone: environment.APP_TIME_ZONE }).format();
export const config = {
  tmdbApiKey: environment.TMDB_API_KEY,
  tmdbReadAccessToken: environment.TMDB_READ_ACCESS_TOKEN,
  databaseUrl: environment.DATABASE_URL,
  catalogBaseUrl: environment.CATALOG_BASE_URL,
  port: environment.PORT,
  host: environment.HOST,
  sessionDays: environment.SESSION_DAYS,
  timeZone: environment.APP_TIME_ZONE,
  corsOrigins: environment.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean),
};
