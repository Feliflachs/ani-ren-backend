const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Prisma 6 + SQLite puede fallar al crear la base con RUST_LOG=warn.
// Reproducido aquí; incidencia: https://github.com/prisma/prisma/issues/29355
const result = spawnSync(process.execPath, [
  path.resolve(__dirname, '../node_modules/prisma/build/index.js'), ...process.argv.slice(2),
], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, RUST_LOG: 'info' },
});
if (result.error) console.error('No se pudo ejecutar Prisma:', result.error.message);
process.exitCode = result.status ?? 1;
