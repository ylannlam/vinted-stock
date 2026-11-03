import {useCallback,useEffect,useRef,useState} from 'react'
import {authenticatedFetch} from './api'
import {parisDay,publicationAccount} from './publications'
import {runPublicationBatch} from './publicationBatch'

export async function publicationRequest(action,query={},body){
  const response=await authenticatedFetch(`/api/adspower?${new URLSearchParams({action,...query})}`,body?{method:'POST',body:JSON.stringify({action,...body})}:{})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw Error(data.error||'Le suivi des annonces est indisponible. Le dernier relevé est conservé.')
  return data
}
export function usePublicationTracking(profiles,request=publicationRequest){
  const [day,setDayValue]=useState(parisDay),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[syncing,setSyncing]=useState(null),[notice,setNotice]=useState('')
  const [directoryError,setDirectoryError]=useState(''),[refreshing,setRefreshing]=useState(false)
  const [batch,setBatch]=useState(null),batchController=useRef(null)
  const alive=useRef(true),pending=useRef(false),current=useRef({}),today=useRef(true),generation=useRef(0)
  current.current={profiles,day,data}
  const setDay=value=>{today.current=value===parisDay();setDayValue(value)}
  const load=useCallback(async()=>{
    const version=++generation.current,selected=current.current.day
    try{const next=await request('publications',{date:selected});if(alive.current&&version===generation.current){setData(next);setError('')}return next}
    catch(e){if(alive.current&&version===generation.current)setError(e.message)}
    finally{if(alive.current&&version===generation.current)setLoading(false)}
  },[request])
  async function refresh(){
    if(pending.current)return
    pending.current=true;setRefreshing(true)
    try{const result=await request('publication-accounts',{},{});if(alive.current&&result.refreshed)setDirectoryError('');await load()}
    catch(e){if(alive.current)setDirectoryError(e.message)}
    finally{pending.current=false;if(alive.current)setRefreshing(false)}
  }
  async function sync(account,force=false){
    if(pending.current||!account)return
    pending.current=true;setSyncing(account.id);setNotice('')
    try{const result=await request('publication-sync',{}, {account_id:account.id,force});await load();if(force&&alive.current)setNotice(result.waiting?'Un relevé est déjà en cours ou vient d’être effectué. Patiente quelques instants.':result.complete?'Relevé enregistré.':'Cette page est enregistrée. Les suivantes seront relevées automatiquement.')}
    catch(e){await load();if(alive.current)setError(e.message)}
    finally{pending.current=false;if(alive.current)setSyncing(null)}
  }
  async function syncAll(accounts){
    if(pending.current||!accounts.length)return
    const controller=new AbortController();batchController.current=controller
    pending.current=true;setNotice('');setError('');setBatch({running:true,total:accounts.length,done:0,updated:0,offline:0,failed:0,current:null,issues:[]})
    try{
      const directory=await request('publication-accounts',{},{});if(directory.refreshed&&alive.current)setDirectoryError('')
      const latest=await load()
      const targets=accounts.map(a=>latest?.accounts?.find(next=>next.id===a.id)||a)
      await runPublicationBatch(targets,{request,signal:controller.signal,onPage:()=>alive.current?load():Promise.resolve(),onProgress:value=>{if(alive.current)setBatch(value)}})
    }catch(e){if(alive.current){setError(e.message);setBatch(old=>({...old,running:false,cancelled:true}))}}
    finally{pending.current=false;if(batchController.current===controller)batchController.current=null}
  }
  useEffect(()=>{
    alive.current=true;load();refresh()
    const tick=async()=>{
      if(pending.current)return
      if(today.current&&current.current.day!==parisDay())setDayValue(parisDay())
      const state=current.current.data
      if(!state?.directory_checked_at||Date.now()-Date.parse(state.directory_checked_at)>125000){await refresh();return}
      const accounts=current.current.profiles.map(p=>publicationAccount(p,state.accounts,state.links)).filter(Boolean)
      const candidate=accounts.filter(a=>a.source_present&&a.bridge_connected&&(!a.next_scan_at||Date.parse(a.next_scan_at)<=Date.now()))
        .sort((a,b)=>(Date.parse(a.last_checked_at)||0)-(Date.parse(b.last_checked_at)||0))[0]
      if(candidate)await sync(candidate)
    }
    const timer=setInterval(tick,15000)
    document.addEventListener('visibilitychange',tick)
    return()=>{alive.current=false;generation.current++;batchController.current?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[request])
  useEffect(()=>{setLoading(true);load()},[day,load])
  const ready=data?.date===day
  return {day,setDay,data,accounts:data?.accounts||[],links:data?.links||[],error:directoryError||error,notice,loading:loading||!ready,refreshing,syncing,batch,syncAll,cancelBatch:()=>{batchController.current?.abort();setBatch(old=>old?{...old,stopping:true}:old)},refresh,sync,load,request,
    account:profile=>publicationAccount(profile,data?.accounts||[],data?.links||[])}
}
