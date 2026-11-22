import {useState,useEffect,useRef} from 'react'
import ListingSeoOutput from './ListingSeoOutput'
import {updateSeoDetails} from '../lib/vintedSeo'
import ScalencyQuickAccount from './ScalencyQuickAccount'
import {listingColors} from '../lib/scalencyQuick'
import ScalencyRelations from './ScalencyRelations'
import {act,query} from '../lib/scalency'
import {uploadListingPhoto} from '../lib/api'
import {emptyListing,validateListingPhoto,listingSizes,matchingSize} from '../lib/listingStudio'

function ChoosePiece({onChoose,busy}){
  const [page,setPage]=useState(0),[rows,setRows]=useState([]),[total,setTotal]=useState(0),[error,setError]=useState('')
  useEffect(()=>{let live=true;query('stock',{page}).then(r=>{if(live){setRows(r.rows);setTotal(r.total);setError('')}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[page])
  return <section className="sc-panel"><label className="sc-field"><span>Choisir la pièce physique</span><select disabled={busy} value="" onChange={e=>{if(e.target.value)onChoose(e.target.value)}}><option value="">Emplacement · catégorie · taille</option>{rows.map(r=><option key={r.id} value={r.id}>{[r.emplacement,r.category,r.size].filter(Boolean).join(' · ')}</option>)}</select></label>{total>36&&<div className="sc-tools"><button disabled={!page||busy} onClick={()=>setPage(p=>p-1)}>Précédent</button><span>{page+1} / {Math.ceil(total/36)}</span><button disabled={(page+1)*36>=total||busy} onClick={()=>setPage(p=>p+1)}>Suivant</button></div>}{error&&<p role="alert">{error}</p>}</section>
}
function Field({label,children}){return <label className="sc-field"><span>{label}</span>{children}</label>}
export default function ScalencyDraft({id,sku,piece,product,onClose,onQueued}){
  const [fields,setFields]=useState({...emptyListing(),sku:sku||''}),[photos,setPhotos]=useState([]),[version,setVersion]=useState(null)
  const [accounts,setAccounts]=useState([]),[cats,setCats]=useState([]),[cursor,setCursor]=useState(null),[options,setOptions]=useState(null)
  const [search,setSearch]=useState(''),[date,setDate]=useState(''),[approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(!id)
  const [quick,setQuick]=useState(!id),[prepared,setPrepared]=useState(false),[review,setReview]=useState(false),[profiles,setProfiles]=useState([]),[owner,setOwner]=useState('')
  const [choosing,setChoosing]=useState(false)
  const [source,setSource]=useState({piece:piece||null,product:product||null,label:''}),[savedState,setSavedState]=useState('draft')
 const uid=useRef(id||crypto.randomUUID()),gate=useRef(false),localUrls=useRef([])
  useEffect(()=>()=>localUrls.current.forEach(URL.revokeObjectURL),[])
  useEffect(()=>{let live=true
    const apply=(row)=>{if(!live)return;setFields({...emptyListing(),...row.fields});setVersion(row.version);setPhotos(row.photos.map((p,i)=>({...p,url:row.urls[i]})));setReady(true);setSavedState(row.state);setSource({piece:row.stock_item_id,product:row.catalog_product_id,label:''})}
    if(!id&&(piece||product||sku)){setReady(false);query('draft-source',{...(piece?{piece}:{}),...(product?{product}:{}),...(sku?{sku}:{})}).then(r=>{if(!live)return;setSource({piece:r.stock?.id||null,product:r.product?.id||null,label:[r.product?.title,r.stock?.emplacement].filter(Boolean).join(' · ')});setFields(f=>({...f,sku:sku||r.product?.supplier_sku||'',size_text:r.stock?.size||'',price:r.product?.sale_price==null?'':String(r.product.sale_price)}));setReady(true)}).catch(e=>{if(live)setError(e.message)})}
    if(id)query('draft',{id}).then(apply).catch(e=>live&&setError(e.message))
    query('quick-profiles').then(r=>{
      if(!live)return
      setProfiles(r.accounts);setOwner(r.owner)
      let last='';try{last=localStorage.getItem('scalency-last-account:'+r.owner)||''}catch{}
      if(!id){const found=r.accounts.find(a=>a.id===last)||(r.accounts.length===1?r.accounts[0]:null)
        if(found)setFields(f=>({...f,account_id:found.id}))}
    }).catch(e=>live&&setError(e.message))
    query('accounts').then(r=>live&&setAccounts(r.rows.map(x=>x.payload).filter(a=>a.linked))).catch(e=>live&&setError(e.message))
    query('catalogs').then(r=>{if(live){setCats(r.data||[]);setCursor(r.next_cursor)}}).catch(e=>live&&setError(e.message))
    return()=>{live=false}
  },[id,piece,product,sku])
  useEffect(()=>{let live=true;setOptions(null);if(fields.catalog_id)query('category',{id:fields.catalog_id}).then(r=>{if(live)setOptions(r)}).catch(e=>live&&setError(e.message));return()=>{live=false}},[fields.catalog_id])
  const edit=(key,value)=>{
    setFields(f=>{
      const next={...f,[key]:value}
      if(key==='size_text')Object.assign(next,updateSeoDetails(f,{size:value}))
      if(key==='status_id'){
        next.seo_condition=options?.conditions?.find(c=>c.id===value)?.title||''
        Object.assign(next,updateSeoDetails(f,{condition:next.seo_condition}))
      }
      return next
    })
    setApproved(false);setMessage('')
  }
  async function run(fn){if(gate.current)return;gate.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{gate.current=false;setBusy(false)}}
  async function save(){const r=await act('save',{id:uid.current,version,fields,piece:source.piece,product:source.product,photos:photos.map(({url,...p})=>p)});setVersion(r.version);return r.version}
  async function validate(){const v=await save();await act('validate',{id:uid.current,version:v,schedule:date?new Date(date).toISOString():null});setApproved(true);setMessage('Scalency a validé cette annonce. Tu peux confirmer sa publication.')}
  async function upload(files){setApproved(false);if(files.length+photos.length>20)throw Error('20 photos maximum.');for(const f of files){validateListingPhoto(f);const p=await uploadListingPhoto(f);const url=URL.createObjectURL(f);localUrls.current.push(url);setPhotos(old=>[...old,{...p,url}])}}
  function selectAccount(account){
    setFields(f=>({...f,account_id:account,brand_id:null,brand_title:''}));setPrepared(false);setApproved(false);setMessage('')
    if(owner)try{localStorage.setItem('scalency-last-account:'+owner,account)}catch{}
  }
  async function quickSend(){
    const v=await save()
    if(prepared){const result=await act('quick-publish',{id:uid.current,version:v});onQueued(result);return}
    setMessage('Analyse des photos et préparation de l’annonce…')
    const r=await act('autopost',{id:uid.current,version:v}).catch(async e=>{
      const latest=await query('draft',{id:uid.current}).catch(()=>null)
      if(latest){setFields(latest.fields);setVersion(latest.version);setSavedState(latest.state);setPrepared(latest.state==='draft'&&latest.version>v)}
      throw e
    })
    if(r.job){onQueued(r);return}
    setVersion(r.version);setFields(r.fields);setPrepared(true)
    if(r.missing.length){setReview(true);setMessage('Brouillon enregistré. À compléter : '+r.missing.join(', ')+'.');return}
    setReview(true);setMessage('Vérifie les champs de l’annonce.')
  }
  const sizes=listingSizes(options)
  const selectedBrand=profiles.find(a=>a.id===fields.account_id)?.brand
  const quickEditable=quick&&savedState==='draft'
  return <article className="sc-editor"><div className="sc-title"><h2>{id?(savedState==='draft'?'Modifier le brouillon':'Fiche annonce'):'Nouvelle annonce'}</h2><button onClick={onClose} disabled={busy}>Fermer</button></div>
    {error&&<p role="alert" className="sc-error">{error}</p>}{message&&<p role="status" className="sc-success">{message}</p>}
    {source.label&&<p className="sc-success">{source.label}</p>}{(id||version!==null)&&<ScalencyRelations entity="draft" id={uid.current} revision={version}/>}
    <fieldset disabled={busy||!ready||savedState!=='draft'}>{savedState==='draft'&&<div className="sc-mode"><button aria-pressed={quick} onClick={()=>{setQuick(true);setApproved(false)}}>Publication automatique</button><button aria-pressed={!quick} onClick={()=>{setQuick(false);setApproved(false)}}>Formulaire détaillé</button></div>}
    {quickEditable&&<ScalencyQuickAccount accounts={profiles} account={fields.account_id} onSelect={selectAccount} onSaved={(id,brand)=>{setPrepared(false);setProfiles(rows=>rows.map(a=>a.id===id?{...a,brand}:a))}}/>}
    {!quick&&savedState==='draft'&&<div className="sc-tools"><button onClick={()=>setChoosing(v=>!v)}>{choosing?'Fermer la sélection':source.piece?'Changer de pièce':'Choisir une pièce du stock'}</button>{source.piece&&<button onClick={()=>{setSource(s=>({...s,piece:null,label:''}));setApproved(false)}}>Détacher la pièce</button>}</div>}
    {choosing&&<ChoosePiece busy={busy} onChoose={pieceId=>run(async()=>{
      const r=await query('draft-source',{piece:pieceId})
      setSource({piece:r.stock.id,product:r.product?.id||null,label:[r.product?.title,r.stock.emplacement,r.stock.size].filter(Boolean).join(' · ')})
      setFields(f=>({...f,sku:r.product?.supplier_sku||'',size_text:r.stock.size||'',size_id:matchingSize(r.stock.size||'',options)||null,price:f.price||String(r.product?.sale_price??'')}))
      setApproved(false);setChoosing(false)
    })}/>}<div className="sc-fields">
      {!quick&&<Field label="Compte Vinted"><select value={fields.account_id} onChange={e=>edit('account_id',e.target.value)}><option value="">Choisir un compte relié</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></Field>}
      <Field label="SKU"><input value={fields.sku} onChange={e=>{setPrepared(false);edit('sku',e.target.value)}}/></Field>
      <Field label="Prix (€)"><input type="number" min=".01" step=".01" value={fields.price} onChange={e=>edit('price',e.target.value)}/></Field>
      {(!quick||review)&&<Field label="Taille sur l’étiquette"><input value={fields.size_text} onChange={e=>{edit('size_text',e.target.value);const m=matchingSize(e.target.value,options);edit('size_id',m||null)}}/></Field>}
    </div><Field label="Photos, dans l’ordre de publication"><input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e=>{const files=[...e.target.files];e.target.value='';setPrepared(false);run(()=>upload(files))}}/></Field>
    <div className="sc-photos">{photos.map((p,i)=><div key={p.path}><img src={p.url} alt={'Photo '+(i+1)}/><button onClick={()=>{setPhotos(photos.filter(x=>x.path!==p.path));setApproved(false);setPrepared(false)}}>Retirer</button></div>)}</div>
    {quickEditable&&<div className="sc-quick-submit"><p>Petit colis · {fields.account_id&&selectedBrand?'Publication sur '+(profiles.find(a=>a.id===fields.account_id)?.login||'ce compte'):'Choisis le compte et sa marque'}</p>
      <button className="sc-primary" disabled={!selectedBrand||!fields.sku.trim()||!(Number(fields.price)>0)||!photos.length} onClick={()=>run(async()=>{try{await quickSend()}catch(e){setMessage('Le brouillon est conservé.');setReview(true);throw e}})}>{busy?'Préparation en cours…':prepared?'Vérifier et envoyer à Scalency':'Remplir et publier via Scalency'}</button>
      <button onClick={()=>setReview(v=>!v)}>{review?'Masquer les détails':'Afficher les détails'}</button></div>}
    {(!quick||review)&&<><div className="sc-tools">{!quick&&<button onClick={()=>run(async()=>{const v=await save();const r=await act('generate',{id:uid.current,version:v});edit('title',r.title);edit('description',r.description);setMessage('Texte préparé. Tu peux le relire et le modifier.')})}>Rédiger le titre et la bio</button>}</div>
    <Field label="Titre"><input maxLength={100} value={fields.title} onChange={e=>edit('title',e.target.value)}/></Field>
    <Field label="Description"><textarea rows={4} maxLength={2000} value={fields.description} onChange={e=>edit('description',e.target.value)}/></Field>
    <div className="sc-fields"><Field label="Rechercher une catégorie"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ex. Robes"/></Field>
    <Field label="Catégorie Vinted"><select value={fields.catalog_id||''} onChange={e=>{edit('catalog_id',Number(e.target.value)||null);edit('size_id',null);edit('status_id',null)}}><option value="">Choisir</option>{fields.catalog_id&&!cats.some(c=>c.id===fields.catalog_id)&&<option value={fields.catalog_id}>{options?.ancestors?.at(-1)?.title||fields.catalog_id}</option>}{cats.filter(c=>!search||c.title?.toLowerCase().includes(search.toLowerCase())||c.id===fields.catalog_id).map(c=><option value={c.id} key={c.id}>{c.title} · {c.id}</option>)}</select></Field></div>
    {cursor&&<button onClick={()=>run(async()=>{const r=await query('catalogs',{cursor});setCats(old=>[...old,...r.data]);setCursor(r.next_cursor)})}>Charger plus de catégories</button>}
    <div className="sc-fields"><Field label="État"><select value={fields.status_id||''} onChange={e=>edit('status_id',Number(e.target.value)||null)}><option value="">Choisir</option>{(options?.conditions||[]).map(c=><option key={c.id} value={c.id}>{c.title||c.name}</option>)}</select></Field>
    <Field label="Taille Vinted"><select value={fields.size_id||''} onChange={e=>{const id=Number(e.target.value)||null;edit('size_id',id);edit('size_text',sizes.find(s=>s.id===id)?.title.split('/')[0]?.trim()||'')}}><option value="">Choisir</option>{sizes.map((s,i)=><option key={s.id+'-'+i} value={s.id}>{s.title}</option>)}</select></Field>
    <div className="sc-field"><span>Couleurs (deux maximum)</span><span className="sc-colors">{listingColors.map(c=><label key={c.id}><input type="checkbox" checked={fields.color_ids?.includes(c.id)||false} disabled={!fields.color_ids?.includes(c.id)&&fields.color_ids?.length>=2} onChange={e=>edit('color_ids',e.target.checked?[...(fields.color_ids||[]),c.id]:fields.color_ids.filter(id=>id!==c.id))}/>{c.title}</label>)}</span></div>
    {(options?.attributes||[]).filter(a=>a.required).map(a=><Field key={a.code} label={a.title}><select value={fields.item_attributes?.find(x=>x.code===a.code)?.ids[0]||''} onChange={e=>edit('item_attributes',[...fields.item_attributes.filter(x=>x.code!==a.code),...(e.target.value?[{code:a.code,ids:[Number(e.target.value)]}]:[])])}><option value="">Choisir</option>{(a.options||[]).map(v=><option value={v.id} key={v.id}>{v.title}</option>)}</select></Field>)}
    <Field label="Marque"><input readOnly={quick} value={quick?selectedBrand||'':fields.brand_title||''} onChange={e=>{edit('brand_id',null);edit('brand_title',e.target.value)}}/></Field>
    <Field label="Format du colis"><select value={fields.package_size_id||''} onChange={e=>edit('package_size_id',Number(e.target.value)||null)}><option value="">Choisir</option>{(options?.package_sizes||[]).map(s=><option key={s.id} value={s.id}>{s.title||s.name||s.id}</option>)}</select></Field>
    {!quick&&<Field label="Programmer (facultatif)"><input type="datetime-local" value={date} onChange={e=>{setDate(e.target.value);setApproved(false)}}/></Field>}</div>
    <div className="sc-tools"><button onClick={()=>run(async()=>{await save();setMessage('Brouillon enregistré sur ton site.')})}>Enregistrer le brouillon</button>
    {!quick&&(approved?<button className="sc-primary" onClick={()=>run(async()=>{await act('publish',{id:uid.current,version,schedule:date?new Date(date).toISOString():null});onQueued()})}>Confirmer la mise en file</button>:<button className="sc-primary" onClick={()=>run(validate)}>Vérifier avec Scalency</button>)}</div></>}</fieldset>
    <ListingSeoOutput title={fields.title} description={fields.description}/>
  </article>
}
