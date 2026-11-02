import {useState,useEffect,useRef,useCallback} from 'react'
import {readViewCache,writeViewCache,viewCacheEpoch} from './viewCache'

export function useCachedState(owner,key,initial) {
  const fallback=useRef(initial),version=useRef(viewCacheEpoch())
  const [snapshot,setSnapshot]=useState(()=>({owner,key,value:readViewCache(owner,key)??fallback.current,fresh:false}))
  const value=snapshot.owner===owner&&snapshot.key===key?snapshot.value:readViewCache(owner,key)??fallback.current
  const setValue=useCallback(update=>setSnapshot(previous=>{
    const before=previous.owner===owner&&previous.key===key?previous.value:readViewCache(owner,key)??fallback.current
    return {owner,key,value:typeof update==='function'?update(before):update,fresh:true}
  }),[owner,key])
  useEffect(()=>{if(snapshot.fresh)writeViewCache(snapshot.owner,snapshot.key,snapshot.value,version.current)},[snapshot])
  return [value,setValue]
}
