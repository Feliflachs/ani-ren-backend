import { Router } from 'express';
import { z } from 'zod';
import type { AnimeExtrasProvider, AnimeExtras } from '../catalog/anime-extras';
import { animeIdSchema } from '../../shared/validation';
import { countryCodeSchema, countryInfo } from '../explore/countries';

export type StreamingLink = { id: string; site: string; url: string; offer: string };
export type RegionalResult = { status: 'regional' | 'no_data' | 'unmatched'; links: StreamingLink[] };
export interface RegionalProvider { get(id: string, identity: AnimeExtras['identity'], country: string): Promise<RegionalResult> }
export class StreamingService {
  constructor(private extras: AnimeExtrasProvider, private regional?: RegionalProvider) {}
  async get(id: string, country?: string) {
    const base = { animeId: id, country: country ? countryInfo(country) : null };
    let extras: AnimeExtras;
    try { extras = await this.extras.get(id, 1); }
    catch { return { ...base, status: 'unavailable', source: null, links: [], message: 'No pudimos consultar las opciones para ver este anime. Reintentá más tarde.' }; }
    if (country && this.regional) {
      try {
        const result = await this.regional.get(id, extras.identity, country);
        if (result.status !== 'unmatched') return { ...base, ...result, source: 'tmdb',
          message: result.status === 'regional' ? 'Opciones informadas para este país. Consultá las condiciones y temporadas disponibles en el proveedor.' : 'No hay opciones informadas para este anime en este país. Esto no confirma que no esté disponible.',
        };
      } catch { /* Provider failure is not evidence of unavailability. */ }
    }
    return { ...base, source: 'anilist', status: 'general',
      links: extras.streamingLinks.map(link => ({ id: String(link.id), site: link.site, url: link.url, offer: 'Enlace general' })),
      message: country ? 'Enlaces generales: no pudimos confirmar disponibilidad en este país.' : 'Elegí un país para consultar disponibilidad. Estos enlaces son generales.',
    };
  }
}
export function streamingRouter(service: StreamingService) {
  const router = Router();
  router.get('/anime/:id/streaming', async (req, res) => {
    const id = animeIdSchema.parse(req.params.id);
    const { country } = z.object({ country: countryCodeSchema.optional() }).strict().parse(req.query);
    res.json(await service.get(id, country));
  });
  return router;
}
