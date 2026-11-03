import {randomUUID} from 'node:crypto'
import {LocalError,validProfile} from './adspower.mjs'

export const pendingStates=new Set(['queued','opening','vinted','dotb'])
export class LaunchQueue{
  constructor({run,limit=3}){this.run=run;this.limit=limit;this.jobs=[];this.running=0;this.requests=new Map()}
  launch({ids,requestId},profiles){
    if(!Array.isArray(ids)||!ids.length||ids.length>100||!ids.every(validProfile)||typeof requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(requestId))throw new LocalError('Sélectionne entre 1 et 100 profils.')
    if(this.requests.has(requestId))return this.requests.get(requestId)
    const byId=new Map(profiles.map(p=>[p.id,p]))
    if(ids.some(id=>!byId.has(id)))throw new LocalError('Un profil a changé. Actualise la liste.',409)
    const added=[]
    for(const id of new Set(ids)){
      const existing=this.jobs.find(j=>j.profile.id===id&&pendingStates.has(j.state))
      if(existing){added.push(existing.id);continue}
      const job={id:randomUUID(),profile:byId.get(id),state:'queued',message:'En attente de démarrage',created_at:Date.now(),checked_at:null,features:[]}
      this.jobs.push(job);added.push(job.id)
    }
    this.jobs=this.jobs.filter((j,i,a)=>pendingStates.has(j.state)||i>=a.length-200)
    this.requests.set(requestId,added);if(this.requests.size>500)this.requests.delete(this.requests.keys().next().value)
    queueMicrotask(()=>this.pump());return added
  }
  cancel(){for(const job of this.jobs)if(job.state==='queued'){job.state='cancelled';job.message='Démarrage annulé'}return this.snapshot()}
  snapshot(){return this.jobs.map(j=>({...j,profile:{...j.profile},features:[...j.features]}))}
  pump(){
    while(this.running<this.limit){
      const job=this.jobs.find(j=>j.state==='queued');if(!job)break
      this.running++;job.state='opening';job.message='Ouverture du profil'
      const update=patch=>Object.assign(job,patch)
      Promise.resolve().then(()=>this.run(job.profile,update)).then(result=>update({state:'started',message:'Les 4 automatisations Dotb sont démarrées',checked_at:Date.now(),features:result.features})).catch(error=>update({state:'attention',message:error instanceof LocalError?error.message:'Le démarrage a été interrompu. Vérifie ce profil puis réessaie.',checked_at:Date.now()})).finally(()=>{this.running--;this.pump()})
    }
  }
}
