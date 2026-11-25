import {useEffect,useId,useState} from 'react'
import {clothingSizeSuggestions} from '../lib/listingStudio'
import {act} from '../lib/scalency'

export default function ScalencyQuickAccount({accounts,health,account,onSelect,onSaved,fixed=false,readOnly=false}){
  const healthLabels=new Map(health?.report?.accounts.map(a=>[a.id,a.block?.label]))
  const current=accounts.find(a=>a.id===account)
  const [editing,setEditing]=useState(false),[name,setName]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const [editingSize,setEditingSize]=useState(false),[size,setSize]=useState('')
  const sizeList=useId()
  useEffect(()=>{setEditingSize(false);setSize(current?.default_size||'');setError('')},[account,current?.default_size])
  useEffect(()=>{setEditing(false);setName(current?.brand||'');setError('')},[account,current?.brand])
  async function save(){
    if(saving||!current)return
    setSaving(true);setError('')
    try{const r=await act('quick-brand',{account:current.id,name});onSaved(current.id,{brand:r.brand});setEditing(false)}
    catch(e){setError(e.message)}finally{setSaving(false)}
  }
  async function saveSize(){
    if(saving||!current)return
    setSaving(true);setError('')
    try{
      const profile=await act('quick-size',{account:current.id,size})
      onSaved(current.id,profile);setEditingSize(false)
    }catch(e){setError(e.message)}finally{setSaving(false)}
  }
  return <div className="sc-quick-account">{!fixed&&<label className="sc-field"><span>Compte de publication</span><select disabled={saving} value={account} onChange={e=>onSelect(e.target.value)}><option value="">Choisir un compte</option>{accounts.map(a=><option key={a.id} value={a.id}>{[a.login,healthLabels.get(a.id)].filter(Boolean).join(' · ')}</option>)}</select></label>}
    {readOnly&&current&&<span>{[current.brand,current.default_size].filter(Boolean).join(' · ')}</span>}
    {!readOnly&&current&&(current.brand&&!editing?<div><span>Marque Vinted · <strong>{current.brand}</strong></span> <button type="button" onClick={()=>setEditing(true)}>Modifier</button></div>:<div><label className="sc-field"><span>Marque de tes produits sur ce compte</span><input value={name} onChange={e=>setName(e.target.value)} maxLength={100}/></label><button type="button" disabled={saving||!name.trim()} onClick={save}>Enregistrer la marque du compte</button></div>)}
    {!readOnly&&current&&(editingSize?<div>
      <label className="sc-field"><span>Taille par défaut du compte</span><input autoFocus list={sizeList} maxLength={80} value={size} onChange={e=>setSize(e.target.value)} placeholder="Ex. XL ou 38"/></label>
      <datalist id={sizeList}>{clothingSizeSuggestions.map(s=><option key={s} value={s}/>)}</datalist>
      <button type="button" disabled={saving} onClick={saveSize}>Enregistrer la taille</button>
      <button type="button" disabled={saving} onClick={()=>{setEditingSize(false);setSize(current.default_size||'');setError('')}}>Annuler</button>
    </div>:<div><span>Taille par défaut · <strong>{current.default_size||'Non définie'}</strong></span>
      <button type="button" disabled={saving} onClick={()=>setEditingSize(true)}>{current.default_size?'Modifier la taille':'Régler la taille'}</button></div>)}
    {error&&<p role="alert" className="sc-error">{error}</p>}</div>
}
