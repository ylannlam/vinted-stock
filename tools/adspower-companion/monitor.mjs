import {DotbUI} from './dotb-ui.mjs'
import {FEATURES,START,PAUSE,STOP,isVinted} from './dotb.mjs'
import {pendingStates} from './queue.mjs'

const unknown=()=>({status:'unknown',features:[],message:'État indisponible. Nouvelle vérification en cours.'})
export function panelActivity(panels){
  if(!panels.length)return {status:'page_closed',features:[],message:'La page Automatisations Dotb est fermée ou absente.'}
  if(panels.length!==1)return unknown()
  const cards=panels[0].cards
  if(FEATURES.some(f=>!cards.some(c=>c.id===f.id&&['ready','running'].includes(c.state))))return unknown()
  const features=FEATURES.filter(f=>cards.find(c=>c.id===f.id).state==='running').map(f=>f.id)
  return {status:features.length===4?'running':features.length?'partial':'paused',features,message:features.length===4?'Les 4 automatisations Dotb sont actives.':features.length?`${features.length}/4 automatisations actives.`:'Les automatisations Dotb sont en pause.'}
}

// Monitoring is strictly read-only: never start a profile, create a page,
// navigate, focus a tab or click a control. Disconnecting CDP leaves it open.
export async function readDotbActivity(address,{connect,createUI=DotbUI.create}={}){
  const connector=connect||((url,options)=>import('playwright-core').then(({chromium})=>chromium.connectOverCDP(url,options)))
  let browser,timer;const uis=[]
  try{
    browser=await connector(address,{timeout:4000,noDefaults:true})
    const inspect=async()=>{
      const context=browser.contexts()[0];if(!context)throw Error('No context')
      const panels=[]
      for(const page of context.pages()){
        if(!isVinted(page.url()))continue
        const ui=await createUI(page,{features:FEATURES,start:START,pause:PAUSE,stop:STOP});uis.push(ui)
        for(const root of await ui.inspect({strict:true}))if(root.value.cards.length===FEATURES.length)panels.push(root.value)
      }
      return panelActivity(panels)
    }
    return await Promise.race([inspect(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Inspection timeout')),4000)})])
  }catch{return unknown()}
  finally{
    clearTimeout(timer)
    // End the connection first so a stalled inspection cannot keep it alive.
    if(browser)await browser.close().catch(()=>{})
    await Promise.allSettled(uis.map(ui=>ui.close()))
  }
}

export class RuntimeMonitor{
  constructor({getClient,inspect=readDotbActivity,now=Date.now,interval=5000}){
    this.getClient=getClient;this.inspect=inspect;this.now=now;this.interval=interval
    this.entries=new Map();this.opened=null;this.checkedAt=null;this.lastStarted=-Infinity;this.inflight=null
  }
  snapshot(){return {monitoring:true,runtime:[...this.entries.values()],opened_ids:this.opened?[...this.opened]:null,browser_checked_at:this.checkedAt}}
  refresh(profiles,jobs){
    if(this.inflight)return this.inflight
    if(this.now()-this.lastStarted<this.interval)return Promise.resolve()
    this.lastStarted=this.now()
    this.inflight=this.scan(profiles,jobs).catch(()=>{this.opened=null}).finally(()=>{this.inflight=null})
    return this.inflight
  }
  async scan(profiles,jobs){
    const client=this.getClient();if(!client)return
    const latest=new Map(jobs.map(j=>[j.profile.id,j]))
    const tracked=[...latest.values()].filter(j=>!pendingStates.has(j.state)&&j.state!=='cancelled')
    const valid=new Set(profiles.map(p=>p.id))
    for(const id of this.entries.keys())if(!valid.has(id)||!tracked.some(j=>j.profile.id===id))this.entries.delete(id)
    let connections
    try{connections=await client.openConnections()}catch{
      if(this.getClient()!==client)return
      this.opened=null;this.checkedAt=this.now()
      for(const job of tracked)this.entries.set(job.profile.id,{profile_id:job.profile.id,job_id:job.id,opened:null,checked_at:this.now(),...unknown()})
      return
    }
    if(this.getClient()!==client)return
    this.opened=new Set(connections.keys());this.checkedAt=this.now()
    const openJobs=[]
    for(const job of tracked){
      const base={profile_id:job.profile.id,job_id:job.id,checked_at:this.now()}
      if(!connections.has(job.profile.id))this.entries.set(job.profile.id,{...base,opened:false,status:'closed',features:[],message:'Le profil AdsPower est fermé.'})
      else openJobs.push(job)
    }
    let next=0
    await Promise.all(Array.from({length:Math.min(3,openJobs.length)},async()=>{
      while(next<openJobs.length){
        const job=openJobs[next++],address=connections.get(job.profile.id)
        let result;try{result=address?await this.inspect(address):unknown()}catch{result=unknown()}
        if(this.getClient()===client)this.entries.set(job.profile.id,{profile_id:job.profile.id,job_id:job.id,opened:true,checked_at:this.now(),...result})
      }
    }))
  }
}
