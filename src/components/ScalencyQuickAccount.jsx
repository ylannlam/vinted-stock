import {useEffect,useState} from 'react'
import {act} from '../lib/scalency'

export default function ScalencyQuickAccount({accounts,account,onSelect,onSaved,fixed=false}){
  const current=accounts.find(a=>a.id===account)
  const [editing,setEditing]=useState(false),[name,setName]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  useEffect(()=>{setEditing(false);setName(current?.brand||'');setError('')},[account,current?.brand])
  async function save(){
    if(saving||!current)return
    setSaving(true);setError('')
    try{const r=await act('quick-brand',{account:current.id,name});onSaved(current.id,r.brand);setEditing(false)}
    catch(e){setError(e.message)}finally{setSaving(false)}
  }
  return <div className="sc-quick-account">{!fixed&&<label className="sc-field"><span>Compte de publication</span><select disabled={saving} value={account} onChange={e=>onSelect(e.target.value)}><option value="">Choisir un compte</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></label>}
    {current&&(current.brand&&!editing?<div><span>Marque Vinted · <strong>{current.brand}</strong></span> <button type="button" onClick={()=>setEditing(true)}>Modifier</button></div>:<div><label className="sc-field"><span>Marque de tes produits sur ce compte</span><input value={name} onChange={e=>setName(e.target.value)} maxLength={100}/></label><button type="button" disabled={saving||!name.trim()} onClick={save}>Enregistrer la marque du compte</button></div>)}
    {error&&<p role="alert" className="sc-error">{error}</p>}</div>
}
