import { PrismaClient } from '@prisma/client';
import { config } from '../src/config/config';
import { JikanCatalog } from '../src/modules/catalog/catalog';
import { seedWorld } from './demo/world';
const db=new PrismaClient({datasourceUrl:config.databaseUrl});
seedWorld(db,new JikanCatalog(fetch,config.catalogBaseUrl)).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
