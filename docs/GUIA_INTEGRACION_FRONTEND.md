# Guía de la nueva integración · paso 3

Backend: `implementacion-front`. App: `nueva-integracion-back`. Esta guía reemplaza las instrucciones anteriores para Aura, Para ti, Explorar y los contratos ampliados. Ver [auditoría](AUDITORIA_FRONT_BACK.md), [mapa del código](MAPA_BACKEND.md) y [API histórica del núcleo](../API.md).

## Preparar el servidor

```powershell
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

Las migraciones agregan selecciones paginadas, puntos en reclamos, país de las valoraciones, avatar y metadatos. Conservan cuentas, sesiones, historial y recompensas. Detener el servidor antes de regenerar Prisma. No ejecutar `migrate reset`. Las migraciones de esta etapa se verifican en bases temporales; la base de desarrollo no se migra automáticamente durante este trabajo.

Base URL con `/api`, por ejemplo `http://192.168.1.10:3000/api` en un teléfono de la misma red. El móvil no usa `localhost` para acceder a la computadora. Configurar `CORS_ORIGINS` para Expo web. No poner tokens ni claves en el repositorio.

## Cliente único y sesión

Hay un [cliente TypeScript de ejemplo](../scripts/frontend-client.example.ts), incluido en el chequeo de tipos. Su función `createApiClient(baseUrl, getToken)` centraliza HTTP, errores, token e idempotencia. No está conectado a la app todavía.

Todas las rutas siguientes son relativas a `/api`; requieren `Authorization: Bearer TOKEN` salvo salud, registro y login. Login devuelve `{ user, token, expiresAt }`; registro devuelve únicamente `{ user }` con estado 201 y requiere iniciar sesión después. Ambos reciben `{ handle, password }`. `/auth/me` restaura la sesión y POST `/auth/logout` la revoca. Al cambiar cuenta, limpiar las cachés de usuario. Las respuestas de error son `{ error: { code, message, ... } }`.

Guardar el token en almacenamiento seguro nativo al integrar; el `userId` de AsyncStorage de la demo no autentica. Mantener la contraseña solo durante el formulario. El cliente de ejemplo no implementa almacenamiento ni refresco de sesión.

## Contratos por pantalla

| Pantalla / contexto | Consulta u operación |
| --- | --- |
| Inicio | `GET /feed?type=for-you\|following\|trending&limit=20&cursor=...` |
| Sugeridos de anime | `GET /discover?limit=20&cursor=...` (ya existente; no exige crear una sección visual nueva) |
| Explorar | `GET /explore`: `genres`, `seasons`, cuatro `trending` y origen `ani-ren` |
| Buscar anime / elegir anime | `GET /search?type=anime&q=...&genres=mal:1,mal:22&season=spring&year=2026&page=1` |
| Buscar otras categorías | `GET /search?type=users\|publications\|lists&q=...&limit=20`; géneros/temporada/año para publicaciones/listas, nunca usuarios |
| Ficha de anime | `GET /anime/mal:20`; `GET /anime/mal:20/extras?page=1` para elenco/enlaces |
| Actividad del editor | `GET /me/anime/mal:20/activity`: historial, `currentRating`, vistos, watchlist, posición favorita y `listIds` |
| Nueva valoración sin texto | `POST /ratings`, clave de idempotencia y cuerpo de valoración |
| Nueva review | `POST /reviews`, clave de idempotencia y cuerpo de review |
| Editar | `PATCH /ratings/:ratingEntryId` o `/reviews/:publicationId`; el ID de una review no es el ID de su valoración |
| Posteos | `POST /posts` / `PATCH /posts/:id`; `text`, `spoiler?`, `animeIds?`, sin puntuación |
| Likes/comentarios | `PUT`/`DELETE /publications/:id/like`; `GET`/`POST /publications/:id/comments` |
| Biblioteca | `GET /users/:id/library?collection=watched\|watchlist\|favorites&q=...&limit=20` (también sirve para el usuario propio) |
| Cambiar colección | `PATCH /me/library/mal:20` con `watched` y/o `watchlist`, booleanos |
| Favoritos ordenados | `GET`/`PUT /me/favorites`; al guardar `{ animeIds: [...] }`, máximo cuatro IDs únicos, orden significativo |
| Perfil | `GET /users/:id`; estadísticas, `auraPoints`, `rank`, favoritos y relaciones con quien consulta |
| Publicaciones del perfil | `GET /users/:id/publications?collection=reviews\|posts\|likes\|all&sort=recent\|featured&limit=20` |
| Dos reviews destacadas | `GET /users/:id/publications?collection=reviews&sort=featured&limit=2` |
| Editar perfil | `PATCH /me/profile` con `name?`, `bio?`, `avatarUrl?`; URL HTTPS o `null`, sin modificar handle ni identidad |
| Relaciones | `GET /users/:id/followers\|following\|friends`; `PUT`/`DELETE /me/following/:userId` |
| Listas | `GET /lists?userId=...&animeId=...`, `GET /lists/:id`, `POST /lists`, `PATCH /lists/:id`, `PUT`/`DELETE /lists/:id/like` |
| Aura / Misiones | `GET /me/aura`, `GET /me/missions`, `PUT /me/missions/:id/claim` |
| Ranking de usuarios | `GET /ranking?scope=global\|friends&limit=20&cursor=...`, ordenado por puntos |
| Tops de anime | `GET /explore/tops?criterion=rating\|views\|trending&period=week\|month\|all&genre=mal:22&limit=20` |
| Mapa / comparación de anime | `GET /explore/map?metric=views\|reviews\|popularity\|anime&period=all&animeId=mal:20` |
| País | `GET /explore/countries/AR?period=all&animeId=mal:20` (también acepta los slugs actuales, por ejemplo `argentina`) |
| Reviews de país | `GET /explore/countries/AR/reviews?period=all&animeId=mal:20&limit=20` |

