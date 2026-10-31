const background='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#eee5d7"/><stop offset="1" stop-color="#faf8f3"/></linearGradient></defs><path fill="url(#b)" d="M0 0h900v700H0z"/><path fill="#c9bba6" opacity=".25" d="M0 530 900 420v280H0z"/><text x="450" y="330" text-anchor="middle" fill="#998b75" font-family="sans-serif" font-size="26">Fond de démonstration</text></svg>')
const now=new Date().toISOString()
const rows=[
  {id:'10101010-1010-4010-8010-101010101010',kind:'background',title:'Studio crème · exemple',category:'Studio',content:'Place l’article de la première image sur le fond de la deuxième image.\nConserve fidèlement sa couleur, sa coupe et tous ses détails. Adapte la lumière et les ombres au fond, avec des proportions réalistes.',notes:'Joindre la photo de l’article et celle du fond à ton outil d’image.',image_path:'demo/fond.png',image_url:background,favorite:true,version:1,updated_at:now},
  {id:'20202020-2020-4020-8020-202020202020',kind:'prompt',title:'Vêtement sur fond · exemple',category:'Vêtements',content:'Utilise la photo de l’article comme référence exacte. Place cet article sur le fond fourni en deuxième image, sans modifier sa forme, sa matière, ses motifs ou sa couleur. Harmonise les ombres et conserve une lumière naturelle.',notes:'Exemple à personnaliser.',image_path:null,image_url:null,favorite:false,version:1,updated_at:now}
]
const images=new Map()
export async function resourcesPreview(method='GET',body) {
  if(method==='GET')return {resources:structuredClone(rows),count:rows.length}
  const old=rows.find(r=>r.id===body.id)
  if(body.action==='download')return {url:old.image_url}
  if(old&&old.version!==body.version)throw Error('Cette ressource a changé. Actualise la bibliothèque.')
  let value
  if(body.action==='save')value={...old,...body,image_url:images.get(body.image_path)||old?.image_url||null}
  else if(body.action==='favorite')value={...old,favorite:body.favorite}
  else if(body.action==='archive')value={...old,archived_at:body.archived?new Date().toISOString():null}
  else throw Error('Action de démonstration inconnue.')
  value.version=(old?.version||0)+1;value.updated_at=new Date().toISOString()
  if(old)rows.splice(rows.indexOf(old),1,value);else rows.push(value)
  return {saved:true,resource:structuredClone(value)}
}
export async function resourcesPreviewUpload(file) {
  const path=`demo/${crypto.randomUUID()}`,url=URL.createObjectURL(file);images.set(path,url);return {path}
}
