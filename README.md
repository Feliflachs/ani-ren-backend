# Ani-Ren Backend

API de Ani-Ren para actividad, comunidad, biblioteca y descubrimiento, implementada con Express, TypeScript, Prisma y SQLite. Sigue el recorrido de clase: Expo → HTTP → Express → Prisma → SQLite.

## Estado actual

Implementado y probado mediante HTTP y una base SQLite real:

- Registro, login, restauración y cierre de sesiones revocables.
- Integración de búsqueda y detalle con Jikan; las temporadas conservan sus IDs independientes.
- Biblioteca de vistos, watchlist y favoritos ordenados, sin duplicar un anime por repetir valoraciones.
- Valoraciones sin texto y reviews independientes, con múltiples entradas por usuario/anime.
- Edición por autor, fecha original y última modificación.
- Promedio que incluye todas las valoraciones, puntuación personal más reciente y totales separados.
- Paginación, validación, errores y protección contra duplicar un mismo envío al reintentar.
- Posteos comunes con hashtags y referencias explícitas de anime, sin generar valoraciones.
- Perfil editable (nombre/biografía), seguir/dejar de seguir y amigos como seguimientos recíprocos.
- Likes y comentarios por publicación, compartidos por posteos y reviews.
- Feed cronológico de cuentas seguidas y consultas por autor, anime y tipo de publicación.
- Listas personales con orden, edición propia y likes independientes.
- Búsqueda por categoría; usuarios, publicaciones y listas sin distinguir tildes, etiquetas exactas y filtros locales.
- Para ti: animes no vistos según favoritos, pendientes y etiquetas gustadas, mediante publicaciones de cuentas no seguidas.
- Aura: cinco misiones acumulativas, progreso desde toda la actividad y recompensas únicas persistentes.
- Rangos cada 100 animes distintos vistos y ranking de usuarios global/amigos con empates.

El frontend en `ani-ren-app/context` todavía usa su demo local. La integración en Expo y la prueba en teléfono siguen pendientes: comenzar por [HANDOFF_FRONTEND.md](HANDOFF_FRONTEND.md). No hay todavía Tendencia, mapa remoto, subida de imágenes ni equipamiento de decoradores. La búsqueda global usa Tenrai con conectividad verificada; no incorpora filtros avanzados. Comunidad, listas, descubrimiento y Aura pueden funcionar con los animes ya guardados.

La API requiere sesión salvo registro, login y salud. No se habilitaron aún enlaces públicos sin sesión.

## Preparación

Usar Node.js 22.18 o posterior dentro de la rama 22.x y npm. Desde este repositorio, en PowerShell:

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run dev
```

Copiar `.env.example` solo si todavía no tenés `.env`; no reemplazar una configuración existente. Para actualizar, detener el servidor de desarrollo (evita que Windows bloquee el motor de Prisma), conservar la base y ejecutar `npm.cmd run db:generate` y `npm.cmd run db:deploy` antes de iniciarlo otra vez. Las migraciones social y de descubrimiento conservan los datos existentes; no requieren reset.

Comprobar `http://localhost:3000/api/health`. El resultado esperado es `{"ok":true}`. Para compilar y ejecutar sin el modo de desarrollo:

```powershell
npm.cmd run build
npm.cmd start
```

`prisma/dev.db` se crea mediante migraciones. No se sube a Git, igual que `.env`, los tokens y las bases de prueba. No ejecutar `migrate reset` sobre una base que se quiera conservar.

### Configuración

| Variable | Uso |
| --- | --- |
| DATABASE_URL | Por defecto `file:./dev.db`, relativo al esquema de Prisma |
| PORT / HOST | Puerto 3000 y escucha en 0.0.0.0 para desarrollo en red local |
| CORS_ORIGINS | Orígenes web permitidos, separados por comas; inicialmente localhost:8081 y localhost:19006 |
| SESSION_DAYS | Duración fija de una sesión, siete días por defecto |
| APP_TIME_ZONE | Zona usada para validar que la fecha de visto no sea futura; America/Buenos_Aires |

En un teléfono físico, la URL del servidor debe usar la IP local de la computadora y ambos deben poder comunicarse en la red. `localhost` en el teléfono apunta al teléfono. Para Expo web agregar su origen exacto a CORS_ORIGINS si cambia. No se abrió el firewall ni se publicó el servidor en Internet.

## Dónde está cada responsabilidad