En las tablas, `\|` significa elegir un valor, no enviar el símbolo. Omitir parámetros opcionales vacíos. Usar `URLSearchParams` para el texto y `encodeURIComponent` para IDs en rutas.

## Guardar una valoración y su país

```http
POST /api/ratings
Authorization: Bearer TOKEN
Content-Type: application/json
Idempotency-Key: 41a9a8ba-01bc-4ac3-936b-a93a353e06d1

{"animeId":"mal:20","rating":4.5,"watchedOn":"2026-10-25","rewatched":false,"countryCode":"AR"}
```

Para una review usar `/reviews` y agregar `text` (10–2000 caracteres), `title?` y `spoiler?`. Ambos casos crean la valoración, marcan visto y actualizan el voto vigente dentro de una transacción. Se devuelve `{ rating }` o `{ publication }`. El autor siempre proviene de la sesión.

Obtener el país una vez al guardar una nueva valoración/review. En Expo, pedir permiso contextual de ubicación y usar `reverseGeocodeAsync(...).isoCountryCode`; no enviar `country` traducido. Ese campo puede ser nulo según la [documentación de Expo Location](https://docs.expo.dev/versions/latest/sdk/location/#locationgeocodedaddress). Usar una función que **retorne** el código: no hacer `setPais(...)` y luego leer el estado React anterior para construir la petición. La app actual solo obtiene ubicación si hay texto; extender el recorrido a valoraciones sin texto en el paso 3.

Si no hay permiso, no hay servicios, falla la consulta o es web sin ese recorrido, enviar `countryCode: null` u omitirlo y guardar igualmente. El backend almacena solo el país asociado al registro, no coordenadas ni dirección. Ese país describe dónde se registró la valoración; no demuestra dónde ocurrió una visualización histórica ni se infiere por IP.

Mantener **la misma clave y el mismo cuerpo** al reintentar un envío cuya respuesta se perdió, incluido el país: no volver a geolocalizar y cambiar el cuerpo del reintento. Un envío nuevo usa otra clave. El mismo envío no duplica valoración, vista ni publicación. Una clave reutilizada con otro cuerpo devuelve conflicto.

Editar con PATCH cambia la entrada original y su puntuación, pero no crea una vista ni cambia el país. No mandar `countryCode` en PATCH. `watchedOn` es `YYYY-MM-DD`; convertir el `DD/MM/YYYY` de la interfaz sin pasar por una conversión de zona horaria que cambie el día.

El editor debe enviar una operación de valoración/review según corresponda. Si también modifica listas/favoritos/watchlist, confirmar sus operaciones por separado y conservar el estado pendiente si alguna falla; no simular éxito global. No recrear una review existente solo para guardar un favorito.

## Misiones, puntos y rangos

Reglas `rulesVersion: "2"`, centralizadas en `src/modules/aura/aura.rules.ts`:

| Animes distintos requeridos por etapa | Puntos automáticos |
| --- | --- |
| 1 | 10 |
| 5 | 25 |
| 10 | 50 |
| 25 | 125 |
| 50 | 250 |
| 100 | 500 |

Hay una familia general (`watched-1`, `watched-5`, etc.) y una por género (`genre-mal-22-1`, `genre-mal-22-5`, etc.). Se incluyen los siete géneros iniciales de la app y otros géneros encontrados en el catálogo. Un anime multigénero aporta uno a cada género; no cuenta dos veces por duplicados de metadatos ni por repetir una review. Cada familia completa da 960 puntos. Las etapas son acumulables e independientes: llegar a cinco acredita las etapas uno y cinco una vez cada una.

| Rango | Puntaje mínimo |
| --- | --- |
| Novato | 0 |
| Aprendiz | 100 |
| Experto | 500 |
| Maestro | 1500 |
| Leyenda | 5000 |

`GET /me/aura` devuelve `points` (acreditados automáticamente), `availablePoints` (cero tras sincronizar), `featuredMissionIds` (hasta tres objetivos aún sin completar), `rank`, `ranks`, `statistics`, `missions` y `rewards`. Cada misión tiene `id`, `groupId`, `genreId`, `title`, `description`, `total`, `points`, `value`, `rawProgress`, `state`, `claimed`, `awardedPoints` y `claimedAt`.

Los estados son `pending`, `in_progress`, `completed`: adaptarlos a los rótulos actuales “Pendiente”, “En curso”, “Completada”. Una misión acreditada conserva `state: completed` aunque se desmarquen vistos; `rawProgress` refleja la colección actual. `awardedPoints` conserva los puntos reales otorgados, aunque una versión futura cambie las reglas.

```http
PUT /api/me/missions/genre-mal-22-5/claim
Authorization: Bearer TOKEN
```

No enviar puntos, progreso, recompensa ni usuario. Respuesta `{ claim, aura }`: reemplazar el estado Aura por el confirmado. Si falta progreso devuelve `409 MISSION_INCOMPLETE`; una misión desconocida, `404 MISSION_NOT_FOUND`. Reintentos y reclamos simultáneos no duplican puntos. Las recompensas anteriores conservan sus nombres y `rulesVersion: "1"`, con cero puntos retroactivos.

Perfil, Aura y ranking usan estos puntos. `rank` contiene `name`, `index`, `points`, `threshold`, `nextRank`, `nextThreshold`, `remaining`, `progress` (0–1). Para la barra actual, usar el progreso del servidor; no volver a dividir vistos por 100. En Leyenda, `nextRank`/`nextThreshold` son null y `progress=1`.

Ranking: `{ metric: "claimed_mission_points", scope, items, total, me, nextCursor }`; cada elemento tiene `user`, `points`, `watched`, `position`, `rank`. Empates comparten posición (1,1,3). `me` devuelve la posición aunque no esté en la página. Amigos significa seguimiento recíproco e incluye la propia cuenta.

## Feed, sugeridos y búsqueda

Para ti: excluye la propia cuenta y cuentas seguidas. Señales del frontend: +3 por mencionar un anime de watchlist, +1 por género coincidente con favoritos/watchlist, +1 por hashtag coincidente con géneros de interés o tags de publicaciones gustadas. Orden global y alternancia de autores; vistos solos no agregan afinidad ni excluyen conversaciones. Seguir a alguien lo retira también de una selección ya creada.

Siguiendo: publicaciones de las cuentas seguidas. Tendencia: todas las publicaciones por `likeCount + commentCount`, después fecha y ID descendentes. La interfaz no vuelve a ordenar las páginas.

`/discover` recomienda animes guardados que el usuario no vio; considera géneros de biblioteca, favoritos y watchlist y devuelve hasta dos reviews de autores distintos. No consulta todo el catálogo externo ni crea actividad. No confundir esta selección con el feed Para ti.

Búsqueda de anime devuelve `items` y `nextPage`, no `nextCursor` ni un total global. Géneros son IDs (`mal:1`), temporada `spring/summer/fall/winter` y año separado; usar los valores de `/explore` para traducir rótulos. La búsqueda filtrada evalúa páginas del proveedor en backend: puede devolver `items: []` con `nextPage` no nulo. Seguir recorriendo al pedir más; el fin es `nextPage === null`. No informar “no existe” por una sola página vacía ni descargar indefinidamente todo el catálogo desde la pantalla. El formato del proveedor se basa en el [adaptador Jikan](https://docs.api.jikan.moe/), con la URL configurable existente; los filtros son aplicados por nuestro backend para mantener OR de géneros.

## Explorar, tops y mapa

Datos de origen `ani-ren`: no son el puntaje ni popularidad global de MyAnimeList. Base nueva sin actividad devuelve listas vacías y ceros/null, nunca los totales de la demo.

`period=week/month/all` representa últimos 7 días/30 días/todo desde `createdAt` del registro. `criterion=rating` ordena por promedio, luego vistas; `views`/`trending` por vistas, luego promedio. Desempate final por ID de anime. Cada fila tiene `anime`, `views`, `viewers`, `reviews`, `ratingCount`, `ratingSum`, `averageRating`, `popularity` (0–100) y, en tops, `position`.

En tops globales y ficha, el promedio usa el voto vigente por cuenta. En país, usa todas las valoraciones registradas en ese país como eventos. **Vistas** de mapa/tops no son **animes distintos** de Aura. Editar conserva el número de vistas; una nueva valoración del mismo anime suma otra vista y puede informar otro país.

Mapa devuelve `{ source, metric, period, animeId?, items, unknownCountryViews, generatedAt }`. Cada país tiene `id`, `code`, `name`, `flag`, `views`, `reviews`, `ratingSum`, `averageRating`, `popularity`, `value`, `intensity`, `colorLevel`.

- `metric=anime` exige `animeId`. Ese filtro también puede acompañar otras métricas.
- `intensity` es el valor relativo al máximo del conjunto (0–1). `colorLevel` es 0 sin actividad, o 1–5; conservar la paleta violeta existente y aplicarla a ese nivel.
- `metric=popularity` usa vistas relativas, 0–100; no inventa interés a partir del orden de países del mock.
- La API conserva los slugs de los seis países dibujados y devuelve otros códigos ISO si hay actividad. No mover coordenadas ni modificar el SVG al integrar datos; acordar luego la representación de los demás países.
- `unknownCountryViews` informa valoraciones sin país; no asignarlas a un país ficticio.

Detalle de país: `statistics`, `topRated` (máximo cinco del período pedido), `trending` (máximo cinco de los últimos siete días, `trendingPeriod: "week"`) y `comparison`. `animeId` limita estadísticas y comparación al anime seleccionado. Las reviews locales salen del endpoint paginado del país, no de una lista fija de IDs en el frontend.

## Adaptar datos manteniendo la interfaz

Crear adaptadores entre los DTOs y los componentes existentes. No reemplazar pantallas ni estilos por estructuras del backend.

| Campo actual | Fuente real |
| --- | --- |
| `image` de anime / avatar | `{ uri: imageUrl }` / `{ uri: avatarUrl }` si existe; conservar fallback visual si falta |
| `genres: string[]` | `genres.map(g => g.name)`; conservar también IDs para filtros |
| `rating` de anime | `statistics.averageRating` o `averageRating` de tops; null significa “sin votos”, no cero estrellas |
| `duration` / `studio` | `durationMinutes` / `studios`; faltantes se muestran con el estado vacío existente |
| `likes`, `comments` | `likeCount`, `commentCount`; `likedByMe` para el botón |
| `time` | Formato relativo de `createdAt`; formato visual sí pertenece al frontend |
| `date` del editor | `watchedOn`, convertido a DD/MM/YYYY |
| `rank` / progreso / totales | Valores del servidor; nunca contar solo los elementos cargados |
| colección `likedIds` de animes | Favoritos ordenados; no confundir con likes de publicaciones |
| ID de anime | Referencia `mal:NNN`, no slugs mock como `frieren`; no fusionar temporadas |

Validar `spoiler` antes de mostrar el texto, igual que en la interfaz actual. Conservar borradores y errores del formulario. Los textos de “datos de ejemplo” deberán reflejar datos reales al integrar, sin rediseñar el componente.

La ficha actual dibuja cinco barras: usar `statistics.distributionBands`, ya calculadas en servidor y ordenadas de 5 a 1 estrella. Cada banda agrupa dos medias estrellas (4,5 y 5 en la de 5; 3,5 y 4 en la de 4, etc.) y entrega `stars`, `count`, `percentage`. `statistics.distribution` conserva los diez valores exactos por si otra vista los necesita. No agregar cinco barras nuevas ni reagrupar votos en la app.

## Paginación e invalidaciones

Listados locales usan `limit` (20 por defecto, máximo 50), `total`, `nextCursor`. No reconstruir cursores ni reutilizarlos entre cuentas, filtros o secciones. Cambiar filtro reinicia la lista. Un 410 obliga a comenzar sin cursor; un 401 cierra/restaura sesión según el flujo.

Para ti y Descubrir conservan selecciones por 20 minutos; recargar sin cursor reemplaza la selección de esa cuenta. Tendencia, tops y consultas nuevas de perfil/biblioteca conservan una copia de resultados durante 20 minutos, con máximo 20 selecciones recientes por cuenta. Los datos de esa copia pueden quedar anteriores a una edición/like: renovar tras una escritura o al refrescar. Ranking y consultas históricas del núcleo son lecturas actuales, no copias congeladas.

| Operación confirmada | Renovar |
| --- | --- |
| Crear/editar valoración o review | Ficha, actividad, biblioteca, perfil, Aura/misiones, feed, tops y mapa |
| Reclamar misión | Aura, misiones, perfil y ranking de usuarios |
| Cambiar vistos | Biblioteca, perfil, Aura y Descubrir; puntos reclamados permanecen |
| Favoritos / watchlist | Biblioteca, perfil, Para ti y Descubrir |
| Like / comentario | Publicación, listas de publicaciones, destacados, Tendencia; Para ti si cambia señal de gustos |
| Seguir / dejar de seguir | Perfiles, relaciones, Siguiendo, Para ti y ranking de amigos |
| Editar perfil / listas | Detalles y tarjetas afectadas |

## Pendientes antes de declarar integración completa

- Definir desbloqueos y equipamiento de decoradores; no llamar a un endpoint que no existe.
- Elegir almacenamiento/subida binaria de avatares y conectar cámara/galería. `avatarUrl` ya persiste una referencia remota, pero no sube el archivo.
- Probar permisos, tiempos de geolocalización, pérdida de red, reintentos y múltiples cuentas en teléfono. Verificar que ninguna pantalla cambió visualmente.
- Probar el proveedor real configurado y considerar una búsqueda indexada si recorrer páginas filtradas resulta lento.

El paso 2 no modifica la app ni sus dependencias. Esta guía y el cliente de ejemplo son el punto de partida del paso 3.

### Búsqueda dentro de Biblioteca (integración frontend)

`GET /lists?userId=...&q=...` filtra nombre/descripción antes de paginar.
`GET /users/:id/publications?collection=likes&q=...` filtra texto, título y anime mencionado antes de paginar; el cursor de selección queda ligado también al texto normalizado.
`q` es opcional, con hasta 100 caracteres. No se filtra una página local como si fuera el conjunto completo.

### Recompensas automáticas (25/10/2026)

Ratings, reviews y marcar visto acreditan todas las etapas alcanzadas dentro de la misma transacción. El inicio del servidor y las consultas de Aura reconcilian objetivos completos anteriores sin reclamar. Los puntos existentes no se modifican; quitar/reagregar vistos y reintentar una escritura no vuelven a premiar una etapa. `PUT /me/missions/:id/claim` se mantiene por compatibilidad, pero el frontend no debe mostrar un botón de reclamo. Usar `featuredMissionIds` para destacadas y `missions` completo para el historial y filtros.

## Disponibilidad por país

GET /api/anime/:id/streaming?country=AR (sesión requerida). country es ISO2 opcional. No acepta coordenadas ni produce actividad, votos, misiones o biblioteca. Devuelve animeId, country, status, source, links y message.

- regional: opciones informadas por TMDB/JustWatch para el país. links incluye id, site, url y offer en castellano.
- no_data: TMDB no informa opciones para ese país; no prueba ausencia absoluta.
- general: enlaces de AniList, sin confirmación regional (país ausente, proveedor no configurado/caído o correspondencia ambigua).
- unavailable: no se pudo consultar la información; mostrar reintento.

Configurar TMDB_READ_ACCESS_TOKEN o TMDB_API_KEY en .env exclusivamente del backend y reiniciar. Si están ambos, prevalece el token. Las credenciales no forman parte del DTO ni de mensajes de error. Identidad basada en AniList idMal, nombres, año, formato TV/MOVIE y coincidencia única con animación en TMDB; no inferir temporadas ni elegir primer resultado aproximado. Caché en memoria acotada a 500 respuestas/6 horas, sin escrituras en la base.

Atribución: mostrar TMDB/JustWatch y créditos; el enlace del proveedor dirige a opciones de reproducción de TMDB. Referencias: https://developer.themoviedb.org/reference/tv-series-watch-providers y https://developer.themoviedb.org/reference/movie-watch-providers.

### Castellano (26/10/2026)
GET /anime/:id agrega synopsisEs (string o null), incluso para registros ya guardados. TMDB translations se consulta solo con coincidencia inequívoca de título, año, animación y formato TV/MOVIE. Preferencia AR, MX, ES; caché compartida de seis horas. Límite de espera de localización: ocho segundos; ante ausencia/fallo se conserva synopsis original. No se reemplaza el original en la base. Los géneros se traducen en la serialización JSON y en los nombres de misiones/filtros, sin modificar IDs. El pie final de MAL Rewrite se retira de la lectura y se reconoce en Créditos. La app conserva synopsisEs al recibir entidades parciales del feed.
