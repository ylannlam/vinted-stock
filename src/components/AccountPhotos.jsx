import {useEffect,useRef,useState} from 'react'
import {creativeAccountsRequest,uploadResourceImage} from '../lib/api'
import {validateImage} from '../lib/resources'
import ResourceDialog from './ResourceDialog'
import './AccountPhotos.css'

const read=(view,account)=>creativeAccountsRequest('GET',undefined,'?'+new URLSearchParams({view,...(account?{account}:{})}))
const photosLink=id=>'#comptes/fonds'+(id?'?account='+encodeURIComponent(id):'')
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const ready=row=>row.hasImage&&row.hasPrompt

function PhotoEditor({profile,onClose,onSaved}){
  const [options,setOptions]=useState([]),[loaded,setLoaded]=useState(false),[revision,setRevision]=useState(0)
  const [selected,setSelected]=useState(profile.background_id||''),[label,setLabel]=useState(profile.label)
  const [front,setFront]=useState(profile.customFront),[back,setBack]=useState(profile.customBack)
  const [file,setFile]=useState(null),[preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const lock=useRef(false),pending=useRef(null)
  useEffect(()=>{let alive=true;read('photo-options').then(r=>{if(alive){setOptions(r.backgrounds);setLoaded(true);setError('')}}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[revision])
  useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file])
  const bg=options.find(b=>b.id===selected),shown=file?preview:bg?.image
  function choose(id){setSelected(id);setFile(null);pending.current=null;setError('')}
  function upload(next){
    if(!next)return
    try{validateImage(next);setFile(next);setSelected('');pending.current=null;setError('')}catch(e){setError(e.message)}
  }
  async function save(e){
    e.preventDefault()
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{
      let id=selected||null
      if(file){
        if(!pending.current)pending.current={id:crypto.randomUUID(),title:label.trim()||file.name.replace(/\.[^.]+$/,'').slice(0,120)||'Fond photo'}
        const ticket=pending.current
        if(!ticket.path)ticket.path=(await uploadResourceImage(file,(_method,input)=>creativeAccountsRequest('POST',{...input,action:'photo-upload'}))).path
        const result=await creativeAccountsRequest('POST',{action:'photo-background',id:ticket.id,title:ticket.title,path:ticket.path})
        id=result.id
      }
      const r=await creativeAccountsRequest('PATCH',{action:'photo-save',account:profile.id,version:profile.version,background_id:id,label,prompt_front:front,prompt_back:back})
      onSaved(r.account)
    }catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}
  }
  function promptField(title,value,setValue){
    return <div className="ap-prompt"><label><span>{title}</span><textarea maxLength={50000} rows={4} value={value??''} onChange={e=>setValue(e.target.value)} placeholder="Colle ici les consignes pour ChatGPT"/></label>
      </div>
  }
  return <ResourceDialog title={'Fond et prompts de '+profile.login} onClose={onClose} busy={busy}><form className="ap-editor" onSubmit={save}>
    <fieldset disabled={busy}><div className="ap-editor-top"><div>{shown?<img className="ap-edit-image" src={shown} alt="Aperçu du fond choisi"/>:<div className="ap-edit-empty">Aucun fond choisi</div>}</div>
      <div><label><span>Nom du fond pour ce compte</span><input maxLength={120} value={label} onChange={e=>setLabel(e.target.value)} placeholder={bg?.title||'Ex. Parquet clair'}/></label>
      <label className="ap-upload"><span>Importer un fond</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{upload(e.target.files?.[0]);e.target.value=''}}/><small>JPG, PNG ou WebP · 10 Mo maximum</small></label>
      {(selected||file)&&<button className="ap-link" type="button" onClick={()=>choose('')}>Enlever le fond de cette fiche</button>}</div></div>
      <details className="ap-picker" open={!selected&&!file||undefined}><summary>Choisir parmi les nouveaux fonds {loaded&&'('+options.length+')'}</summary><div className="ap-choices">{options.map(b=><button type="button" key={b.id} aria-pressed={b.id===selected} onClick={()=>choose(b.id)}>{b.image&&<img src={b.image} alt="" loading="lazy"/>}<span>{b.title}</span></button>)}</div>
      {!loaded&&<button type="button" onClick={()=>setRevision(r=>r+1)}>Recharger les fonds</button>}{loaded&&!options.length&&<p>Importe ton premier fond ci-dessus.</p>}</details>
      {promptField('Prompt ChatGPT',front,setFront)}
      <details className="ap-back"><summary>Prompt pour le dos (facultatif)</summary>{promptField('Prompt dos',back,setBack)}</details>
    </fieldset>{error&&<p role="alert" className="ap-error">{error}</p>}
    <div className="ap-actions"><button className="ap-button" type="button" disabled={busy} onClick={onClose}>Annuler</button><button type="submit" className="ap-button ap-primary" disabled={busy||(!loaded&&!!profile.background_id&&!file)}>{busy?'Enregistrement…':'Enregistrer pour '+profile.login}</button></div>
  </form></ResourceDialog>
}