| Archivo | Función |
| --- | --- |
| `src/index.ts` | Arranque, conexión y cierre del servidor |
| `src/app.ts` | Express, CORS, límites y montaje de rutas |
| `src/auth.ts`, `src/security.ts` | Usuarios, hash de contraseñas, sesión y autoría |
| `src/catalog.ts` | Jikan, referencias `mal:ID`, metadatos y promedio propio |
| `src/activity.ts` | Crear/editar valoraciones y reviews de forma transaccional |
| `src/reads.ts` | Catálogo, consultas de publicaciones e historial personal |
| `src/posts.ts` | Crear/editar posteos y referencias explícitas de anime |
| `src/social.ts` | Perfiles, relaciones, likes, comentarios y feed Siguiendo |
| `src/library.ts` | Vistos, watchlist y reemplazo ordenado de favoritos |
| `src/lists.ts` | Listas, orden, permisos y likes |
| `src/search.ts` | Búsqueda por categoría, normalización y filtros locales |
| `src/discovery.ts` | Selección de Para ti, afinidad, exclusiones y páginas persistentes |
| `src/aura.ts` | Reglas de misiones/rangos, progreso, reclamos únicos y ranking de usuarios |
| `src/operations.ts` | Recuperar el resultado de un POST reintentado |
| `src/validation.ts`, `src/errors.ts` | Validación y errores uniformes |
| `src/pagination.ts`, `src/serializers.ts` | Páginas y respuestas para el frontend |
| `prisma/schema.prisma` | Modelos y relaciones implementadas |
| `prisma/migrations/` | Historia reproducible de cambios de base |
| `tests/` | Pruebas HTTP, SQLite y adaptador de catálogo |

Se usa Zod para validar datos que llegan por red; Express no puede confiar en tipos TypeScript del cliente. `express-rate-limit` limita intentos y solicitudes. La criptografía usa `node:crypto`: scrypt para contraseñas y tokens aleatorios cuyo hash se conserva en SQLite.

