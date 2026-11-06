const ids=['30303030-3030-4030-8030-303030303030','40404040-4040-4040-8040-404040404040','50505050-5050-4050-8050-505050505050']
// Démo : quelques comptes déjà choisis, dont un sans DA, pour montrer l’atelier rempli.
const demo=[['33333333-3333-4333-8333-333333333333','camille.mode','10101010-1010-4010-8010-101010101010'],['55555555-5555-4555-8555-555555555501','lea.vintage','10101010-1010-4010-8010-101010101010'],['55555555-5555-4555-8555-555555555502','maison.jade',null],['55555555-5555-4555-8555-555555555503','nina.closet','10101010-1010-4010-8010-101010101010'],['55555555-5555-4555-8555-555555555504','sofia.dress',null]]
const accounts=demo.map(([id,login,background_id])=>({id,login,country:'FR',source_present:true,enabled:true,background_id,prompt_front:null,prompt_back:login==='nina.closet'?'Montre le dos de l’article, même lumière, même fond.':null,notes:'',version:1}))
export async function creativeAccountsPreview(method='GET',body){
 if(method==='GET')return {accounts:structuredClone(accounts),count:accounts.length,page_size:250}
 if(body.action==='sync'){
  for(const [index,id] of ids.entries())if(!accounts.some(a=>a.id===id))accounts.push({id,login:['boutique.creme','style.fleuri','ancien.compte'][index],country:'FR',source_present:true,enabled:false,background_id:null,prompt_front:null,prompt_back:null,notes:'',version:1})
  return {synced:true,count:accounts.length}
 }
 if(body.action==='select'){
  if(body.changes.some(c=>accounts.find(a=>a.id===c.id)?.version!==c.version))throw Error('La sélection a changé. Actualise avant de réessayer.')
  for(const c of body.changes){const a=accounts.find(a=>a.id===c.id);a.enabled=c.enabled;a.version++}
  return {saved:true}
 }
 const a=accounts.find(a=>a.id===body.id)
 if(!a||a.version!==body.version)throw Error('Ce compte a changé. Actualise avant de réessayer.')
 Object.assign(a,{background_id:body.background_id,prompt_front:body.prompt_front,prompt_back:body.prompt_back,notes:body.notes,version:a.version+1})
 return {saved:true,account:structuredClone(a)}
}
