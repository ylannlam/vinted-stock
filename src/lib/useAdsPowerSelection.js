import {useEffect,useRef,useState} from 'react'
import {legacySelection} from './adspowerVisibility'

export function useAdsPowerSelection(owner,profiles,profilesLoaded,request){
 const [selection,setSelection]=useState(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false)
 const inFlight=useRef(false),alive=useRef(true),current=useRef(selection);current.current=selection
 async function refresh(){
  try{const result=await request('profile-selection');if(alive.current){setSelection(result.selection);setLoaded(true);setError('')}}
  catch(e){if(alive.current){setError(e.message);setLoaded(false)}}
 }
 useEffect(()=>{alive.current=true;refresh();return()=>{alive.current=false}},[owner,request])
 async function save(chosen){
  if(inFlight.current)return false
  inFlight.current=true;setSaving(true);setError('')
  try{
   const result=await request('profile-selection',{}, {version:current.current?.version||0,profiles:chosen.map(({id,number,name,group})=>({id,number:String(number),name,group:group||''}))})
   current.current=result.selection
   if(alive.current)setSelection(result.selection)
   try{localStorage.setItem(`adspower-visible:${owner}`,JSON.stringify(result.selection.profiles.map(p=>p.id)))}catch{}
   return true
  }catch(e){if(alive.current)setError(e.message);return false}
  finally{inFlight.current=false;if(alive.current)setSaving(false)}
 }
 useEffect(()=>{
  if(!loaded||selection||!profilesLoaded||saving||error)return
  const ids=legacySelection(localStorage,owner)
  const found=profiles.filter(p=>ids.includes(p.id))
  // Do not silently erase an old choice when the local API returns an incomplete list.
  if(ids.some(id=>!found.some(p=>p.id===id))){setError('Certains comptes choisis ne sont plus disponibles dans AdsPower. Vérifie « Mes comptes » pour enregistrer ta liste.');return}
  save(found)
 },[loaded,selection,profilesLoaded,profiles,saving,error,owner])
 const chosen=selection?.profiles||[]
 const displayed=chosen.map(p=>profiles.find(live=>live.id===p.id)||p)
 return {selection,loaded,error,saving,displayed,save,refresh}
}
