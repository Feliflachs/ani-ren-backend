import { JikanCatalog } from '../src/modules/catalog/catalog';
import { networkCodes } from '../src/modules/catalog/catalog-errors';
import { ApiError } from '../src/shared/errors';
import { config } from '../src/config/config';

const startedAt = Date.now();

// Comprobación manual opcional: usa Internet, no crea usuarios ni escribe en SQLite.
async function main() {
  console.log(`Comprobando catálogo con Node ${process.version} (no requiere iniciar el backend).`);
  console.log(`Proveedor: ${config.catalogBaseUrl} · tiempo máximo de petición: 8 segundos.`);
  const catalog = new JikanCatalog(fetch, config.catalogBaseUrl);
  console.log('1/2 Buscando Frieren…');
  const result = await catalog.search('Frieren', 1);
  console.log('Resultados independientes:', result.items.map(({ id, title }) => ({ id, title })));
  const first = result.items[0];
  if (!first) throw new Error('La búsqueda no devolvió resultados.');
  console.log(`2/2 Consultando detalle de ${first.id}…`);
  const detail = await catalog.get(first.id);
  console.log('Detalle normalizado:', { id: detail.id, title: detail.title, genres: detail.genres, imageAvailable: Boolean(detail.imageUrl) });
  const page = await catalog.search('Naruto', 1);
  if (page.nextPage) {
    const next = await catalog.search('Naruto', page.nextPage);
    if (!next.items.length) throw new Error('El proveedor anunció una página siguiente vacía.');
    console.log('Paginación verificada:', { nextPage: page.nextPage, items: next.items.length });
  }
  console.log('OK: búsqueda y detalle conectados al catálogo configurado.');
}
main().catch((error: unknown) => {
  console.error(`Falló el chequeo después de ${((Date.now() - startedAt) / 1000).toFixed(1)} segundos.`);
  if (error instanceof ApiError) console.error(`[${error.code}] ${error.message}`);
  else console.error('Falló el chequeo del catálogo.');
  const codes = networkCodes(error);
  if (codes.length) console.error(`Diagnóstico de red: ${codes.join(', ')}`);
  if (error instanceof ApiError && error.code === 'CATALOG_TLS_ERROR') {
    console.error('Revisá la fecha del equipo y los certificados del proxy/antivirus, si usás alguno. No desactives la validación HTTPS.');
  } else if (error instanceof ApiError && error.code === 'CATALOG_RATE_LIMIT') {
    console.error('Esperá al menos un minuto antes de volver a consultar.');
  } else if (error instanceof ApiError && error.status === 503) {
    console.error('Revisá el proveedor configurado y su disponibilidad. La dirección antigua api.jikan.moe está discontinuada.');
  }
  process.exitCode = 1;
});
