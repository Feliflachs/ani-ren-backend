import type { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import type { Catalog } from '../../src/modules/catalog/catalog';
import { hashPassword, hashToken } from '../../src/modules/auth/security';
import { randomBytes } from 'node:crypto';
import { anime, DEMO_PASSWORD } from './data';

export const WORLD_VERSION = 'aniren_world_v1';
const countries = ['AR','BR','CL','UY','PE','CO','MX','EC','BO','PY','US','CA','ES','FR','DE','IT','GB','PT','NL','SE','JP','KR','CN','IN','ID','PH','AU','NZ','ZA','EG'];
const names = ['Alma','Bruno','Clara','Dante','Elena','Fabio','Gala','Hugo','Irene','Julián','Kiara','Leo','Mara','Noah','Olivia','Pablo','Renata','Simón','Tania','Ulises','Vera','Wes','Ximena','Yago','Zoe','Adrián','Bianca','Ciro','Dalia','Emilio','Flor','Gael','Helena','Ian','Jade','Kevin','Lara','Milo','Nadia','Oliver','Petra','Quinn','Rocío','Saúl','Teo','Uma','Violeta','William','Yuna','Zaid','Amelia','Benicio','Celia','Diego','Eva','Felipe','Greta','Héctor','Isabel','Jonás'];
const surnames = ['Vidal','Costa','Reyes','Molina','Silva','Navarro','Duarte','Luna','Paz','Rivera'];
const observations: Record<keyof typeof anime, string[]> = {
  naruto: ['La rivalidad del equipo funciona mejor cuando se nota lo que cada uno teme perder.', 'Los entrenamientos me interesan por los vínculos que construyen, aunque algunos se estiran.', 'Los personajes secundarios se ganaron mi atención antes que las peleas grandes.'],
  onepiece: ['Las despedidas entre islas me quedan más presentes que muchas peleas.', 'La tripulación sostiene la aventura incluso cuando el ritmo se vuelve irregular.', 'Me gusta que cada isla tenga su propia identidad; algunas historias podrían ser más cortas.'],
  bebop: ['La música y los silencios cuentan bastante de lo que los personajes prefieren callar.', 'Los episodios independientes me funcionaron mejor cuando los vi con pausas.', 'El contraste entre humor y melancolía me dejó pensando después de terminar.'],
  eva: ['La distancia entre los personajes pesa más que las explicaciones del mundo.', 'La incomodidad es parte de la experiencia, aunque no todas las decisiones me convencen.', 'Me interesaron las escenas íntimas más que el misterio de fondo.'],
  frieren: ['El viaje hace que un gesto cotidiano tenga peso cuando vuelve a aparecer.', 'Las conversaciones de Fern y Stark le dan una calidez que no esperaba.', 'Las pausas me ayudaron a entender cómo cambia la relación con el tiempo.'],
  spy: ['Los pequeños problemas de convivencia son lo que más disfruto de los Forger.', 'Anya sostiene mucho del humor, pero las escenas entre Loid y Yor también funcionan.', 'La mezcla de espionaje y familia me funciona mejor en episodios cortos que en maratón.'],
  trigun: ['El contraste entre las bromas de Vash y sus convicciones es lo que me hizo seguir.', 'La aventura gana cuando deja ver lo difícil que es sostener una decisión.', 'El humor tarda en encontrar su lugar, pero los dilemas compensan parte del camino.'],
  beck: ['Los ensayos y las frustraciones del grupo se sienten tan importantes como los conciertos.', 'La música me hizo volver, aunque el arranque me costó un poco.', 'Me gustó que aprender a tocar no resuelva de golpe los problemas de los personajes.'],
  honey: ['Las dudas sobre el futuro me resultaron más cercanas que los enredos románticos.', 'Los personajes pueden frustrar sin dejar de ser comprensibles.', 'Las conversaciones pequeñas muestran lo difícil que es decir algo a tiempo.'],
  school: ['Los malentendidos me hacen reír cuando el episodio no insiste demasiado.', 'El elenco sostiene los chistes incluso cuando la situación se repite.', 'Prefiero sus momentos de comedia cotidiana a los enredos que se alargan.'],
  titan: ['La sensación de peligro está muy bien construida, sobre todo al principio.', 'Me atrapó cómo las decisiones del grupo cambian cuando falta información.', 'La tensión funciona, aunque algunas explicaciones frenan escenas que ya se entendían.'],
};
const openings = ['La terminé este fin de semana.', 'La vi sin apurarme.', 'Volví a darle una oportunidad.', 'Llegué por una recomendación.', 'La fui viendo después de estudiar.', 'Me acompañó durante varias noches.', 'Tenía expectativas distintas.', 'Necesité unos días para ordenar lo que pensé.'];
const endings = ['La recomendaría con esas reservas.', 'Me quedo con sus personajes.', 'No todo me funcionó igual, pero valió el tiempo.', 'Me gustaría conversar sobre esas decisiones.', 'Por ahora esa es mi impresión.', 'La próxima vez la vería con más pausas.', 'Entiendo por qué genera opiniones distintas.', 'Todavía tengo escenas dando vueltas.'];
const prompts = ['¿Qué personaje secundario merecía más tiempo?', '¿La prefieren de a un episodio o en maratón?', 'Me dieron ganas de volver a escuchar su música.', 'Busco otra historia con un grupo de personajes así.', '¿Qué les cambió al volver a verla?', 'Hoy terminé otro capítulo y necesitaba comentarlo.', '¿Qué detalle les pasó desapercibido al principio?', 'Estoy convenciendo a un amigo para verla juntos.', 'Me interesa leer opiniones distintas a la mía.', '¿La recomendarían como primer anime?', 'El ritmo me está haciendo verla con más pausas.', 'Me guardé unas escenas para dibujar después.'];

export async function seedWorld(db: PrismaClient, catalog: Catalog, progress = console.log, count = 60) {
  if (count < 1 || count > names.length) throw Error('Invalid demo size');
  const avatars = await db.avatar.findMany({ where: { active: true }, orderBy: [{sortOrder:'asc'}, {id:'asc'}] });
  if (!avatars.length) throw Error('Cargá primero el catálogo de avatares.');
  const keys = Object.keys(anime) as (keyof typeof anime)[];
  for (const id of Object.values(anime)) if (!await db.anime.findUnique({where:{id}})) throw Error(`Falta ${id}; ejecutá seed:demo primero.`);
  const people = names.slice(0,count).map((name,i) => ({ id: `${WORLD_VERSION}_${i+1}`, handle: `demo_world_${i+1}`, name: `${name} ${surnames[i%surnames.length]}`, country: countries[i%countries.length], avatar: avatars[(i*7)%avatars.length] }));
  for (const p of people) {
    const found = await db.user.findMany({where:{OR:[{id:p.id},{normalizedHandle:p.handle}]}});
    if (found.some(u=>u.id!==p.id || u.normalizedHandle!==p.handle)) throw Error(`Colisión: ${p.handle}`);
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const p of people) await db.user.upsert({where:{id:p.id}, update:{}, create:{id:p.id,handle:p.handle,normalizedHandle:p.handle,name:p.name,passwordHash,
    bio:`Anime, música y conversaciones después de cada capítulo. Actividad demo de ${p.country}. Cuenta ficticia de prueba.`,avatarId:p.avatar.id,avatarUrl:p.avatar.imageUrl}});
  // Assign images only to old demo profiles which still have their original empty avatar.
  const old = await db.user.findMany({where:{id:{startsWith:'aniren_demo_v1_'},avatarId:null,avatarUrl:null},orderBy:{id:'asc'}});
  for (let i=0;i<old.length;i++) await db.user.update({where:{id:old[i].id},data:{avatarId:avatars[i%avatars.length].id,avatarUrl:avatars[i%avatars.length].imageUrl}});
  const anchorRow = await db.operation.upsert({where:{userId_key:{userId:people[0].id,key:`${WORLD_VERSION}_anchor`}},update:{},create:{userId:people[0].id,key:`${WORLD_VERSION}_anchor`,fingerprint:WORLD_VERSION,response:{anchor:new Date().toISOString()}}});
  const anchor = new Date((anchorRow.response as {anchor:string}).anchor);
  const app = createApp({db,catalog,corsOrigins:[],sessionDays:1,timeZone:'America/Buenos_Aires'});
  const server = await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const address=server.address(); if(!address || typeof address==='string') throw Error('No local API');
  const base=`http://127.0.0.1:${address.port}/api`;
  const tokens=new Map<string,string>();
  let added=0;
  async function call(p:typeof people[number],route:string,method:string,body?:unknown,key?:string,days=0) {
    const operationKey=`${WORLD_VERSION}_${key}`;
    const existed=key ? await db.operation.findUnique({where:{userId_key:{userId:p.id,key:operationKey}}}) : null;
    const r=await fetch(base+route,{method,headers:{Authorization:`Bearer ${tokens.get(p.id)}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':operationKey}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await r.json() as any;
    if(!r.ok)throw Error(`${p.handle} ${route}: ${r.status} ${JSON.stringify(result)}`);
    if(key&&!existed){
      const createdAt=new Date(anchor.getTime()-days*86400000);
      if(result.publication){const pub=await db.publication.findUniqueOrThrow({where:{id:Number(result.publication.id)}});await db.publication.update({where:{id:pub.id},data:{createdAt}});if(pub.ratingEntryId)await db.ratingEntry.update({where:{id:pub.ratingEntryId},data:{createdAt}});}
      if(result.rating)await db.ratingEntry.update({where:{id:Number(result.rating.id)},data:{createdAt}});
      added++;
    }
    return result;
  }
  const pubs:number[]=[];
  try {
    for(const p of people){const token=randomBytes(32).toString('base64url');tokens.set(p.id,token);await db.session.create({data:{tokenHash:hashToken(token),userId:p.id,expiresAt:new Date(Date.now()+3600000)}});}
    for(let i=0;i<people.length;i++){
      const p=people[i];
      for(let j=0;j<7;j++){
        const k=keys[(i*3+j)%keys.length];const days=j<2?(i%5)+j/4:8+(i+j)%20;
        const watchedOn=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(anchor.getTime()-days*86400000));
        const rating=2.5+((i*3+j*2)%6)*0.5;
        const body={animeId:anime[k],rating,countryCode:p.country,watchedOn,...(j<4?{text:`${openings[i%openings.length]} ${observations[k][(i+j)%3]} ${endings[(Math.floor(i/3)+j)%endings.length]}`,spoiler:false}:{})};
        const result=await call(p,j<4?'/reviews':'/ratings','POST',body,`rating_${j}`,days);
        if(j<4)pubs.push(Number(result.publication.id));
      }
      for(let j=0;j<2;j++){
        const k=keys[(i+j*5)%keys.length];const item=await db.anime.findUniqueOrThrow({where:{id:anime[k]}});
        await call(p,'/posts','POST',{text:`${item.title}: ${prompts[(i+j*3)%prompts.length]}`,animeIds:[anime[k]],spoiler:false},`post_${j}`,(i%7)+j/3);
      }
      // Skip user-managed library setup on repeat runs.
      const setupKey=`${WORLD_VERSION}_library`;
      if(!await db.operation.findUnique({where:{userId_key:{userId:p.id,key:setupKey}}})){
        await call(p,'/me/favorites','PUT',{animeIds:[anime[keys[(i*3)%keys.length]],anime[keys[(i*3+1)%keys.length]]]});
        await call(p,`/me/library/${anime[keys[(i*3+8)%keys.length]]}`,'PATCH',{watchlist:true});
        await db.operation.create({data:{userId:p.id,key:setupKey,fingerprint:WORLD_VERSION,response:{done:true}}});
      }
      progress(`${i+1}/${people.length}: ${p.name} (${p.country})`);
    }
    for(let i=0;i<people.length;i++){
      const p=people[i];const socialKey=`${WORLD_VERSION}_social`;
      if(await db.operation.findUnique({where:{userId_key:{userId:p.id,key:socialKey}}}))continue;
      for(const offset of [1,7,13]){
        const target=people[(i+offset)%people.length];if(target.id!==p.id)await call(p,`/me/following/${target.id}`,'PUT');
        await call(p,`/publications/${pubs[((i+offset)*4)%pubs.length]}/like`,'PUT');
      }
      await call(p,`/publications/${pubs[((i+1)*4)%pubs.length]}/comments`,'POST',{text:['Me pasó algo parecido con el ritmo. La vi con pausas y la disfruté más.','Me gusta leer otra interpretación; ese detalle me había pasado por alto.','Coincido con lo de los personajes. Son lo que más recuerdo.','Yo tuve una impresión distinta, pero entiendo tu punto.'][i%4]},'comment');
      await db.operation.create({data:{userId:p.id,key:socialKey,fingerprint:WORLD_VERSION,response:{done:true}}});
    }
    const ids=people.map(p=>p.id);
    return {added,users:ids.length,reviews:await db.publication.count({where:{userId:{in:ids},kind:'review'}}),posts:await db.publication.count({where:{userId:{in:ids},kind:'post'}}),ratings:await db.ratingEntry.count({where:{userId:{in:ids}}}),countries:new Set(people.map(p=>p.country)).size};
  } finally {
    await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});
    await db.session.deleteMany({where:{tokenHash:{in:[...tokens.values()].map(hashToken)}}});
  }
}
