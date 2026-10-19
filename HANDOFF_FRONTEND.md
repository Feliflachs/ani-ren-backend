> Actualización 18/10/2026: las reglas vigentes de puntuación, Para ti y Descubrir están en API.md y README.md. Un voto vigente por persona; editar estrellas actualiza ese voto. Para ti incluye vistos y seguidos; Descubrir agrupa solo animes no vistos. El frontend integrado está en feature/integracion-backend. Las notas históricas que contradigan estas reglas quedan reemplazadas.

# Ani-Ren: integrar el frontend con el backend local

Fecha: 12/10/2026. Backend listo para integrar el núcleo implementado. No equivale a terminar todas las funcionalidades propuestas. Trabajar sobre la rama `context` del frontend; leer su HANDOFF.md junto con este archivo. No se modificó el repositorio del frontend.

## Fuentes de verdad y alcance

1. [API.md](API.md): rutas, cuerpos, respuestas, validaciones, permisos y paginación implementados.
2. [README.md](README.md): instalación y pruebas de proveedores.
3. Este archivo: orden y diferencias concretas con el frontend actual.
4. PLAN_IMPLEMENTACION.md y ESQUEMA_DATOS_Y_API.md contienen también propuestas futuras: no asumir que toda ruta conceptual existe.

El catálogo principal usa Tenrai (`https://api.tenrai.org/v1`), compatible con Jikan v4 y los mismos IDs MAL. AniList aporta personajes, voces japonesas y enlaces de streaming. Consultas reales verificadas; los fallos externos deben tener estado de error y reintento. No usar el servicio cerrado `api.jikan.moe` desde la app. Toda consulta pasa por nuestro backend; ninguna credencial de sesión se envía a proveedores.

## Arranque y dirección de red

Conservar `.env` y `prisma/dev.db`. Si es la primera instalación, seguir README. Para actualizar, detener el servidor antes de generar Prisma en Windows:

```powershell
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run check:catalog
npm.cmd run check:anilist
npm.cmd run dev
```

Tenrai es el valor por defecto aunque `.env` todavía no tenga `CATALOG_BASE_URL`. Si existe con la dirección antigua, cambiar solo esa variable. No ejecutar reset ni sobrescribir `.env`.

En el frontend definir `EXPO_PUBLIC_API_URL` con la base **incluido `/api`**, y centralizarla en un único cliente HTTP. Reiniciar Expo al cambiar configuración.

| Dónde corre la app | Base de ejemplo |
| --- | --- |
| Navegador en la misma PC | `http://localhost:3000/api` |
| Emulador Android estándar | `http://10.0.2.2:3000/api` |
| Teléfono físico | `http://IP_LAN_DE_LA_PC:3000/api` |

En teléfono, localhost es el teléfono. Usar la misma red; localizar IPv4 de la PC con `ipconfig` y comprobar `/api/health` desde el navegador del teléfono. El servidor escucha en `0.0.0.0`; permitir el puerto en la red privada si el firewall lo bloquea. El túnel de Expo no publica automáticamente el backend. Para Expo web, agregar el origen exacto a `CORS_ORIGINS` si difiere de localhost:8081/19006. No poner tokens en EXPO_PUBLIC_*.

## Orden de integración

| Bloque del frontend | Fuente remota y adaptación |
| --- | --- |
| SessionContext | Registro/login, `/auth/me`, logout; reemplazar selección de usuario demo por sesión real |
| Catálogo y fichas | `/anime?q=...`, `/anime/:id`, extras separados; IDs opacos `mal:20` en rutas y relaciones |
| PublicationsContext | Separar rating sin texto, review y post; listar/crear/editar mediante API; likes y comentarios del servidor |
| AppState | Vistos, watchlist, favoritos e historial; `currentRating` y totales remotos |
| ProfilesContext, useDirectory, useCurrentUser | Perfil propio/remoto y búsquedas paginadas; no construir un directorio completo cargando toda la comunidad |
| SocialContext | Seguir/dejar de seguir y amigos recíprocos, contadores de servidor |
| Inicio, feed.ts | `/feed?type=following` y `/feed?type=for-you`; retirar selección local sobre una página |
| ListsContext | Crear/editar/listar/likes; conservar orden y posiciones devueltos |
| Explorar | `/search` por categoría; respetar diferencias de filtros y cursores |
| useMissions, Aura, ranking | `/me/aura`, `/me/missions`, reclamo PUT y `/ranking`; no calcular progreso a partir de una página |

