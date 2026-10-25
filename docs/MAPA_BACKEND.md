# Mapa del backend

Este documento es el punto de entrada para encontrar y modificar código. El paso 1 agrupó funcionalidades sin cambiar comportamiento. El paso 2 amplía contratos y reglas según la [auditoría](AUDITORIA_FRONT_BACK.md) y la [guía de integración](GUIA_INTEGRACION_FRONTEND.md).

## Recorrido de una solicitud

```text
Frontend → /api/... → app.ts → router del módulo → Prisma → SQLite
                                      └────────→ catálogo externo (cuando corresponde)
                         ↑
              sesión, validación y errores
```

`src/index.ts` conecta la base y arranca/cierra el servidor. `src/app.ts` configura Express y monta los routers. Las dependencias se pasan a los routers (base, catálogo, zona horaria); las pruebas pueden reemplazar proveedores externos.

## Carpetas

```text
src/
├── index.ts
├── app.ts
├── config/
│   └── config.ts
├── modules/
│   ├── auth/          # Registro, login, sesiones y contraseñas
│   ├── catalog/       # Metadatos, promedio propio y extras de anime
│   ├── activity/      # Valoraciones, reviews y consultas de actividad
│   ├── community/     # Posteos, perfiles, relaciones e interacciones
│   ├── library/       # Vistos, watchlist y favoritos
│   ├── lists/         # Listas personales, orden y likes
│   ├── search/        # Búsqueda por categoría y filtros
│   ├── discovery/     # Para ti y descubrimiento de animes
│   ├── explore/       # Tops, países, mapa y agregados de valoraciones
│   └── aura/          # Misiones, recompensas, rangos y ranking
└── shared/            # Validación, errores, paginación, DTOs e idempotencia
prisma/
├── schema.prisma
└── migrations/
tests/                 # Pruebas por funcionalidad y fixture de SQLite
scripts/               # Comandos de Prisma y comprobaciones de proveedores
docs/
└── MAPA_BACKEND.md
```

## Dónde tocar cada funcionalidad

Todas las rutas de la tabla tienen prefijo `/api`. Es un índice de responsabilidades; el contrato detallado existente está en [API.md](../API.md).

| Área | Archivo dentro de `src/` | Responsabilidad / rutas principales | Pruebas en `tests/` |
| --- | --- | --- | --- |
| Autenticación | `modules/auth/auth.ts`, `security.ts` en esa carpeta | `/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout`; middleware de sesión y criptografía | `backend.test.ts` |
| Catálogo | `modules/catalog/catalog.ts`, `catalog-errors.ts` | Adaptador de catálogo, cache de metadatos, `ensureAnime`, `animeDetail` y promedio de valoraciones vigentes | `catalog.test.ts`, `current-rating-discover.test.ts` |
| Extras | `modules/catalog/anime-extras.ts` | `/anime/:id/extras`; proveedor AniList, personajes, voces y enlaces | `anime-extras.test.ts` |
| Valoraciones y reviews | `modules/activity/activity.ts` | Crear/editar `/ratings` y `/reviews`; transacciones e idempotencia | `backend.test.ts`, `current-rating-discover.test.ts` |
| Consultas | `modules/activity/reads.ts` | `/anime`, `/anime/:id`, `/publications`, `/publications/:id`, `/me/anime/:animeId/activity` | `backend.test.ts` |
| Posteos | `modules/community/posts.ts` | Crear/editar `/posts`, hashtags y menciones de anime | `social.test.ts` |
| Comunidad | `modules/community/social.ts` | Perfiles, seguir, amigos, likes, comentarios y `/feed` de Siguiendo | `social.test.ts` |
| Biblioteca | `modules/library/library.ts` | `/me/library`, `/me/favorites`; vistos, watchlist y favoritos ordenados | `social.test.ts`, `backend.test.ts` |
| Listas | `modules/lists/lists.ts` | `/lists`, elementos, orden, permisos y likes | `lists-search.test.ts` |
| Búsqueda | `modules/search/search.ts` | `/search`; búsqueda por categoría y filtros | `lists-search.test.ts` |
| Para ti | `modules/discovery/discovery.ts` | `/feed?type=for-you`; afinidad, selección y páginas persistentes | `discovery.test.ts` |
| Descubrir | `modules/discovery/anime-discovery.ts` | `/discover`; selección de animes no vistos y reviews | `current-rating-discover.test.ts` |
| Aura y misiones | `modules/aura/aura.ts` | `/me/aura`, `/me/missions`, `/me/missions/:id/claim`, `/ranking`; definiciones, progreso y reclamos únicos | `aura.test.ts` |
| Reglas de Aura | `modules/aura/aura.rules.ts`, `aura.service.ts` | Etapas, puntos, umbrales y cálculo completo del progreso | `aura.test.ts` |
| Tops y mapa | `modules/explore/explore.ts`, `explore.service.ts`, `countries.ts` | `/explore`, `/explore/tops`, `/explore/map`, países, reviews regionales e intensidades | `explore.test.ts` |
| Tendencia y consultas de perfil | `modules/community/publication-queries.ts` | `/feed?type=trending`, `/users/:id/publications` | `integration-contracts.test.ts` |
| Biblioteca de usuarios | `modules/library/library-queries.ts` | `/users/:id/library`, colecciones y búsqueda normalizada | `integration-contracts.test.ts` |
| Base de datos | `../prisma/schema.prisma`, `../prisma/migrations/` | Modelos, relaciones e historia de cambios | `migration.test.ts` y fixtures de integración |

