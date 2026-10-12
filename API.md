# API implementada: actividad, comunidad, descubrimiento y Aura

Base de desarrollo: `http://localhost:3000/api`. JSON UTF-8. Todas las rutas requieren Bearer token salvo `/health`, `/auth/register` y `/auth/login`.

Este archivo describe el código actual. Las operaciones futuras del [esquema conceptual](ESQUEMA_DATOS_Y_API.md) no están disponibles todavía.

Catálogo externo: Tenrai reemplaza la API pública cerrada de Jikan, conservando formato y referencias `mal:ID`. Búsqueda, detalle y paginación reales verificados el 12/10/2026. `CATALOG_BASE_URL` configura el proveedor compatible. AniList entrega los extras por separado. Guía de conexión del frontend: [HANDOFF_FRONTEND.md](HANDOFF_FRONTEND.md).

## Rutas

### Datos complementarios: AniList

`GET /api/anime/mal:20/extras?page=1` requiere sesión. Consulta AniList directamente por `idMal`, sin Jikan ni registros previos en SQLite. `page` es opcional, entero de 1 a 1000. No acepta `country`.

Respuesta `{ extras }`:

- `animeId`, `source: "anilist"`, `anilistId`, `fetchedAt` (fecha de consulta original, también desde caché).
- `streamingLinks`: `{ id, site, url, language }`, solo enlaces `STREAMING` habilitados con URL HTTPS válida. Una lista vacía no demuestra que no exista streaming.
- `regionalAvailability: "unknown"`: mostrar «Consultar disponibilidad en la plataforma». El idioma no determina el país; `countryOfOrigin` tampoco representa licencias territoriales.
- `characters`: diez por página, ordenados por rol/ID. Cada entrada contiene `role`, `character: { id, name, imageUrl }` y `voiceActors: [{ id, name, imageUrl }]`. Nombres e imágenes pueden ser `null`; puede no haber actores.
- `voiceActorLanguage: "JAPANESE"`, `page`, `nextPage` (o `null`). Los IDs de personas pertenecen a AniList, no son IDs de anime de Ani-Ren.

Caché en memoria: hasta 50 páginas durante una hora; consultas simultáneas idénticas compartidas; cola de hasta diez consultas distintas; una petición cada 2,1 segundos; timeout de red de ocho segundos, más espera en cola. Límites por proceso, sin persistencia en SQLite ni descarga masiva. No se guardan errores ni respuestas parciales de GraphQL.

Errores: `ANILIST_NOT_FOUND` (404), `ANILIST_INVALID_RESPONSE`, `ANILIST_GRAPHQL_ERROR`, `ANILIST_ERROR` (502), `ANILIST_TIMEOUT`, `ANILIST_UNAVAILABLE`, `ANILIST_BUSY`, `ANILIST_RATE_LIMIT` (503). El frontend debe permitir reintentar esta sección sin bloquear reviews o biblioteca. Un error no equivale a una lista vacía.

