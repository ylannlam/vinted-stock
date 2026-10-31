import {useEffect,useRef,useState} from 'react'
import ResourceDialog from './ResourceDialog'
import {filterResources,validateImage} from '../lib/resources'

const defaultRequest=(...args)=>import('../lib/api').then(m=>m.resourcesRequest(...args))
const defaultUpload=(...args)=>import('../lib/api').then(m=>m.uploadResourceImage(...args))
const input='w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-sm focus:outline-teal-600'
const button='inline-flex items-center justify-center gap-2 border rounded-lg px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
const primary='inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40'
const date=value=>new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})

function ResourceImage({url,title,className=''}) {
  const [failed,setFailed]=useState(false)
  useEffect(()=>setFailed(false),[url])
  return url&&!failed?<img src={url} alt={title} className={className} loading="lazy" onError={()=>setFailed(true)}/>:
    <div className={`${className} grid place-items-center bg-stone-100 text-stone-500 text-sm p-6 text-center`}>Image indisponible. Actualise pour réessayer.</div>
}

function ImageField({editing,file,onFile,onRemove,busy}) {
  const [preview,setPreview]=useState('')
  useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file])
  const url=preview||editing.image_url
  return <div className="space-y-3">
    {url&&<ResourceImage url={url} title="Aperçu du fond" className="w-full h-64 rounded-xl object-contain bg-stone-100"/>}
    <label className="block border-2 border-dashed border-gray-300 rounded-xl p-5 text-center cursor-pointer hover:border-teal-500" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy&&e.dataTransfer.files[0])onFile(e.dataTransfer.files[0])}}>
      <span className="block text-sm font-medium">{url?'Remplacer l’image':'Choisir une image de fond'}</span>
      <span className="block text-xs text-gray-500 mt-1">Glisse une image ici ou choisis un fichier · JPG, PNG, WebP · 10 Mo max.</span>
      <input type="file" aria-label="Image de fond" accept="image/jpeg,image/png,image/webp" disabled={busy} className="block mx-auto mt-3 max-w-full text-xs" onChange={e=>{if(e.target.files?.[0])onFile(e.target.files[0]);e.target.value=''}}/>
    </label>
    {(file||editing.image_path)&&<button type="button" disabled={busy} className="text-sm text-rose-700 underline" onClick={onRemove}>Retirer cette image de la fiche</button>}
  </div>
}

