import { spanishGenre } from '../catalog/localization';
export const auraRulesVersion = '2';

// Valores iniciales centralizados: no se aceptan puntos o umbrales desde el cliente.
export const missionStages = [
  { total: 1, points: 10 }, { total: 5, points: 25 }, { total: 10, points: 50 },
  { total: 25, points: 125 }, { total: 50, points: 250 }, { total: 100, points: 500 },
] as const;
export const rankDefinitions = [
  { name: 'Novato', threshold: 0 }, { name: 'Aprendiz', threshold: 100 },
  { name: 'Experto', threshold: 500 }, { name: 'Maestro', threshold: 1500 },
  { name: 'Leyenda', threshold: 5000 },
] as const;
export const ranks = rankDefinitions.map(rank => rank.name);
export function rankProgress(points: number) {
  const index = rankDefinitions.reduce((current, rank, index) => points >= rank.threshold ? index : current, 0);
  const current = rankDefinitions[Math.max(0, index)];
  const next = rankDefinitions[Math.max(0, index) + 1];
  return { name: current.name, index: Math.max(0, index), points, threshold: current.threshold,
    nextRank: next?.name ?? null, nextThreshold: next?.threshold ?? null,
    remaining: next ? Math.max(0, next.threshold - points) : 0,
    progress: next ? Math.max(0, Math.min(1, (points - current.threshold) / (next.threshold - current.threshold))) : 1 };
}

// Géneros de las pantallas actuales. Se agregan los demás géneros presentes en el catálogo.
export const initialGenres = [
  { id: 'mal:1', name: 'Acción' }, { id: 'mal:4', name: 'Comedia' },
  { id: 'mal:10', name: 'Fantasía' }, { id: 'mal:22', name: 'Romance' },
  { id: 'mal:2', name: 'Aventura' }, { id: 'mal:8', name: 'Drama' }, { id: 'mal:30', name: 'Deportes' },
];
export function missionDefinitions(genres: { id: string; name: string }[]) {
  const groups = [
    { id: 'watched', label: 'Animes vistos', genreId: null as string | null, icon: 'eye-outline' },
    ...genres.map(genre => ({ id: `genre-${genre.id.replace(':', '-')}`, label: spanishGenre(genre).name, genreId: genre.id, icon: 'sparkles-outline' })),
  ];
  return groups.flatMap(group => missionStages.map(stage => ({
    id: `${group.id}-${stage.total}`, groupId: group.id, genreId: group.genreId,
    title: `${group.label} · ${stage.total}`, metric: group.genreId ? 'genre' : 'watched',
    description: `Mirá ${stage.total} anime${stage.total === 1 ? '' : 's'}${group.genreId ? ` del género ${group.label}` : ' diferentes'}.`,
    total: stage.total, points: stage.points, rewardId: `${group.id}-${stage.total}`,
    reward: `${stage.points} puntos de Aura`, icon: group.icon,
  })));
}
