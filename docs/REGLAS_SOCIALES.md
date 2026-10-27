# Reglas sociales — 26/10/2026

## Feeds

La app ofrece Para ti, Siguiendo y Descubrir. La selección se calcula en el servidor; los likes no reinician las páginas cargadas. Actualizar o tirar hacia abajo genera una selección nueva. Las selecciones paginadas de Para ti y Descubrir duran 20 minutos; su orden queda estable mientras se recorren.

- **Para ti** (`GET /feed?type=for-you`): excluye autor propio y cuentas seguidas. Afinidad: +3 por anime en watchlist, +1 por género coincidente con favoritos/watchlist y +1 por hashtag coincidente con esos géneros o hashtags de publicaciones con like. Alterna autores cuando es posible. La recencia desempata por ID; no se agregaron likes globales al puntaje. Sin gustos, ofrece publicaciones recientes de otras cuentas. Marcar visto no excluye conversaciones de este feed.
- **Siguiendo** (`GET /feed?type=following`): publicaciones de cuentas seguidas, ID descendente, cursor. Es orden de inserción; la base de prueba debe insertar en orden cronológico si modifica fechas. Seguir/dejar de seguir actualiza elegibilidad de los feeds.
- **Descubrir** (`GET /discover`): tarjetas por anime guardado en el catálogo local, excluyendo los vistos del lector. No utiliza sus géneros favoritos, follows ni afinidad. Solo la elegibilidad es personal. Se incluyen hasta dos reviews de distintos autores.

## Relevancia en Descubrir

Implementación en `src/modules/discovery/ranking.ts` y `anime-discovery.ts`.

- Ventana: últimos 14 días; peso temporal `2^(-edadEnDias/3)`. Fuera de ventana, peso cero.
- Cada usuario aporta su voto vigente por anime. Se usa fecha de creación del voto: editar texto no renueva su edad. Cambiar estrellas de una entrada antigua actualiza la opinión vigente, pero no rejuvenece su fecha de creación.
- Actividad por persona/anime: máximo entre el peso de su voto y 0,25 del peso de su interacción más reciente en una review. Likes y comentarios repetidos no se suman entre sí para una persona. Se excluyen las interacciones del autor en su propia review.
- Calidad: promedio temporal suavizado con tres votos neutrales de 3 estrellas, dividido por 5. Evita que una única puntuación perfecta reciba automáticamente el mismo respaldo que varias opiniones.
- Puntaje = `log(1 + actividad) * calidad`. Varias valoraciones recientes y favorables pueden superar mucha actividad histórica. No es una comparación explícita entre dos semanas ni usa totales históricos de likes.
- Empates: orden determinista por día e ID, sin aleatoriedad entre páginas. Los animes sin señales quedan disponibles detrás de aquellos con actividad. No se promete que una tarjeta desaparezca después de leerla.
- Reviews destacadas: frescura de creación + `log(1 + suma de frescura por participante único)`, ignorando interacciones propias. Tienen la misma ventana y decaimiento. Una review antigua puede volver a aparecer si recibe conversación reciente real; sus likes viejos no la sostienen indefinidamente.
- Esta implementación consulta catálogo/comunidad local y calcula en memoria; para volúmenes grandes faltaría precalcular agregados. La entrega se valida con una comunidad pequeña, no con pruebas de carga masiva.

El endpoint anterior `/feed?type=trending` se conserva por compatibilidad, pero Inicio ya no lo consume; no confundir su popularidad acumulada con Descubrir.

## Comentarios y respuestas

- `GET /publications/:id/comments`: comentarios principales, paginados, con `replyCount`.
- `GET /publications/:id/comments?parentId=ID`: respuestas de ese comentario principal, paginadas independientemente.
- `POST /publications/:id/comments`: `{ text, parentId?: string }`, con Idempotency-Key. El padre debe ser un comentario principal de la misma publicación. Un solo nivel de respuestas; no árboles infinitos.
- `commentCount` de la publicación incluye principales y respuestas. `total` de cada consulta corresponde únicamente a la colección consultada.
- El frontend conserva abiertos los hilos durante la actualización tras responder; ofrece Ver respuestas/Ocultar respuestas y Cargar más para ambas colecciones.
- Migración aditiva `202610260001_comment_replies`: los comentarios anteriores conservan parentId null. Aplicada a la BD local durante este bloque.

## Eliminación

- `DELETE /publications/:id`: solo autor autenticado. Elimina post/review, menciones, likes, comentarios y respuestas por cascada.
- Borrar una review elimina la publicación, no su RatingEntry. Se mantienen estrellas, visto, historial de valoraciones y Aura; el diálogo explica esa diferencia. No hay endpoint de eliminación de valoraciones en este bloque.
- Se invalidan los snapshots de DTOs para evitar que páginas anteriores revivan contenido borrado.
- Aún no hay imágenes en posteos. Su futura implementación debe agregar limpieza de archivos al borrar/reemplazar.

## Validación

74 pruebas backend completas pasaron, incluyendo permisos de borrado, cascadas, separación/paginación de respuestas, idempotencia y ranking temporal. La app pasó 31 pruebas, tipos y lint; prueba real en Chromium de Descubrir, posteo, hilo desplegable, eliminación y navegación después de valorar. Export web e iOS/Hermes correctos; Hermes necesitó ejecutarse fuera del sandbox después de terminar con código 6 dentro de él. Esto no sustituye probar en teléfono real.

Pendientes independientes: datos pequeños accesibles para el usuario, métricas únicas de mapa/tops regionales, imágenes, compartir público y prueba en teléfono real.