Integración para evaluación: aclarar la admisibilidad de Ani-Ren con el proveedor antes de adoptarla para publicación. Sus [condiciones](https://docs.anilist.co/guide/terms-of-use) restringen servicios competidores de listas/seguimiento; la flexibilidad educativa que mencionan corresponde a recolección de datos, no establece una excepción general a la restricción de competencia. Referencias: [enlaces](https://docs.anilist.co/reference/object/mediaexternallink), [límites](https://docs.anilist.co/guide/rate-limiting).

### Rutas generales

| Método y ruta | Cuerpo o consulta | Resultado |
| --- | --- | --- |
| GET /health | — | `{ ok: true }` tras consultar SQLite |
| POST /auth/register | handle, password | 201, `{ user }`; no inicia sesión automáticamente |
| POST /auth/login | handle, password | `{ user, token, expiresAt }` |
| GET /auth/me | — | `{ user }` |
| POST /auth/logout | — | 204, revoca la sesión usada |
| GET /anime | q de 2–100 caracteres, page opcional desde 1 | `{ items, nextPage }`; 20 metadatos por página |
| GET /anime/:id | ID como `mal:20` | `{ anime }`, incluye metadatos, fetchedAt, metadataStale y statistics |
| GET /users/:id | ID real de usuario | `{ user }`, perfil, estadísticas, relación con lector y favoritos |
| PATCH /me/profile | name?, bio? | `{ user }`; perfil básico confirmado, solo cuenta autenticada |
| GET /me/library | collection=watched o watchlist (defecto watched), limit?, cursor? | `{ items, total, nextCursor }`; items con anime, watched, watchlist, favoritePosition |
| PATCH /me/library/:animeId | watched=true?, watchlist=true/false?; al menos uno | `{ animeId, watched, watchlist, favoritePosition }`; no crea valoración |
| GET /me/favorites | — | `{ items, total }`; items con anime y position, en orden, máximo 100 |
| PUT /me/favorites | `{ animeIds: [...] }` | Reemplaza favoritos en ese orden; `{ items, total }` |
| GET /me/anime/:animeId/activity | limit, cursor opcionales | `{ items, total, nextCursor, watched, watchlist, favoritePosition, currentRating }` |
| POST /ratings | animeId, rating, watchedOn?, rewatched? | 201, `{ rating }`; requiere Idempotency-Key |
| PATCH /ratings/:id | rating?, watchedOn?, rewatched? | `{ rating }`; solo autor y solo si no tiene review |
| POST /reviews | animeId, rating, text, title?, spoiler?, watchedOn?, rewatched? | 201, `{ publication }`; requiere Idempotency-Key |
| PATCH /reviews/:id | rating?, text?, title?, spoiler?, watchedOn?, rewatched? | `{ publication }`; ID de publicación, solo autor |
| POST /posts | text, title?, spoiler?, animeIds? | 201, `{ publication }`; requiere Idempotency-Key; no crea voto ni visto |
| PATCH /posts/:id | text?, title?, spoiler?, animeIds? | `{ publication }`; solo autor; animeIds reemplaza las menciones |
| GET /publications | animeId?, userId?, kind=review/post?, limit?, cursor? | `{ items, total, nextCursor }`; filtros combinables, incluye reviews y posteos |
| GET /publications/:id | ID de publicación | `{ publication }` |
| PUT /me/following/:userId | Sin cuerpo | Seguir; `{ userId, isFollowing, followsMe, isFriend }` |
| DELETE /me/following/:userId | Sin cuerpo | Dejar de seguir; mismo formato de relación |
| GET /users/:id/followers | limit?, cursor? | `{ items, total, nextCursor }`; perfiles básicos de seguidores |
| GET /users/:id/following | limit?, cursor? | `{ items, total, nextCursor }`; perfiles básicos de seguidos |
| GET /users/:id/friends | limit?, cursor? | `{ items, total, nextCursor }`; perfiles de seguimientos recíprocos |
| PUT /publications/:id/like | Sin cuerpo | `{ publicationId, likedByMe, likeCount }` |
| DELETE /publications/:id/like | Sin cuerpo | Quita únicamente el like propio; mismo formato |
| GET /publications/:id/comments | limit?, cursor? | `{ items, total, nextCursor }`; recientes primero |
| POST /publications/:id/comments | text | 201, `{ comment }`; requiere Idempotency-Key |
| GET /feed | type=following o for-you obligatorio, limit?, cursor? | `{ items, total, nextCursor }`; Para ti agrega generatedAt y expiresAt |
| POST /lists | title, animeIds, description?, ordered? | 201, `{ list }`; requiere Idempotency-Key |
| GET /lists | userId?, animeId?, limit?, cursor? | `{ items, total, nextCursor }`; listas recientes primero |
| GET /lists/:id | ID de lista | `{ list }` |
| PATCH /lists/:id | title?, description?, ordered?, animeIds? | `{ list }`; solo autor, reemplazo de contenido en orden |
| PUT /lists/:id/like | Sin cuerpo | `{ listId, likedByMe, likeCount }` |
| DELETE /lists/:id/like | Sin cuerpo | Quita el like propio; mismo formato |
| GET /search | type=users/publications/lists, q?, genres?, season?, year?, limit?, cursor? | `{ type, items, total, nextCursor }`; ver filtros debajo |
| GET /search | type=anime, q, page? | `{ type, items, nextPage }`; búsqueda global mediante catálogo |
| GET /me/aura | Sin parámetros | `{ rulesVersion, statistics, rank, ranks, missions, rewards }` |
| GET /me/missions | Sin parámetros | `{ rulesVersion, items, total, claimedIds }`; las cinco misiones completas, sin paginar |
| PUT /me/missions/:id/claim | Sin cuerpo | `{ claim }`; comprueba objetivo y reclama una sola vez |
| GET /ranking | scope=global/friends (defecto global), limit?, cursor? | `{ scope, metric, items, total, me, nextCursor }` |

IDs de usuarios son strings opacos; IDs de valoraciones/publicaciones/listas se devuelven como strings numéricas y no deben construirse en el cliente. En SQLite son secuencias independientes: no confundir un ID de valoración con un ID de publicación o lista.

## Formato de respuestas

Valoración: `id`, `userId`, `animeId`, `rating`, `watchedOn`, `rewatched`, `publicationId` (null si no hay review), `createdAt`, `updatedAt`.

Publicación: `id`, `kind` (review/post), `userId`, `author`, `animeId`, `ratingEntryId`, `rating`, `watchedOn`, `rewatched`, `title`, `text`, `spoiler`, `tags`, `animeIds`, `mentionedAnime`, `likeCount`, `commentCount`, `likedByMe`, `createdAt`, `updatedAt`.

- Review: `animeId`, `ratingEntryId` y `rating` tienen valor; `animeIds` contiene su único anime y `mentionedAnime` está vacío. `anime` contiene sus metadatos locales (incluidos título e imagen), sin llamadas externas por tarjeta. En posteos `anime` es `null` y se usa `mentionedAnime`.
- Post: `animeId`, `ratingEntryId`, `rating` y `watchedOn` son null, `rewatched` es false. `animeIds` contiene sus referencias explícitas en orden; `mentionedAnime` incluye los metadatos guardados de esas referencias. Sin referencias, ambos arrays están vacíos.
- `author` es perfil básico (`id`, `handle`, `name`, `bio`, `createdAt`), sin credenciales. Se consulta su versión actual. `likedByMe` siempre corresponde a la sesión lectora.
- Los hashtags se derivan del texto, normalizados sin mayúsculas/tildes. La búsqueda admite etiquetas exactas. No hay resolución automática de hashtags a títulos; las referencias de anime se envían mediante IDs elegidos desde el catálogo.
- Comment: `id`, `publicationId`, `userId`, `author`, `text`, `createdAt`. Sin edición ni respuestas anidadas en este bloque.
- Perfil detallado: campos básicos, `statistics` con `watched`, `reviews`, `posts`, `followers`, `following`, `friends`; `isMe`, `isFollowing`, `followsMe`, `isFriend`; `favorites: [{ anime, position }]`. Todos los contadores salen de la base, no de una página del feed.
- Lista: `id`, `userId`, `author`, `title`, `description`, `ordered`, `animeIds`, `items: [{ anime, position }]`, `itemCount`, `likeCount`, `likedByMe`, `createdAt`, `updatedAt`. Siempre devuelve el orden guardado; `ordered` indica si la UI lo presenta como ranking.

## Validaciones y reglas

- Objetos estrictos: rechazar campos desconocidos, incluido un userId enviado para suplantar autoría.
- Usuario: 3–20 letras ASCII, números o guion bajo; comparación sin mayúsculas ni espacios extremos.
- Contraseña: 8–128 caracteres, una letra y un número. No recortar ni cambiar mayúsculas.
- Estrellas: número de 0,5 a 5 en medios puntos; no aceptar strings numéricas.
- Review: texto recortado de 10–2000 caracteres, título opcional de hasta 100.
- Post: texto recortado de 3–2000 caracteres, título opcional/null de hasta 100; máximo 10 referencias de anime sin duplicados. Sin referencias no consulta al proveedor.
- Comentario: texto recortado de 1–2000 caracteres. Su autor sale de la sesión, igual que el de cualquier publicación.
- Perfil: name recortado de 1–60 caracteres y bio de 0–500; no permite modificar handle, ID ni credenciales. PATCH exige al menos un campo.
- watchedOn: `YYYY-MM-DD`, opcional/null; fecha real, no futura según APP_TIME_ZONE. No enviar DD/MM/YYYY directamente desde el formulario actual.
- rewatched y spoiler: booleanos; false si se omiten al crear. PATCH conserva campos omitidos.
- updatedAt empieza en null; una edición registra el instante y conserva createdAt.
- PATCH exige algún campo editable. No se puede cambiar autor ni anime de una valoración/review existente. En posteos sí pueden reemplazarse las referencias de anime; `animeIds: []` las elimina.
- Biblioteca permite marcar visto y agregar/quitar watchlist. Desmarcar visto, borrado de actividad y conversión de valoración en review quedan pendientes de sus reglas.
- Watchlist, visto y favoritos son estados independientes. Marcar visto o valorar conserva la watchlist; quitar de watchlist no borra votos, vistos ni favoritos. Los favoritos no exigen ni generan un visto.
- Favoritos: máximo 100 IDs distintos en orden; posiciones desde cero. `animeIds: []` vacía favoritos. Reemplazo atómico, sin modificar otros estados de biblioteca. Estas cotas y las de menciones son límites operativos iniciales.
- Listas: título recortado de 3–100 caracteres, descripción de 0–2000, entre 1 y 100 animes distintos. Se conserva el mínimo del editor actual: una lista publicada no queda vacía. `description` por defecto vacío y `ordered` false. PATCH conserva campos omitidos; `animeIds` reemplaza todo el contenido atómicamente y preserva likes y fecha original. Agregar animes a listas no marca vistos, no crea valoraciones ni modifica favoritos.

La secuencia autoincremental determina el orden de inserción y la puntuación personal actual. Se usa como cursor estable de orden nuevo→antiguo, incluso cuando dos entradas comparten milisegundo. Cambiar una fecha de visto o editar una entrada antigua no cambia ese orden.

## Envíos y transacciones

POST de valoración, review, post, comentario o lista requiere `Idempotency-Key`: 16–100 letras ASCII, números, guion o guion bajo. Un UUID es válido. La clave pertenece al usuario autenticado y comparte un espacio entre esos tipos de operación.

- Misma clave y datos normalizados: devuelve el resultado original sin crear otra entrada.
- Misma clave con otros datos o tipo: 409 OPERATION_CONFLICT.
- Otra clave: nueva entrada intencional, aunque tenga el mismo contenido o anime.
- Se guardan resultado y actividad en la misma transacción. No almacenar contraseñas o tokens en la operación.
- Si posteriormente se editó la publicación, el resultado de reintentar su POST sigue siendo el original; consultar el detalle para obtener la versión actual.
- Una review guarda valoración, publicación y visto juntos. Un fallo revierte esas tres escrituras.
- El resultado guardado es una instantánea: likes, comentarios y perfil pueden cambiar después. Reconsultar el detalle para obtener su estado actual. Reintentos de operaciones creadas antes del bloque social conservan el formato original guardado.

PUT/DELETE de like y seguimiento expresan el estado deseado; repetirlos no alterna el estado ni duplica relaciones. Devuelven 200 también si ya estaba en ese estado. Recursos inexistentes devuelven 404 y seguirse a uno mismo devuelve 400 SELF_FOLLOW. No requieren Idempotency-Key.

El feed `following` incluye reviews y posteos de cuentas seguidas, recientes primero, sin rellenar con otras cuentas. Sin seguidos devuelve una lista vacía. Editar no lleva una publicación al comienzo. Dejar de seguir cambia los resultados de la consulta siguiente, sin borrar comentarios o likes.

La consulta `/publications?animeId=...` encuentra reviews de ese anime y posteos que lo mencionan explícitamente. Agregar `kind=review` para mostrar solo reviews de una ficha. Una mención en un post nunca suma al promedio ni al contador de reviews.

## Para ti: descubrir animes según gustos

`GET /feed?type=for-you` selecciona reviews y posteos de otras cuentas **que el lector no sigue**, con al menos un anime referenciado que **no haya marcado como visto**. No incluye charla sin referencias explícitas ni rellena con publicaciones propias o de seguidos. Una watchlist representa pendientes: sus animes no vistos sí pueden aparecer.

Las señales iniciales conservan la lógica acordada del frontend:

1. Géneros de favoritos y watchlist forman los intereses. Las estrellas por sí solas todavía no se interpretan como preferencia.
2. Etiquetas de publicaciones a las que el lector dio like forman intereses adicionales; likes de listas no afectan esta versión del algoritmo.
3. Cada candidato suma +3 si menciona un pendiente no visto, +1 por género coincidente y +1 por hashtag coincidente con géneros de interés o etiquetas gustadas. Se deduplican géneros/etiquetas. Para un post mixto, los géneros se toman solo de los animes no vistos.
4. Se ordena por puntuación y después por creación (ID descendente). Se alternan autores cuando quedan alternativas; esto puede poner una publicación de menor afinidad antes que otra del autor recién mostrado.
5. Sin afinidad se usa fecha y variedad de autores, manteniendo las mismas exclusiones. Si no hay candidatos, se devuelve vacío.

Cada item conserva el formato de publicación y agrega `recommendation: { score, reasons: { inWatchlist, matchedGenres, matchedTags }, discoveryAnimeIds }`. Son motivos de selección, no estrellas ni votos del anime. El servidor no deduce qué conoce el usuario fuera de Ani-Ren: «nuevo» significa aquí no marcado como visto. Diferentes reviews del mismo anime pueden aparecer; no se fusionan sus opiniones.

Paginación de Para ti:

- La primera consulta sin cursor puntúa el conjunto elegible completo y conserva su orden en SQLite durante 20 minutos. No ordena solo la primera página.
- Hay una selección activa por cuenta. Recargar sin cursor la reemplaza, también si se hace desde otra sesión de la misma cuenta. `generatedAt` y `expiresAt` permiten identificarla.
- Continuar con `nextCursor` conserva orden incluso después de likes, nuevas publicaciones o reinicios del servidor. Nuevas señales/publicaciones entran al recargar desde el inicio. Cambiar `limit` no duplica items.
- Al continuar se vuelven a comprobar seguidos y vistos: esos cambios excluyen de inmediato los candidatos afectados. Los cuerpos e interacciones se leen actuales; puntajes/motivos corresponden a `generatedAt`, aunque luego se edite un texto.
- `total` cuenta los miembros de esa selección que siguen siendo elegibles, incluidos los ya paginados; puede disminuir. No cuenta novedades posteriores a la selección. No es `items.length` ni el total histórico de la red.
- Cursor de otra cuenta/tipo: 400. Selección vencida o reemplazada: 410 `FEED_EXPIRED`; el frontend debe descartar ese cursor y cargar la primera página, sin cerrar sesión.
- Al crear una selección se limpian las vencidas; las restantes están acotadas a una por cuenta. No se consulta Jikan para recomendar contenido ya guardado.

## Búsqueda por categoría

Para `users`, `publications` y `lists`, `q` es opcional (hasta 100 caracteres); vacío permite explorar la categoría. La búsqueda ignora mayúsculas y tildes, tratando caracteres como `%` literalmente.

| Categoría | Texto consultado |
| --- | --- |
| users | Nombre, handle y biografía; devuelve perfiles básicos |
| publications | Texto, título, autor y títulos de los animes referenciados |
| lists | Título y descripción de la lista |

En publicaciones, si `q` empieza por `#`, se busca una etiqueta exacta normalizada: `q=%23animacion` coincide con `#Animación`, pero no con `#Animaciones`. No hay que reindexar las reviews antiguas o editadas porque las etiquetas se extraen del texto actual.

Filtros para publicaciones y listas: `genres=mal:22,mal:24` (máximo 10 IDs de género, coincide **cualquiera**); `season=winter|spring|summer|fall`; `year=2025` (1900–2200). Debe existir un mismo anime de la publicación/lista que cumpla los filtros combinados. No confundir ID de género con ID de anime, aunque compartan prefijo. En usuarios estos filtros se rechazan con 400 `INVALID_SEARCH_FILTER`.

Los resultados locales usan `limit`/`cursor` y total de todas las coincidencias; listas/publicaciones por ID descendente, usuarios por ID de usuario descendente para un orden estable. El cursor queda ligado a cuenta, categoría, consulta y filtros. Las búsquedas locales pueden cambiar con ediciones; no usan la selección temporal de Para ti.

`type=anime` conserva la búsqueda global existente: `q` de 2–100 y `page` desde 1, respuesta `nextPage`, sin inventar total del proveedor. Usa Tenrai mediante el adaptador compatible con Jikan v4. Los filtros avanzados de anime global aún no están conectados al adaptador: no enviar `genres`, `season`, `year`, `limit` o `cursor` en esa categoría. Las búsquedas locales sí funcionan sin proveedor.

La implementación inicial escanea en servidor los textos y metadatos locales necesarios para normalizar tildes; solo envía una página al cliente. El armado de Para ti también evalúa el conjunto completo. Es una base para una comunidad pequeña, sin motor de búsqueda adicional: medir e indexar antes de crecer a muchos datos. No cargar toda esa información en los contextos del frontend.

## Aura, misiones y recompensas

Reglas iniciales confirmadas el 12/10/2026, `rulesVersion: "1"`. Las misiones son acumulativas, sin período semanal, vencimiento ni puntos adicionales. Se consulta toda la biblioteca/actividad del usuario, no una página del historial. Biblioteca única por usuario/anime evita duplicar vistos por repetir puntuaciones.

| ID | Objetivo | Recompensa |
| --- | --- | --- |
| romance | Dos animes distintos vistos del género Romance | Corazón de anime |
| shonen | Tres animes distintos vistos del género Acción | Espíritu shonen |
| generos | Cuatro IDs de género distintos en los animes vistos | Explorador |
| reviews | Tres publicaciones de tipo review, incluso del mismo anime | Voz de la comunidad |
| primera | Un anime visto | Primer capítulo |

La misión `shonen` conserva el ID/nombre de pantalla, pero su criterio es **Acción**, no la demografía Shounen. Se reconocen los nombres Action/Acción del metadato normalizado; Romance se compara sin mayúsculas/tildes. Un anime con varios géneros suma uno a cada misión específica y sus géneros distintos a Explorador. Géneros ausentes no se inventan ni impiden contar un visto. Las temporadas conservan sus IDs separados.

Las reviews repetidas aportan al objetivo de tres reviews; editar, puntuar sin texto y publicar un post común no lo incrementan. Vistos declarados sin review también cuentan. `statistics` devuelve watched, reviews, genres, watchlist y favorites. Sin actividad, todos son cero y el rango es Novato.

Cada misión devuelve id, title, description, metric, total, rewardId, reward, icon, rawProgress, value, state, claimed y claimedAt. `rawProgress` es el total real; `value` se limita al objetivo para una barra. `state` es pending, in_progress o completed. Completar no reclama automáticamente: `claimed` es independiente.

`PUT /me/missions/:id/claim` usa exclusivamente la sesión. No acepta userId, progreso, recompensa o puntos del cliente. Objetivo incompleto: 409 MISSION_INCOMPLETE. ID desconocido: 404 MISSION_NOT_FOUND. Una transacción comprueba elegibilidad y guarda la recompensa; una clave única usuario/misión impide duplicados. Repetir o enviar dos reclamos simultáneos devuelve el mismo claim, con la misma fecha; no requiere Idempotency-Key.

`claim` y los elementos de `rewards` contienen missionId, rewardId, reward, rulesVersion y claimedAt. Se conserva lo otorgado incluso si después cambian metadatos y baja el progreso actual. Son desbloqueos persistentes, sin monedas ni efectos en vistos/rango. El código todavía no equipa decoradores de perfil. Cambiar la versión de reglas no habilita cobrar otra vez la misma misión; una misión nueva necesita otro ID.

## Rangos y ranking de usuarios

Rangos según animes distintos vistos: Novato desde 0, Aprendiz desde 100, Experto desde 200, Maestro desde 300 y Leyenda desde 400. No dependen de likes, estrellas ni recompensas. `rank` devuelve name, index, watched, threshold, nextRank, nextThreshold, remaining y progress (0–1 dentro del tramo). Leyenda devuelve nextRank/nextThreshold null, remaining 0 y progress 1. Aura incluye además `ranks: [{ name, index, threshold, unlocked }]` para que la app no duplique los umbrales. El perfil `GET /users/:id` también devuelve el rank calculado de esa persona, sin revelar sus reclamos privados.

`GET /ranking` clasifica por `metric: "distinct_watched_anime"`. `scope=global` incluye todas las cuentas; `scope=friends` incluye al lector y sus seguimientos **recíprocos**. No basta seguir en una sola dirección. Incluye usuarios con cero vistos.

Cada item contiene user (perfil básico sin credenciales), watched, position y rank. Los empates comparten posición: 1, 2, 2, 4. Dentro de un empate se ordena por ID de usuario ascendente para paginar sin repetir; no se desempata por likes ni antigüedad. `me` informa posición, vistos y rango del lector dentro del ámbito elegido, aunque esté fuera de la página cargada; total cuenta todo ese ámbito.

Usa limit/cursor como los otros listados, vinculando el cursor a cuenta y ámbito. Es una clasificación actual, sin ventana temporal ni selección guardada: si cambian vistos o amistades durante la navegación, refrescar desde la primera página. El servidor calcula los conteos de biblioteca y posiciones del conjunto antes de recortar la página. La versión inicial está pensada para una comunidad pequeña; optimizar consultas antes de grandes volúmenes.

## Promedios y páginas

El promedio incluye cada RatingEntry una vez, con o sin review. Las puntuaciones repetidas de un usuario cuentan individualmente. La puntuación actual del usuario es la última entrada creada, no su media ni la última editada.

Los listados paginados usan limit=20 por defecto, máximo 50, y cursor opaco ligado a la consulta y sus filtros; los feeds y biblioteca también lo ligan a la cuenta. Reutilizar el cursor fuera de ese ámbito devuelve 400. `total` representa todas las coincidencias actuales; `items.length` representa solo esa página. Sin más resultados, nextCursor es null. Excepto la selección de Para ti descrita arriba, no son instantáneas: cambiar relaciones o referencias puede cambiar coincidencias entre páginas. Favoritos devuelve la colección completa acotada a 100. Jikan usa page/nextPage en lugar de cursor, según su contrato.

El resumen de anime distingue `averageRating`, `ratingCount`, `reviewCount` y `ratingUserCount`. Una página del feed nunca se usa para calcular esos totales.

## Errores

Formato: `{ "error": { "code": "...", "message": "...", "fields": [...] } }`. fields solo aparece en validación, con field y message por problema.

| Estado | Ejemplos |
| --- | --- |
| 400 | VALIDATION_ERROR, INVALID_JSON, INVALID_CURSOR, SELF_FOLLOW, INVALID_SEARCH_FILTER |
| 401 | SESSION_REQUIRED, SESSION_EXPIRED, INVALID_CREDENTIALS |
| 403 | NOT_OWNER, ORIGIN_NOT_ALLOWED |
| 404 | ANIME_NOT_FOUND, PUBLICATION_NOT_FOUND, RATING_NOT_FOUND, USER_NOT_FOUND, LIST_NOT_FOUND, MISSION_NOT_FOUND |
| 409 | CONFLICT, OPERATION_CONFLICT, EDIT_REVIEW, MISSION_INCOMPLETE |
| 410 | FEED_EXPIRED; recargar Para ti desde la primera página |
| 413 | BODY_TOO_LARGE; máximo 32 KB de JSON |
| 429 | AUTH_RATE_LIMIT, RATE_LIMIT |
| 500 | INTERNAL_ERROR, sin detalles internos |
| 502/503 | CATALOG_ERROR, CATALOG_INVALID_RESPONSE, CATALOG_UNAVAILABLE, CATALOG_TIMEOUT, CATALOG_DNS_ERROR, CATALOG_TLS_ERROR, CATALOG_BUSY, CATALOG_RATE_LIMIT |

El frontend debe distinguir una sesión vencida de una falta de conexión. Guardar el borrador ante fallo, mostrar el error y ofrecer reintento. No mostrar éxito antes de recibir confirmación del servidor.
