// Ejemplo compilado por npm run typecheck. Copiar/adaptar en el paso 3; no modifica la app.
export class BackendError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type Page = { limit?: number; cursor?: string };
type RatingDraft = { animeId: string; rating: number; watchedOn?: string | null; rewatched?: boolean; countryCode?: string | null };
type ReviewDraft = RatingDraft & { text: string; title?: string | null; spoiler?: boolean };

export function createApiClient(baseUrl: string, getToken: () => string | null) {
  const base = baseUrl.replace(/\/+$/, ''); // Ejemplo: http://192.168.1.10:3000/api
  async function request<T = unknown>(route: string, options: {
    method?: string; body?: unknown; operationId?: string; query?: Record<string, string | number | undefined>;
  } = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) params.set(key, String(value));
    const token = getToken();
    const response = await fetch(`${base}${route}${params.size ? '?' + params : ''}`, {
      method: options.method ?? 'GET', signal: AbortSignal.timeout(20_000), headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.operationId ? { 'Idempotency-Key': options.operationId } : {}),
      }, body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 204) return undefined as T;
    const payload = await response.json();
    if (!response.ok) throw new BackendError(response.status, payload.error?.code ?? 'HTTP_ERROR', payload.error?.message ?? 'No se pudo completar la solicitud.');
    return payload as T;
  }
  return {
    request,
    login: (handle: string, password: string) => request('/auth/login', { method: 'POST', body: { handle, password } }),
    session: () => request('/auth/me'),
    logout: () => request('/auth/logout', { method: 'POST' }),
    aura: () => request('/me/aura'),
    missions: () => request('/me/missions'),
    claimMission: (missionId: string) => request(`/me/missions/${encodeURIComponent(missionId)}/claim`, { method: 'PUT' }),
    ranking: (scope: 'global' | 'friends', page: Page = {}) => request('/ranking', { query: { scope, ...page } }),
    feed: (type: 'for-you' | 'following' | 'trending', page: Page = {}) => request('/feed', { query: { type, ...page } }),
    discover: (page: Page = {}) => request('/discover', { query: page }),
    rate: (body: RatingDraft, operationId: string) => request('/ratings', { method: 'POST', body, operationId }),
    review: (body: ReviewDraft, operationId: string) => request('/reviews', { method: 'POST', body, operationId }),
    animeActivity: (animeId: string, page: Page = {}) => request(`/me/anime/${encodeURIComponent(animeId)}/activity`, { query: page }),
    library: (userId: string, collection: 'watched' | 'watchlist' | 'favorites', q = '', page: Page = {}) =>
      request(`/users/${encodeURIComponent(userId)}/library`, { query: { collection, q, ...page } }),
    searchAnime: (q: string, page = 1, filters: { genres?: string[]; season?: string; year?: number } = {}) =>
      request('/search', { query: { type: 'anime', q, page, ...filters, genres: filters.genres?.length ? filters.genres.join(',') : undefined } }),
    explore: () => request('/explore'),
    tops: (criterion: 'rating' | 'views' | 'trending', period: 'week' | 'month' | 'all', page: Page = {}, genre?: string) =>
      request('/explore/tops', { query: { criterion, period, genre, ...page } }),
    map: (metric: 'reviews' | 'views' | 'popularity' | 'anime', period: 'week' | 'month' | 'all' = 'all', animeId?: string) =>
      request('/explore/map', { query: { metric, period, animeId } }),
  };
}
