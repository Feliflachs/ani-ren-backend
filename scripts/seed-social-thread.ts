import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { config } from '../src/config/config';
import { createApp } from '../src/app';
import { JikanCatalog } from '../src/modules/catalog/catalog';
import { hashToken } from '../src/modules/auth/security';

const db = new PrismaClient({ datasourceUrl: config.databaseUrl });
const version = 'social_thread_v1';
const comments = [
  'One Piece por la tripulación. Me importa tanto el viaje como llegar al destino.',
  'Frieren. Fern y Stark me ganaron con sus conversaciones cotidianas.',
  'Naruto fue mi puerta de entrada al anime, así que tiene ventaja sentimental.',
  'Attack on Titan me hizo querer ver otro capítulo cada vez. Qué manera de sostener la tensión.',
  'Mi voto va para Frieren, sobre todo por la música y las pausas.',
  'Zoro es mi favorito, pero Nami tiene escenas que me emocionan muchísimo.',
  'Kakashi. Me quedo con los maestros que aprenden algo de sus alumnos también.',
  'Levi, aunque Armin es el personaje que más me interesa escuchar.',
  'Yo elegiría One Piece para verla con amigos y Frieren para verla tranquila.',
  'Naruto tiene temas que vuelvo a escuchar aunque hayan pasado años.',
  'Me cuesta elegir una sola. Las cuatro me funcionan en momentos distintos.',
  'La relación de Frieren con el tiempo es lo que más me quedó dando vueltas.',
  'Sanji: sus peleas están bien, pero me gusta más cuando cuida al grupo.',
  'Sakura merece más reconocimiento. Hay mucho para conversar sobre su recorrido.',
  'Mikasa. Me interesan las decisiones que toma cuando todo se complica.',
  'Stark me hace reír y también me emociona cuando tiene que juntar valor.',
  'Luffy convierte una idea simple en una manera de vivir. Eso me encanta.',
  'El inicio de Attack on Titan sigue siendo de los que más me impactaron.',
  'Hinata es mi favorita de Naruto. Siempre me gustaron sus momentos más tranquilos.',
  'Fern diciendo mucho con una mirada: eso ya me compra el capítulo.',
  'Chopper. No pienso justificarlo, lo quiero en todas las aventuras.',
  'Me gustaría volver a ver Naruto con alguien que nunca la haya visto.',
  'Hange aporta una energía distinta al grupo y por eso me encanta.',
  'Brook tiene una mezcla de humor y melancolía que me puede.',
  'La música de Frieren me acompaña hasta cuando estudio.',
  'Lo mejor de este debate es que nadie necesita contar el final para recomendar algo.',
  'Robin: me gusta cómo va encontrando su lugar dentro de la tripulación.',
  'Yo arrancaría por Frieren si la persona busca algo más pausado.',
  'One Piece pide paciencia, pero encariñarse con el grupo lo hace mucho más fácil.',
  'Mi lista de pendientes acaba de crecer otra vez. Gracias por las recomendaciones.',
];
const replies = [
  'Coincido con lo del grupo: las despedidas me pegan por los vínculos que construyeron.',
  'Sí, hay momentos chiquitos entre compañeros que recuerdo más que una pelea.',
  'A mí me pasó con la música. Escucho un tema y vuelvo directo a esa aventura.',
  'Me sirve esa recomendación. La voy a empezar sin apurarme.',
  'Gracias por explicarlo sin spoilers, así dan ganas de entrar a la conversación.',
  'Yo la vi de a poco y terminé queriendo a personajes que al principio no me convencían.',
  'El humor también ayuda a sentir que realmente conviven.',
  'No siempre conecto con el protagonista; a veces un secundario se lleva todo.',
  'Me interesa eso de mirar el viaje y no estar esperando solamente el final.',
  'Exacto. Cuando el grupo se separa un rato se nota cuánto aporta cada uno.',
  'También cambia mucho verla solo o comentarla con alguien después.',
  'Tengo pendiente volver a las primeras aventuras para ver esos detalles.',
  'Me quedo con la recomendación de espaciar los capítulos.',
  'Los personajes imperfectos me resultan mucho más interesantes.',
  'A veces una escena sencilla termina siendo la que más recordás.',
  'Eso me pasó con una despedida: parecía breve y me dejó pensando bastante.',
  'La banda sonora hace un trabajo enorme en esas escenas.',
  'No hace falta que todos tengamos el mismo favorito para disfrutar la charla.',
  'Por eso prefiero estas recomendaciones a una nota sin explicación.',
  'Me dieron ganas de organizar una noche de anime con amigos.',
  'Volví a verla y me fijé más en los personajes de fondo.',
  'La primera vez estaba pendiente de la acción; ahora disfruto más las conversaciones.',
  'Qué lindo encontrar gente que recuerda esos momentos también.',
  'Anotado. Voy a probar con unos capítulos este fin de semana.',
  'Después vuelvo al hilo para contar qué me pareció.',
  'Gracias por la charla, me llevo varias ideas para seguir viendo.',
];

