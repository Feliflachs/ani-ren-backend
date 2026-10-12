import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JikanCatalog, catalogBaseUrl } from '../src/catalog';
import { ApiError } from '../src/errors';
import { networkCodes } from '../src/catalog-errors';

test('proveedor configurable conserva contrato e identidad MAL', async () => {
  const catalog = new JikanCatalog(async (url) => {
    assert.equal(String(url), 'https://catalog.example/v1/anime/20');
    return Response.json({ data: { mal_id: 20, title: 'Naruto' } });
  }, 'https://catalog.example/v1/');
  assert.equal((await catalog.get('mal:20')).id, 'mal:20');
  for (const url of ['http://catalog.example', 'https://user:secret@catalog.example', 'https://catalog.example?token=x', 'https://catalog.example/#x']) {
    assert.throws(() => catalogBaseUrl(url));
  }
});

test('Jikan normaliza datos opcionales sin agrupar temporadas ni inventar puntuación propia', async () => {
  const catalog = new JikanCatalog(async (url) => {
    assert.match(String(url), /^https:\/\/api.tenrai.org\/v1\/anime\?/);
    return Response.json({ data: [
      { mal_id: 1, title: 'Temporada uno', genres: [] },
      { mal_id: 2, title: 'Temporada dos', title_japanese: null, images: { jpg: { image_url: null } }, score: 9.5 },
    ], pagination: { has_next_page: true } });
  });
  const result = await catalog.search('Temporada', 1);
  assert.deepEqual(result.items.map((item) => item.id), ['mal:1', 'mal:2']);
  assert.equal(result.nextPage, 2);
  assert.equal(result.items[1].imageUrl, null);
  assert.equal('rating' in result.items[1], false);
});

test('Jikan distingue no encontrado, límite, error y respuesta inválida', async () => {
  for (const [status, expected] of [[404, 404], [429, 503], [500, 502]]) {
    const catalog = new JikanCatalog(async () => new Response('', { status }));
    await assert.rejects(catalog.get('mal:1'), (error: unknown) => error instanceof ApiError && error.status === expected);
  }
  const invalid = new JikanCatalog(async () => Response.json({ data: { mal_id: 2, title: 'Otro ID' } }));
  await assert.rejects(invalid.get('mal:1'), (error: unknown) => error instanceof ApiError && error.code === 'CATALOG_INVALID_RESPONSE');
  const unavailable = new JikanCatalog(async () => { throw new Error('Sin conexión'); });
  await assert.rejects(unavailable.get('mal:1'), (error: unknown) => error instanceof ApiError && error.status === 503);
});

test('consulta repetida utiliza caché acotada y no vuelve a llamar al proveedor', async () => {
  let requests = 0;
  const catalog = new JikanCatalog(async () => {
    requests++;
    return Response.json({ data: { mal_id: 1, title: 'Anime', genres: [] } });
  });
  await catalog.get('mal:1');
  await catalog.get('mal:1');
  assert.equal(requests, 1);
});

test('consultas simultáneas idénticas comparten petición sin saturar la cola', async () => {
  let requests = 0;
  const catalog = new JikanCatalog(async () => {
    requests++;
    return Response.json({ data: { mal_id: 1, title: 'Anime' } });
  });
  const results = await Promise.all(Array.from({ length: 30 }, () => catalog.get('mal:1')));
  assert.equal(results.length, 30);
  assert.ok(results.every((item) => item.id === 'mal:1'));
  assert.equal(requests, 1);
});

test('respuestas inválidas y fallos compartidos permiten reintentar sin caché contaminada', async () => {
  for (const failure of ['schema', 'id', 'network']) {
    let requests = 0;
    const catalog = new JikanCatalog(async () => {
      requests++;
      if (requests === 1) {
        if (failure === 'network') throw new Error('Desconectado');
        return Response.json({ data: failure === 'schema' ? {} : { mal_id: 2, title: 'Otro anime' } });
      }
      return Response.json({ data: { mal_id: 1, title: 'Anime' } });
    });
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => catalog.get('mal:1')));
    assert.ok(results.every((result) => result.status === 'rejected'));
    assert.equal(requests, 1);
    assert.equal((await catalog.get('mal:1')).id, 'mal:1');
    assert.equal(requests, 2);
  }
});

test('portadas usan alternativas HTTPS cuando falta o es inválida la imagen principal', async () => {
  const catalog = new JikanCatalog(async () => Response.json({
    data: [
      { mal_id: 1, title: 'JPG', images: { jpg: { image_url: 'https://images.example/normal.jpg', large_image_url: 'https://images.example/large.jpg' } } },
      { mal_id: 2, title: 'WebP', images: { jpg: { image_url: 'http://images.example/insecure.jpg' }, webp: { image_url: 'https://images.example/normal.webp' } } },
      { mal_id: 3, title: 'Grande', images: { jpg: { image_url: null, large_image_url: 'https://images.example/large.jpg' } } },
      { mal_id: 4, title: 'Sin imagen', images: { jpg: { image_url: 'https://' } } },
    ], pagination: { has_next_page: false },
  }));
  assert.deepEqual((await catalog.search('Anime', 1)).items.map((item) => item.imageUrl), [
    'https://images.example/normal.jpg', 'https://images.example/normal.webp', 'https://images.example/large.jpg', null,
  ]);
});

test('diagnóstico distingue timeout, DNS, TLS y errores de conexión anidados', async () => {
  const cases: [unknown, string][] = [
    [new DOMException('timeout', 'TimeoutError'), 'CATALOG_TIMEOUT'],
    [new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }), 'CATALOG_DNS_ERROR'],
    [new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } }), 'CATALOG_DNS_ERROR'],
    [new TypeError('fetch failed', { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } }), 'CATALOG_TLS_ERROR'],
    [new TypeError('fetch failed', { cause: new AggregateError([{ code: 'ETIMEDOUT' }]) }), 'CATALOG_TIMEOUT'],
    [new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }), 'CATALOG_UNAVAILABLE'],
  ];
  for (const [cause, expected] of cases) {
    const catalog = new JikanCatalog(async () => { throw cause; });
    await assert.rejects(catalog.get('mal:1'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, expected);
      assert.equal(error.cause, cause);
      return true;
    });
  }
});

test('fallo de transporte al leer el cuerpo no se presenta como JSON inválido', async () => {
  const catalog = new JikanCatalog(async () => new Response(new ReadableStream({
    start(controller) { controller.error(new DOMException('timeout', 'TimeoutError')); },
  })));
  await assert.rejects(catalog.get('mal:1'), (error: unknown) => error instanceof ApiError && error.code === 'CATALOG_TIMEOUT');
  const invalidJson = new JikanCatalog(async () => new Response('<html>no es JSON</html>'));
  await assert.rejects(invalidJson.get('mal:1'), (error: unknown) => error instanceof ApiError && error.code === 'CATALOG_INVALID_RESPONSE');
});

test('diagnóstico no expone mensajes, direcciones ni valores de configuración', () => {
  const cause: { code: string; message: string; cause?: unknown } = { code: 'ECONNRESET', message: 'https://usuario:clave@proxy.example' };
  cause.cause = cause;
  assert.deepEqual(networkCodes(new Error('Detalle privado', { cause })), ['ECONNRESET']);
  assert.deepEqual(networkCodes({ code: 'https://usuario:clave@proxy.example' }), []);
});
