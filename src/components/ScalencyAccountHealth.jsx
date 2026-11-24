import {useCallback,useEffect,useState} from 'react'
import {query} from '../lib/scalency'

export function useAccountHealth(enabled=true){
  const [report,setReport]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const refresh=useCallback(()=>setRevision(v=>v+1),[])
  useEffect(()=>{
    if(!enabled)return
    let live=true,reading=false
    async function read(){
      if(reading)return
      reading=true
      try{
        const value=await query('account-health')
        if(live){setReport(value);setError('')}
      }catch(e){if(live)setError(e.message||'Scalency est indisponible.')}
      finally{reading=false}
    }
    const tick=()=>{if(document.visibilityState==='visible')read()}
    read()
    const timer=setInterval(tick,30000)
    document.addEventListener('visibilitychange',tick)
    return ()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[enabled,revision])
  return {report,error,refresh}
}
export function preparationBlock(health,id){
  if(!id)return 'Choisis le compte de publication.'
  const current=health.report?.accounts.find(a=>a.id===String(id))
  if(current?.block&&current.block.kind!=='unknown')return current.block.label
  if(health.error||current?.block?.kind==='unknown')return 'État du compte indisponible'
  if(!health.report)return 'Vérification du compte…'
  return current?'':'Compte introuvable dans Scalency'
}
const when=value=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(value))
export function AccountHealthNotice({health,id,overview=false}){
  const entries=health.report?.accounts||[]
  const selected=entries.find(a=>a.id===String(id))
  const warning=id?preparationBlock(health,id):''
  const others=overview?entries.filter(a=>a.id!==String(id)&&['banned','restricted','blocked','publication'].includes(a.block?.kind)):[]
  if(!warning&&!others.length&&!health.error)return null
  return <aside className="sc-account-warning" aria-live="polite">
    {warning&&<p><strong>{selected?.login&&selected.login+' · '}{warning}</strong>{health.report||health.error?' — Préparation et mise en file suspendues.':''}
      {selected?.block?.until&&' Fin indiquée par Scalency le '+when(selected.block.until)+' (heure de Paris).'}</p>}
    {others.map(a=><p key={a.id}><strong>{a.login}</strong> · {a.block.label}</p>)}
    {health.error&&<p>La vérification auprès de Scalency a échoué.</p>}
    {(health.error||health.report)&&<button type="button" className="bs-link" onClick={health.refresh}>Revérifier les comptes</button>}
  </aside>
}
