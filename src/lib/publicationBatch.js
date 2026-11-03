const pause=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('Stopped','AbortError'));return}
  const stop=()=>{clearTimeout(timer);reject(new DOMException('Stopped','AbortError'))}
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve()},ms)
  signal?.addEventListener('abort',stop,{once:true})
})

// One read at a time, including every page. The server also enforces a shared limit.
export async function runPublicationBatch(accounts,{request,onProgress=()=>{},onPage=async()=>{},signal,wait=pause,now=Date.now}={}){
  const queue=[...new Map(accounts.filter(a=>a.source_present).map(a=>[a.id,a])).values()]
  const state={running:true,cancelled:false,total:queue.length,done:0,updated:0,offline:0,failed:0,current:null,issues:[]}
  const emit=()=>onProgress({...state,issues:[...state.issues]})
  let lastRequest=-Infinity
  emit()
  try{
    for(const account of queue){
      if(signal?.aborted)break
      if(!account.bridge_connected){state.offline++;state.done++;state.issues.push({login:account.login,message:'Bridge fermé : ouvre ce profil et active son Bridge Dotb.'});emit();continue}
      let first=true,waiting=0,pages=0
      state.current=account.login;emit()
      try{
        for(;;){
          const delay=Math.max(0,10000-(now()-lastRequest))
          if(delay)await wait(delay,signal)
          if(signal?.aborted)break
          lastRequest=now()
          const result=await request('publication-sync',{}, {account_id:account.id,force:first})
          if(result.waiting){if(++waiting>=7)throw Error('Ce compte est déjà en cours de relevé. Réessaie dans un instant.');continue}
          if(!result.synced||typeof result.complete!=='boolean')throw Error('Le relevé n’a pas pu être confirmé.')
          waiting=0;pages++;await onPage()
          if(result.complete){state.updated++;state.done++;emit();break}
          if(pages>=10000)throw Error('Le relevé est trop long. Les pages déjà reçues sont conservées.')
          first=false
        }
      }catch(e){
        if(signal?.aborted||e.name==='AbortError')break
        state.failed++;state.done++;state.issues.push({login:account.login,message:e.message});emit()
      }
    }
  }finally{state.running=false;state.cancelled=!!signal?.aborted&&state.done<state.total;state.current=null;emit()}
  return {...state,issues:[...state.issues]}
}