export default function ResourcesTab({request=defaultRequest,upload=defaultUpload}) {
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[tab,setTab]=useState('all')
  const [search,setSearch]=useState(''),[category,setCategory]=useState(''),[favorites,setFavorites]=useState(false),[sort,setSort]=useState('recent'),[limit,setLimit]=useState(24)
  const [editing,setEditing]=useState(null),[file,setFile]=useState(null),[dirty,setDirty]=useState(false),[detailId,setDetailId]=useState(null)
  const [download,setDownload]=useState(null),[savingLabel,setSavingLabel]=useState('')
  const alive=useRef(true),operation=useRef(false),uploadCache=useRef(null)
  const active=rows.filter(r=>!r.archived_at),detail=rows.find(r=>r.id===detailId)
  const categories=[...new Set(rows.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'))
  const visible=filterResources(rows,{tab,search,category,favorites,sort})
  async function load() {
    const first=await request(),all=[...first.resources],size=first.page_size||250
    for(let offset=size;offset<first.count;offset+=size){if(!alive.current)return;const next=await request('GET',undefined,`?offset=${offset}`);all.push(...next.resources)}
    if(alive.current)setRows([...new Map(all.map(r=>[r.id,r])).values()])
  }
  async function run(action) {
    if(operation.current)return
    operation.current=true;setBusy(true);setError('');setNotice('')
    try{await action()}catch(e){if(alive.current)setError(e.message||'Impossible de terminer. Réessaie.')}
    finally{operation.current=false;if(alive.current){setBusy(false);setLoading(false);setSavingLabel('')}}
  }
  useEffect(()=>{alive.current=true;run(load);return()=>{alive.current=false}},[request])
  useEffect(()=>setLimit(24),[tab,search,category,favorites,sort])
  useEffect(()=>{if(!dirty)return;const warn=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
  function update(patch){setEditing(e=>({...e,...patch}));setDirty(true)}
  function openEditor(rowOrKind) {
    const value=typeof rowOrKind==='string'?{id:crypto.randomUUID(),kind:rowOrKind,title:'',category:'',content:'',notes:'',image_path:null,image_url:null}:rowOrKind
    setEditing({...value});setFile(null);uploadCache.current=null;setDirty(false);setError('');setNotice('');setDetailId(null);setDownload(null)
  }
  function closeEditor() {
    if(dirty&&!window.confirm('Fermer sans enregistrer les modifications ?'))return
    setEditing(null);setFile(null);uploadCache.current=null;setDirty(false);setError('')
  }
  function chooseFile(value) {
    try{validateImage(value);setFile(value);uploadCache.current=null;setDirty(true);setError('')}
    catch(e){setError(e.message)}
  }
  function merge(row){setRows(old=>[row,...old.filter(r=>r.id!==row.id)])}
  async function save() {
    if(!editing.title.trim())throw Error('Donne un titre à cette ressource.')
    if(editing.kind==='prompt'&&!editing.content.trim())throw Error('Ajoute le texte du prompt.')
    if(editing.kind==='background'&&!file&&!editing.image_path)throw Error('Choisis l’image de fond à enregistrer.')
    let path=editing.image_path
    if(file) {
      setSavingLabel('Envoi de l’image…')
      if(uploadCache.current?.file===file)path=uploadCache.current.path
      else {const sent=await upload(file,request);path=sent.path;uploadCache.current={file,path}}
    }
    setSavingLabel('Enregistrement…')
    const result=await request('POST',{action:'save',id:editing.id,version:editing.version,kind:editing.kind,title:editing.title,category:editing.category,content:editing.content,notes:editing.notes,image_path:path||null})
    merge(result.resource);setEditing(null);setFile(null);uploadCache.current=null;setDirty(false);setNotice('Enregistré dans ta bibliothèque.');setTab('all');setSearch('');setCategory('');setFavorites(false)
  }
  async function change(row,action,values) {
    const result=await request('PATCH',{id:row.id,version:row.version,action,...values});merge(result.resource)
    if(action==='archive'){setDetailId(null);setNotice(values.archived?'Ressource archivée. Tu peux la restaurer dans Archives.':'Ressource restaurée dans la bibliothèque.')}
  }
  async function copy(row) {
    try{await navigator.clipboard.writeText(row.content);setNotice('Prompt copié.');setError('')}
    catch{setDetailId(row.id);setError('La copie automatique est indisponible. Sélectionne le texte du prompt ci-dessous pour le copier.')}
  }
  async function prepareDownload(row) {
    const result=await request('POST',{action:'download',id:row.id})
    setDownload({id:row.id,url:result.url});setDetailId(row.id)
    const link=document.createElement('a');link.href=result.url;link.download='';link.rel='noreferrer';document.body.appendChild(link);link.click();link.remove()
    setNotice('Téléchargement demandé. Le lien reste disponible si ton navigateur ne l’a pas démarré.')
  }
  return <main className="max-w-screen-2xl mx-auto p-4 sm:p-6 space-y-5 text-slate-800">
    <header className="flex flex-wrap justify-between items-center gap-4"><div><p className="text-xs font-semibold tracking-widest text-teal-700 uppercase mb-1">Ton atelier photo</p><h1 className="text-2xl font-bold">Prompts & fonds</h1><p className="text-sm text-gray-500 mt-1">Tes fonds et les prompts pour y placer tes articles, au même endroit.</p></div><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>run(load)}>Actualiser</button><button className={button} disabled={busy} onClick={()=>openEditor('prompt')}>+ Nouveau prompt</button><button className={primary} disabled={busy} onClick={()=>openEditor('background')}>+ Ajouter un fond</button></div></header>
    <div className="rounded-2xl bg-teal-50 border border-teal-100 p-5 flex flex-wrap justify-between gap-4"><p className="text-sm text-teal-900 max-w-2xl">Garde le fond, le prompt et tes consignes ensemble. Quand tu prépares une photo, télécharge le fond et copie le prompt dans ton outil d’image avec la photo de l’article.</p><div className="flex items-center gap-6 text-sm text-teal-900"><span><strong className="text-xl mr-1">{active.filter(r=>r.kind==='background').length}</strong> fonds</span><span><strong className="text-xl mr-1">{active.filter(r=>r.kind==='prompt').length}</strong> prompts</span></div></div>
    {!editing&&!detail&&error&&<p role="alert" className="rounded-xl bg-red-50 border border-red-200 text-red-800 p-3 text-sm">{error}</p>}
    {!detail&&notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b"><div className="flex overflow-x-auto">{[['all','Tout'],['background','Fonds'],['prompt','Prompts'],['archived','Archives']].map(([key,label])=><button key={key} onClick={()=>setTab(key)} aria-pressed={tab===key} className={`px-4 py-3 text-sm border-b-2 ${tab===key?'border-teal-700 font-semibold text-teal-800':'border-transparent text-gray-500'}`}>{label}{key==='archived'&&rows.some(r=>r.archived_at)?` (${rows.filter(r=>r.archived_at).length})`:''}</button>)}</div><button aria-pressed={favorites} className={`${button} mb-2 ${favorites?'!bg-amber-50 !border-amber-300 !text-amber-900':''}`} onClick={()=>setFavorites(!favorites)}>{favorites?'★':'☆'} Favoris</button></div>
    <div className="flex flex-wrap gap-3"><input className={`${input} flex-1 min-w-48`} aria-label="Rechercher un fond ou un prompt" placeholder="Rechercher un titre, un prompt, une catégorie…" value={search} onChange={e=>setSearch(e.target.value)}/><select className={`${input} sm:!w-auto`} aria-label="Catégorie" value={category} onChange={e=>setCategory(e.target.value)}><option value="">Toutes les catégories</option>{categories.map(c=><option key={c}>{c}</option>)}</select><select className={`${input} sm:!w-auto`} aria-label="Trier la bibliothèque" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Modifiés récemment</option><option value="name">Nom A → Z</option><option value="favorites">Favoris en premier</option></select></div>
    {loading?<p role="status" className="py-12 text-center text-gray-500">Chargement de ta bibliothèque…</p>:<>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">{visible.slice(0,limit).map(row=><article key={row.id} className="bg-white border rounded-2xl overflow-hidden flex flex-col">
        <button className="w-full text-left relative" onClick={()=>{setDetailId(row.id);setError('');setDownload(null)}} aria-label={`Ouvrir ${row.title}`}>
          {row.image_path?<ResourceImage url={row.image_url} title={row.title} className="w-full h-52 object-cover bg-stone-100"/>:<div className="h-52 p-6 bg-gradient-to-br from-teal-50 to-slate-100 overflow-hidden"><span className="text-4xl leading-none text-teal-600" aria-hidden="true">“</span><p className="text-sm leading-relaxed text-slate-700 line-clamp-5 whitespace-pre-wrap">{row.content}</p></div>}
          <span className="absolute top-3 left-3 bg-white/95 border rounded-full px-2.5 py-1 text-xs">{row.kind==='background'?'Fond':'Prompt'}</span>
        </button>
        <div className="p-4 flex flex-col flex-1 gap-3"><div className="flex justify-between items-start gap-3"><div className="min-w-0"><h2 className="font-semibold break-words">{row.title}</h2><p className="text-xs text-gray-500 mt-1">{row.category||'Sans catégorie'} · {date(row.updated_at)}</p></div><button className="text-xl text-amber-600 shrink-0 px-1" aria-label={`${row.favorite?'Retirer des':'Ajouter aux'} favoris : ${row.title}`} aria-pressed={row.favorite} disabled={busy} onClick={()=>run(()=>change(row,'favorite',{favorite:!row.favorite}))}>{row.favorite?'★':'☆'}</button></div>
          <p className="text-xs text-gray-500">{row.content?'Prompt prêt à copier':row.kind==='background'?'Ajoute le prompt pour placer un article sur ce fond.':'Aucun prompt associé'}</p>
          <div className="flex flex-wrap gap-2 mt-auto">{row.content&&<button className={button} onClick={()=>copy(row)}>Copier le prompt</button>}<button className={button} disabled={busy} onClick={()=>openEditor(row)}>Modifier</button>{row.archived_at&&<button className={`${button} text-teal-800`} disabled={busy} onClick={()=>run(()=>change(row,'archive',{archived:false}))}>Restaurer</button>}</div>
        </div>
      </article>)}</div>
      {!visible.length&&<div className="rounded-2xl border border-dashed bg-white text-center p-10 space-y-3"><p className="font-medium">{search||category||favorites?'Aucune ressource ne correspond.':tab==='archived'?'Aucune ressource archivée.':'Ta bibliothèque est prête à accueillir tes idées.'}</p><p className="text-sm text-gray-500">{tab==='archived'?'Les ressources archivées restent disponibles ici.':'Ajoute un fond avec son prompt, ou sauvegarde un prompt à réutiliser.'}</p></div>}
      <div className="flex items-center justify-between text-xs text-gray-500"><span>{visible.length} ressource{visible.length!==1?'s':''}</span>{visible.length>limit&&<button className={button} onClick={()=>setLimit(n=>n+24)}>Afficher davantage</button>}</div>
    </>}
    {editing&&<ResourceDialog title={editing.version?'Modifier la ressource':editing.kind==='background'?'Ajouter un fond':'Nouveau prompt'} onClose={closeEditor} busy={busy}><form className="space-y-5" onSubmit={e=>{e.preventDefault();run(save)}}>
      <div className="grid md:grid-cols-2 gap-5"><div className="space-y-4"><label className="block text-sm">Titre<input autoFocus className={`${input} mt-1`} required maxLength={120} value={editing.title} disabled={busy} placeholder={editing.kind==='background'?'Ex. Mur crème · lumière douce':'Ex. Robe sur mannequin'} onChange={e=>update({title:e.target.value})}/></label>
        <label className="block text-sm">Catégorie <span className="text-gray-400">· facultatif</span><input className={`${input} mt-1`} list="resource-categories" maxLength={60} value={editing.category} disabled={busy} placeholder="Robes, mannequin, extérieur…" onChange={e=>update({category:e.target.value})}/><datalist id="resource-categories">{categories.map(c=><option value={c} key={c}/>)}</datalist></label>
        <p className="text-xs text-gray-500">{editing.kind==='background'?'Enregistre le fond et, si tu en as un, le prompt à utiliser avec.':'Enregistre ton prompt. Tu peux aussi lui joindre un fond de référence.'}</p>
        <ImageField editing={editing} file={file} busy={busy} onFile={chooseFile} onRemove={()=>{setFile(null);uploadCache.current=null;update({image_path:null,image_url:null})}}/>
      </div><div className="space-y-4"><label className="block text-sm font-medium">Prompt pour placer l’article sur le fond<textarea className={`${input} mt-2 min-h-72 leading-relaxed`} required={editing.kind==='prompt'} maxLength={50000} value={editing.content} disabled={busy} placeholder="Colle ici tes instructions : position de l’article, proportions, lumière, ombres, détails à conserver…" onChange={e=>update({content:e.target.value})}/></label>
        <p className="text-xs text-gray-500">Ce texte sera conservé tel quel, avec ses retours à la ligne.</p><label className="block text-sm">Tes notes <span className="text-gray-400">· facultatif</span><textarea className={`${input} mt-1 min-h-24`} maxLength={3000} value={editing.notes} disabled={busy} placeholder="Outil utilisé, réglages, articles adaptés à ce fond…" onChange={e=>update({notes:e.target.value})}/></label></div></div>
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <footer className="flex flex-wrap items-center gap-3 border-t pt-4"><button className={primary} disabled={busy}>{busy?savingLabel||'Enregistrement…':'Enregistrer'}</button><button type="button" className={button} disabled={busy} onClick={closeEditor}>Annuler</button><span className="text-xs text-gray-500">Enregistré sur ton compte, accessible depuis ton PC ou ton téléphone.</span></footer>
    </form></ResourceDialog>}
    {detail&&!editing&&<ResourceDialog title={detail.title} onClose={()=>{setDetailId(null);setError('');setDownload(null)}} busy={busy}><div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><span>{detail.kind==='background'?'Fond':'Prompt'} · {detail.category||'Sans catégorie'}</span>{detail.archived_at&&<span className="px-2 py-1 rounded-full bg-amber-50 text-amber-900">Archivé</span>}<span>Modifié le {date(detail.updated_at)}</span></div>
      {detail.image_path&&<ResourceImage url={detail.image_url} title={detail.title} className="w-full max-h-96 object-contain rounded-xl bg-stone-100"/>}
      {detail.content?<div><div className="flex justify-between items-center gap-3 mb-2"><h3 className="font-medium text-sm">Prompt pour l’article</h3><button className={button} onClick={()=>copy(detail)}>Copier le prompt</button></div><textarea aria-label="Prompt enregistré" readOnly className={`${input} min-h-48 leading-relaxed bg-gray-50`} value={detail.content} onFocus={e=>e.target.select()}/></div>:<p className="text-sm text-gray-500">Aucun prompt associé à ce fond pour le moment. Clique sur Modifier pour en ajouter un.</p>}
      {detail.notes&&<div className="rounded-xl bg-gray-50 p-4"><h3 className="text-sm font-medium mb-2">Tes notes</h3><p className="text-sm text-gray-600 whitespace-pre-wrap break-words">{detail.notes}</p></div>}
      {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
      <div className="flex flex-wrap gap-2 border-t pt-4"><button className={primary} disabled={busy} onClick={()=>openEditor(detail)}>Modifier</button>{detail.image_path&&(download?.id===detail.id?<a className={button} href={download.url} download target="_blank" rel="noreferrer">Télécharger l’image</a>:<button className={button} disabled={busy} onClick={()=>run(()=>prepareDownload(detail))}>Télécharger l’image</button>)}<button className={button} disabled={busy} onClick={()=>run(()=>change(detail,'favorite',{favorite:!detail.favorite}))}>{detail.favorite?'★ Retirer des favoris':'☆ Ajouter aux favoris'}</button><button className={`${button} ml-auto text-gray-600`} disabled={busy} onClick={()=>run(()=>change(detail,'archive',{archived:!detail.archived_at}))}>{detail.archived_at?'Restaurer':'Archiver'}</button></div>
    </div></ResourceDialog>}
  </main>
}