Integrar un recorrido por vez, manteniendo diseño visual. Retirar mocks y persistencia social local cuando sus consumidores estén conectados. No subir automáticamente a la cuenta real los datos demo o históricos de AsyncStorage. Conservar solo preferencias, borradores y credencial segura; no implementar sincronización offline ni descargar todo el catálogo.

## Reglas que el frontend debe adaptar

- Login devuelve token opaco y expiresAt; enviar `Authorization: Bearer TOKEN`. Registro no inicia sesión. En móvil, almacenamiento seguro del sistema; en web, sesión en memoria para esta versión. No guardar contraseña ni token en AsyncStorage/localStorage. Ante 401 invalidar sesión y datos privados; un timeout de `/auth/me` debe permitir reintentar, no considerarse automáticamente credencial revocada.
- Cambiar de cuenta o cerrar sesión limpia todos los estados y cachés privados. Cancelar/ignorar respuestas tardías de la cuenta anterior. No mostrar brevemente sus listas o feed a otra cuenta.
- Backend genera IDs y fechas. Nada de `current-user`, IDs demo, IDs numéricos MAL sin prefijo ni fechas inventadas.
- Varias valoraciones/reviews del mismo usuario y anime: historial por ID de entrada, no un objeto único indexado por anime. Todas las valoraciones cuentan en el promedio; la actual es la última creada. Editar conserva createdAt y cambia updatedAt, sin reordenar historial como si fuera nueva.
- Rating sin texto: POST `/ratings`; no aparece como publicación. Review: POST `/reviews` (mínimo diez caracteres). Post: POST `/posts`, sin puntuación ni visto automático. Rewatched es booleano, no un contador.
- Crear rating/review marca visto. Vistos y misiones de géneros cuentan IDs distintos; misión de reviews cuenta publicaciones nuevas aunque repitan anime. Las temporadas se conservan como entradas distintas del catálogo.
- Tarjetas de review reciben `publication.anime` con metadatos guardados; posts reciben `mentionedAnime`. No hacer una petición externa por cada tarjeta. `animeIds` y `animeId` siguen disponibles.
- Hashtags no se convierten automáticamente en menciones de anime: seleccionar y enviar `animeIds` explícitos en posteos. Esto difiere del detector local del front.
- Para ti exige al menos una referencia a anime no visto y excluye publicaciones propias y de seguidos. Esta regla de servidor prevalece sobre la nota anterior del HANDOFF del front que permitía contenido compuesto solo por vistos. No rellenar con Siguiendo ni alterar scores desde el cliente.
- `/feed?type=for-you` conserva una selección durante veinte minutos. Continuar con nextCursor; al refrescar empezar sin cursor y reemplazar items. Ante 410 empezar una selección nueva. Al seguir un autor o marcar visto, refrescar para reflejar exclusiones.
- Vistos solo permite `watched: true`; watchlist permite true/false. No ofrecer todavía desmarcar visto ni borrar actividad/publicaciones/listas/cuentas. Quitar de watchlist o favoritos sí existe.
- No confundir promedio de Ani-Ren (0,5–5) con puntuación MAL/AniList. Usar `statistics` del backend; sin votos el promedio es null.

## Cliente HTTP, reintentos y paginación

