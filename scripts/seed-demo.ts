import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { config } from '../src/config/config';
import { JikanCatalog } from '../src/modules/catalog/catalog';
import { seedDemo } from './demo/seed';

async function main() {
  const db = new PrismaClient({ datasourceUrl: config.databaseUrl });
  try {
    const report = await seedDemo(db, new JikanCatalog(fetch, config.catalogBaseUrl), console.log);
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/demo-report.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ counts: report.counts, addedSteps: report.addedSteps, skippedSteps: report.skippedSteps,
      hubPublicationId: report.hubPublicationId, report: 'artifacts/demo-report.json' }, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falló la carga demo.'); process.exitCode = 1; });
