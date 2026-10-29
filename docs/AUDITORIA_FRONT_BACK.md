# Auditoría frontend → backend · 25/10/2026

Repositorios revisados: app en `nueva-integracion-back`, backend en `implementacion-front`. El frontend permanece sin modificaciones. Esta auditoría describe el código encontrado y los cambios del paso 2; la guía operativa es [GUIA_INTEGRACION_FRONTEND.md](GUIA_INTEGRACION_FRONTEND.md).

## Decisiones confirmadas en esta etapa

- Conservar completamente el diseño visual. El paso 3 reemplaza fuentes de datos y operaciones; no rediseña pantallas.
- Para ti excluye publicaciones propias y de cuentas seguidas, como `src/feed.ts` del frontend.
- Misiones generales y por género con etapas 1/5/10/25/50/100. Cada etapa entrega 10/25/50/125/250/500 puntos, respectivamente, una vez por cuenta.
- El puntaje reclamado acumulado determina el rango: Novato 0, Aprendiz 100, Experto 500, Maestro 1500, Leyenda 5000. Completar una misión habilita el botón de reclamo; reclamar suma sus puntos.
- Cada nueva valoración puede llevar el país obtenido por el dispositivo. Esa valoración cuenta como una vista en dicho país, con su puntuación. El mapa permite comparar un anime entre países y consultar top 5 puntuados y top 5 recientes por país.
- El diseño fino del mapa se revisará antes de conectarlo. Los desbloqueos/equipamiento de decoradores requieren reglas del usuario y permanecen pendientes.

## Inventario y resultado

Las rutas de archivos de la primera columna pertenecen a la app; las de backend se encuentran bajo `src/modules/`.

| Fuente del frontend | Regla / dato encontrado | Resultado del backend |
| --- | --- | --- |
| `context/SessionContext.tsx`, `login.ts`, `usuarios-demo.json` | Login, registro, restauración y logout con cuentas de ejemplo | Ya había sesiones revocables, credenciales validadas y hash de contraseña; se conserva. El front debe dejar de identificar una sesión solo por ID. |
| `context/PublicationsContext.tsx`, `publications.ts` | Persistencia local, reviews/logs/posteos, edición, tags, likes y comentarios | Ya había operaciones transaccionales con idempotencia y permisos. La integración debe diferenciar IDs de publicaciones/valoraciones y crear/editar explícitamente. |
| `context/AppState.tsx` | Vistos únicos, watchlist, favoritos y actividad combinada | Se conserva biblioteca por cuenta/anime; ahora se permite desmarcar visto sin borrar historial/puntos. Favoritos limitados a cuatro como el editor de perfil. La consulta de actividad agrega `listIds`. |
| `context/ListsContext.tsx` | Contenido ordenado, likes y edición por autor | Ya implementado. Orden y likes se guardan sin generar votos ni vistos. |
| `context/SocialContext.tsx`, `perfil/comunidad.tsx` | Seguimientos y amistad recíproca | Ya implementado. Las relaciones se consultan por usuario y con total del servidor. |
| `context/ProfilesContext.tsx`, `perfil/editar.tsx` | Nombre, bio, avatar y cuatro favoritos | Nombre/bio ya existían. Se agregó referencia `avatarUrl` HTTPS; cámara/galería y subida binaria a un proveedor siguen pendientes. No se acepta una URI local como imagen remota. |
| `PerfilView.tsx`, `perfil/reviews.tsx` | Reseñas destacadas por likes+comentarios, últimas publicaciones y pestaña Likes | Nuevas consultas por usuario, colección y orden. Se calculan sobre todo el conjunto antes de paginar, no sobre lo cargado en el teléfono. |
| `perfil/biblioteca.tsx` | Biblioteca propia/ajena, favoritos, búsqueda por título | Nueva consulta de biblioteca por usuario con filtro de texto normalizado y total real. Likes de publicaciones tienen su propia consulta. |
| `feed.ts`, `(tabs)/inicio.tsx` | Para ti, Siguiendo, Tendencia | Para ti se alineó con el frontend; Tendencia se agregó con likes+comentarios y desempate por fecha. Siguiendo se conserva. |
| `missions.ts`, `useMissions.ts` | Cinco misiones de demo sin puntos | Sustituidas por familias y etapas confirmadas. Catálogo inicial de siete géneros de la pantalla más géneros presentes en metadatos; progreso por ID de género y anime único. |
| `mock.ts:getRankProgress`, `aura/*`, `(tabs)/aura.tsx` | Rangos por cada 100 vistos, ranking por vistos, progreso y estadísticas | Cambiado a puntos reclamados. Perfil, Aura y ranking usan la misma regla. No recalcular el rango en la app. |
| `aura/rangos.tsx` | Decoradores con bloqueos fijos y títulos “IA” simulados | Pendiente de definición. No se implementó generación IA ni se presentó un decorador de demo como desbloqueo real. |
| `explorar/busqueda.tsx`, buscadores de Crear/listas/mapa | Texto, categoría, varios géneros OR y temporada | Búsqueda social ya existía. Se agregaron exploración de anime sin texto y filtros server-side por géneros OR, temporada y año, preservando la paginación del proveedor. |
| `explorar/anime/[id].tsx` | Ficha, elenco, enlaces, distribución de estrellas simulada | Ficha y extras ya existían; se agregó distribución real en diez medias estrellas, vistos únicos, duración y estudios cuando el proveedor los informa. |
| `(tabs)/explorar.tsx`, `explorar/tops.tsx` | Tendencias fijas, géneros, temporadas y tops recortados con `slice` | Nuevas consultas con actividad real, filtros y períodos temporales, sin puntajes inventados cuando no hay datos. |
| `mock.ts:getCountryMetric/getCountryTop`, `WorldMap.tsx`, `explorar/mapa/*` | Vistos/reviews locales simulados e intensidades | Nuevas agregaciones por país/anime y tops; `intensity`/`colorLevel` calculados en servidor. Geometría y paleta permanecen en el frontend. |
| `crear/review/escribir.tsx:obtenerPais` | País mostrado temporalmente solo al escribir review | El backend ahora recibe `countryCode` opcional tanto en valoración sin texto como en review. El paso 3 debe usar el código ISO, retornarlo desde la función y enviarlo con el guardado. |
| Backend `discovery/anime-discovery.ts` | Sugeridos de animes no vistos con hasta dos reviews | Ya existe `/discover`: queda disponible para reutilizar, sin agregar pantallas nuevas ni confundirlo con Para ti. |

