import {useEffect,useState} from 'react'
import ListingSeoOutput from './ListingSeoOutput'
import {query} from '../lib/scalency'
import '../scalency.css'

export default function ScalencyRelations({entity,id,account,revision=0,onCandidates}){
  const [state,setState]=useState({links:[],loading:true,error:''})
  useEffect(()=>{
    let active=true
    if(!id)return
    setState({links:[],loading:true,error:''})
    query('relations',{entity,id,...(account?{account}:{})}).then(result=>{
      if(!active)return
      setState({links:result.links,seoCopy:result.seoCopy,loading:false,error:''})
      onCandidates?.(result.suggestions||[])
    }).catch(e=>{if(active)setState({links:[],loading:false,error:e.message})})
    return()=>{active=false}
  },[entity,id,account,revision,onCandidates])
  if(!id)return null
  const groups=new Map()
  for(const l of state.links){
    if(!groups.has(l.group))groups.set(l.group,[])
    groups.get(l.group).push(l)
  }
  return <>{state.seoCopy&&<ListingSeoOutput {...state.seoCopy}/>}<section className="sc-related" aria-label="Fiches liées">
    <h3>Fiches liées</h3>
    {state.error?<p role="alert">{state.error}</p>:state.loading?<p>Recherche des correspondances…</p>:!groups.size?<p>Aucune correspondance confirmée pour cette fiche.</p>:
      [...groups].map(([group,links])=><div className="sc-rel-group" key={group}><b>{group}</b>
        <div>{links.map(l=><a key={l.route+JSON.stringify(l.params)} href={'#'+l.route+'?'+new URLSearchParams(l.params)}>{l.label} ↗</a>)}</div>
      </div>)}
  </section></>
}
