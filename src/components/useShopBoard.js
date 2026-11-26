import {useCallback,useEffect,useRef,useState} from 'react'
import {query} from '../lib/scalency'
import {readViewCache,viewCacheEpoch,writeViewCache} from '../lib/viewCache'

const sources=['ventes','articles','retraits','publications','references']
export default function useShopBoard(){
  const [board,setBoard]=useState(()=>readViewCache(query,'shop-board')||null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const generation=useRef(0),working=useRef(false)
  const refresh=useCallback(async(force=false)=>{
    if(working.current)return
    working.current=true
    const ticket=generation.current,epoch=viewCacheEpoch(),live=()=>generation.current===ticket&&epoch===viewCacheEpoch()
    let loaded=false
    setBusy(true);setError('')
    const read=async()=>{const value=await query('shop-board');if(live()){writeViewCache(query,'shop-board',value,epoch);setBoard(value);loaded=true}}
    try{
      await read()
      if(!live())return
      let refreshed=false
      for(const source of sources){
        let cursor=''
        const seen=new Set()
        do{
          const page=await query('shop-refresh',{source,cursor,force:force?'1':'0'})
          if(!live())return
          if(!page.skipped)refreshed=true
          cursor=page.next
          if(cursor&&seen.has(cursor))throw Error('Page de synchronisation répétée.')
          seen.add(cursor)
        }while(cursor)
      }
      if(refreshed)await read()
    }catch(e){if(live())setError((loaded?'Dernières données disponibles. ':'')+(e.message||'Lecture interrompue.'))}
    finally{if(live()){working.current=false;setBusy(false)}}
  },[])
  const reread=useCallback(async()=>{
    const ticket=generation.current,epoch=viewCacheEpoch(),next=await query('shop-board')
    if(generation.current===ticket&&epoch===viewCacheEpoch()){writeViewCache(query,'shop-board',next,epoch);setBoard(next)}
  },[])
  useEffect(()=>{
    generation.current++
    refresh()
    const tick=()=>{if(document.visibilityState==='visible')refresh()}
    const timer=setInterval(tick,180000)
    document.addEventListener('visibilitychange',tick)
    return ()=>{generation.current++;working.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[refresh])
  return {board,busy,error,refresh,reread}
}
