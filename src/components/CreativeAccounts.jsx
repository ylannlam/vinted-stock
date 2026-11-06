import {useEffect,useMemo,useRef,useState} from 'react'
import ResourceDialog from './ResourceDialog'
import {accountTone,backgroundUsage,directionPrompts,filterCreativeAccounts,sortAtelierAccounts} from '../lib/creativeAccounts'
import {thumbOf} from '../lib/resourceThumbs'
import {directionReady} from '../lib/workspace'

const defaultRequest=(...args)=>import('../lib/api').then(m=>m.creativeAccountsRequest(...args))
const defaultStats=()=>import('../lib/api').then(m=>m.listingStudioRequest('GET',undefined,'action=picker'))
const input='w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-sm focus:outline-teal-600'
const button='inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40'
const primary='inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40'
const SELECTED_KEY='vs-atelier-account'
const FILTERS=[['all','Tous'],['ready','Prêts'],['incomplete','DA à compléter'],['blocked','Bloqués']]
const draftOf=a=>a?{background_id:a.background_id||null,prompt_front:a.prompt_front??null,prompt_back:a.prompt_back??null,notes:a.notes||''}:null
const sameDraft=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const readStored=()=>{try{return localStorage.getItem(SELECTED_KEY)}catch{return null}}
const store=id=>{try{localStorage.setItem(SELECTED_KEY,id)}catch{/* Préférence facultative. */}}

// Copie une image dans le presse-papiers (en PNG, seul format accepté partout) pour la coller dans l’outil IA.
function copyImage(url){
 const png=fetch(url,{mode:'cors'}).then(r=>{if(!r.ok)throw Error('image');return r.blob()}).then(createImageBitmap).then(bitmap=>new Promise((ok,ko)=>{
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
  canvas.getContext('2d').drawImage(bitmap,0,0);canvas.toBlob(b=>b?ok(b):ko(Error('png')),'image/png')
 }))
 return navigator.clipboard.write([new ClipboardItem({'image/png':png})])
}

function missingParts(background,prompts){
 return [!background&&'le fond',!prompts.front.trim()&&'le prompt avant',!prompts.back.trim()&&'le prompt arrière'].filter(Boolean)
}

function Thumb({background,className}){
 const url=thumbOf(background)
 return url?<img src={url} alt="" loading="lazy" className={`${className} object-cover bg-stone-100`}/>:<span className={`${className} bg-stone-100 grid place-items-center text-[10px] text-stone-400`}>—</span>
}

