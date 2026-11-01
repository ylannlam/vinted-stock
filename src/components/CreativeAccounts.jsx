import {useEffect,useRef,useState} from 'react'
import ResourceDialog from './ResourceDialog'
import {directionPrompts,filterCreativeAccounts} from '../lib/creativeAccounts'

const defaultRequest=(...args)=>import('../lib/api').then(m=>m.creativeAccountsRequest(...args))
const input='w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-sm focus:outline-teal-600'
const button='inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
const primary=`${button} !bg-teal-700 !text-white !border-teal-700 hover:!bg-teal-800`

export default function CreativeAccounts({resources,request=defaultRequest,onLibrary,onDownload}) {
 const [accounts,setAccounts]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState('')
 const [selection,setSelection]=useState(null),[selectionSearch,setSelectionSearch]=useState(''),[selectionFilter,setSelectionFilter]=useState('all')
 const [editing,setEditing]=useState(null),[dirty,setDirty]=useState(false)
 const operation=useRef(false),alive=useRef(true)
 const backgrounds=resources.filter(r=>r.kind==='background'&&!r.archived_at)
 const visible=filterCreativeAccounts(accounts,search)
 async function load() {
  const first=await request(),all=[...first.accounts],size=first.page_size||250
  for(let offset=size;offset<first.count;offset+=size){const next=await request('GET',undefined,`?offset=${offset}`);all.push(...next.accounts)}
  if(alive.current)setAccounts(all)
  return all
 }
 async function run(action){
  if(operation.current)return
  operation.current=true;setBusy(true);setError('');setNotice('')
  try{await action()}catch(e){if(alive.current)setError(e.message||'Impossible de terminer. Réessaie.')}
  finally{operation.current=false;if(alive.current){setBusy(false);setLoading(false)}}
 }
 useEffect(()=>{alive.current=true;run(async()=>{const rows=await load();if(alive.current&&!rows.length)await sync()});return()=>{alive.current=false}},[request])
 useEffect(()=>{
  if(!dirty)return
  const warn=e=>{e.preventDefault();e.returnValue=''}
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)
 },[dirty])
 function openSelection(rows=accounts){setSelection(rows.map(a=>({...a})));setSelectionSearch('');setSelectionFilter('all');setDirty(false);setError('')}
 function closeSelection(){if(dirty&&!window.confirm('Fermer sans enregistrer le choix des comptes ?'))return;setSelection(null);setDirty(false);setError('')}
 function changeSelection(ids,enabled){setSelection(old=>old.map(a=>ids.includes(a.id)?{...a,enabled}:a));setDirty(true)}
 async function saveSelection(){
  const original=new Map(accounts.map(a=>[a.id,a]))
  const changes=selection.filter(a=>a.enabled!==original.get(a.id)?.enabled).map(a=>({id:a.id,version:a.version,enabled:a.enabled}))
  await request('PATCH',{action:'select',changes})
  // Reflect a confirmed save even if the following refresh is temporarily unavailable.
  setAccounts(old=>old.map(a=>{const change=changes.find(c=>c.id===a.id);return change?{...a,enabled:change.enabled,version:a.version+1}:a}))
  setSelection(null);setDirty(false);setNotice('Choix des comptes enregistré. Les comptes mis de côté restent disponibles.')
 }
 async function sync(){await request('POST',{action:'sync'});const rows=await load();if(!alive.current)return;openSelection(rows);setNotice(`${rows.filter(a=>a.source_present).length} comptes récupérés depuis Dotb.`)}
 function edit(account){setEditing({...account});setDirty(false);setError('');setNotice('')}
 function update(patch){setEditing(old=>({...old,...patch}));setDirty(true)}
 function closeEditor(){if(dirty&&!window.confirm('Fermer sans enregistrer cette DA ?'))return;setEditing(null);setDirty(false);setError('')}
 async function saveDirection(){
  const result=await request('PATCH',{action:'save',id:editing.id,version:editing.version,background_id:editing.background_id||null,prompt_front:editing.prompt_front,prompt_back:editing.prompt_back,notes:editing.notes})
  setAccounts(old=>old.map(a=>a.id===result.account.id?result.account:a));setEditing(null);setDirty(false);setNotice('Direction artistique enregistrée pour ce compte.')
 }
 async function copy(text,label){try{await navigator.clipboard.writeText(text);setNotice(`${label} copié.`);setError('')}catch{setError('Copie automatique indisponible : sélectionne le texte affiché pour le copier.')}}
 function setAside(account){
  if(!window.confirm(`Mettre « ${account.login} » de côté ? Sa DA sera conservée et tu pourras le recocher plus tard.`))return
  run(async()=>{await request('PATCH',{action:'select',changes:[{id:account.id,version:account.version,enabled:false}]});setAccounts(old=>old.map(a=>a.id===account.id?{...a,enabled:false,version:a.version+1}:a));setNotice('Compte mis de côté. Sa DA est conservée.')})
 }
 const selectedBackground=resources.find(r=>r.id===editing?.background_id)
 const selectorRows=selection?filterCreativeAccounts(selection,selectionSearch,selectionFilter):[]
 return <section className="space-y-5" aria-label="Directions artistiques par compte">
  <div className="flex flex-wrap justify-between items-start gap-4">
   <div><h2 className="text-xl font-semibold">Une DA par compte</h2><p className="text-sm text-gray-500 mt-1">Choisis tes comptes, puis retrouve leur fond et leurs prompts avant / arrière.</p></div>
   <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>run(load)}>Actualiser les DA</button><button className={button} disabled={busy||loading} onClick={()=>openSelection()}>Choisir mes comptes</button><button className={primary} disabled={busy} onClick={()=>run(sync)}>{busy?'Chargement…':'Récupérer depuis Dotb'}</button></div>
  </div>
  <p className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-900">Seuls les comptes que tu coches apparaissent ici. Laisse les comptes bannis ou inutilisés de côté. Dotb ne fournit pas leur statut de bannissement ; tes choix sont conservés à chaque récupération.</p>
  {!selection&&!editing&&error&&<p role="alert" className="rounded-lg bg-red-50 text-red-800 p-3 text-sm">{error}</p>}
  {!selection&&!editing&&notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
  <div className="flex flex-wrap gap-3 items-center"><input className={`${input} max-w-lg`} aria-label="Rechercher dans mes DA" placeholder="Rechercher un compte sélectionné…" value={search} onChange={e=>setSearch(e.target.value)}/><span className="text-xs text-gray-500">{accounts.filter(a=>a.enabled).length} sélectionnés · {accounts.filter(a=>!a.enabled).length} de côté</span></div>
  {loading?<p role="status" className="py-10 text-center text-gray-500">Chargement des comptes…</p>:<div className="grid lg:grid-cols-2 gap-5">{visible.map(account=>{
   const background=resources.find(r=>r.id===account.background_id),prompts=directionPrompts(account,background)
   return <article key={account.id} className="rounded-2xl border bg-white p-4 space-y-4">
    <header className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="font-semibold break-all">{account.login}</h3><p className="text-xs text-gray-500">{account.country||'Compte Dotb'}{!account.source_present?' · Absent de la dernière liste Dotb':''}</p></div><button className={button} disabled={busy} onClick={()=>edit(account)}>Configurer la DA</button></header>
    <div className="grid sm:grid-cols-[150px_1fr] gap-4">
     <div>{background?.image_url?<img src={background.image_url} alt={`Fond de ${account.login}`} className="w-full h-52 object-contain bg-stone-100 rounded-lg"/>:<div className="h-40 grid place-items-center bg-stone-100 rounded-lg text-xs text-gray-500 text-center p-3">{background?'Aperçu indisponible':'Aucun fond associé'}</div>}<p className="text-xs font-medium mt-2 break-words">{background?.title||'Choisis un fond dans Configurer la DA'}</p>{background?.archived_at&&<p className="text-xs text-amber-700">Fond archivé : choisis un autre fond.</p>}{background?.image_path&&<button className={`${button} mt-2 !text-xs w-full`} disabled={busy} onClick={()=>onDownload(background)}>Télécharger le fond</button>}</div>
     <div className="space-y-3">{[['front','Avant','prompt_front'],['back','Arrière','prompt_back']].map(([side,label,field])=><div key={side} className="border rounded-lg p-3"><div className="flex justify-between items-center gap-2"><span className="text-sm font-medium">{label}</span><button className={`${button} !text-xs`} disabled={!prompts[side].trim()} onClick={()=>copy(prompts[side],`Prompt ${label.toLowerCase()}`)}>Copier · {label}</button></div><p className="text-[11px] text-gray-500 mt-1">{account[field]===null?'Repris du fond':'Personnalisé pour ce compte'}</p><textarea aria-label={`Prompt ${label.toLowerCase()} de ${account.login}`} className={`${input} mt-2 h-24 !text-xs`} readOnly value={prompts[side]} placeholder="À compléter dans la DA ou dans le fond." onFocus={e=>e.target.select()}/></div>)}</div>
    </div>
    {account.notes&&<p className="text-sm text-gray-600 whitespace-pre-wrap break-words">{account.notes}</p>}
    <button className="text-xs text-gray-500 underline" disabled={busy} onClick={()=>setAside(account)}>Mettre ce compte de côté</button>
   </article>
  })}</div>}
  {!loading&&!visible.length&&<div className="text-center rounded-2xl border border-dashed p-8 space-y-3"><p className="text-sm text-gray-500">{search?'Aucun compte sélectionné ne correspond.':accounts.length?'Choisis les comptes que tu veux utiliser pour préparer tes photos.':'Récupère tes comptes Dotb, puis coche uniquement ceux que tu veux utiliser.'}</p><button className={primary} disabled={busy} onClick={()=>accounts.length?openSelection():run(sync)}>{accounts.length?'Choisir mes comptes':'Récupérer mes comptes Dotb'}</button></div>}
  {selection&&<ResourceDialog title="Choisir mes comptes" onClose={closeSelection} busy={busy}>
   <div className="space-y-4"><p className="text-sm text-gray-600">Coche les comptes à afficher dans les DA. Décocher un compte conserve ses réglages et ne supprime rien dans Dotb.</p>
    <div className="flex flex-wrap gap-2"><input className={`${input} flex-1 min-w-44`} aria-label="Rechercher un compte Dotb" placeholder="Pseudo ou pays…" value={selectionSearch} onChange={e=>setSelectionSearch(e.target.value)}/><select className={`${input} sm:!w-auto`} aria-label="Filtrer le choix des comptes" value={selectionFilter} onChange={e=>setSelectionFilter(e.target.value)}><option value="all">Tous les comptes</option><option value="selected">Cochés</option><option value="aside">De côté</option></select></div>
    <div className="flex flex-wrap gap-3 items-center text-xs"><span>{selection.filter(a=>a.enabled).length} cochés · {selectorRows.length} affichés</span><button className="text-teal-700 underline" disabled={busy} onClick={()=>changeSelection(selectorRows.map(a=>a.id),true)}>Cocher les comptes affichés</button><button className="text-gray-600 underline" disabled={busy} onClick={()=>changeSelection(selectorRows.map(a=>a.id),false)}>Décocher les comptes affichés</button></div>
    <div className="max-h-[50vh] overflow-y-auto rounded-xl border divide-y">{selectorRows.map(a=><label key={a.id} className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-teal-700" disabled={busy} checked={a.enabled} onChange={e=>changeSelection([a.id],e.target.checked)}/><span className="min-w-0"><span className="text-sm font-medium break-all">{a.login}</span><span className="block text-xs text-gray-500">{a.country||'Compte Dotb'}{!a.source_present?' · Absent de la dernière récupération':''}</span></span><span className="ml-auto text-xs text-gray-500">{a.enabled?'Retenu':'De côté'}</span></label>)}{!selectorRows.length&&<p className="p-6 text-sm text-gray-500">Aucun compte à afficher.</p>}</div>
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}{error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
    <div className="flex gap-3"><button className={primary} disabled={busy} onClick={()=>run(saveSelection)}>Enregistrer la sélection</button><button className={button} disabled={busy} onClick={closeSelection}>Annuler</button></div>
   </div>
  </ResourceDialog>}
  {editing&&<ResourceDialog title={`DA · ${editing.login}`} onClose={closeEditor} busy={busy}><form className="space-y-5" onSubmit={e=>{e.preventDefault();run(saveDirection)}}>
   <div className="grid md:grid-cols-[240px_1fr] gap-5"><div className="space-y-3"><label className="block text-sm font-medium">Fond associé<select className={`${input} mt-2`} disabled={busy} value={editing.background_id||''} onChange={e=>update({background_id:e.target.value||null})}><option value="">Aucun fond</option>{backgrounds.map(bg=><option key={bg.id} value={bg.id}>{bg.title}</option>)}{editing.background_id&&!backgrounds.some(b=>b.id===editing.background_id)&&<option value={editing.background_id}>Fond indisponible · à remplacer</option>}</select></label>
    {selectedBackground?.image_url&&<img src={selectedBackground.image_url} alt="Aperçu du fond associé" className="w-full h-72 object-contain bg-stone-100 rounded-xl"/>}<p className="text-xs text-gray-500">Les prompts du fond sont repris automatiquement, sauf si tu les personnalises ci-contre.</p><button type="button" className="text-xs text-teal-700 underline" disabled={busy} onClick={()=>{if(dirty&&!window.confirm('Quitter sans enregistrer cette DA pour ouvrir la bibliothèque ?'))return;setEditing(null);setDirty(false);onLibrary()}}>Gérer les fonds dans la bibliothèque</button></div>
    <div className="space-y-4">{[['prompt_front','content','Avant'],['prompt_back','content_back','Arrière']].map(([field,source,label])=><div key={field} className="rounded-xl border bg-gray-50 p-3"><h3 className="text-sm font-semibold">Prompt {label.toLowerCase()}</h3><label className="flex gap-2 items-center text-xs mt-2"><input type="checkbox" checked={editing[field]!==null} disabled={busy} onChange={e=>update({[field]:e.target.checked?selectedBackground?.[source]||'':null})}/>Personnaliser le prompt {label.toLowerCase()} pour ce compte</label><textarea aria-label={`Texte du prompt ${label.toLowerCase()}`} className={`${input} mt-3 min-h-36`} maxLength={50000} disabled={busy} readOnly={editing[field]===null} value={editing[field]??selectedBackground?.[source]??''} placeholder={editing[field]===null?'Aucun prompt dans le fond. Coche Personnaliser pour en écrire un.':'Écris les consignes propres à ce compte…'} onChange={e=>update({[field]:e.target.value})}/><p className="mt-1 text-xs text-gray-500">{editing[field]===null?'Lié au prompt du fond : ses modifications seront reprises ici.':'Ce texte reste propre à ce compte, sans modifier le fond.'}</p></div>)}</div>
   </div>
   <label className="block text-sm">Consignes de la DA<textarea className={`${input} mt-2 min-h-24`} value={editing.notes} maxLength={3000} disabled={busy} placeholder="Ambiance, couleurs, cadrage, accessoires…" onChange={e=>update({notes:e.target.value})}/></label>
   {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
   <div className="flex gap-3 border-t pt-4"><button className={primary} disabled={busy}>Enregistrer la DA</button><button type="button" className={button} disabled={busy} onClick={closeEditor}>Annuler</button></div>
  </form></ResourceDialog>}
 </section>
}
