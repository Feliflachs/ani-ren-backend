# API implementada: actividad, comunidad, descubrimiento y Aura

Base de desarrollo: `http://localhost:3000/api`. JSON UTF-8. Todas las rutas requieren Bearer token salvo `/health`, `/auth/register` y `/auth/login`.

La referencia vigente del paso 2 es la [guía vigente de integración](docs/GUIA_INTEGRACION_FRONTEND.md). Este archivo conserva el contrato del núcleo y enlaza las reglas nuevas. Las operaciones futuras del [esquema conceptual](ESQUEMA_DATOS_Y_API.md) no están disponibles todavía.

Catálogo externo: Tenrai reemplaza la API pública cerrada de Jikan, conservando formato y referencias `mal:ID`. Búsqueda, detalle y paginación reales verificados el 12/10/2026. `CATALOG_BASE_URL` configura el proveedor compatible. AniList entrega los extras por separado. Guía de conexión del frontend: [guía vigente de integración](docs/GUIA_INTEGRACION_FRONTEND.md).

## Rutas

### Promedios de tarjetas en lote

`GET /anime/statistics?ids=mal:1,mal:20` requiere sesión y admite hasta 100 referencias.
Devuelve `{ items: [{ id, statistics: { averageRating, ratingUserCount } }] }`.
Cuenta solo el voto vigente de cada persona, igual que la ficha del anime; sin votos,
devuelve `averageRating: null` y `ratingUserCount: 0`. No consulta el proveedor externo
ni crea actividad. Permite cargar las estrellas de búsquedas y publicaciones sin abrir fichas.

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
| PATCH /me/library/:animeId | watched=true/false?, watchlist=true/false?; al menos uno | `{ animeId, watched, watchlist, favoritePosition }`; no crea valoración |
| GET /me/favorites | — | `{ items, total }`; items con anime y position, en orden, máximo 100 |
| PUT /me/favorites | `{ animeIds: [...] }` | Reemplaza favoritos en ese orden; `{ items, total }` |
| GET /me/anime/:animeId/activity | limit, cursor opcionales | `{ items, total, nextCursor, watched, watchlist, favoritePosition, currentRating, listIds }` |
| POST /ratings | animeId, rating, watchedOn?, rewatched?, countryCode? | 201, `{ rating }`; requiere Idempotency-Key |
| PATCH /ratings/:id | rating?, watchedOn?, rewatched? | `{ rating }`; solo autor y solo si no tiene review |
| POST /reviews | animeId, rating, text, title?, spoiler?, watchedOn?, rewatched?, countryCode? | 201, `{ publication }`; requiere Idempotency-Key |
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
| GET /discover | limit?, cursor? | Animes no vistos, estadísticas, Watchlist y hasta dos reviews por anime |
| GET /feed | type=following, for-you o trending obligatorio, limit?, cursor? | `{ items, total, nextCursor }`; Para ti agrega generatedAt y expiresAt |
| POST /lists | title, animeIds, description?, ordered? | 201, `{ list }`; requiere Idempotency-Key |
| GET /lists | userId?, animeId?, limit?, cursor? | `{ items, total, nextCursor }`; listas recientes primero |
| GET /lists/:id | ID de lista | `{ list }` |
| PATCH /lists/:id | title?, description?, ordered?, animeIds? | `{ list }`; solo autor, reemplazo de contenido en orden |
| PUT /lists/:id/like | Sin cuerpo | `{ listId, likedByMe, likeCount }` |
| DELETE /lists/:id/like | Sin cuerpo | Quita el like propio; mismo formato |
| GET /search | type=users/publications/lists, q?, genres?, season?, year?, limit?, cursor? | `{ type, items, total, nextCursor }`; ver filtros debajo |
| GET /search | type=anime, q, page? | `{ type, items, nextPage }`; búsqueda global mediante catálogo |
| GET /me/aura | Sin parámetros | `{ rulesVersion, statistics, rank, ranks, missions, rewards }` |
| GET /me/missions | Sin parámetros | `{ rulesVersion, items, total, claimedIds }`; familias de misiones por género y total, con seis etapas cada una, sin paginar |
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
- Perfil detallado: campos básicos, `statistics` con `watched`, `watchlist`, `reviews`, `posts`, `followers`, `following`, `friends`; `isMe`, `isFollowing`, `followsMe`, `isFriend`; `favorites: [{ anime, position }]`. Todos los contadores salen de la base, no de una página del feed.
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
- Biblioteca permite marcar/desmarcar visto y agregar/quitar watchlist. Desmarcar conserva historial, votos y recompensas reclamadas. Borrado de actividad y conversión de valoración en review quedan pendientes de sus reglas.
- Watchlist, visto y favoritos son estados independientes. Marcar visto o valorar conserva la watchlist; quitar de watchlist no borra votos, vistos ni favoritos. Los favoritos no exigen ni generan un visto.
- Favoritos: máximo 4 IDs distintos en orden; posiciones desde cero. `animeIds: []` vacía favoritos. Reemplazo atómico, sin modificar otros estados de biblioteca. Estas cotas y las de menciones son límites operativos iniciales.
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

