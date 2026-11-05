const profiles=Array.from({length:6},(_,i)=>({id:`demo-${i}`,number:String(i+1).padStart(2,'0'),name:['Dressing Camille','Atelier Léa','Dressing Emma','Sélection Jade','Studio Louise','Dressing Alice'][i],group:i<4?'Vinted · France':'Nouveaux profils',opened:i===1}))
let jobs=[],started=0
export async function adsPowerPreview(path,body){
  if(path==='/profiles')return {profiles}
  if(path==='/profiles/proxies')return {profiles:profiles.map((p,i)=>({id:p.id,number:p.number,proxy:i<3?{host:'isp.decodo.com',port:10001+i,user:'demo-user'}:null}))}
  if(path==='/profiles/create'){const number=String(profiles.length+1).padStart(2,'0'),profile={id:`demo-${profiles.length}`,number,name:body.name,group:body.group,opened:false};profiles.push(profile);return {profile:{profile_id:profile.id,profile_no:number,name:body.name,group:body.group,resolution:'1920_1080',threads:16,gpu:'NVIDIA GeForce RTX 4060',chrome:141}}}
  if(path==='/profiles/fingerprint'){if(profiles.find(p=>p.id===body.id)?.opened)throw Error('Ferme ce profil dans AdsPower avant de changer son empreinte.');return {profile:{profile_id:body.id,resolution:'2560_1440',threads:16,gpu:'NVIDIA GeForce RTX 4070',chrome:141}}}
  if(path==='/launch'){started=Date.now();jobs=body.ids.map((id,i)=>({id:crypto.randomUUID(),profile:profiles.find(p=>p.id===id),state:i<3?'opening':'queued',message:'Ouverture du profil',created_at:started,checked_at:null}));return {jobs:structuredClone(jobs)}}
  if(path==='/cancel')jobs=jobs.map(j=>j.state==='queued'?{...j,state:'cancelled',message:'Démarrage annulé'}:j)
  if(started)jobs=jobs.map((j,i)=>{
    if(j.state==='cancelled')return j
    const elapsed=Date.now()-started-i*700
    return elapsed>6500?{...j,state:i===2?'attention':'started',message:i===2?'Une connexion Vinted est nécessaire dans ce profil.':'Les 4 automatisations Dotb sont démarrées',checked_at:started+6500}:{...j,state:elapsed>2500?'dotb':'opening',message:elapsed>2500?'Vérification des automatisations Dotb':'Ouverture de Vinted'}
  })
  const checked=Date.now(),runtime=jobs.filter(j=>j.state==='started').map(j=>({profile_id:j.profile.id,job_id:j.id,status:'running',opened:true,features:['likes','agent','orders','bridge'],message:'Les 4 automatisations Dotb sont actives.',checked_at:checked}))
  return {configured:true,jobs:structuredClone(jobs),version:'1.1.0',factory:true,monitoring:true,runtime,opened_ids:[...new Set([...profiles.filter(p=>p.opened).map(p=>p.id),...jobs.map(j=>j.profile.id)])],browser_checked_at:checked}
}