Prisma queda fijado en 6.19.3 para mantener el modelo de integración del ejemplo de clase. `deepmerge-ts` tiene una corrección fijada en 8.0.0 por [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx); se verificó generación, migraciones y pruebas con esa combinación. `scripts/prisma.cjs` fuerza `RUST_LOG=info` en el proceso de Prisma: se reprodujo el fallo de creación de SQLite con `RUST_LOG=warn` descrito en [esta incidencia](https://github.com/prisma/prisma/issues/29355). No modifica variables globales de la computadora.

## Sesión

Login devuelve `user`, `token` y `expiresAt`. Enviar `Authorization: Bearer <token>` en las solicitudes protegidas. Logout revoca esa sesión y no cierra otras sesiones del usuario. La base guarda únicamente el hash del token.

La integración móvil deberá conservarlo en almacenamiento seguro del dispositivo. Para el frontend web, el primer alcance será sesión en memoria; persistir sesiones web requiere diseñar cookies seguras y su flujo. No guardar contraseña ni copiar el token a AsyncStorage/localStorage. Fuera de una demostración local controlada, servir el backend por HTTPS antes de transportar credenciales reales.

## Catálogo y datos

### Probar AniList: personajes, voces y enlaces

Integración complementaria independiente de Jikan. Consulta real verificada el 12/10/2026 con Naruto (`mal:20`): personajes, voces japonesas, enlaces y paginación. Esta consulta pública no requiere API key ni cuenta de AniList.

Desde este repositorio, sin iniciar el backend:

```powershell
npm.cmd run check:anilist
```

Debe imprimir datos y terminar con `OK`. Usa Internet y no escribe en SQLite. `check:catalog` prueba Tenrai; `check:anilist` prueba los extras. Los enlaces obtenidos no certifican disponibilidad en Argentina ni en otro país.

Para probar la ruta con el servidor iniciado (`npm.cmd run dev`), iniciar sesión con una cuenta de Ani-Ren:

```powershell
$credentials = @{ handle = 'TU_USUARIO'; password = 'TU_CONTRASENA' } | ConvertTo-Json
$session = Invoke-RestMethod 'http://localhost:3000/api/auth/login' -Method Post -ContentType 'application/json' -Body $credentials
$headers = @{ Authorization = "Bearer $($session.token)" }
$result = Invoke-RestMethod 'http://localhost:3000/api/anime/mal:20/extras?page=1' -Headers $headers
$result.extras | ConvertTo-Json -Depth 10
```

Si no tenés cuenta, usar primero `POST /api/auth/register` con el mismo cuerpo (ver ejemplo más abajo). No compartir contraseñas ni tokens. El frontend deberá consumir `/anime/:id/extras`, mostrar carga/error y paginar personajes con `nextPage`; la ficha y las reviews no deben depender del éxito de esta sección. No filtrar países usando `language`.

Integración para evaluación: las [condiciones de AniList](https://docs.anilist.co/guide/terms-of-use) restringen servicios competidores de listas y seguimiento de anime, categoría en la que podría entrar Ani-Ren. Aclarar su admisibilidad antes de adoptarla para publicación; ser un proyecto de clase no garantiza una excepción. Contrato y límites en [API.md](API.md).

### Catálogo principal: Tenrai (compatible con Jikan v4)

Jikan es una API no oficial de MyAnimeList: [documentación](https://docs.api.jikan.moe/), [proyecto](https://github.com/jikan-me/jikan-rest). No se utiliza su sistema de usuarios. Las cuentas y opiniones son propias de Ani-Ren.

**Actualización del 12/10/2026:** tras el cierre de Jikan público se conectó [Tenrai](https://api.tenrai.org/documentation), compatible con el formato Jikan v4 y los mismos IDs MyAnimeList. Búsqueda, detalle y paginación verificados en vivo. Por defecto se usa `https://api.tenrai.org/v1`, configurable con `CATALOG_BASE_URL` en `.env` (HTTPS, sin credenciales). No requiere API key para estas consultas. Es un servicio externo en beta; mantenemos manejo de errores y caché. No se migraron IDs ni datos existentes.

- Identidad pública del catálogo: `mal:20`, por ejemplo. Es la misma entrada del proveedor; no se agrupan temporadas.
- Búsqueda: 20 resultados por página, filtro SFW activo y `nextPage` para continuar.
- No descargar todo el catálogo. Se conservan metadatos al consultar una ficha o registrar actividad sobre ella.
- Caché de consultas en memoria del servidor: máximo 50 respuestas válidas durante un minuto. Las solicitudes simultáneas idénticas comparten una petición y un lugar en la cola. Los errores y respuestas inválidas no se guardan; permiten reintentar.
- Portadas: preferir tamaño normal JPG/WebP, con alternativa de tamaño grande cuando falta; solo URLs HTTPS válidas. Sin imagen disponible, devolver `null` para que el frontend muestre su placeholder.
- Actualización de detalle tras 24 horas. Si falla temporalmente el proveedor y existe una ficha guardada, se devuelve con `metadataStale: true`.
- Una petición externa cada 1,1 segundos, cola limitada y timeout de ocho segundos. Si el proveedor responde 429, pausa nuevas consultas durante un minuto y responde un error recuperable. Estos límites son para un único proceso.
- La búsqueda devuelve metadatos; la ficha contiene `statistics.averageRating`, `ratingCount`, `reviewCount` y `ratingUserCount`, calculados con SQLite. Sin votos, el promedio es `null`.

El adaptador se probó con respuestas controladas y consultas reales a Tenrai. Este chequeo usa exactamente la configuración de catálogo del servidor:

```powershell
npm.cmd run check:catalog
```

Ese comando es de solo lectura, no escribe cuentas ni actividad. La suite habitual no depende de Internet.

### Si falla `check:catalog`

El chequeo ahora muestra el paso, el tiempo transcurrido y un código de diagnóstico:

| Código | Qué se pudo identificar |
| --- | --- |
| CATALOG_TIMEOUT | La petición agotó su tiempo; puede fallar la red o el proveedor |
| CATALOG_DNS_ERROR | No se pudo resolver el dominio del catálogo configurado |
| CATALOG_TLS_ERROR | Falló la conexión HTTPS o la verificación del certificado |
| CATALOG_UNAVAILABLE | Otro fallo de conexión; ver el código técnico mostrado por el chequeo |
| CATALOG_RATE_LIMIT | El proveedor respondió 429; se respeta Retry-After con mínimo un minuto |
| CATALOG_ERROR | El proveedor respondió un error HTTP, cuyo estado se muestra |

La primera línea del chequeo debe indicar `https://api.tenrai.org/v1`. Si indica la dirección antigua, corregir `CATALOG_BASE_URL` en `.env` y reiniciar el backend. No desactivar la validación HTTPS para sortear errores de certificados.

El timeout anterior correspondía a la dirección pública cerrada de Jikan. Tenrai es el reemplazo actual; un nuevo fallo debe diagnosticarse sobre ese proveedor. Los códigos técnicos se muestran sin volcar credenciales.

## Contrato y ejemplo de uso

El contrato concreto está en [API.md](API.md). La planificación general sigue en [PLAN_IMPLEMENTACION.md](PLAN_IMPLEMENTACION.md) y [ESQUEMA_DATOS_Y_API.md](ESQUEMA_DATOS_Y_API.md).

Ejemplo en PowerShell con el servidor encendido; crea una cuenta de prueba nueva. No imprimir ni compartir `$session.token`:

```powershell
$base = 'http://localhost:3000/api'
$account = @{ handle = 'prueba_ani'; password = 'Ejemplo2026' } | ConvertTo-Json
Invoke-RestMethod "$base/auth/register" -Method Post -ContentType 'application/json' -Body $account
$session = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body $account
$headers = @{ Authorization = "Bearer $($session.token)" }
Invoke-RestMethod "$base/anime?q=Naruto" -Headers $headers

$headers['Idempotency-Key'] = [guid]::NewGuid().ToString()
$review = @{
  animeId = 'mal:20'
  rating = 4.5
  text = 'Me gusto volver a ver este anime.'
  watchedOn = '2026-10-01'
  rewatched = $true
  spoiler = $false
} | ConvertTo-Json
Invoke-RestMethod "$base/reviews" -Method Post -Headers $headers -ContentType 'application/json' -Body $review
Invoke-RestMethod "$base/anime/mal:20" -Headers $headers
Invoke-RestMethod "$base/auth/logout" -Method Post -Headers $headers
```

El ejemplo del catálogo y la primera review requieren conexión con Jikan. Para repetir el mismo envío tras un error de red, conservar su clave y cuerpo. Para crear otra review intencionalmente, generar otra clave. No ejecutar otra vez el registro del ejemplo esperando que cree un duplicado: responde 409 si el usuario existe.

### Probar un posteo sin depender de Jikan

Con el servidor encendido, ingresar con una cuenta ya creada (reemplazar los datos de ejemplo). El siguiente recorrido crea un posteo real en la base local, da like y agrega un comentario:

```powershell
$base = 'http://localhost:3000/api'
$account = @{ handle = 'prueba_ani'; password = 'Ejemplo2026' } | ConvertTo-Json
$session = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body $account
$headers = @{ Authorization = "Bearer $($session.token)"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$body = @{ text = 'Arrancando la comunidad de #Anime en Ani-Ren' } | ConvertTo-Json
$result = Invoke-RestMethod "$base/posts" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
$postId = $result.publication.id
Invoke-RestMethod "$base/publications/$postId/like" -Method Put -Headers $headers
$headers['Idempotency-Key'] = [guid]::NewGuid().ToString()
$comment = @{ text = 'Primer comentario de prueba' } | ConvertTo-Json
Invoke-RestMethod "$base/publications/$postId/comments" -Method Post -Headers $headers -ContentType 'application/json' -Body $comment
Invoke-RestMethod "$base/publications/$postId" -Headers $headers
Invoke-RestMethod "$base/auth/logout" -Method Post -Headers $headers
```

Para el recorrido entre cuentas, ingresar con una segunda cuenta y usar `PUT /api/me/following/:userId` con el ID del autor; luego `GET /api/feed?type=following`. No hay actualizaciones en tiempo real: consultar nuevamente después de escribir. Los posteos sin referencias no consultan Jikan; referenciar animes que aún no están guardados sí depende del proveedor.

## Verificación y continuidad

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

Las 42 pruebas crean y eliminan bases aisladas dentro de `.test-data/`, aplican migraciones reales y usan sesiones HTTP independientes. No modifican `prisma/dev.db`. Cubren actividad, autoría, promedio, paginación, sesiones, catálogo controlado, relaciones, interacciones por publicación, biblioteca, listas, búsqueda, Para ti y Aura. Incluyen reclamos simultáneos, vistos distintos, rangos, ranking, proveedor caído, reinicios, migración con datos previos, permisos, reintentos y rollback. Los mensajes de error interno durante las pruebas de rollback son intencionales.

Para probar desde Expo: conectar sus contextos, búsquedas, feeds, Aura y ranking con el contrato de API.md. Próximos bloques: países/mapa, imágenes y avatares, decoradores equipables y Tendencia, con sus reglas pendientes. Retomar Jikan para buscar/importar animes nuevos. No se migraron datos demo del frontend ni se hicieron commits, push o despliegues.

Las reglas iniciales de Aura se confirmaron el 12/10/2026: cada review nueva cuenta para la misión de reviews aunque repita anime; las misiones de vistos cuentan IDs distintos. Rangos en 0/100/200/300/400 vistos; recompensas únicas sin puntos. `GET /api/me/aura` consulta el estado y `PUT /api/me/missions/:id/claim` reclama con sesión, sin cuerpo. Los desbloqueos se conservan tras reiniciar; no se activan desde números enviados por la app.

Para ti recomienda contenido ya publicado en Ani-Ren; una comunidad vacía devuelve un feed vacío. Selecciona todo el conjunto elegible antes de paginar y mantiene el orden durante 20 minutos. La búsqueda local recorre textos en servidor para normalizar tildes y devuelve solo una página. Estas implementaciones son para una comunidad inicial: medir e indexar antes de escalar. Los detalles de señales, exclusiones, cursores y límites están en API.md.