## Diferencias deliberadas que la integración debe respetar

- **Vistos de misiones/perfil:** cantidad de IDs de anime distintos con `watched=true`.
- **Vistas del mapa/tops:** cantidad de nuevas valoraciones registradas. Rewatch/nueva valoración suma una vista; reintento con la misma clave y edición no suman otra.
- **Promedio global/ficha:** un voto vigente por persona y anime, conservando historial. **Promedio por país:** promedio de las valoraciones registradas en ese país; incluye valoraciones repetidas como eventos de vistas.
- “Esta semana” y “Este mes” son ventanas móviles de 7 y 30 días desde el registro en servidor. No representan semanas de calendario ni el `watchedOn` escrito por el usuario.
- Tendencia de publicaciones usa likes+comentarios. Tendencia de animes usa vistas recientes, luego promedio para desempatar. No son la misma métrica.
- Datos anteriores sin país quedan sin país; se informan aparte y no se asignan a Argentina por defecto.
- Las recompensas de las cinco misiones históricas se conservan con cero puntos; las nuevas etapas tienen IDs propios. No se vuelven a otorgar puntos por reintentar un reclamo.

## Pendientes y límites reales

1. Decoradores: definir catálogo, reglas de desbloqueo y selección persistida. No hay endpoint de equipamiento implementado.
2. Avatar: la API guarda/borra una URL HTTPS; falta elegir almacenamiento/subida de imagen y conectar permisos de cámara/galería. Los botones actuales son simulaciones del frontend.
3. Mapa: hay datos e intensidades para integrar; la prueba de permisos y el comportamiento geográfico deben verificarse en teléfono en el paso 3. Se conserva la geometría actual de seis países; la API puede devolver otros códigos ISO y su representación visual se acordará entonces.
4. Búsqueda remota filtrada: filtra en backend cada página del proveedor, conservando `nextPage` incluso si no hubo coincidencias. No devuelve un total global ficticio; con filtros poco frecuentes puede requerir recorrer varias páginas. No está indexado todo el catálogo externo.
5. Las selecciones y agregaciones evalúan el conjunto local en memoria; son adecuadas para la escala actual y requieren índices/agregaciones dedicadas antes de crecer. Los proveedores reales y la app en teléfono no quedan certificados por los tests con proveedores simulados.

Los contratos nuevos y los pendientes están separados en la guía. Esta entrega no habilita afirmar que todos los TODO del frontend ya están resueltos, ni que la app ya está integrada.

## Verificación realizada

- 59/59 pruebas aprobadas con HTTP local y SQLite temporal, incluidos migración de datos anteriores, reclamos simultáneos, puntos/rangos, ubicación opcional, reintentos, edición de puntuaciones, filtros y aislamiento de cursores.
- `npm.cmd run typecheck` y `npm.cmd run build` aprobados. El cliente de ejemplo también se comprueba con TypeScript.
- Frontend sin cambios y en `nueva-integracion-back`; backend en `implementacion-front`.
- Entorno disponible: Node 24.19.0. El proyecto declara Node 22.x; falta repetir la validación específica en esa versión. La ejecución de pruebas requirió acceso al servidor HTTP local fuera del sandbox.
- No se aplicaron las migraciones a `prisma/dev.db`, no se consultaron proveedores con datos de usuarios y no se hicieron commits/push/despliegues.