async function main() {
  const users = await db.user.findMany({ where: { OR: [
    {id:{startsWith:'aniren_demo_v1_'},normalizedHandle:{startsWith:'demo_'}},
    {id:{startsWith:'aniren_world_v1_'},normalizedHandle:{startsWith:'demo_world_'}},
  ] }, orderBy:{id:'asc'} });
  const author=users.find(u=>u.normalizedHandle==='demo_lara');
  if(!author || users.length<66)throw Error('Faltan las cuentas de demo.');
  const others=users.filter(u=>u.id!==author.id);
  const app=createApp({...config,db,catalog:new JikanCatalog(fetch,config.catalogBaseUrl)});
  const server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const address=server.address();if(!address||typeof address==='string')throw Error('No local server');
  const baseUrl=`http://127.0.0.1:${address.port}/api`;
  const tokens=new Map<string,string>();
  async function call(user:typeof author,route:string,method='GET',body?:unknown,key?:string):Promise<any>{
    if(!user)throw Error('No user');
    if(!tokens.has(user.id)){
      const token=randomBytes(32).toString('base64url');
      await db.session.create({data:{tokenHash:hashToken(token),userId:user.id,expiresAt:new Date(Date.now()+3600000)}});
      tokens.set(user.id,token);
    }
    const r=await fetch(`${baseUrl}${route}`,{method,headers:{Authorization:`Bearer ${tokens.get(user.id)}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':`${version}_${key}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await r.json();if(!r.ok)throw Error(`${route}: ${r.status} ${JSON.stringify(result)}`);return result;
  }
  try {
    const post=await call(author,'/posts','POST',{
      text:'Debate de la comunidad: si tuvieras que recomendar solo uno entre One Piece, Naruto, Frieren y Attack on Titan, ¿cuál elegirías y qué personaje te ganó? Contá el motivo sin spoilers. Quiero leer sus opiniones y descubrir detalles que se me pasaron.',
      animeIds:['mal:21','mal:20','mal:52991','mal:16498'],spoiler:false,
    },'post');
    const id=Number(post.publication.id);
    for(const user of others.slice(0,65))await call(user,`/publications/${id}/like`,'PUT');
    let threadId:string|undefined;
    for(let i=0;i<comments.length;i++){
      const result=await call(others[i],`/publications/${id}/comments`,'POST',{text:comments[i]},`root_${i}`);
      // Make the active reply thread the most recent root, visible on the first page.
      if(i===comments.length-1)threadId=result.comment.id;
    }
    for(let i=0;i<replies.length;i++)await call(others[(i+30)%others.length],`/publications/${id}/comments`,'POST',{text:replies[i],parentId:threadId},`reply_${i}`);
    // A stable group of recent demo reviews gets smaller, varied like counts too.
    const marker=`${version}_review_targets`;
    let saved=await db.operation.findUnique({where:{userId_key:{userId:author.id,key:marker}}});
    if(!saved){
      const targets=await db.publication.findMany({where:{kind:'review',userId:{in:users.map(u=>u.id)}},orderBy:{id:'desc'},take:12,select:{id:true}});
      saved=await db.operation.create({data:{userId:author.id,key:marker,fingerprint:version,response:{ids:targets.map(p=>p.id)}}});
    }
    const targets=(saved.response as {ids:number[]}).ids;
    for(let i=0;i<targets.length;i++)for(let j=0;j<3+i%8;j++)await call(others[(i*7+j)%others.length],`/publications/${targets[i]}/like`,'PUT');
    const detail=await call(author,`/publications/${id}`);
    const roots=await call(author,`/publications/${id}/comments`);
    const thread=await call(author,`/publications/${id}/comments?parentId=${threadId}`);
    if(roots.total!==30 || thread.total!==26 || !roots.nextCursor || !thread.nextCursor)throw Error('Comment pagination validation failed');
    const rootNext=await call(author,`/publications/${id}/comments?cursor=${encodeURIComponent(roots.nextCursor)}`);
    const replyNext=await call(author,`/publications/${id}/comments?parentId=${threadId}&cursor=${encodeURIComponent(thread.nextCursor)}`);
    if(!rootNext.items.length||!replyNext.items.length)throw Error('Empty next page');
    console.log(JSON.stringify({publicationId:id,author:author.name,likes:await db.publicationLike.count({where:{publicationId:id}}),comments:await db.comment.count({where:{publicationId:id}}),roots:roots.total,replies:thread.total,reviewTargets:targets.length,url:`http://localhost:8081/inicio/review/${id}`,apiPublicationFound:!!detail.publication},null,2));
  } finally {
    await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});
    await db.session.deleteMany({where:{tokenHash:{in:[...tokens.values()].map(hashToken)}}});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
