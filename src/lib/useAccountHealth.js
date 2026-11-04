import {useCallback,useEffect,useRef,useState} from 'react'
export const accountHealthRequest=(method='GET',body)=>import('./api').then(m=>m.resourcesRequest(method,body,'?scope=health'))
export function useAccountHealth(request=accountHealthRequest){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now)
  const alive=useRef(false),pending=useRef(false),generation=useRef(0)
  const refresh=useCallback(async(sync=true)=>{
    if(pending.current)return
    pending.current=true;const ticket=++generation.current;setBusy(true)
    try{const next=await request(sync?'POST':'GET',sync?{action:'sync'}:undefined);if(alive.current&&ticket===generation.current){setData(next);setError('')}}
    catch(e){if(alive.current&&ticket===generation.current)setError(e.message)}
    finally{if(ticket===generation.current){pending.current=false;if(alive.current)setBusy(false)}}
  },[request])
  useEffect(()=>{
    alive.current=true;pending.current=false;refresh()
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')refresh()},300000)
    const clock=setInterval(()=>setNow(Date.now()),30000)
    return()=>{alive.current=false;generation.current++;clearInterval(timer);clearInterval(clock)}
  },[refresh])
  async function save(body){
    if(pending.current)throw Error('Une actualisation est en cours. Réessaie dans un instant.')
    pending.current=true;const ticket=++generation.current;setBusy(true)
    try{const next=await request('POST',{action:'report',...body});if(alive.current&&ticket===generation.current){setData(next);setError('')}}
    finally{if(ticket===generation.current){pending.current=false;if(alive.current)setBusy(false)}}
  }
  return {data,error,busy,now,refresh,save}
}