function AccountRow({account,background,stat,ready,active,onSelect}){
 const tone=accountTone(stat?.health)
 return <button type="button" role="option" aria-selected={active} onClick={onSelect} className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl transition-colors ${active?'bg-teal-50 ring-1 ring-teal-600':'hover:bg-slate-50'} ${tone.key==='blocked'?'opacity-80':''}`}>
  <Thumb background={background} className="h-12 w-9 rounded-md shrink-0"/>
  <span className="min-w-0 flex-1">
   <span className="block text-sm font-semibold truncate">{account.login}</span>
   <span className="flex items-center gap-1.5 text-xs text-slate-500 truncate"><span className={`h-2 w-2 rounded-full shrink-0 ${tone.dot}`}/>{tone.label}</span>
  </span>
  <span className="flex flex-col items-end gap-1 shrink-0">
   {stat?.today>0&&<span className="rounded-full bg-emerald-50 text-emerald-800 px-2 py-0.5 text-[11px] font-medium">{stat.today} auj.</span>}
   {!ready&&<span className="rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-[11px]">DA à faire</span>}
  </span>
 </button>
}

function PromptBlock({label,linked,value,hasBackground,copied,busy,onCopy,onCustomize,onReset,onChange}){
 return <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
  <div className="flex flex-wrap items-center gap-2">
   <h4 className="text-sm font-semibold">Prompt {label.toLowerCase()}</h4>
   <span className={`text-[11px] rounded-full px-2 py-0.5 ${linked?'bg-white border text-slate-500':'bg-violet-50 text-violet-800'}`}>{linked?'repris du fond':'propre à ce compte'}</span>
   <button type="button" className={`${primary} ml-auto !py-1.5`} disabled={!value.trim()} onClick={onCopy}>{copied?'Copié ✓':`Copier l’${label.toLowerCase()}`}</button>
  </div>
  {linked?<pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-white border border-slate-200 p-3 font-sans text-xs leading-relaxed text-slate-700">{value.trim()?value:<span className="text-slate-400">{hasBackground?'Le fond n’a pas de prompt '+label.toLowerCase()+'.':'Choisis un fond ou écris un prompt pour ce compte.'}</span>}</pre>
   :<textarea aria-label={`Prompt ${label.toLowerCase()} de ce compte`} className={`${input} min-h-40 text-xs leading-relaxed`} maxLength={50000} disabled={busy} value={value} placeholder="Consignes propres à ce compte…" onChange={e=>onChange(e.target.value)}/>}
  <div className="text-xs">{linked?<button type="button" className="text-teal-700 hover:underline" disabled={busy} onClick={onCustomize}>Personnaliser pour ce compte</button>
   :hasBackground&&<button type="button" className="text-slate-500 hover:underline" disabled={busy} onClick={onReset}>Revenir au prompt du fond</button>}</div>
 </div>
}

function BackgroundPicker({backgrounds,current,usage,onPick,onClose,onLibrary}){
 const [search,setSearch]=useState('')
 const fold=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
 const shown=backgrounds.filter(b=>fold(`${b.title} ${b.category}`).includes(fold(search.trim())))
 return <ResourceDialog title="Choisir un fond" onClose={onClose}>
  <div className="space-y-4">
   <div className="flex flex-wrap gap-2"><input className={`${input} flex-1 min-w-48`} aria-label="Rechercher un fond" placeholder="Rechercher un fond…" value={search} onChange={e=>setSearch(e.target.value)}/><button type="button" className={button} onClick={onLibrary}>+ Ajouter un fond</button></div>
   <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto p-1">
    {shown.map(b=><button type="button" key={b.id} onClick={()=>onPick(b.id)} className={`text-left rounded-xl border bg-white overflow-hidden hover:ring-2 hover:ring-teal-500 ${b.id===current?'ring-2 ring-teal-700':''}`}>
     <Thumb background={b} className="w-full aspect-[3/4]"/>
     <span className="block px-2 pt-2 text-sm font-medium truncate">{b.title}</span>
     <span className="block px-2 pb-2 text-[11px] text-slate-500 truncate">{b.id===current?'Fond actuel':usage.get(b.id)?.length?`Utilisé par ${usage.get(b.id).length} compte${usage.get(b.id).length>1?'s':''}`:'Pas encore utilisé'}</span>
    </button>)}
    {current&&<button type="button" onClick={()=>onPick(null)} className="rounded-xl border border-dashed text-sm text-slate-500 hover:bg-slate-50 aspect-[3/4]">Retirer le fond</button>}
   </div>
   {!shown.length&&<p className="text-sm text-slate-500 text-center py-6">{backgrounds.length?'Aucun fond ne correspond.':'Aucun fond pour l’instant. Ajoute-en un dans l’onglet Fonds.'}</p>}
  </div>
 </ResourceDialog>
}

export default function CreativeAccounts({resources,request=defaultRequest,statsRequest=defaultStats,onLibrary,onDownload,onAccounts}) {
 const [stats,setStats]=useState({}),[filter,setFilter]=useState('all')
 const [accounts,setAccounts]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
 const [error,setError]=useState(''),[toast,setToast]=useState(''),[search,setSearch]=useState('')
 const [selection,setSelection]=useState(null),[selectionSearch,setSelectionSearch]=useState(''),[selectionFilter,setSelectionFilter]=useState('all'),[selectionDirty,setSelectionDirty]=useState(false)
 const [selectedId,setSelectedId]=useState(readStored),[draft,setDraft]=useState(null),[mobileDetail,setMobileDetail]=useState(false)
 const [picker,setPicker]=useState(false),[copied,setCopied]=useState('')
 const operation=useRef(false),alive=useRef(true),listRef=useRef(null)
 const backgrounds=useMemo(()=>resources.filter(r=>r.kind==='background'&&!r.archived_at),[resources])
 const byId=id=>resources.find(r=>r.id===id)
 const usage=useMemo(()=>backgroundUsage(accounts),[accounts])

 const info=account=>{const background=byId(account.background_id);return {background,ready:directionReady(account,background),tone:accountTone(stats[account.id]?.health)}}
 function matches(account,key){
  const {ready,tone}=info(account)
  if(key==='ready')return ready&&tone.key!=='blocked'
  if(key==='incomplete')return !ready
  if(key==='blocked')return tone.key==='blocked'
  return true
 }
 const enabled=sortAtelierAccounts(filterCreativeAccounts(accounts,''),stats)
 const shown=sortAtelierAccounts(filterCreativeAccounts(accounts,search),stats).filter(a=>matches(a,filter))
 const selected=accounts.find(a=>a.id===selectedId&&a.enabled)||null
 const dirty=!!selected&&!!draft&&!sameDraft(draft,draftOf(selected))

 useEffect(()=>{let live=true;statsRequest().then(r=>{if(live)setStats(r?.accounts||{})}).catch(()=>{});return()=>{live=false}},[statsRequest])
 useEffect(()=>{onAccounts?.(accounts)},[accounts])
 // Toujours un compte ouvert : le dernier consulté, sinon le premier de la liste.
 useEffect(()=>{if(!loading&&!selected&&enabled.length)setSelectedId(enabled[0].id)},[loading,selected,enabled.length])
 useEffect(()=>{setDraft(draftOf(selected));if(selected)store(selected.id)},[selected?.id,selected?.version])
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),2600);return()=>clearTimeout(t)},[toast])
 useEffect(()=>{if(!copied)return;const t=setTimeout(()=>setCopied(''),1600);return()=>clearTimeout(t)},[copied])
 useEffect(()=>{
  if(!dirty&&!selectionDirty)return
  const warn=e=>{e.preventDefault();e.returnValue=''}
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)
 },[dirty,selectionDirty])

 async function load() {
  const first=await request(),all=[...first.accounts],size=first.page_size||250
  for(let offset=size;offset<first.count;offset+=size){const next=await request('GET',undefined,`?offset=${offset}`);all.push(...next.accounts)}
  if(alive.current)setAccounts(all)
  return all
 }
 async function run(action){
  if(operation.current)return
  operation.current=true;setBusy(true);setError('')
  try{await action()}catch(e){if(alive.current)setError(e.message||'Impossible de terminer. Réessaie.')}
  finally{operation.current=false;if(alive.current){setBusy(false);setLoading(false)}}
 }
 useEffect(()=>{alive.current=true;run(async()=>{const rows=await load();if(alive.current&&!rows.length)await sync()});return()=>{alive.current=false}},[request])

 function choose(id){
  if(id===selectedId)return setMobileDetail(true)
  if(dirty&&!window.confirm('Changer de compte sans enregistrer les modifications de cette DA ?'))return
  setSelectedId(id);setMobileDetail(true);setError('')
 }
 function listKeys(e){
  if(!['ArrowDown','ArrowUp'].includes(e.key)||!shown.length)return
  e.preventDefault()
  const index=shown.findIndex(a=>a.id===selectedId),next=shown[Math.min(shown.length-1,Math.max(0,index+(e.key==='ArrowDown'?1:-1)))]
  if(next){choose(next.id);requestAnimationFrame(()=>listRef.current?.querySelector('[aria-selected="true"]')?.focus())}
 }

 function openSelection(rows=accounts){setSelection(rows.map(a=>({...a})));setSelectionSearch('');setSelectionFilter('all');setSelectionDirty(false);setError('')}
 function closeSelection(){if(selectionDirty&&!window.confirm('Fermer sans enregistrer le choix des comptes ?'))return;setSelection(null);setSelectionDirty(false);setError('')}
 function changeSelection(ids,value){setSelection(old=>old.map(a=>ids.includes(a.id)?{...a,enabled:value}:a));setSelectionDirty(true)}
 async function saveSelection(){
  const original=new Map(accounts.map(a=>[a.id,a]))
  const changes=selection.filter(a=>a.enabled!==original.get(a.id)?.enabled).map(a=>({id:a.id,version:a.version,enabled:a.enabled}))
  await request('PATCH',{action:'select',changes})
  // La sauvegarde confirmée s’affiche même si l’actualisation suivante échoue.
  setAccounts(old=>old.map(a=>{const change=changes.find(c=>c.id===a.id);return change?{...a,enabled:change.enabled,version:a.version+1}:a}))
  setSelection(null);setSelectionDirty(false);setToast('Choix des comptes enregistré.')
 }
 async function sync(){
  await request('POST',{action:'sync'});const rows=await load();if(!alive.current)return
  if(selection)setSelection(old=>rows.map(a=>({...a,enabled:old.find(o=>o.id===a.id)?.enabled??a.enabled})))
  else openSelection(rows)
  setToast(`${rows.filter(a=>a.source_present).length} comptes récupérés depuis Dotb.`)
 }
 async function saveDirection(){
  const result=await request('PATCH',{action:'save',id:selected.id,version:selected.version,...draft})
  setAccounts(old=>old.map(a=>a.id===result.account.id?result.account:a));setToast('DA enregistrée.')
 }
 function setAside(account){
  if(!window.confirm(`Mettre « ${account.login} » de côté ? Sa DA est conservée et tu pourras le reprendre depuis « Gérer mes comptes ».`))return
  run(async()=>{
   await request('PATCH',{action:'select',changes:[{id:account.id,version:account.version,enabled:false}]})
   setAccounts(old=>old.map(a=>a.id===account.id?{...a,enabled:false,version:a.version+1}:a));setSelectedId(null);setMobileDetail(false);setToast('Compte mis de côté. Sa DA est conservée.')
  })
 }
 async function copyText(text,key){
  try{await navigator.clipboard.writeText(text);setCopied(key);setError('')}
  catch{setError('Copie automatique indisponible : sélectionne le texte du prompt pour le copier.')}
 }
 function copyBackground(background){
  const url=background.image_url||thumbOf(background)
  copyImage(url).then(()=>{setCopied('image');setError('')}).catch(()=>{setError('Ton navigateur n’a pas pu copier l’image : utilise « Télécharger ».')})
 }
 function update(patch){setDraft(old=>({...old,...patch}))}

 const counts=Object.fromEntries(FILTERS.map(([key])=>[key,enabled.filter(a=>matches(a,key)).length]))
 const selectorRows=selection?filterCreativeAccounts(selection,selectionSearch,selectionFilter):[]
 const panel=selected&&draft&&(()=>{
  const background=byId(draft.background_id),prompts=directionPrompts(draft,background),missing=missingParts(background,prompts)
  const stat=stats[selected.id]||{},tone=accountTone(stat.health)
  return <section aria-label={`Atelier de ${selected.login}`} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
   <header className="flex flex-wrap items-start gap-3 border-b border-slate-100 p-4 sm:p-5">
    <div className="flex w-full items-center justify-between gap-2 lg:hidden"><button type="button" className={`${button} !px-2.5`} onClick={()=>setMobileDetail(false)}>← Comptes</button><button type="button" className={`${button} text-slate-500`} disabled={busy} onClick={()=>setAside(selected)}>Mettre de côté</button></div>
    <div className="min-w-0 flex-1">
     <div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-bold truncate">{selected.login}</h3><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone.chip}`}>{tone.label}</span>{missing.length?<span className="rounded-full bg-amber-50 text-amber-800 px-2.5 py-0.5 text-xs">Il manque {missing.join(', ')}</span>:<span className="rounded-full bg-teal-50 text-teal-800 px-2.5 py-0.5 text-xs">DA prête</span>}</div>
     <p className="mt-1 text-sm text-slate-500">{selected.country||'Compte Dotb'}{!selected.source_present?' · absent de Dotb':''} · <b className="font-medium text-slate-700">{stat.today||0}</b> posté{stat.today>1?'s':''} aujourd’hui · <b className="font-medium text-slate-700">{stat.in_progress||0}</b> en cours · {stat.week||0} cette semaine</p>
    </div>
    <button type="button" className={`${button} hidden lg:inline-flex text-slate-500`} disabled={busy} onClick={()=>setAside(selected)}>Mettre de côté</button>
   </header>
   <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(200px,280px)_1fr]">
    <div className="space-y-3">
     <h4 className="text-sm font-semibold">Fond</h4>
     {background?<>
      <button type="button" className="block w-full rounded-xl overflow-hidden bg-stone-100" title="Changer de fond" onClick={()=>setPicker(true)}><Thumb background={background} className="w-full aspect-[3/4] !object-contain"/></button>
      <p className="text-sm font-medium truncate" title={background.title}>{background.title}</p>
      <div className="grid grid-cols-2 gap-2"><button type="button" className={primary} onClick={()=>copyBackground(background)}>{copied==='image'?'Copiée ✓':'Copier l’image'}</button><button type="button" className={button} disabled={busy||!background.image_path} onClick={()=>onDownload?.(background)}>Télécharger</button></div>
      <button type="button" className={`${button} w-full`} disabled={busy} onClick={()=>setPicker(true)}>Changer de fond</button>
     </>:<button type="button" onClick={()=>setPicker(true)} className="w-full h-40 md:h-auto md:aspect-[3/4] rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-teal-500 hover:text-teal-700">+ Choisir un fond</button>}
    </div>
    <div className="space-y-3 min-w-0">
     {[['prompt_front','content','front','Avant'],['prompt_back','content_back','back','Arrière']].map(([field,source,side,label])=><PromptBlock key={field} label={label} linked={draft[field]===null} value={prompts[side]} hasBackground={!!background} busy={busy} copied={copied===side}
      onCopy={()=>copyText(prompts[side],side)} onCustomize={()=>update({[field]:background?.[source]||''})} onReset={()=>update({[field]:null})} onChange={value=>update({[field]:value})}/>)}
     <label className="block text-sm font-semibold">Consignes de la DA <span className="font-normal text-slate-400">· ambiance, couleurs, cadrage</span><textarea className={`${input} mt-1.5 min-h-20 font-normal`} value={draft.notes} maxLength={3000} disabled={busy} placeholder="Ex. lumière douce, tons crème, cadrage plein pied…" onChange={e=>update({notes:e.target.value})}/></label>
    </div>
   </div>
   {dirty&&<footer className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-b-2xl border-t border-amber-200 bg-amber-50 px-4 py-3 sm:px-5"><span className="text-sm text-amber-900">Modifications non enregistrées</span><button type="button" className={`${primary} ml-auto`} disabled={busy} onClick={()=>run(saveDirection)}>Enregistrer la DA</button><button type="button" className={button} disabled={busy} onClick={()=>setDraft(draftOf(selected))}>Annuler</button></footer>}
  </section>
 })()

 return <section className="space-y-4" aria-label="Directions artistiques par compte">
  <div className="flex flex-wrap items-center gap-2">
   <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer les comptes">{FILTERS.map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)} className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter===key?(key==='blocked'?'bg-rose-600 text-white':key==='incomplete'?'bg-amber-500 text-white':'bg-teal-700 text-white'):'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label} <span className="opacity-75">{counts[key]}</span></button>)}</div>
   <div className="ml-auto flex gap-2"><button className={button} disabled={busy} title="Recharger les comptes" onClick={()=>run(load)}>↻ Actualiser</button><button className={button} disabled={busy||loading} onClick={()=>openSelection()}>Gérer mes comptes</button></div>
  </div>
  {!selection&&error&&<p role="alert" className="rounded-lg bg-red-50 text-red-800 p-3 text-sm">{error}</p>}
  {loading&&!accounts.length?<p role="status" className="py-10 text-center text-gray-500">Chargement des comptes…</p>
  :!enabled.length?<div className="text-center rounded-2xl border border-dashed bg-white p-10 space-y-3"><p className="text-sm text-gray-500">{accounts.length?'Choisis les comptes que tu veux utiliser pour préparer tes photos.':'Récupère tes comptes Dotb, puis coche ceux que tu veux utiliser.'}</p><button className={primary} disabled={busy} onClick={()=>accounts.length?openSelection():run(sync)}>{accounts.length?'Choisir mes comptes':'Récupérer mes comptes Dotb'}</button></div>
  :<div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
   <aside className={`rounded-2xl border border-slate-200 bg-white p-2 lg:sticky lg:top-4 ${mobileDetail?'hidden lg:block':''}`}>
    <input className={`${input} mb-2`} aria-label="Rechercher un compte" placeholder={`Rechercher parmi ${enabled.length} comptes…`} value={search} onChange={e=>setSearch(e.target.value)}/>
    <div ref={listRef} role="listbox" aria-label="Comptes" tabIndex={-1} onKeyDown={listKeys} className="space-y-0.5 lg:max-h-[calc(100vh-260px)] overflow-y-auto">
     {shown.map(account=>{const {background,ready}=info(account);return <AccountRow key={account.id} account={account} background={background} stat={stats[account.id]} ready={ready} active={account.id===selectedId} onSelect={()=>choose(account.id)}/>})}
     {!shown.length&&<p className="p-4 text-center text-sm text-slate-500">Aucun compte ne correspond.</p>}
    </div>
    <p className="px-2 pt-2 text-[11px] text-slate-400">↑ ↓ pour passer d’un compte à l’autre</p>
   </aside>
   <div className={mobileDetail?'':'hidden lg:block'}>{panel||<p className="rounded-2xl border border-dashed bg-white p-10 text-center text-sm text-slate-500">Choisis un compte dans la liste.</p>}</div>
  </div>}

  {toast&&<p role="status" className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</p>}
  {picker&&selected&&<BackgroundPicker backgrounds={backgrounds} current={draft?.background_id} usage={usage} onClose={()=>setPicker(false)} onPick={id=>{update({background_id:id});setPicker(false)}} onLibrary={()=>{if(dirty&&!window.confirm('Quitter sans enregistrer cette DA pour ajouter un fond ?'))return;setPicker(false);onLibrary()}}/>}
  {selection&&<ResourceDialog title="Gérer mes comptes" onClose={closeSelection} busy={busy}>
   <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3"><p className="text-sm text-slate-600 flex-1 min-w-52">Coche les comptes à afficher dans l’atelier. Décocher un compte garde sa DA et ne touche à rien dans Dotb.</p><button className={button} disabled={busy} onClick={()=>run(sync)}>{busy?'Chargement…':'Récupérer depuis Dotb'}</button></div>
    <div className="flex flex-wrap gap-2"><input className={`${input} flex-1 min-w-44`} aria-label="Rechercher un compte Dotb" placeholder="Pseudo ou pays…" value={selectionSearch} onChange={e=>setSelectionSearch(e.target.value)}/><select className={`${input} sm:!w-auto`} aria-label="Filtrer le choix des comptes" value={selectionFilter} onChange={e=>setSelectionFilter(e.target.value)}><option value="all">Tous les comptes</option><option value="selected">Cochés</option><option value="aside">De côté</option></select></div>
    <div className="flex flex-wrap gap-3 items-center text-xs"><span>{selection.filter(a=>a.enabled).length} cochés · {selectorRows.length} affichés</span><button className="text-teal-700 underline" disabled={busy} onClick={()=>changeSelection(selectorRows.map(a=>a.id),true)}>Cocher les comptes affichés</button><button className="text-gray-600 underline" disabled={busy} onClick={()=>changeSelection(selectorRows.map(a=>a.id),false)}>Décocher les comptes affichés</button></div>
    <div className="max-h-[50vh] overflow-y-auto rounded-xl border divide-y">{selectorRows.map(a=><label key={a.id} className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-teal-700" disabled={busy} checked={a.enabled} onChange={e=>changeSelection([a.id],e.target.checked)}/><span className="min-w-0"><span className="text-sm font-medium break-all">{a.login}</span><span className="block text-xs text-gray-500">{a.country||'Compte Dotb'}{!a.source_present?' · Absent de la dernière récupération':''}</span></span><span className="ml-auto text-xs text-gray-500">{a.enabled?'Retenu':'De côté'}</span></label>)}{!selectorRows.length&&<p className="p-6 text-sm text-gray-500">Aucun compte à afficher.</p>}</div>
    {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
    <div className="flex gap-3"><button className={primary} disabled={busy} onClick={()=>run(saveSelection)}>Enregistrer la sélection</button><button className={button} disabled={busy} onClick={closeSelection}>Annuler</button></div>
   </div>
  </ResourceDialog>}
 </section>
}
