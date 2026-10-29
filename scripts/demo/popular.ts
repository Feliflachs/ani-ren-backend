import type { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app';
import type { Catalog } from '../../src/modules/catalog/catalog';
import { hashToken } from '../../src/modules/auth/security';
import { personas, DEMO_VERSION } from './data';

const version = 'popular_reviews_v1';
const selection = [
  { id: 'mal:21', name: 'One Piece', lines: [
    'La tripulación convierte cada despedida en algo que me importa.',
    'El mundo es enorme, pero los momentos entre compañeros son lo que más me engancha.',
    'Las promesas y los sueños de cada personaje le dan sentido al viaje.',
    'Me encanta que pueda pasar del humor a una escena emotiva sin perder su identidad.',
    'Hay aventuras que disfruto por la acción; esta también por las ganas de seguir viajando con el grupo.',
    'Cada integrante aporta algo distinto y eso hace que me interese incluso cuando cambia el escenario.',
    'Los detalles que vuelven a aparecer mucho después hacen que preste atención a todo.',
    'Las islas cambian, pero la lealtad entre los personajes mantiene unido el recorrido.',
  ] },
  { id: 'mal:20', name: 'Naruto', lines: [
    'Los vínculos del equipo me importaron tanto como los combates.',
    'Ver a los personajes esforzarse por encontrar su lugar es lo que más me llega.',
    'La música hace que algunas escenas me sigan emocionando incluso sabiendo lo que viene.',
    'Me quedo con los maestros y con lo que cada alumno aprende de ellos.',
    'Las rivalidades funcionan porque detrás hay afecto, orgullo y miedo a quedarse solo.',
    'Los personajes secundarios tienen momentos que todavía recuerdo con muchísimo cariño.',
    'La forma en que mezcla estrategia y emoción en las peleas me sigue funcionando.',
    'Más allá de las técnicas, me atrapa cómo cambia la confianza entre compañeros.',
  ] },
  { id: 'mal:52991', name: 'Frieren', lines: [
    'Las pausas y los gestos pequeños hacen que el paso del tiempo se sienta de verdad.',
    'Fern y Stark le dan al viaje una calidez que me hizo querer al grupo muy rápido.',
    'Me encanta cómo una conversación sencilla cambia de significado después.',
    'La música y los paisajes acompañan sin quitarles espacio a los personajes.',
    'Cada recuerdo ayuda a entender algo del presente sin explicar de más.',
    'Las despedidas tienen peso incluso cuando la historia las cuenta en voz baja.',
    'El humor cotidiano hace que los momentos emotivos lleguen mucho más.',
    'No necesito un gran giro para disfrutarla: una parada del viaje ya puede dejarme pensando.',
  ] },
  { id: 'mal:16498', name: 'Attack on Titan', lines: [
    'La tensión del comienzo y la sensación de peligro me atraparon enseguida.',
    'Las decisiones del grupo pesan porque la historia deja sentir sus consecuencias.',
    'La música y la dirección hacen que las escenas de acción tengan una fuerza tremenda.',
    'Me gusta cómo cambia lo que creemos entender cuando aparece nueva información.',
    'Los personajes reaccionan de maneras distintas al miedo y eso vuelve interesantes los conflictos.',
    'Los momentos de cooperación me resultan tan intensos como los enfrentamientos.',
    'La incertidumbre está muy bien construida: quería seguir, pero también necesitaba procesar lo que veía.',
    'Los detalles del principio ganan mucho cuando se miran con atención.',
  ] },
];
const openings = ['Me dejó una impresión buenísima.', 'Es de las que recomiendo cuando me preguntan por mis favoritas.', 'La disfruté muchísimo.', 'Me ganó por sus personajes.', 'Terminó siendo mucho más especial de lo que esperaba.', 'La fui viendo con calma y me encantó.', 'Entiendo perfectamente el cariño que le tiene tanta gente.', 'Me quedé pensando en ella varios días.', 'La compartí con amigos y dio para muchas conversaciones.', 'Tiene momentos que me dan ganas de volver a verla.'];
const endings = ['Me quedo con esa mezcla de emoción y aventura.', 'Una de mis favoritas para conversar después de cada capítulo.', 'La recomiendo sin dudar.', 'Para mí se ganó un lugar entre las que más disfruté.', 'Me dejó con ganas de seguir hablando de sus personajes.', 'No todo tiene que sorprenderme para emocionarme así.', 'De esas historias que da gusto compartir.', 'La experiencia completa me compensó de sobra.', 'Me llevó a buscar su música cuando terminé.', 'Me alegro de haberle dedicado tiempo.'];

export async function seedPopular(db: PrismaClient, catalog: Catalog, progress = console.log) {
  const users = await db.user.findMany({ where: { OR: [
    { id: { startsWith: `${DEMO_VERSION}_` }, normalizedHandle: { startsWith: 'demo_' } },
    { id: { startsWith: 'aniren_world_v1_' }, normalizedHandle: { startsWith: 'demo_world_' } },
  ] }, orderBy: { id: 'asc' } });
  if (!users.length) throw Error('No hay cuentas de demo para ampliar.');
  for (const anime of selection) if (!await db.anime.findUnique({where:{id:anime.id}})) throw Error(`Falta ${anime.name} en el catálogo.`);
  const app = createApp({ db, catalog, corsOrigins: [], sessionDays: 1, timeZone: 'America/Buenos_Aires' });
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No local API');
  const tokens: string[] = [];
  let added = 0, skipped = 0, fiveStars = 0;
  try {
    for (let i=0; i<users.length; i++) {
      const user=users[i];
      const token=randomBytes(32).toString('base64url');tokens.push(hashToken(token));
      await db.session.create({data:{userId:user.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+3600000)}});
      const last=await db.ratingEntry.findFirst({where:{userId:user.id,countryCode:{not:null}},orderBy:{id:'desc'}});
      const countryCode=last?.countryCode ?? personas.find(p=>`${DEMO_VERSION}_${p.key}`===user.id)?.country;
      if (!countryCode) throw Error(`Falta país para ${user.handle}`);
      for (let j=0;j<selection.length;j++) {
        const anime=selection[j];const key=`${version}_${anime.id.replace(':', '_')}`;
        if (await db.operation.findUnique({where:{userId_key:{userId:user.id,key}}})) {skipped++;continue;}
        const bucket=(i+j*3)%10;
        const rating=bucket===0?4:bucket===1?4.5:5;
        const previous=await db.libraryEntry.findUnique({where:{userId_animeId:{userId:user.id,animeId:anime.id}}});
        const body={animeId:anime.id,rating,countryCode,rewatched:!!previous?.watched,spoiler:false,
          text:`${openings[(Math.floor(i/8)+j)%openings.length]} ${anime.lines[(i+j)%anime.lines.length]} ${rating===5?endings[(Math.floor(i/10)+j)%endings.length]:'Tiene algunos tramos que me cuestan más, pero el conjunto me gustó muchísimo.'}`};
        const response=await fetch(`http://127.0.0.1:${address.port}/api/reviews`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
        if(!response.ok)throw Error(`${user.handle}: ${response.status} ${await response.text()}`);
        added++;if(rating===5)fiveStars++;
      }
      progress(`${i+1}/${users.length}: ${user.name}`);
    }
    return {users:users.length,added,skipped,fiveStars};
  } finally {
    await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});
    await db.session.deleteMany({where:{tokenHash:{in:tokens}}});
  }
}