## Para ti: conversaciones según gustos

Regla confirmada el 25/10/2026: excluir publicaciones propias y de cuentas seguidas. +3 por watchlist, +1 por género de favoritos/watchlist y +1 por tag coincidente con géneros de interés o tags gustados. Alterna autores y pagina una selección de 20 minutos. Vistos solos no agregan afinidad; seguir a un autor lo retira de la selección. Ver la [guía vigente de integración](docs/GUIA_INTEGRACION_FRONTEND.md) para respuestas, cursores y Tendencia.

## Descubrir: animes nuevos con opiniones

`GET /discover?limit=20&cursor=...` requiere sesión. Devuelve `{ items, total, nextCursor }`; cada item es `{ id, anime, watchlist, reviews }`. `anime` incluye `statistics` con el mismo significado que la ficha. `reviews` contiene hasta dos publicaciones de autores distintos, ordenadas por likes y luego ID descendente, sin filtrar por puntuación positiva. Conservan el indicador spoiler y sus interacciones. Sin reviews se devuelve un array vacío.

Se recomienda el catálogo ya guardado en Ani-Ren, sin importar masivamente el proveedor. Se excluyen todos los IDs marcados vistos por el lector; los animes de cuentas seguidas sí pueden aparecer. Cada anime aparece una sola vez. Se ordena por coincidencias de géneros de vistos/favoritos/watchlist y se desempata por ID externo descendente. La primera versión no usa estrellas como señal.

Selección persistente de 20 minutos, independiente de Para ti. Recargar sin cursor reemplaza la selección de Descubrir de esa cuenta. Al paginar se vuelven a excluir vistos, manteniendo posiciones estables. Cursores inválidos/de otra cuenta o sección devuelven 400; vencidos/reemplazados, 410. El frontend reinicia ante 410. Los metadatos, votos, Watchlist e interacciones se leen actuales. `total` cuenta animes de la selección todavía no vistos, incluyendo páginas anteriores.

Los datos se consultan en lotes por página, sin peticiones externas por tarjeta. Para esta comunidad inicial se puntúa el catálogo guardado completo y se seleccionan reviews en memoria por página; medir e indexar antes de escalar a un catálogo o actividad grandes.

## Búsqueda por categoría

`/search?type=anime` admite texto opcional, géneros OR, temporada, año y page/nextPage. La API filtra cada página remota, guarda metadatos y conserva nextPage incluso en páginas sin coincidencias. No hay total global ficticio. Usuarios, publicaciones y listas conservan búsqueda local normalizada con limit/cursor/total; filtros de anime no se aplican a usuarios. Ver la [guía vigente de integración](docs/GUIA_INTEGRACION_FRONTEND.md).

## Aura, misiones y recompensas

