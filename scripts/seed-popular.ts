import { PrismaClient } from '@prisma/client';
import { config } from '../src/config/config';
import { JikanCatalog } from '../src/modules/catalog/catalog';
import { seedPopular } from './demo/popular';
const db=new PrismaClient({datasourceUrl:config.databaseUrl});
seedPopular(db,new JikanCatalog(fetch,config.catalogBaseUrl)).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
