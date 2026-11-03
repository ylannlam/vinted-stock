const profiles=Array.from({length:6},(_,i)=>({id:`demo-${i}`,number:String(i+1).padStart(2,'0'),name:['Dressing Camille','Atelier Léa','Dressing Emma','Sélection Jade','Studio Louise','Dressing Alice'][i],group:i<4?'Vinted · France':'Nouveaux profils',opened:i===1}))
let jobs=[],started=0
export async function adsPowerPreview(path,body){
  if(path==='/profiles')return {profiles}
  if(path==='/launch'){started=Date.now();jobs=body.ids.map((id,i)=>({id:crypto.randomUUID(),profile:profiles.find(p=>p.id===id),state:i<3?'opening':'queued',message:'Ouverture du profil',created_at:started,checked_at:null}));return {jobs:structuredClone(jobs)}}
  if(path==='/cancel')jobs=jobs.map(j=>j.state==='queued'?{...j,state:'cancelled',message:'Démarrage annulé'}:j)
  if(started)jobs=jobs.map((j,i)=>{
    if(j.state==='cancelled')return j
    const elapsed=Date.now()-started-i*700
    return elapsed>6500?{...j,state:i===2?'attention':'started',message:i===2?'Une connexion Vinted est nécessaire dans ce profil.':'Les 4 automatisations Dotb sont démarrées',checked_at:started+6500}:{...j,state:elapsed>2500?'dotb':'opening',message:elapsed>2500?'Vérification des automatisations Dotb':'Ouverture de Vinted'}
  })
  return {configured:true,jobs:structuredClone(jobs),version:'1.0.0'}
}
