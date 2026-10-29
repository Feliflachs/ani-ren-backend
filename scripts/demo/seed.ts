import type { Server } from 'node:http';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app';
import { ensureAnime, type Catalog } from '../../src/modules/catalog/catalog';
import { hashPassword, hashToken } from '../../src/modules/auth/security';
import { credentialsSchema } from '../../src/shared/validation';
import { fingerprint } from '../../src/shared/operations';
import { anime, DEMO_PASSWORD, DEMO_VERSION, personas, rootComments } from './data';

const DAY = 86_400_000;
const userId = (key: string) => `${DEMO_VERSION}_${key}`;
const marker = (key: string) => `${DEMO_VERSION}_done_${key}`;
type Json = Record<string, any>;
type Stamp = { publication?: number; rating?: number; list?: number; comment?: number;
  like?: number; listLike?: number; follow?: string };

export async function seedDemo(db: PrismaClient, catalog: Catalog, progress: (message: string) => void = () => {}) {
  // Complete collision preflight before creating accounts or changing existing resources.
  for (const person of personas) {
    const id = userId(person.key);
    const handle = `demo_${person.key}`;
    credentialsSchema.parse({ handle, password: DEMO_PASSWORD });
    const collisions = await db.user.findMany({ where: { OR: [{ id }, { normalizedHandle: handle }] }, select: { id: true, normalizedHandle: true } });
    if (collisions.some(row => row.id !== id || row.normalizedHandle !== handle))
      throw new Error(`La cuenta ${handle} ya pertenece a otros datos. No se modificó.`);
  }
  progress('Verificando el catálogo real antes de crear cuentas…');
  for (const id of Object.values(anime)) await ensureAnime(db, catalog, id);
  for (const person of personas) {
    const id = userId(person.key);
    if (!await db.user.findUnique({ where: { id } })) {
      await db.user.create({ data: { id, handle: `demo_${person.key}`, normalizedHandle: `demo_${person.key}`,
        name: person.name, bio: `${person.bio} · Cuenta ficticia de prueba.`, passwordHash: await hashPassword(DEMO_PASSWORD),
        createdAt: new Date(Date.now() - (person.key === 'nora' ? 0 : 90 * DAY)) } });
    }
  }
  const anchorOwner = userId(personas[0].key);
  const anchorRecord = await db.operation.upsert({ where: { userId_key: { userId: anchorOwner, key: `${DEMO_VERSION}_anchor` } },
    create: { userId: anchorOwner, key: `${DEMO_VERSION}_anchor`, fingerprint: DEMO_VERSION,
      response: { anchor: new Date().toISOString() } }, update: {} });
  const anchor = new Date((anchorRecord.response as Json).anchor);
  const date = (daysAgo: number) => new Date(anchor.getTime() - daysAgo * DAY);
  const watchedOn = (daysAgo: number) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date(daysAgo));
  const app = createApp({ db, catalog, corsOrigins: [], sessionDays: 1, timeZone: 'America/Buenos_Aires' });
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo abrir la API local de carga.');
  const base = `http://127.0.0.1:${address.port}/api`;
  const tokens = new Map<string, string>();
  let addedSteps = 0;
  let skippedSteps = 0;
  async function request(actor: string, route: string, method = 'GET', body?: Json, key?: string): Promise<Json> {
    const response = await fetch(base + route, { method, headers: {
      ...(tokens.has(actor) ? { Authorization: `Bearer ${tokens.get(actor)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': `${DEMO_VERSION}_api_${key}` } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json() as Json;
    if (!response.ok) throw new Error(`${actor}: ${method} ${route}: ${response.status} ${result.error?.message ?? 'Error'}`);
    return result;
  }
  async function step(actor: string, key: string, route: string, method: string, body?: Json,
    daysAgo = 0, stamp?: (result: Json) => Stamp) {
    const id = userId(actor);
    const hash = fingerprint('demo-step', { route, method, body: body ?? null, daysAgo });
    const saved = await db.operation.findUnique({ where: { userId_key: { userId: id, key: marker(key) } } });
    if (saved) {
      if (saved.fingerprint !== hash) throw new Error(`Cambió el plan ${actor}/${key}. Usá una versión nueva; no se sobrescriben tus cambios.`);
      skippedSteps++;
      return saved.response as Json;
    }
    const result = await request(actor, route, method, body, method === 'POST' ? key : undefined);
    // Only historical timestamps are simulated directly. All behavior uses real API validation,
    // currentRatingId, idempotency and automatic Aura. The marker makes subsequent runs non-destructive.
    await db.$transaction(async tx => {
      const targets = stamp?.(result);
      const createdAt = date(daysAgo);
      if (targets?.publication) await tx.publication.update({ where: { id: targets.publication, userId: id }, data: { createdAt } });
      if (targets?.rating) await tx.ratingEntry.update({ where: { id: targets.rating, userId: id }, data: { createdAt } });
      if (targets?.list) await tx.animeList.update({ where: { id: targets.list, userId: id }, data: { createdAt } });
      if (targets?.comment) await tx.comment.update({ where: { id: targets.comment, userId: id }, data: { createdAt } });
      if (targets?.like) await tx.publicationLike.update({ where: { userId_publicationId: { userId: id, publicationId: targets.like } }, data: { createdAt } });
      if (targets?.listLike) await tx.listLike.update({ where: { userId_listId: { userId: id, listId: targets.listLike } }, data: { createdAt } });
      if (targets?.follow) await tx.follow.update({ where: { followerId_followedId: { followerId: id, followedId: targets.follow } }, data: { createdAt } });
      await tx.operation.create({ data: { userId: id, key: marker(key), fingerprint: hash, response: result as Prisma.InputJsonObject } });
    });
    addedSteps++;
    return result;
  }
  const publications = new Map<string, { id: string; age: number; actor: string }>();
  const lists = new Map<string, string>();
  try {
    progress('Comprobando el login de las 20 cuentas con contraseña real…');
    for (const person of personas) {
      const result = await request(person.key, '/auth/login', 'POST', { handle: `demo_${person.key}`, password: DEMO_PASSWORD });
      if (result.user.id !== userId(person.key)) throw new Error('Identidad inesperada al iniciar sesión.');
      tokens.set(person.key, result.token);
    }
    // Follow graph contains reciprocal, unilateral and cross-interest connections. Nora stays empty.
    for (let i = 0; i < 19; i++) {
      const person = personas[i];
      const neighbors = new Set([(i + 1) % 19, (i + 18) % 19, (i + 4) % 19]);
      for (const j of neighbors) await step(person.key, `follow_${personas[j].key}`, `/me/following/${userId(personas[j].key)}`,
        'PUT', undefined, 60, () => ({ follow: userId(personas[j].key) }));
      await step(person.key, 'favorites', '/me/favorites', 'PUT', { animeIds: person.favorites.map(key => anime[key]) });
      for (const key of person.watchlist) await step(person.key, `watchlist_${key}`, `/me/library/${anime[key]}`, 'PATCH', { watchlist: true });
    }
    progress('Creando reviews y posteos con voces propias, en orden histórico…');
    type Event = { actor: string; key: string; age: number; route: string; body: Json };
    const events: Event[] = [];
    personas.forEach((person, index) => {
      person.reviews.forEach(([key, rating, text], n) => {
        const age = n === 0 ? 45 + index / 100 : 1 + (index % 4) / 2;
        events.push({ actor: person.key, key: `review_${n}`, age, route: '/reviews',
          body: { animeId: anime[key], rating, text, countryCode: person.country, watchedOn: watchedOn(age), spoiler: false } });
      });
      person.posts.forEach(([key, text], n) => events.push({ actor: person.key, key: `post_${n}`, age: 6 - n - index / 100,
        route: '/posts', body: { text, animeIds: [anime[key]], spoiler: person.key === 'cami' && n === 0 } }));
    });
    events.push({ actor: 'lucas', key: 'naruto_second_review', age: 2, route: '/reviews', body: {
      animeId: anime.naruto, rating: 4.5, countryCode: 'AR', watchedOn: watchedOn(2), rewatched: true,
      text: 'Le subo la nota después de volver a verla sin apurarme. Los baches siguen, pero esta vez me importaron mucho más los personajes secundarios. No borro lo que pensé antes: esta es mi opinión de ahora.',
    } });
    events.push({ actor: 'alex', key: 'naruto_travel_rating', age: 0.75, route: '/ratings', body: {
      animeId: anime.naruto, rating: 3.5, countryCode: 'JP', watchedOn: watchedOn(0.75), rewatched: true,
    } });
    events.push({ actor: 'mia', key: 'rating_without_country', age: 1, route: '/ratings', body: {
      animeId: anime.school, rating: 3.5, countryCode: null, watchedOn: watchedOn(1),
    } });
    for (const event of events.sort((a, b) => b.age - a.age || a.actor.localeCompare(b.actor))) {
      const result = await step(event.actor, event.key, event.route, 'POST', event.body, event.age, result => ({
        publication: result.publication ? Number(result.publication.id) : undefined,
        rating: result.publication?.ratingEntryId ? Number(result.publication.ratingEntryId)
          : result.rating ? Number(result.rating.id) : undefined,
      }));
      if (result.publication) publications.set(`${event.actor}_${event.key}`, { id: result.publication.id, age: event.age, actor: event.actor });
    }
    // A real change to older stars makes that opinion current, without creating another viewer.
    const oldMateo = publications.get('mateo_review_0')!;
    await step('mateo', 'edit_old_stars', `/reviews/${oldMateo.id}`, 'PATCH', { rating: 4 });
    await step('emma', 'watched_without_rating', `/me/library/${anime.spy}`, 'PATCH', { watched: true });
    for (const person of personas.slice(0, 19)) {
      const ids = [...new Set([...person.favorites, ...person.watchlist])].map(key => anime[key]);
      const result = await step(person.key, 'list', '/lists', 'POST', { title: `El rincón de ${person.name.split(' ')[0]}`,
        description: person.bio, ordered: ['ken', 'lara', 'mateo'].includes(person.key), animeIds: ids }, 7,
      result => ({ list: Number(result.list.id) }));
      lists.set(person.key, result.list.id);
    }
    progress('Conectando likes, listas y conversaciones con respuestas…');
    // Likes on old reviews stay old; recent conversation is deliberately not lifetime popularity.
    for (const publication of publications.values()) {
      const index = personas.findIndex(person => person.key === publication.actor);
      for (const shift of [1, 5]) {
        const actor = personas[(index + shift) % 19].key;
        await step(actor, `like_${publication.actor}_${publication.id}`, `/publications/${publication.id}/like`, 'PUT', undefined,
          Math.max(0.1, publication.age - 0.5), () => ({ like: Number(publication.id) }));
      }
    }
    // Old Naruto has more lifetime likes, but no current signal to hold it above recent Frieren.
    const oldPopular = publications.get('ren_review_0')!;
    for (const person of personas.slice(0, 19).filter(person => person.key !== 'ren'))
      await step(person.key, 'old_popular_like', `/publications/${oldPopular.id}/like`, 'PUT', undefined, 30,
        () => ({ like: Number(oldPopular.id) }));
    for (let i = 0; i < 19; i++) {
      const target = personas[(i + 1) % 19].key;
      const id = lists.get(target)!;
      await step(personas[i].key, 'list_like', `/lists/${id}/like`, 'PUT', undefined, 1, () => ({ listLike: Number(id) }));
    }
    const hub = publications.get('lara_post_1')!;
    const roots: string[] = [];
    for (let i = 0; i < rootComments.length; i++) {
      const [index, text] = rootComments[i];
      const result = await step(personas[index].key, `hub_root_${i}`, `/publications/${hub.id}/comments`, 'POST', { text },
        0.6 - i / 100, result => ({ comment: Number(result.comment.id) }));
      roots.push(result.comment.id);
    }
    // One thread has 25 replies, covering a second page independently of the 25 root comments.
    for (let i = 0; i < 25; i++) {
      const person = personas[i % 19];
      const text = i < 19 ? person.reply : [
        'Me llevo la idea de separar lo que espero de la serie de lo que realmente propone.',
        'Otra cosa: una recomendación sin contar el giro principal se agradece mucho.',
        'Me sirve leer desacuerdos cuando explican el motivo, aunque no cambie de opinión.',
        'Probé mirar más despacio y entendí mejor por qué les gustaban esas escenas.',
        'Vuelvo después de unos capítulos. Por ahora la recomendación me está funcionando.',
        'Gracias por la charla. Ya tengo algo para ver el fin de semana.',
      ][i - 19];
      await step(person.key, `hub_reply_${i}`, `/publications/${hub.id}/comments`, 'POST', { text, parentId: roots[0] },
        0.25 - i / 200, result => ({ comment: Number(result.comment.id) }));
    }
    for (let i = 0; i < 19; i++) {
      const target = publications.get(`${personas[(i + 1) % 19].key}_review_1`)!;
      await step(personas[i].key, 'discussion', `/publications/${target.id}/comments`, 'POST', { text: personas[i].comment },
        0.1, result => ({ comment: Number(result.comment.id) }));
    }
    const ids = personas.map(person => userId(person.key));
    const report = {
      version: DEMO_VERSION, anchor: anchor.toISOString(), addedSteps, skippedSteps,
      accounts: personas.map(person => ({ handle: `demo_${person.key}`, name: person.name, country: person.country, voice: person.voice })),
      password: DEMO_PASSWORD, hubPublicationId: hub.id, expandedThreadId: roots[0],
      counts: {
        users: await db.user.count({ where: { id: { in: ids } } }),
        posts: await db.publication.count({ where: { userId: { in: ids }, kind: 'post' } }),
        reviews: await db.publication.count({ where: { userId: { in: ids }, kind: 'review' } }),
        ratings: await db.ratingEntry.count({ where: { userId: { in: ids } } }),
        comments: await db.comment.count({ where: { userId: { in: ids }, parentId: null } }),
        replies: await db.comment.count({ where: { userId: { in: ids }, parentId: { not: null } } }),
        follows: await db.follow.count({ where: { followerId: { in: ids } } }),
        likes: await db.publicationLike.count({ where: { userId: { in: ids } } }),
        lists: await db.animeList.count({ where: { userId: { in: ids } } }),
      },
    };
    // Assertions use the public API, including a user with absolutely no personal signals.
    const following = await request('lucas', '/feed?type=following');
    const forYou = await request('lucas', '/feed?type=for-you');
    if (!following.items.length || !forYou.items.length || !forYou.nextCursor) throw new Error('La base no cubre ambos feeds y paginación.');
    const cold = await request('nora', '/discover');
    if (!cold.items.length) throw new Error('La cuenta nueva no puede descubrir contenido.');
    return report;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
    });
    // Only revoke sessions created by this invocation; do not log out the user's app sessions.
    await db.session.deleteMany({ where: { tokenHash: { in: [...tokens.values()].map(hashToken) } } });
  }
}
