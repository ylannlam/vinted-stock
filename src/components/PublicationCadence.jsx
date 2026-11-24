import {useCallback,useEffect,useState} from 'react'
import {act,query} from '../lib/scalency'
import './PublicationCadence.css'

export function useCadence(){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const refresh=useCallback(()=>setRevision(n=>n+1),[])
  useEffect(()=>{
    let live=true,reading=false
    async function read(){
      if(reading)return
      reading=true
      try{const result=await query('cadence');if(live){setRows(result);setError('')}}
      catch(e){if(live)setError(e.message)}
      finally{reading=false}
    }
    const tick=()=>{if(document.visibilityState==='visible')read()}
    read()
    const timer=setInterval(tick,60000)
    document.addEventListener('visibilitychange',tick)
    return ()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[revision])
  return {rows,error,refresh}
}
const rhythm=r=>r.mode==='normal'?'Normal':!r.starter_day?'Démarrage · première publication à venir':r.starter_day<=3?'Démarrage · jour '+r.starter_day+'/3':'Démarrage · 3 jours écoulés'

export function CadenceSettings({row,onSaved,blocked}){
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [mode,setMode]=useState(''),[starter,setStarter]=useState(''),[normal,setNormal]=useState('')
  function open(){setMode(row.mode);setStarter(row.starter_limit);setNormal(row.normal_limit);setError('');setEditing(true)}
  async function save(ev){
    ev.preventDefault()
    if(busy)return
    setBusy(true);setError('')
    try{await act('cadence-save',{account:row.account,mode,starter:Number(starter),normal:Number(normal)});setEditing(false);onSaved()}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="cadence-card">
    <div><strong>{rhythm(row)}</strong><p>{blocked||('Places restantes : '+row.remaining+' sur '+row.day_limit+' · '+row.posted+' publiée(s) · '+row.reserved+' en file')}</p></div>
    {!editing&&<button type="button" onClick={open}>{row.mode==='starter'&&row.starter_day>3?'Choisir le rythme':'Régler le plafond'}</button>}
    {editing&&<form onSubmit={save}><label>Rythme actif<select value={mode} onChange={e=>setMode(e.target.value)}><option value="starter">Démarrage</option><option value="normal">Normal</option></select></label>
      <label>Plafond en démarrage<input type="number" required step="1" min="0" max="2147483647" value={starter} onChange={e=>setStarter(e.target.value)}/></label>
      <label>Plafond normal<input type="number" required step="1" min="0" max="2147483647" value={normal} onChange={e=>setNormal(e.target.value)}/></label>
      <button disabled={busy}>Enregistrer</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>Annuler</button>
      {error&&<p role="alert">{error}</p>}</form>}
  </section>
}
export function CadenceOverview({health}){
  const {rows,error,refresh}=useCadence()
  return <section className="cadence-overview"><h2>Publications du jour</h2>
    {error?<p role="alert">{error} <button onClick={refresh}>Réessayer</button></p>:<div className="cadence-scroll"><table>
      <thead><tr>{['Compte','Rythme','Publiées','En file','Places restantes'].map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(r=>{
        const block=health.report?.accounts.find(a=>a.id===r.account)?.block
        return <tr key={r.account}><th scope="row"><a href={'#annonces?account='+encodeURIComponent(r.account)}>{r.login}</a></th>
          <td>{rhythm(r)}</td><td>{r.posted}</td><td>{r.reserved}</td><td>{block?.label||<strong>{r.remaining} / {r.day_limit}</strong>}</td></tr>
      })}</tbody></table></div>}
  </section>
}
