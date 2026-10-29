// No personal affinity or lifetime like totals. All signals expire after 14 days.
const DAY = 86_400_000;
export const discoveryWindow = (now: Date) => new Date(now.getTime() - 14 * DAY);
export function freshness(date: Date, now: Date) {
  const age = Math.max(0, now.getTime() - date.getTime());
  return age > 14 * DAY ? 0 : Math.pow(0.5, age / (3 * DAY));
}
export function discoveryScore(
  votes: { userId: string; rating: number; createdAt: Date }[],
  engagement: { userId: string; createdAt: Date }[], now: Date,
) {
  const people = new Map<string, number>();
  let weightedRating = 9, weight = 3; // Three neutral votes prevent one perfect vote dominating.
  for (const vote of votes) {
    const recent = freshness(vote.createdAt, now);
    weightedRating += vote.rating * recent;
    weight += recent;
    people.set(vote.userId, Math.max(people.get(vote.userId) ?? 0, recent));
  }
  for (const event of engagement) {
    people.set(event.userId, Math.max(people.get(event.userId) ?? 0, 0.25 * freshness(event.createdAt, now)));
  }
  const activity = [...people.values()].reduce((sum, value) => sum + value, 0);
  return Math.log1p(activity) * (weightedRating / weight / 5);
}

// A daily deterministic tie-break gives quiet catalogue entries a chance without unstable pages.
export function discoveryTie(id: string, now: Date) {
  let hash = 2166136261;
  for (const character of now.toISOString().slice(0, 10) + id)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
