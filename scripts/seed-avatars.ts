import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
const db = new PrismaClient();
async function main() {
  const root = path.resolve(__dirname, '..');
  const rows: { id: string; collection: string; name: string; imageUrl: string; sourceUrl: string; sortOrder: number }[] = JSON.parse(await readFile(path.join(root, 'scripts/avatar-catalog.json'), 'utf8'));
  for (const row of rows) await access(path.join(root, 'public/avatars', path.basename(row.imageUrl)));
  await db.$transaction(rows.flatMap(({ id, collection, name, imageUrl, sourceUrl, sortOrder }) => {
    const data = { collection, name, imageUrl, sourceUrl, sortOrder, active: true };
    return [db.avatar.upsert({ where: { id }, create: { id, ...data }, update: data }),
      db.user.updateMany({ where: { avatarId: id }, data: { avatarUrl: imageUrl } })];
  }));
  console.log(`Avatar catalog: ${rows.length} records loaded.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
