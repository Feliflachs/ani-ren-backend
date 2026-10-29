import type { Prisma } from '@prisma/client';
import { genresOf } from '../search/search';
import { countryInfo, mapCountries } from './countries';

export type Period = 'week' | 'month' | 'all';
export function since(period: Period, now = new Date()) {
  return period === 'all' ? undefined : new Date(now.getTime() - (period === 'week' ? 7 : 30) * 86_400_000);
}
export async function ratingEvents(tx: Prisma.TransactionClient, period: Period, countryCode?: string, animeId?: string) {
  return tx.ratingEntry.findMany({ where: { countryCode, animeId, createdAt: { gte: since(period) } },
    orderBy: { id: 'asc' }, include: { anime: true, publication: { select: { id: true } }, currentFor: { select: { id: true } } } });
}
type Event = Awaited<ReturnType<typeof ratingEvents>>[number];

export function animeTotals(events: Event[], genre?: string, regional = false) {
  const groups = new Map<string, Event[]>();
  for (const event of events) {
    if (genre && !genresOf(event.anime.genres).some(item => item.id === genre)) continue;
    const rows = groups.get(event.animeId) ?? [];
    rows.push(event); groups.set(event.animeId, rows);
  }
  const maximum = Math.max(0, ...[...groups.values()].map(rows => rows.length));
  return [...groups.values()].map(rows => {
    // País: promedio de las valoraciones registradas allí. Global: voto vigente de cada persona.
    const votes = regional ? rows : rows.filter(row => row.currentFor.length > 0);
    const ratingSum = votes.reduce((sum, row) => sum + row.rating, 0);
    return { anime: rows[0].anime, views: rows.length, viewers: new Set(rows.map(row => row.userId)).size,
      reviews: rows.filter(row => row.publication).length, ratingCount: votes.length, ratingSum,
      averageRating: votes.length ? ratingSum / votes.length : null,
      popularity: maximum ? Math.round(rows.length / maximum * 100) : 0 };
  });
}
export function sortTop<T extends { anime: { id: string }; views: number; averageRating: number | null }>(rows: T[], criterion: 'rating' | 'views' | 'trending') {
  return [...rows].filter(row => criterion !== 'rating' || row.averageRating !== null).sort((a, b) =>
    (criterion === 'rating' ? (b.averageRating ?? 0) - (a.averageRating ?? 0) || b.views - a.views
      : b.views - a.views || (b.averageRating ?? 0) - (a.averageRating ?? 0)) || a.anime.id.localeCompare(b.anime.id));
}
export function countryTotals(events: Event[], metric: 'reviews' | 'views' | 'popularity' | 'anime', animeId?: string) {
  const codes = new Set([...mapCountries.map(country => country.code), ...events.flatMap(event => event.countryCode ? [event.countryCode] : [])]);
  const selected = animeId ? events.filter(event => event.animeId === animeId) : events;
  const rows = [...codes].map(code => {
    const local = selected.filter(event => event.countryCode === code);
    return { ...countryInfo(code), views: local.length, reviews: local.filter(event => event.publication).length,
      ratingSum: local.reduce((sum, event) => sum + event.rating, 0),
      averageRating: local.length ? local.reduce((sum, event) => sum + event.rating, 0) / local.length : null };
  });
  const maxViews = Math.max(0, ...rows.map(row => row.views));
  const maxReviews = Math.max(0, ...rows.map(row => row.reviews));
  return rows.map(row => {
    const popularity = maxViews ? Math.round(row.views / maxViews * 100) : 0;
    const value = metric === 'reviews' ? row.reviews : metric === 'popularity' ? popularity : row.views;
    const max = metric === 'reviews' ? maxReviews : metric === 'popularity' ? 100 : maxViews;
    const intensity = max ? value / max : 0;
    return { ...row, popularity, value, intensity, colorLevel: value ? Math.max(1, Math.ceil(intensity * 5)) : 0 };
  }).sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));
}
