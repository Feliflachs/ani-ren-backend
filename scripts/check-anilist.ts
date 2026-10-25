import { AniListExtras, ANILIST_URL } from '../src/modules/catalog/anime-extras';
import { ApiError } from '../src/shared/errors';
import { networkCodes } from '../src/modules/catalog/catalog-errors';

async function main() {
  console.log(`Consultando ${ANILIST_URL}: Naruto (mal:20). No requiere backend ni escribe en SQLite.`);
  const extras = await new AniListExtras().get('mal:20', 1);
  console.log(JSON.stringify(extras, null, 2));
  console.log('OK: AniList respondió con personajes y enlaces. Disponibilidad por país SIN confirmar.');
}
main().catch((error: unknown) => {
  console.error(error instanceof ApiError ? `[${error.code}] ${error.message}` : 'Falló el chequeo de AniList.');
  const codes = networkCodes(error);
  if (codes.length) console.error(`Diagnóstico: ${codes.join(', ')}`);
  process.exitCode = 1;
});