Los POST de ratings/reviews/posts/comentarios/listas requieren `Idempotency-Key`: generar una clave por envío lógico y reutilizarla con el mismo cuerpo si hay timeout. No generar otra en cada reintento: duplicaría publicaciones. Si el usuario modifica el envío tras resolver el anterior, usar una clave nueva. PUT de likes/seguimientos/recompensas ya es idempotente por identidad.

Confirmar cambios con la respuesta del servidor y mantener el borrador si falla. Un 204 no tiene JSON. Errores: `{ error: { code, message, ... } }`. Manejar 400 validación, 401 sesión, 403 permisos, 404 ausente, 409 conflicto/objetivo incompleto, 410 selección vencida, 429 límite y 502/503 proveedor. No mostrar un error como si fuera un resultado vacío.

Listas locales paginadas usan `limit`, `cursor` y `nextCursor`; los cursores están ligados a filtros/cuenta. Cambiar búsqueda o filtros reinicia colección/cursor. Catálogo y personajes usan `page`/`nextPage`. Deduplicar al anexar por ID y descartar respuestas de búsquedas anteriores; añadir debounce al texto. `total` no se obtiene de items.length.

## Funciones pendientes: no conservar números demo como datos reales

Tendencia y tops globales de anime; métricas por país/mapa; imágenes/avatares subidos; decoradores equipables; borrados; desmarcar visto; conversión rating↔review; filtros avanzados del catálogo externo. Ocultar o deshabilitar sus acciones con estado claro de pendiente. Reconocimiento, openings y endings siguen como extras futuros. La detección local de país del front no se envía todavía: el backend no acepta ese campo.

Extras de AniList: pedirlos aparte para no bloquear la ficha; disponibilidad regional `unknown` aunque haya enlaces. Se puede abrir la plataforma para consultar disponibilidad; no inferir Argentina del idioma. Para este proyecto local se continúa con la evaluación técnica; revisar condiciones antes de una publicación futura.

## Prueba de aceptación en la app

1. Crear A y B, iniciar sesiones independientes. Buscar anime real, abrir ficha y extras.
2. A publica review de 3,5; B la ve, comenta y da like. A publica otra del mismo anime con 4,5: dos reviews, promedio 4 si no hay otras valoraciones, puntuación actual 4,5 y un anime visto.
3. Editar la primera review: conserva likes/comentarios y fecha original; muestra última modificación. B no puede editarla.
4. Valorar sin texto otro anime: biblioteca/progreso cambian y no aparece review vacía. Crear post sin puntuación: no aumenta vistos.
5. Probar watchlist/favoritos, listas ordenadas, seguir/dejar de seguir, búsquedas y ambas paginaciones.
6. Para ti: B sin seguir a A puede descubrir una publicación sobre un anime que B no vio; al seguir A debe salir de Para ti y entrar en Siguiendo. El feed puede estar vacío con una sola cuenta: no es un fallo.
7. Completar misión y reclamar dos veces: una recompensa. Comprobar rango y ranking sin contadores demo.
8. Reiniciar backend/app: datos persistentes, sesión válida restaurada en móvil. Cambiar cuenta: aislamiento. Cortar red al guardar: borrador conservado y reintento con misma clave sin duplicados.

Pruebas de backend y proveedores no sustituyen estas comprobaciones en Expo/teléfono. El backend no necesita reset para integrar el front.

## Texto para iniciar el trabajo en el repositorio del frontend

> Integrá Ani-Ren con el backend local de ../ani-ren-backend. Leé HANDOFF_FRONTEND.md, API.md y README.md de ese repositorio, y contrastalos con el HANDOFF.md de la rama context del frontend. Empezá por cliente HTTP, sesión real y el recorrido buscar anime → publicar review → verla desde otra cuenta. Después conectá comunidad, biblioteca, listas, búsqueda, feeds y Aura. Reemplazá mocks por recorrido, preservá el diseño y las reglas acordadas, no migres datos demo automáticamente ni inventes rutas para funcionalidades pendientes. Verificá aislamiento de cuentas, reintentos, paginación y persistencia.