## Código compartido

| Archivo | Uso |
| --- | --- |
| `shared/errors.ts` | `ApiError` y conversión de errores a respuestas HTTP |
| `shared/validation.ts` | IDs, credenciales, puntuaciones, fechas, actividad y etiquetas |
| `shared/pagination.ts` | Límites, cursores y formato de páginas |
| `shared/serializers.ts` | DTOs e includes de publicaciones, comentarios y valoraciones |
| `shared/operations.ts` | Huellas y respuestas persistidas para reintentos con `Idempotency-Key` |
| `shared/selection.ts` | Copias paginadas por cuenta/filtros para Tendencia, tops y consultas nuevas de perfil/biblioteca |
| `config/config.ts` | Lectura y validación del entorno |

## Convenciones para seguir programando

1. Buscar primero el módulo responsable en la tabla. Mantener juntos los archivos de una funcionalidad.
2. Si el módulo crece, separar `*.routes.ts` (HTTP), `*.service.ts` (reglas/cálculos), `*.schemas.ts` (validación propia) y `*.dto.ts` (respuesta) cuando haya una responsabilidad concreta que extraer. No crear capas vacías.
3. Reservar `shared/` para piezas utilizadas por varias funcionalidades. Los imports entre módulos deben ser explícitos; no crear una segunda implementación de la misma regla.
4. Montar nuevas rutas en `app.ts` y documentar sus contratos en `API.md`. Conservar el orden de middlewares: salud y autenticación pública, sesión y límite, routers protegidos, 404, errores.
5. **Preservar el orden de discovery y publication-queries antes de social:** comparten `/feed`; discovery atiende `type=for-you`, publication-queries atiende `trending` y delegan los demás casos con `next()`.
6. Mantener cambios de base en migraciones. Esta reorganización no requiere migrar ni reiniciar datos.
7. Ejecutar `npm.cmd run typecheck`, `npm.cmd test` y `npm.cmd run build` tras modificar el backend. Los tests usan bases temporales en `.test-data/`; no requieren modificar la base de desarrollo.

## Límites actuales de la separación

Varios routers todavía contienen reglas y consultas Prisma. `reads.ts` reúne consultas de catálogo y publicaciones. Aura y Explorar separan rutas, reglas y cálculos en sus propios archivos. `genresOf` sigue en búsqueda y se reutiliza desde descubrimiento, aura y explorar; los DTOs compartidos usan la selección de perfil de autenticación.

Los restantes puntos de extracción se documentan para mantener legibles los módulos al crecer. Las diferencias deliberadas con el frontend están registradas en la auditoría.

## Etapas de la nueva integración

1. **Organización:** rama backend `implementacion-front`. Agrupar archivos, actualizar imports y dejar este mapa. Conservar comportamiento y contratos.
2. **Auditoría e implementación:** inventariar las funcionalidades del frontend, comparar misiones, puntajes, aura, Explorar, Para ti y sugeridos; implementar las reglas faltantes en backend y redactar una guía de consumo comprobada.
3. **Integración:** rama app `nueva-integracion-back`. Consumir los contratos verificados conservando completamente la interfaz visual.

`HANDOFF_FRONTEND.md`, `PLAN_IMPLEMENTACION.md` y `ESQUEMA_DATOS_Y_API.md` conservan información de la integración anterior. Son antecedentes para contrastar en el paso 2, no una certificación de que el frontend actual ya esté integrado.

## Verificación de la reorganización (25/10/2026)

- 53/53 pruebas aprobadas antes y después de mover los archivos.
- `npm.cmd run typecheck` y `npm.cmd run build` aprobados.
- Comparación de los 35 archivos TypeScript de código, pruebas y scripts contra Git: únicamente cambiaron imports relativos; 21 archivos se trasladaron.
- Frontend sin cambios; esquema y migraciones sin cambios.
- Las pruebas HTTP necesitaron acceso al servidor local fuera del sandbox. Se ejecutaron con Node 24.19.0 disponible en el entorno; `package.json` declara Node 22.x. La validación específica en Node 22 sigue pendiente.

Esto verifica la reorganización y los casos existentes. No reemplaza la auditoría funcional del paso 2 ni una prueba de integración en teléfono.
