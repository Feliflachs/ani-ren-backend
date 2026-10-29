// Re-download the reviewed selection, never choose the first search result.
const fs = require('node:fs/promises');
const path = require('node:path');
async function main() {
  const root = path.resolve(__dirname, '..');
  const rows = JSON.parse(await fs.readFile(path.join(root, 'scripts/avatar-catalog.json'), 'utf8'));
  await fs.mkdir(path.join(root, 'public/avatars'), { recursive: true });
  for (const row of rows) {
    const response = await fetch(row.originalUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw Error(`Download failed: ${row.name}`);
    await fs.writeFile(path.join(root, 'public/avatars', path.basename(row.imageUrl)), Buffer.from(await response.arrayBuffer()));
    console.log(`${row.collection} / ${row.name}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
