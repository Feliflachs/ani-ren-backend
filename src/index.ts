import { awardCompletedMissions } from './modules/aura/aura.service';
import { PrismaClient } from '@prisma/client';
import { config } from './config/config';
import { createApp } from './app';
import { JikanCatalog } from './modules/catalog/catalog';

const db = new PrismaClient({ datasourceUrl: config.databaseUrl });
async function start() {
  await db.$connect();
  // Confirmar que las migraciones se aplicaron; arrancar no modifica el esquema.
  const users = await db.user.findMany({ select: { id: true, avatarUrl: true } });
  // Reconcile completed missions from accounts created before automatic rewards.
  for (const user of users) await db.$transaction(tx => awardCompletedMissions(tx, user.id));
  const app = createApp({ ...config, db, catalog: new JikanCatalog(fetch, config.catalogBaseUrl) });
  const server = app.listen(config.port, config.host, () => {
    console.log(`Ani-Ren API: http://localhost:${config.port}/api/health`);
  });
  server.on('error', async (error) => {
    console.error('No se pudo abrir el servidor:', error.message);
    await db.$disconnect();
    process.exitCode = 1;
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(async () => { await db.$disconnect(); });
    server.closeIdleConnections();
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
start().catch(async (error: unknown) => {
  console.error('No se pudo iniciar. Revisá .env y ejecutá npm run db:deploy.', error instanceof Error ? error.name : 'Error');
  await db.$disconnect();
  process.exitCode = 1;
});
