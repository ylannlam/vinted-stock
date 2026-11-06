import {useEffect,useRef,useState} from 'react'

// Recopie en arrière-plan le prix d'achat Shein des ventes dans Dotb (administrateur seulement).
// Une passe par minute ; enchaîne tant qu'il reste des prix ; s'arrête sur un problème de clé.
export function useDotbCosts(request,enabled){
 const [state,setState]=useState({message:'',sent:0,pending:0})
 const stopped=useRef(false)
 useEffect(()=>{
  if(!enabled)return
  let active=true,timer
  const tick=async()=>{
   if(!active||stopped.current)return
   let delay=60000
   if(document.visibilityState==='visible'){
    try{
     const r=await request('POST',{action:'dotb_costs'})
     if(!active)return
     setState(old=>({message:r.message||'',sent:old.sent+(r.sent||0),pending:r.pending||0}))
     if(['scope','auth','plan','setup'].includes(r.stop)){stopped.current=true;return}
     if(!r.stop&&r.pending>0&&r.sent>0)delay=4000
    }catch{/* nouvel essai à la prochaine passe */}
   }
   timer=setTimeout(tick,delay)
  }
  timer=setTimeout(tick,1500)
  return()=>{active=false;clearTimeout(timer)}
 },[enabled])
 return state
}
