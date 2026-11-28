import {useCallback,useEffect,useRef,useState} from 'react'
import {act,query} from '../lib/scalency'
import './PublicationCadence.css'

export function useCadence(){
  const [rows,setRows]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const saveVersion=useRef(0)
  const applySaved=useCallback((account,capacity)=>{
    saveVersion.current++
    setRows(previous=>previous?.map(row=>row.account===account?{...row,...capacity}:row)??null)
  },[])
  const refresh=useCallback(()=>setRevision(n=>n+1),[])
  useEffect(()=>{
    let live=true,reading=false
    async function read(){
      if(reading)return
      reading=true
      const version=saveVersion.current
      try{const result=await query('cadence');if(live&&version===saveVersion.current){setRows(result);setError('')}}
      catch(e){if(live&&version===saveVersion.current)setError(e.message)}
      finally{reading=false}
    }
    const tick=()=>{if(document.visibilityState==='visible')read()}
    read()
    const timer=setInterval(tick,60000)
    document.addEventListener('visibilitychange',tick)
    return ()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[revision])
  return {rows:rows??[],loading:rows===null&&!error,error,refresh,applySaved}
}
const rhythm=r=>r.mode==='normal'?'Normal':!r.starter_day?'Démarrage · première publication à venir':r.starter_day<=3?'Démarrage · jour '+r.starter_day+'/3':'Démarrage · 3 jours écoulés'

export function CadenceSettings({row,onSaved,blocked}){
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [mode,setMode]=useState(row.mode),[limit,setLimit]=useState(''),[saved,setSaved]=useState(false)
  function selectMode(value){
    setMode(value)
    setLimit(String(value==='starter'?row.starter_limit:row.normal_limit))
  }
  function open(){selectMode(row.mode);setError('');setSaved(false);setEditing(true)}
  async function save(ev){
    ev.preventDefault()
    if(busy)return
    setBusy(true);setError('')
    try{
      const capacity=await act('cadence-save',{
        account:row.account,mode,
        starter:mode==='starter'?Number(limit):row.starter_limit,
        normal:mode==='normal'?Number(limit):row.normal_limit
      })
      onSaved(row.account,capacity)
      setEditing(false)
      setSaved(true)
    }
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="cadence-card">
    <div><strong>Plafond quotidien de {row.login}</strong>
      <p>{row.day_limit} {row.day_limit===1?'annonce':'annonces'} par jour · {rhythm(row)}</p>
      <p>{blocked||('Places restantes : '+row.remaining+' · '+row.posted+(row.posted>1?' publiées':' publiée')+' · '+row.reserved+(row.reserved>1?' places réservées':' place réservée'))}</p>
      {saved&&<p role="status">Plafond enregistré.</p>}
    </div>
    {!editing&&<button type="button" onClick={open}>Régler le plafond</button>}
    {editing&&<form onSubmit={save}><label>Rythme actif<select disabled={busy} value={mode} onChange={e=>selectMode(e.target.value)}><option value="starter">Démarrage</option><option value="normal">Normal</option></select></label>
      <label>Annonces par jour<input type="number" autoFocus required step="1" min="0" max="2147483647" disabled={busy} value={limit} onChange={e=>setLimit(e.target.value)}/></label>
      <button disabled={busy}>{busy?'Enregistrement…':'Enregistrer'}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>Annuler</button>
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
          <td>{rhythm(r)}</td><td>{r.posted}</td><td>{r.queued??'Indisponible'}</td><td>{block?.label||<strong>{r.remaining} / {r.day_limit}</strong>}</td></tr>
      })}</tbody></table></div>}
  </section>
}
