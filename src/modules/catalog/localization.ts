import type { AnimeExtrasProvider } from './anime-extras';
import type { TmdbStreaming } from '../streaming/tmdb';
const names: Record<string, string> = {
  "Action": "Acción",
  "Adventure": "Aventura",
  "Comedy": "Comedia",
  "Drama": "Drama",
  "Fantasy": "Fantasía",
  "Horror": "Terror",
  "Mystery": "Misterio",
  "Romance": "Romance",
  "Sci-Fi": "Ciencia ficción",
  "Slice of Life": "Vida cotidiana",
  "Sports": "Deportes",
  "Supernatural": "Sobrenatural",
  "Suspense": "Suspenso",
  "AwardWinning": "Premiados",
  "Award Winning": "Premiados",
  "AvantGarde": "Vanguardia",
  "Avant Garde": "Vanguardia",
  "Gourmet": "Gastronomía",
  "Ecchi": "Ecchi",
  "Hentai": "Hentai",
  "Boys Love": "Romance entre chicos",
  "Girls Love": "Romance entre chicas",
  "Erotica": "Erótica"
};
export const spanishGenre = <T extends { name: string }>(genre: T): T => ({ ...genre, name: names[genre.name] ?? genre.name });
export const cleanSynopsis = (value: string) => value.replace(/\s*\[Written by MAL Rewrite\]\s*$/i, '').trim();
// At the JSON boundary this also covers genres on old records and nested anime DTOs.
export function localizedJson(key: string, value: unknown): unknown {
  if (key === 'genres' && Array.isArray(value)) return value.map(item => item && typeof item === 'object' && typeof item.name === 'string' ? spanishGenre(item) : item);
  if (key === 'synopsis' && typeof value === 'string') return cleanSynopsis(value);
  return value;
}
export class SynopsisLocalization {
  constructor(private extras: AnimeExtrasProvider, private tmdb?: TmdbStreaming) {}
  async get(id: string): Promise<string | null> {
    if (!this.tmdb) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lookup = async () => {
      try { return await this.tmdb!.spanishSynopsis((await this.extras.get(id, 1)).identity); }
      catch { return null; }
    };
    try {
      return await Promise.race([lookup(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 8000); })]);
    } finally { clearTimeout(timer); }
  }
}