export function PhotoAccountPanel({account,login,onSaved,autoEdit=false}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const [edit,setEdit]=useState(autoEdit),[zoom,setZoom]=useState(false),[message,setMessage]=useState(''),[download,setDownload]=useState(false)
  const alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{let active=true;setError('');read('photos',account).then(r=>{if(active)setData(r.account)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[account,revision])
  if(!data)return <section className="ap-loading" role="status">{error?<>{error} <button onClick={()=>setRevision(r=>r+1)}>Réessayer</button></>:'Chargement du fond de '+(login||'ce compte')+'…'}</section>
  async function copy(value){
    try{await navigator.clipboard.writeText(value);if(alive.current)setMessage('Prompt copié.')}catch{if(alive.current)setMessage('Sélectionne le texte dans « Voir le prompt » pour le copier.')}
  }
  async function getFile(){
    setDownload(true);setError('')
    try{const r=await creativeAccountsRequest('POST',{action:'photo-download',account:data.id,version:data.version,background_id:data.background_id})
      if(!alive.current)return
      const a=document.createElement('a');a.href=r.url;a.download=r.name;document.body.appendChild(a);a.click();a.remove()
    }catch(e){if(alive.current)setError(e.message)}finally{if(alive.current)setDownload(false)}
  }
  function saved(next){setData(next);setEdit(false);setMessage('Fiche photo enregistrée.');setError('');onSaved?.(next)}
  return <section className="ap-panel" aria-label={'Fond photo de '+data.login}>
    {data.image?<button type="button" className="ap-preview" onClick={()=>setZoom(true)} aria-label={'Agrandir le fond de '+data.login}><img src={data.image} alt={data.name||'Fond du compte'}/></button>:<div className="ap-preview ap-empty">Aucun fond</div>}
    <div className="ap-panel-body"><p className="ap-eyebrow">Photos de {data.login}</p><h2>{data.name||'Fond photo du compte'}</h2>
      {!ready(data)&&<p className="ap-missing">{!data.hasImage&&!data.hasPrompt?'Ajoute un fond et un prompt.':!data.hasImage?'Ajoute le fond de ce compte.':'Ajoute le prompt de ce compte.'}</p>}
      <div className="ap-actions">{data.front.trim()&&<button type="button" className="ap-button ap-primary" onClick={()=>copy(data.front)}>Copier le prompt</button>}
        {data.hasImage&&<button type="button" className="ap-button" disabled={download} onClick={getFile}>Télécharger le fond</button>}
        <button type="button" className="ap-link" onClick={()=>{setEdit(true);setError('')}}>{ready(data)?'Modifier la fiche photo':'Configurer la fiche photo'}</button></div>
      {(data.front.trim()||data.back.trim())&&<details><summary>Voir le prompt{data.back.trim()?' et sa version dos':''}</summary>{data.front.trim()&&<pre>{data.front}</pre>}{data.back.trim()&&<><strong>Dos</strong><pre>{data.back}</pre><button type="button" className="ap-button" onClick={()=>copy(data.back)}>Copier le prompt dos</button></>}</details>}
      {message&&<small role="status">{message}</small>}{error&&<p role="alert" className="ap-error">{error} <button type="button" onClick={()=>setRevision(r=>r+1)}>Actualiser</button></p>}
    </div>{edit&&<PhotoEditor profile={data} onClose={()=>setEdit(false)} onSaved={saved}/>}
    {zoom&&<ResourceDialog title={data.name||data.login} onClose={()=>setZoom(false)}><img className="ap-full" src={data.original||data.image} alt={'Fond de '+data.login}/></ResourceDialog>}
  </section>
}

export default function AccountPhotos({account}){
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState(''),[scope,setScope]=useState('linked'),[incomplete,setIncomplete]=useState(false),[revision,setRevision]=useState(0)
  useEffect(()=>{let live=true;setLoading(true);read('photos').then(r=>{if(live){setRows(r.accounts);setError('');if(!r.accounts.some(a=>a.linked))setScope('all')}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[revision])
  const linked=rows.filter(a=>a.linked)
  const shown=rows.filter(r=>(scope==='all'||r.linked)&&(!incomplete||!ready(r))&&normalize([r.login,r.name].join(' ')).includes(normalize(search.trim())))
  return <main className="ap-page"><header><h1>Fonds et prompts</h1><p>Le fond photo et les consignes ChatGPT de chaque compte Vinted.</p></header>
    {account&&<div className="ap-focus"><a className="ap-link" href={photosLink()}>Retour à la grille</a><PhotoAccountPanel key={account} account={account} onSaved={()=>setRevision(r=>r+1)}/></div>}
    <div className="ap-tools"><label><span>Rechercher</span><input type="search" placeholder="Pseudo ou nom du fond" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label><span>Comptes</span><select value={scope} onChange={e=>setScope(e.target.value)}><option value="linked">Reliés à Scalency ({linked.length})</option><option value="all">Tous les comptes ({rows.length})</option></select></label>
      <label className="ap-check"><input type="checkbox" checked={incomplete} onChange={e=>setIncomplete(e.target.checked)}/>À compléter uniquement</label></div>
    {error&&<p role="alert" className="ap-error">{error} <button onClick={()=>setRevision(r=>r+1)}>Réessayer</button></p>}
    {loading&&!rows.length?<p>Chargement des comptes…</p>:<div className="ap-grid">{shown.map(r=><a key={r.id} className={'ap-card'+(account===r.id?' ap-current':'')} href={photosLink(r.id)} onClick={()=>window.scrollTo(0,0)}>
      {r.image?<img src={r.image} alt="" loading="lazy"/>:<div className="ap-empty">Aucun fond</div>}<div className="ap-card-info"><strong>{r.login}</strong><span>{r.name||'Fond à choisir'}</span>{!ready(r)&&<small>À compléter</small>}</div></a>)}</div>}
    {!loading&&!error&&!shown.length&&<p>Aucun compte ne correspond à cette recherche.</p>}
  </main>
}
