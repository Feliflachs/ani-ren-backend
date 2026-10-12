import { ApiError } from './errors';

// fetch suele envolver el error de red en cause, y a veces en AggregateError.
// Extraer solo códigos: no imprimir URLs de proxy, cabeceras ni mensajes arbitrarios.
export function networkCodes(error: unknown): string[] {
  const codes = new Set<string>();
  const visited = new Set<object>();
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > 5 || visited.has(value)) return;
    visited.add(value);
    const item = value as { name?: unknown; code?: unknown; cause?: unknown; errors?: unknown };
    if (item.name === 'TimeoutError') codes.add('TIMEOUT');
    if (typeof item.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(item.code)) codes.add(item.code);
    visit(item.cause, depth + 1);
    if (Array.isArray(item.errors)) item.errors.slice(0, 10).forEach((child) => visit(child, depth + 1));
  }
  visit(error, 0);
  return [...codes];
}

export function catalogNetworkError(cause: unknown) {
  const codes = networkCodes(cause);
  let code = 'CATALOG_UNAVAILABLE';
  let message = 'No pudimos conectar con el catálogo. Reintentá en un momento.';
  if (codes.some((value) => ['ENOTFOUND', 'EAI_AGAIN'].includes(value))) {
    code = 'CATALOG_DNS_ERROR';
    message = 'No se pudo resolver la dirección del catálogo. Revisá la conexión y el DNS de la red.';
  } else if (codes.some((value) => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(value))) {
    code = 'CATALOG_TLS_ERROR';
    message = 'No se pudo verificar la conexión HTTPS con el catálogo.';
  } else if (codes.some((value) => ['TIMEOUT', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(value))) {
    code = 'CATALOG_TIMEOUT';
    message = 'Se agotó el tiempo de espera al consultar el catálogo. Puede ser un problema de red o del proveedor.';
  }
  return new ApiError(503, code, message, { cause });
}