Versión 2: etapas 1/5/10/25/50/100 por género y total de animes distintos, recompensas 10/25/50/125/250/500 puntos. GET /me/aura devuelve points, availablePoints, estadísticas, rango, misiones y recompensas. PUT /me/missions/:id/claim valida progreso y guarda un único reclamo con sus puntos; devuelve { claim, aura }. No recibe puntaje del cliente. Los reclamos anteriores se conservan con cero puntos. Detalle y ejemplos en la [guía vigente de integración](docs/GUIA_INTEGRACION_FRONTEND.md).

## Rangos y ranking de usuarios

Rangos confirmados: Novato 0, Aprendiz 100, Experto 500, Maestro 1500 y Leyenda 5000 puntos reclamados. GET /ranking usa metric=claimed_mission_points y scope global/friends; devuelve puntos, vistos, posición, rango y la posición propia. Empates comparten puesto; friends incluye amistad recíproca y cuenta propia. Ver la [guía vigente de integración](docs/GUIA_INTEGRACION_FRONTEND.md).

## Promedios y páginas

El puntaje global utiliza la valoración más reciente realizada o modificada por cada usuario, con una media simple y un voto por persona/anime. Crear una valoración o cambiar efectivamente sus estrellas actualiza `LibraryEntry.currentRatingId` en la misma transacción. Editar texto, título, spoilers, fecha de visto o reenviar las mismas estrellas no cambia el voto vigente. Reintentar un POST ya confirmado tampoco lo cambia. Se conserva todo el historial y las fechas originales de las publicaciones.

`ratingCount` cuenta entradas históricas; `ratingUserCount` cuenta votos vigentes/personas y es el denominador del promedio; `reviewCount` cuenta reviews. Sin votos, `averageRating` es null. La migración conserva como voto inicial la última entrada creada de cada usuario/anime: los datos antiguos no permiten distinguir cambios de estrellas de otras ediciones.

Los listados paginados usan limit=20 por defecto, máximo 50, y cursor opaco ligado a la consulta y sus filtros; los feeds y biblioteca también lo ligan a la cuenta. Reutilizar el cursor fuera de ese ámbito devuelve 400. `total` representa todas las coincidencias actuales; `items.length` representa solo esa página. Sin más resultados, nextCursor es null. Tendencia, tops y consultas nuevas de perfil/biblioteca también usan selecciones de 20 minutos (ver guía). Las consultas restantes no son instantáneas: cambiar relaciones o referencias puede cambiar coincidencias entre páginas. Favoritos devuelve la colección completa acotada a cuatro para nuevas selecciones. Jikan usa page/nextPage en lugar de cursor, según su contrato.

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
| 410 | FEED_EXPIRED o DISCOVERY_EXPIRED; recargar la sección desde la primera página |
| 413 | BODY_TOO_LARGE; máximo 32 KB de JSON |
| 429 | AUTH_RATE_LIMIT, RATE_LIMIT |
| 500 | INTERNAL_ERROR, sin detalles internos |
| 502/503 | CATALOG_ERROR, CATALOG_INVALID_RESPONSE, CATALOG_UNAVAILABLE, CATALOG_TIMEOUT, CATALOG_DNS_ERROR, CATALOG_TLS_ERROR, CATALOG_BUSY, CATALOG_RATE_LIMIT |

El frontend debe distinguir una sesión vencida de una falta de conexión. Guardar el borrador ante fallo, mostrar el error y ofrecer reintento. No mostrar éxito antes de recibir confirmación del servidor.

## Ampliaciones del 25/10/2026

La [guía vigente](docs/GUIA_INTEGRACION_FRONTEND.md) documenta /explore, /explore/tops, /explore/map, /explore/countries/:country, sus reviews, /users/:id/publications, /users/:id/library, countryCode opcional en POST de valoraciones/reviews, avatarUrl en perfiles, distribución de estrellas, duración/estudios y listIds en actividad. Las cuatro migraciones nuevas conservan datos históricos.
