import {useState,useEffect,useRef} from 'react'
import {act,query} from '../lib/scalency'
import {uploadListingPhoto} from '../lib/api'
import {emptyListing,validateListingPhoto,listingSizes,matchingSize} from '../lib/listingStudio'

function Field({label,children}){return <label className="sc-field"><span>{label}</span>{children}</label>}
export default function ScalencyDraft({id,sku,onClose,onQueued}){
  const [fields,setFields]=useState({...emptyListing(),sku:sku||''}),[photos,setPhotos]=useState([]),[version,setVersion]=useState(null)
  const [accounts,setAccounts]=useState([]),[cats,setCats]=useState([]),[cursor,setCursor]=useState(null),[options,setOptions]=useState(null)
  const [search,setSearch]=useState(''),[date,setDate]=useState(''),[approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(!id)
  const uid=useRef(id||crypto.randomUUID()),gate=useRef(false),localUrls=useRef([])
  useEffect(()=>()=>localUrls.current.forEach(URL.revokeObjectURL),[])
  useEffect(()=>{let live=true
    const apply=(row)=>{if(!live)return;setFields({...emptyListing(),...row.fields});setVersion(row.version);setPhotos(row.photos.map((p,i)=>({...p,url:row.urls[i]})));setReady(true)}
    if(id)query('draft',{id}).then(apply).catch(e=>live&&setError(e.message))
    query('accounts').then(r=>live&&setAccounts(r.rows.map(x=>x.payload).filter(a=>a.linked))).catch(e=>live&&setError(e.message))
    query('catalogs').then(r=>{if(live){setCats(r.data||[]);setCursor(r.next_cursor)}}).catch(e=>live&&setError(e.message))
    return()=>{live=false}
  },[id])
  useEffect(()=>{let live=true;setOptions(null);if(fields.catalog_id)query('category',{id:fields.catalog_id}).then(r=>{if(live)setOptions(r)}).catch(e=>live&&setError(e.message));return()=>{live=false}},[fields.catalog_id])
  const edit=(key,value)=>{setFields(f=>({...f,[key]:value}));setApproved(false);setMessage('')}
  async function run(fn){if(gate.current)return;gate.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{gate.current=false;setBusy(false)}}
  async function save(){const r=await act('save',{id:uid.current,version,fields,photos:photos.map(({url,...p})=>p)});setVersion(r.version);return r.version}
  async function validate(){const v=await save();await act('validate',{id:uid.current,version:v,schedule:date?new Date(date).toISOString():null});setApproved(true);setMessage('Scalency a validé cette annonce. Tu peux confirmer sa publication.')}
  async function upload(files){setApproved(false);if(files.length+photos.length>20)throw Error('20 photos maximum.');for(const f of files){validateListingPhoto(f);const p=await uploadListingPhoto(f);const url=URL.createObjectURL(f);localUrls.current.push(url);setPhotos(old=>[...old,{...p,url}])}}
  const sizes=listingSizes(options)
  return <article className="sc-editor"><div className="sc-title"><h2>{id?'Modifier le brouillon':'Nouvelle annonce'}</h2><button onClick={onClose} disabled={busy}>Fermer</button></div>
    {error&&<p role="alert" className="sc-error">{error}</p>}{message&&<p role="status" className="sc-success">{message}</p>}
    <fieldset disabled={busy||!ready}><div className="sc-fields">
      <Field label="Compte Vinted"><select value={fields.account_id} onChange={e=>edit('account_id',e.target.value)}><option value="">Choisir un compte relié</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></Field>
      <Field label="SKU"><input value={fields.sku} onChange={e=>edit('sku',e.target.value)}/></Field>
      <Field label="Prix (€)"><input type="number" min=".01" step=".01" value={fields.price} onChange={e=>edit('price',e.target.value)}/></Field>
      <Field label="Taille sur l’étiquette"><input value={fields.size_text} onChange={e=>{edit('size_text',e.target.value);const m=matchingSize(e.target.value,options);if(m)edit('size_id',m)}}/></Field>
    </div><Field label="Photos, dans l’ordre de publication"><input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e=>{const files=[...e.target.files];e.target.value='';run(()=>upload(files))}}/></Field>
    <div className="sc-photos">{photos.map((p,i)=><div key={p.path}><img src={p.url} alt={'Photo '+(i+1)}/><button onClick={()=>{setPhotos(photos.filter(x=>x.path!==p.path));setApproved(false)}}>Retirer</button></div>)}</div>
    <div className="sc-tools"><button onClick={()=>run(async()=>{const v=await save();const r=await act('generate',{id:uid.current,version:v});edit('title',r.title);edit('description',r.description);setMessage('Texte préparé. Tu peux le relire et le modifier.')})}>Rédiger le titre et la bio</button></div>
    <Field label="Titre"><input maxLength={100} value={fields.title} onChange={e=>edit('title',e.target.value)}/></Field>
    <Field label="Description"><textarea rows={4} maxLength={2000} value={fields.description} onChange={e=>edit('description',e.target.value)}/></Field>
    <div className="sc-fields"><Field label="Rechercher une catégorie"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ex. Robes"/></Field>
    <Field label="Catégorie Vinted"><select value={fields.catalog_id||''} onChange={e=>{edit('catalog_id',Number(e.target.value)||null);edit('size_id',null);edit('status_id',null)}}><option value="">Choisir</option>{fields.catalog_id&&!cats.some(c=>c.id===fields.catalog_id)&&<option value={fields.catalog_id}>{options?.ancestors?.at(-1)?.title||fields.catalog_id}</option>}{cats.filter(c=>!search||c.title?.toLowerCase().includes(search.toLowerCase())||c.id===fields.catalog_id).map(c=><option value={c.id} key={c.id}>{c.title} · {c.id}</option>)}</select></Field></div>
    {cursor&&<button onClick={()=>run(async()=>{const r=await query('catalogs',{cursor});setCats(old=>[...old,...r.data]);setCursor(r.next_cursor)})}>Charger plus de catégories</button>}
    <div className="sc-fields"><Field label="État"><select value={fields.status_id||''} onChange={e=>edit('status_id',Number(e.target.value)||null)}><option value="">Choisir</option>{(options?.conditions||[]).map(c=><option key={c.id} value={c.id}>{c.title||c.name}</option>)}</select></Field>
    <Field label="Taille Vinted"><select value={fields.size_id||''} onChange={e=>edit('size_id',Number(e.target.value)||null)}><option value="">Choisir</option>{sizes.map((s,i)=><option key={s.id+'-'+i} value={s.id}>{s.title}</option>)}</select></Field>
    <Field label="Marque"><input value={fields.brand_title||''} onChange={e=>{edit('brand_id',null);edit('brand_title',e.target.value)}}/></Field>
    <Field label="Format du colis"><select value={fields.package_size_id||''} onChange={e=>edit('package_size_id',Number(e.target.value)||null)}><option value="">Choisir</option>{(options?.package_sizes||[]).map(s=><option key={s.id} value={s.id}>{s.title||s.name||s.id}</option>)}</select></Field>
    <Field label="Programmer (facultatif)"><input type="datetime-local" value={date} onChange={e=>{setDate(e.target.value);setApproved(false)}}/></Field></div>
    <div className="sc-tools"><button onClick={()=>run(async()=>{await save();setMessage('Brouillon enregistré sur ton site.')})}>Enregistrer le brouillon</button>
    {approved?<button className="sc-primary" onClick={()=>run(async()=>{await act('publish',{id:uid.current,version,schedule:date?new Date(date).toISOString():null});onQueued()})}>Confirmer la mise en file</button>:<button className="sc-primary" onClick={()=>run(validate)}>Vérifier avec Scalency</button>}</div></fieldset></article>
}
