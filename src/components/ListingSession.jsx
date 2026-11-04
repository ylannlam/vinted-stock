import {useEffect,useMemo,useRef,useState} from 'react'
import ListingSettingsPanel from './ListingSettingsPanel'
import {catalogChoices,generationIssues,listingIssues,listingSizes,listingStateLabels,validateListingPhoto,MAX_LISTING_PHOTOS} from '../lib/listingStudio'
import {applyListingPresets} from '../lib/listingSettings'

const input='w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:outline-teal-600 disabled:bg-slate-50 disabled:text-slate-500'
const button='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40'
const primary='rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40'
const link='text-sm font-medium text-teal-800 underline underline-offset-4 disabled:opacity-40'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const hour=v=>new Date(v).toLocaleString('fr-FR',{weekday:'short',hour:'2-digit',minute:'2-digit'})
const titleOf=(rows,id)=>(rows||[]).find(r=>r.id===id)?.title||null
const byName=(a,b)=>a.name.localeCompare(b.name,'fr',{numeric:true})

// Où en est un article : ce qui reste à faire, du dépôt des photos à la publication.
export function cardStage(card,options){
 const {row,fields,photos}=card
 if(row.state==='published')return 'published'
 if(row.state!=='draft')return 'dotb'
 if(!fields.title?.trim())return generationIssues(fields,photos).length?'inputs':'prepare'
 if(fields.catalog_id&&!options)return 'loading'
 return listingIssues(fields,photos,options).length?'review':'ready'
}
const stages={inputs:['À compléter','bg-slate-100 text-slate-700'],prepare:['Prête à préparer','bg-sky-50 text-sky-800'],loading:['Chargement…','bg-slate-100 text-slate-600'],review:['À vérifier','bg-amber-100 text-amber-900'],ready:['Prête à publier','bg-teal-100 text-teal-900'],dotb:['Dotb','bg-blue-50 text-blue-800'],published:['Publiée','bg-emerald-100 text-emerald-900']}

// Regroupe les photos déposées en articles, dans l'ordre des noms de fichiers (01, 02…).
export function groupFiles(files,size){
 const sorted=[...files].sort(byName),groups=[]
 for(let i=0;i<sorted.length;i+=size)groups.push(sorted.slice(i,i+size))
 return groups
}

export default function ListingSession({request,upload,account,meta,onBack,onOpenDraft}){
 const cards=useRef(new Map()),optionCache=useRef(new Map()),alive=useRef(true),settingsRef=useRef(null)
 const [order,setOrder]=useState([]),[,setTick]=useState(0)
 const [settings,setSettings]=useState(null),[dotb,setDotb]=useState(false),[serverDotb,setServerDotb]=useState(!!meta.dotb_publish_enabled)
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [dropped,setDropped]=useState(null),[showSettings,setShowSettings]=useState(false),[expanded,setExpanded]=useState(null),[copied,setCopied]=useState('')
 const choices=useMemo(()=>catalogChoices(meta.catalogs||[]),[meta.catalogs])
 const render=()=>{if(alive.current)setTick(n=>n+1)}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])

 // Une file par article : enregistrements, photos, rédaction et publication ne se chevauchent jamais.
 const queue=(card,fn)=>{const next=(card.chain||Promise.resolve()).catch(()=>{}).then(fn);card.chain=next;return next}
 function accept(card,row){card.row=row;if(!card.dirty){card.fields=row.fields;card.photos=row.photos}}
 async function flush(card){
  while(card.dirty){
   const rev=card.rev
   const {draft}=await request('POST',{action:'save',id:card.id,version:card.row.version,fields:card.fields,photos:card.photos.map(({path})=>({path}))})
   card.row=draft
   if(rev===card.rev){card.dirty=false;card.fields=draft.fields;card.photos=draft.photos}
  }
 }
 const save=card=>{clearTimeout(card.timer);card.error='';return queue(card,()=>flush(card)).catch(e=>{card.error=e.message;render();throw e}).finally(render)}
 async function act(card,label,fn){
  card.busy=label;card.error='';render()
  try{return await queue(card,async()=>{clearTimeout(card.timer);await flush(card);return fn()})}
  catch(e){card.error=e.message;throw e}
  finally{card.busy='';render()}
 }
 function touch(card){card.dirty=true;card.rev++;card.error='';clearTimeout(card.timer);card.timer=setTimeout(()=>save(card).catch(()=>{}),900);render()}
 function edit(card,patch){
  if(card.row.state!=='draft'||card.busy)return
  card.fields={...card.fields,...patch}
  if(Object.hasOwn(patch,'size_text'))card.fields=applyListingPresets(card.fields,optionsFor(card.fields.catalog_id),settingsRef.current?.effective)
  touch(card)
 }
 function setPhotos(card,photos){if(card.row.state!=='draft'||card.busy||card.row.dotb_item_id)return;card.photos=photos;touch(card)}
 const remember=row=>{const old=cards.current.get(row.id);if(old){accept(old,row);return old}const card={id:row.id,row,fields:row.fields,photos:row.photos,dirty:false,rev:0,busy:'',error:'',link:''};cards.current.set(row.id,card);return card}
 const list=()=>order.map(id=>cards.current.get(id)).filter(Boolean)
 const optionsFor=id=>{const value=optionCache.current.get(Number(id));return value&&!(value instanceof Promise)&&!(value instanceof Error)?value:null}

 // Options Vinted d'une catégorie (tailles, états, colis) : chargées une fois, puis les réglages complètent les fiches.
 function ensureOptions(id){
  id=Number(id);if(!id||optionCache.current.has(id))return
  optionCache.current.set(id,request('GET',undefined,`action=options&catalog_id=${id}`).then(value=>{optionCache.current.set(id,value);fillPresets(id)}).catch(e=>{optionCache.current.set(id,e)}).finally(render))
 }
 function fillPresets(catalogId){
  const options=optionsFor(catalogId),preset=settingsRef.current?.effective;if(!options||!preset)return
  for(const card of cards.current.values()){
   if(card.row.state!=='draft'||card.busy||Number(card.fields.catalog_id)!==catalogId||!card.fields.title)continue
   const next=applyListingPresets(card.fields,options,preset)
   if(JSON.stringify(next)!==JSON.stringify(card.fields))edit(card,next)
  }
 }
 useEffect(()=>{for(const card of list())if(card.fields.catalog_id)ensureOptions(card.fields.catalog_id)})
 function changeCategory(card,id){
  edit(card,{catalog_id:id,size_id:null,package_size_id:null,item_attributes:[]})
  // Les réglages (état, colis, taille) complètent aussitôt la fiche pour la nouvelle catégorie.
  if(id&&optionsFor(id))fillPresets(id);else if(id)ensureOptions(id)
 }

 async function load(){
  await saveAll()
  for(const [id,value] of optionCache.current)if(value instanceof Error)optionCache.current.delete(id)
  const result=await request('GET',undefined,`action=session&account_id=${account.id}`)
  if(!alive.current)return
  settingsRef.current=result.settings;setSettings(result.settings);setDotb(!!result.dotb);setServerDotb(!!result.dotb_publish_enabled)
  setOrder(result.drafts.map(row=>remember(row).id))
 }
 useEffect(()=>{setLoading(true);load().catch(e=>setError(e.message)).finally(()=>{if(alive.current)setLoading(false)})},[account.id])
 // Les annonces planifiées par Dotb sont revérifiées chaque minute tant que la page est ouverte.
 useEffect(()=>{
  const timer=setInterval(()=>{if(document.visibilityState!=='visible')return;for(const card of list())if(card.row.state==='scheduled'&&!card.busy)queue(card,async()=>accept(card,(await request('POST',{action:'refresh',id:card.id})).draft)).catch(()=>{}).finally(render)},60000)
  return()=>clearInterval(timer)
 },[order])
 useEffect(()=>{const warn=e=>{if(list().some(c=>c.dirty||c.busy)||busy){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)})

 async function withBusy(label,fn){if(busy)return;setBusy(label);setError('');setNotice('');try{await fn()}catch(e){if(alive.current)setError(e.message)}finally{if(alive.current)setBusy('')}}

 // Photos venant de l'ordinateur : un dépôt = un article, ou plusieurs articles si on le choisit.
 function drop(fileList){
  const files=Array.from(fileList||[]).filter(Boolean);if(!files.length)return
  try{files.forEach(validateListingPhoto)}catch(e){setError(e.message);return}
  if(files.length===1)return withBusy('Ajout de l’article…',()=>addArticles([files]))
  setDropped(files)
 }
 async function addArticles(groups){
  setDropped(null)
  if(groups.some(g=>g.length>MAX_LISTING_PHOTOS))throw Error(`Un article peut avoir ${MAX_LISTING_PHOTOS} photos au maximum.`)
  for(let g=0;g<groups.length;g++){
   const label=groups.length>1?`Article ${g+1} sur ${groups.length}`:'Nouvel article'
   setBusy(`${label} : création…`)
   const {draft}=await request('POST',{action:'create',id:crypto.randomUUID(),account_id:account.id})
   const card=remember(draft);setOrder(old=>[card.id,...old.filter(id=>id!==card.id)])
   await uploadInto(card,groups[g],(i,n)=>setBusy(`${label} : photo ${i} sur ${n}…`))
  }
  setNotice(groups.length>1?`${groups.length} articles ajoutés. Indique le SKU, la taille et le prix de chacun, puis « Tout préparer ».`:'Article ajouté. Indique son SKU, sa taille et son prix.')
 }
 function uploadInto(card,files,progress=()=>{}){
  if(card.photos.length+files.length>MAX_LISTING_PHOTOS)return Promise.reject(Error(`Un article peut avoir ${MAX_LISTING_PHOTOS} photos au maximum.`))
  try{files.forEach(validateListingPhoto)}catch(e){return Promise.reject(e)}
  return act(card,'Envoi des photos…',async()=>{
   for(let i=0;i<files.length;i++){
    progress(i+1,files.length)
    const asset=await upload(files[i]),rev=card.rev
    const {draft}=await request('POST',{action:'save',id:card.id,version:card.row.version,fields:card.fields,photos:[...card.photos.map(({path})=>({path})),{path:asset.path}]})
    card.row=draft;card.photos=draft.photos;if(rev===card.rev){card.dirty=false;card.fields=draft.fields};render()
   }
  })
 }

 async function prepare(card){
  const needed=generationIssues(card.fields,card.photos)
  if(needed.length)throw Error(`Complète d’abord ${needed.map(i=>i.label).join(', ')}.`)
  if(meta.ai_ready===false)throw Error('La rédaction automatique reste à connecter. Tu peux remplir la fiche toi-même.')
  const {draft}=await request('POST',{action:'generate',id:card.id,version:card.row.version})
  accept(card,draft)
  if(draft.last_error)throw Error(draft.last_error)
  if(draft.fields.catalog_id)ensureOptions(draft.fields.catalog_id)
 }
 const prepareOne=card=>act(card,'Rédaction…',()=>prepare(card)).catch(()=>{})
 async function prepareAll(){
  const waiting=list().filter(c=>c.row.state==='draft'&&!c.fields.title?.trim())
  const ready=waiting.filter(c=>!generationIssues(c.fields,c.photos).length)
  if(!ready.length)throw Error(waiting.length?'Indique d’abord le SKU, la taille et le prix des articles à préparer.':'Tous les articles ont déjà leur texte.')
  let done=0,failed=0
  for(let i=0;i<ready.length;i++){
   setBusy(`Rédaction ${i+1} sur ${ready.length}…`)
   try{await act(ready[i],'Rédaction…',()=>prepare(ready[i]));done++}
   catch(e){failed++;if(/quota/i.test(e.message)){setError(e.message);break}}
  }
  setNotice([`${done} article${done>1?'s':''} préparé${done>1?'s':''}.`,waiting.length>ready.length?`${waiting.length-ready.length} à compléter avant (SKU, taille ou prix).`:'',failed?`${failed} en erreur : regarde la carte concernée.`:''].filter(Boolean).join(' '))
 }

 async function copy(card,key,text){
  try{await navigator.clipboard.writeText(text)}catch{
   // Ancien navigateur ou page non sécurisée : copie par une zone de texte temporaire.
   const area=document.createElement('textarea')
   try{area.value=text;document.body.appendChild(area);area.select?.();if(document.execCommand?.('copy')!==true)throw Error('copy unavailable')}catch{setError('La copie automatique est indisponible : sélectionne le texte dans « Modifier les détails ».');return}finally{area.remove()}
  }
  setCopied(`${card.id}:${key}`);setTimeout(()=>{if(alive.current)setCopied(v=>v===`${card.id}:${key}`?'':v)},2000)
 }
 const download=card=>act(card,'Préparation des photos…',async()=>{
  const {draft}=await request('GET',undefined,`action=draft&id=${card.id}`)
  const {exportListing,downloadListingFile}=await import('../lib/listingExport')
  downloadListingFile(await exportListing(draft,account,meta,optionsFor(draft.fields.catalog_id),{onProgress:label=>{card.busy=label;render()}}))
 }).catch(()=>{})
 const published=card=>act(card,'Enregistrement du lien…',async()=>{
  const {draft}=await request('POST',{action:'mark_published',id:card.id,version:card.row.version,url:card.link.trim()})
  accept(card,draft);card.link=''
 }).catch(()=>{})

 // Dotb : création de la fiche, envoi des photos une par une, puis publication à l'heure prévue.
 // mode : 'live' = en ligne directement, 'draft' = brouillon créé sur Vinted, publié ensuite à la main.
 async function sendDotb(card,mode='live'){
  const issues=listingIssues(card.fields,card.photos,optionsFor(card.fields.catalog_id))
  if(issues.length)throw Error(`Complète ${issues.map(i=>i.label).join(', ')}.`)
  let {draft}=await request('POST',{action:'publish',id:card.id,version:card.row.version,confirmation_account_id:account.id,mode});accept(card,draft)
  for(let i=0;i<80&&draft.state==='preparing';i++){
   if(draft.last_error&&!draft.busy)throw Error(draft.last_error)
   await sleep(draft.busy?5000:300)
   ;({draft}=await request('POST',{action:'step',id:card.id}));accept(card,draft);render()
  }
  if(draft.state==='attention')throw Error(draft.message||'À vérifier dans Dotb.')
 }
 async function bridgeReady(){
  const value=await request('GET',undefined,'action=accounts'),target=value.accounts.find(a=>a.id===account.id)
  if(!target)throw Error('Ce compte ne fait plus partie de ta sélection AdsPower.')
  if(!target.connected)throw Error('Ouvre ce compte dans AdsPower et active son Bridge Dotb, puis réessaie.')
 }
 const sendOne=(card,mode)=>withBusy('Vérification du Bridge…',async()=>{await bridgeReady();await act(card,'Envoi à Dotb…',()=>sendDotb(card,mode))})
 async function sendAll(mode){
  const ready=list().filter(c=>cardStage(c,optionsFor(c.fields.catalog_id))==='ready')
  if(!ready.length)throw Error('Aucun article prêt à publier.')
  setBusy('Vérification du Bridge…');await bridgeReady()
  let done=0
  for(let i=0;i<ready.length;i++){setBusy(`Envoi à Dotb ${i+1} sur ${ready.length}…`);try{await act(ready[i],'Envoi à Dotb…',()=>sendDotb(ready[i],mode));done++}catch{}}
  setNotice(`${done} annonce${done>1?'s':''} transmise${done>1?'s':''} à Dotb sur ${ready.length}. ${mode==='draft'?'Dotb crée les brouillons sur Vinted un par un, à l’heure indiquée sur chaque carte : il te restera à les publier depuis Vinted.':'Dotb les publie une par une, à l’heure indiquée sur chaque carte.'}`)
 }
 const refresh=card=>act(card,'Vérification…',async()=>accept(card,(await request('POST',{action:'refresh',id:card.id})).draft)).catch(()=>{})
 const discard=card=>act(card,'Retrait…',async()=>{await request('POST',{action:'discard',id:card.id,version:card.row.version});cards.current.delete(card.id);setOrder(old=>old.filter(id=>id!==card.id))}).catch(()=>{})
 async function saveAll(){for(const c of cards.current.values())if(c.dirty)await save(c)}
 const openFull=card=>withBusy('Enregistrement…',async()=>{await saveAll();onOpenDraft(card.row)})

 const rows=list(),staged=rows.map(c=>[c,cardStage(c,optionsFor(c.fields.catalog_id))])
 const count=key=>staged.filter(([,s])=>s===key).length
 const active=staged.filter(([,s])=>s!=='published'),done=staged.filter(([,s])=>s==='published')
 const working=!!busy||rows.some(c=>c.busy)
 const toPrepare=rows.filter(c=>c.row.state==='draft'&&!c.fields.title?.trim()&&!generationIssues(c.fields,c.photos).length).length

 function summary(card,options){
  const f=card.fields,category=choices.find(c=>c.id===f.catalog_id)
  const chip=(label,value,key)=><span key={key} className={`rounded-full px-2.5 py-1 text-xs ${value?'bg-slate-100 text-slate-700':'bg-amber-100 text-amber-900'}`}>{value||`${label} à choisir`}</span>
  return <div className="flex flex-wrap gap-1.5">
   {chip('Catégorie',category?.label.split(' › ').slice(-2).join(' › '),'c')}
   {(!options||listingSizes(options).length>0)&&chip('Taille Vinted',titleOf(listingSizes(options),f.size_id),'s')}
   {(!options||options.conditions?.length>0)&&chip('État',titleOf(options?.conditions,f.status_id),'e')}
   {(!options||options.package_sizes?.length>0)&&!options?.parcel_measurements&&chip('Colis',titleOf(options?.package_sizes,f.package_size_id),'p')}
   {chip('Couleur',f.color_ids.map(id=>titleOf(meta.colors,id)).filter(Boolean).join(', '),'k')}
   {chip('Marque',f.brand_id===1?'Sans marque':f.brand_title,'b')}
  </div>
 }

 function details(card,options){
  const f=card.fields,locked=!!card.busy,search=card.categorySearch||''
  const filtered=search?choices.filter(c=>c.label.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))).slice(0,300):choices
  const current=choices.find(c=>c.id===f.catalog_id)
  const select=(label,value,rows,onChange,empty='Choisir…')=><label className="text-xs font-medium text-slate-600">{label}<select className={input+' mt-1'} value={value||''} onChange={e=>onChange(e.target.value?Number(e.target.value):null)}><option value="">{empty}</option>{rows.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
  return <fieldset disabled={locked} className="border-t bg-slate-50/60 p-3 sm:p-4 space-y-4">
   <div><p className="text-xs font-medium text-slate-600 mb-2">Photos · {card.photos.length} / {MAX_LISTING_PHOTOS}</p><div className="flex flex-wrap gap-2">
    {card.photos.map((p,i)=><div key={p.path} className="w-20 rounded-lg border bg-white overflow-hidden"><img src={p.url} alt={`Photo ${i+1}`} className="h-24 w-full object-contain bg-stone-50"/><div className="flex justify-between text-xs"><button type="button" className="px-1.5 py-1 disabled:opacity-25" aria-label={`Avancer la photo ${i+1}`} disabled={i===0||!!card.row.dotb_item_id} onClick={()=>{const next=[...card.photos];[next[i-1],next[i]]=[next[i],next[i-1]];setPhotos(card,next)}}>←</button><button type="button" className="text-rose-700 disabled:opacity-25" aria-label={`Retirer la photo ${i+1}`} disabled={!!card.row.dotb_item_id} onClick={()=>setPhotos(card,card.photos.filter((_,n)=>n!==i))}>✕</button><button type="button" className="px-1.5 py-1 disabled:opacity-25" aria-label={`Reculer la photo ${i+1}`} disabled={i===card.photos.length-1||!!card.row.dotb_item_id} onClick={()=>{const next=[...card.photos];[next[i+1],next[i]]=[next[i],next[i+1]];setPhotos(card,next)}}>→</button></div></div>)}
    <label className="w-20 h-[7.5rem] grid place-items-center rounded-lg border-2 border-dashed border-teal-200 text-xs text-teal-800 cursor-pointer text-center">+ Photos<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Ajouter des photos à cet article" onChange={e=>{const files=Array.from(e.target.files||[]).sort(byName);e.target.value='';uploadInto(card,files).catch(()=>{})}}/></label>
   </div></div>
   <label className="block text-xs font-medium text-slate-600">Description<textarea className={input+' mt-1 min-h-40 leading-relaxed'} maxLength={2000} value={f.description} onChange={e=>edit(card,{description:e.target.value})}/><span className="block text-right font-normal text-slate-400">{f.description.length} / 2000</span></label>
   <div className="grid gap-3 sm:grid-cols-2">
    <div className="sm:col-span-2"><label className="text-xs font-medium text-slate-600">Catégorie Vinted<input className={input+' mt-1 mb-1.5'} placeholder="Rechercher une catégorie…" value={search} onChange={e=>{card.categorySearch=e.target.value;render()}}/></label><select aria-label="Catégorie Vinted" className={input} value={f.catalog_id||''} onChange={e=>changeCategory(card,Number(e.target.value)||null)}><option value="">Choisir la catégorie</option>{current&&!filtered.some(c=>c.id===current.id)&&<option value={current.id}>{current.label}</option>}{filtered.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
    {f.catalog_id&&!options?<p className="sm:col-span-2 text-sm text-slate-500">{optionCache.current.get(Number(f.catalog_id)) instanceof Error?'Les options de cette catégorie n’ont pas pu être chargées. Actualise la session.':'Chargement des tailles et des options…'}</p>:options&&<>
     {!!listingSizes(options).length&&select('Taille Vinted',f.size_id,listingSizes(options),size_id=>edit(card,{size_id}))}
     {!!options.package_sizes?.length&&!options.parcel_measurements&&select('Format du colis',f.package_size_id,options.package_sizes,package_size_id=>edit(card,{package_size_id}))}
     {!!options.conditions?.length&&<div className="sm:col-span-2"><p className="text-xs font-medium text-slate-600 mb-1">État</p><div className="flex flex-wrap gap-1.5">{options.conditions.map(o=><button type="button" key={o.id} aria-pressed={f.status_id===o.id} onClick={()=>edit(card,{status_id:o.id})} className={button+' !py-1.5 '+(f.status_id===o.id?'!border-teal-700 !bg-teal-700 !text-white':'')}>{o.title}</button>)}</div></div>}
     {(options.attributes||[]).map(a=>{const ids=f.item_attributes.find(x=>x.code===a.code)?.ids||[],multi=(a.selection_limit||1)>1;return <label key={a.code} className="text-xs font-medium text-slate-600">{a.title}{a.required?' · obligatoire':' · facultatif'}<select className={input+' mt-1'} multiple={multi} value={multi?ids.map(String):String(ids[0]||'')} onChange={e=>{const chosen=Array.from(e.target.selectedOptions).map(o=>Number(o.value)).filter(Boolean);edit(card,{item_attributes:[...f.item_attributes.filter(x=>x.code!==a.code),...(chosen.length?[{code:a.code,ids:chosen}]:[])]})}}>{!multi&&<option value="">Choisir…</option>}{a.options.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select></label>})}
    </>}
    {select('Couleur principale',f.color_ids[0],meta.colors||[],id=>edit(card,{color_ids:id?[id,...f.color_ids.slice(1).filter(v=>v!==id)]:[]}))}
    {select('Deuxième couleur · facultatif',f.color_ids[1],(meta.colors||[]).filter(c=>c.id!==f.color_ids[0]),id=>edit(card,{color_ids:id?[...f.color_ids.slice(0,1),id]:f.color_ids.slice(0,1)}),'Aucune')}
    <div className="text-xs font-medium text-slate-600">Marque<p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal text-slate-800">{f.brand_id===1?'Sans marque':f.brand_title||'À choisir'}{f.brand_id!==1&&<button type="button" className={button+' !py-1'} onClick={()=>edit(card,{brand_id:1,brand_title:'Sans marque'})}>Sans marque</button>}<button type="button" className={link} onClick={()=>openFull(card)}>Chercher une marque</button></p></div>
    <label className="sm:col-span-2 text-xs font-medium text-slate-600">Détails à mentionner · facultatif<textarea className={input+' mt-1 min-h-16'} maxLength={1500} value={f.notes} placeholder="Défauts, matière vérifiée, mesures… pris en compte à la prochaine rédaction." onChange={e=>edit(card,{notes:e.target.value})}/></label>
   </div>
   <div className="flex flex-wrap gap-3 justify-between items-center border-t pt-3">
    <div className="flex flex-wrap gap-3">{f.title&&<button type="button" className={link} onClick={()=>prepareOne(card)}>Refaire le texte avec l’IA</button>}<button type="button" className={link} onClick={()=>openFull(card)}>Ouvrir la fiche complète</button></div>
    {!card.row.dotb_item_id&&(card.confirm?<span className="flex gap-2 items-center text-sm">Retirer cet article ?<button type="button" className={button+' !text-rose-700'} onClick={()=>discard(card)}>Oui, retirer</button><button type="button" className={button} onClick={()=>{card.confirm=false;render()}}>Non</button></span>:<button type="button" className="text-sm text-rose-700 underline underline-offset-4" onClick={()=>{card.confirm=true;render()}}>Retirer de la session</button>)}
   </div>
  </fieldset>
 }

 function renderCard(card,stage){
  const f=card.fields,options=optionsFor(f.catalog_id),editable=card.row.state==='draft',open=expanded===card.id,locked=!!card.busy
  const issues=stage==='review'?listingIssues(f,card.photos,options):[],needs=stage==='inputs'?generationIssues(f,card.photos):[]
  const [label,tone]=stage==='dotb'?[listingStateLabels[card.row.state],card.row.state==='attention'?'bg-amber-100 text-amber-900':'bg-blue-50 text-blue-800']:stages[stage]
  const isCopied=key=>copied===`${card.id}:${key}`
  return <article key={card.id} aria-label={f.title||f.sku||'Nouvel article'} className={`rounded-2xl border bg-white overflow-hidden ${stage==='ready'?'border-teal-200':'border-slate-200'}`}>
   <div className="flex gap-3 sm:gap-4 p-3 sm:p-4">
    <button type="button" onClick={()=>setExpanded(open?null:card.id)} aria-label={`Photos de l’article (${card.photos.length})`} className="relative w-20 h-24 sm:w-24 sm:h-28 shrink-0 rounded-xl overflow-hidden border bg-stone-50">
     {card.photos[0]?.url?<img src={card.photos[0].url} alt="" className="h-full w-full object-contain"/>:<span className="grid h-full place-items-center text-2xl text-slate-300">＋</span>}
     <span className="absolute bottom-1 right-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold">{card.photos.length} photo{card.photos.length>1?'s':''}</span>
    </button>
    <div className="min-w-0 flex-1 space-y-2.5">
     <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>{card.busy?<span role="status" className="text-xs text-slate-500">{card.busy}</span>:card.dirty&&<span className="text-xs text-slate-400">Enregistrement…</span>}</div>
     {editable?<fieldset disabled={locked} className="grid grid-cols-3 gap-2">
      <label className="text-[11px] font-medium text-slate-500">SKU<input className={input+(needs.some(i=>i.key==='sku')?' !border-amber-400':'')} value={f.sku} maxLength={200} placeholder="sz…" onChange={e=>edit(card,{sku:e.target.value})}/></label>
      <label className="text-[11px] font-medium text-slate-500">Taille<input className={input+(needs.some(i=>i.key==='size-text')?' !border-amber-400':'')} value={f.size_text} maxLength={80} placeholder="M" onChange={e=>edit(card,{size_text:e.target.value,size_id:null})}/></label>
      <label className="text-[11px] font-medium text-slate-500">Prix (€)<input className={input+(needs.some(i=>i.key==='price')?' !border-amber-400':'')} inputMode="decimal" value={String(f.price||'').replace('.',',')} maxLength={12} placeholder="24,90" onChange={e=>edit(card,{price:e.target.value})}/></label>
     </fieldset>:<p className="text-xs text-slate-500">{[f.sku,f.size_text&&`Taille ${f.size_text}`,f.price&&`${String(f.price).replace('.',',')} €`].filter(Boolean).join(' · ')}</p>}
     {f.title?(editable?<label className="block"><span className="sr-only">Titre</span><textarea rows={1} disabled={locked} className={input+' font-semibold resize-none h-16 sm:h-10 leading-snug'} maxLength={100} value={f.title} onChange={e=>edit(card,{title:e.target.value.replace(/\s*\n\s*/g,' ')})}/><span className={`block text-right text-[11px] ${f.title.length<60?'text-amber-700':'text-slate-400'}`}>{f.title.length} / 100{f.title.length<60?' · ajoute les détails utiles pour la recherche':''}</span></label>:<p className="font-semibold break-words">{f.title}</p>):stage!=='inputs'&&<p className="text-sm text-slate-500">Le titre, la description, la catégorie et les couleurs seront rédigés à partir des photos.</p>}
     {f.title&&<button type="button" onClick={()=>setExpanded(open?null:card.id)} className="block w-full text-left text-sm text-slate-600 hover:text-slate-900"><span className="line-clamp-2 break-words">{f.description||'Description à rédiger'}</span></button>}
     {f.title&&summary(card,options)}
     {card.row.message&&editable&&f.title&&<p className="text-xs text-amber-800">{card.row.message}</p>}
     {needs.length>0&&<p className="text-sm text-slate-600">À compléter : {needs.map(i=>i.label).join(', ')}.</p>}
     {issues.length>0&&<div className="flex flex-wrap items-center gap-2"><span className="text-sm text-amber-900">À vérifier :</span>{issues.map(i=><button type="button" key={i.key} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-950 underline underline-offset-2" onClick={()=>setExpanded(card.id)}>{i.label}</button>)}</div>}
     {card.error&&<p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800">{card.error}{card.dirty&&<button className={link+' ml-2'} disabled={locked} onClick={()=>save(card).catch(()=>{})}>Réessayer l’enregistrement</button>}</p>}
     <div className="flex flex-wrap items-center gap-2">
      {stage==='prepare'&&<button className={primary} disabled={locked||!!busy} onClick={()=>prepareOne(card)}>Préparer avec l’IA</button>}
      {stage==='ready'&&<>
       <button className={button} disabled={locked} onClick={()=>copy(card,'title',f.title)}>{isCopied('title')?'Titre copié ✓':'Copier le titre'}</button>
       <button className={button} disabled={locked} onClick={()=>copy(card,'description',f.description)}>{isCopied('description')?'Description copiée ✓':'Copier la description'}</button>
       <button className={button} disabled={locked} onClick={()=>download(card)}>Photos (.zip)</button>
       {dotb&&<><button className={button} disabled={locked||!!busy} onClick={()=>sendOne(card,'draft')}>Dotb : brouillon Vinted</button><button className={primary} disabled={locked||!!busy} onClick={()=>sendOne(card,'live')}>Dotb : en ligne</button></>}
      </>}
      {(stage==='review'||stage==='ready'||stage==='inputs')&&<button className={link} onClick={()=>setExpanded(open?null:card.id)}>{open?'Fermer les détails':'Modifier les détails'}</button>}
      {stage==='prepare'&&<button className={link} onClick={()=>setExpanded(open?null:card.id)}>{open?'Fermer':'Photos et détails'}</button>}
     </div>
     {stage==='ready'&&<form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();if(card.link.trim())published(card)}}><input aria-label={`Lien Vinted de ${f.title}`} className={input+' flex-1 min-w-48'} inputMode="url" placeholder="Publiée sur Vinted ? Colle le lien de l’annonce" value={card.link} disabled={locked} onChange={e=>{card.link=e.target.value;render()}}/><button className={button} disabled={locked||!card.link.trim()}>Notée publiée</button></form>}
     {stage==='dotb'&&<div className="space-y-2"><p className={`rounded-lg p-2.5 text-sm ${card.row.state==='attention'||card.row.last_error?'bg-amber-50 text-amber-950':'bg-blue-50 text-blue-950'}`}>{card.row.last_error||card.row.message}{card.row.state==='scheduled'&&card.row.scheduled_at?` · Prévue ${hour(card.row.scheduled_at)}`:''}</p><div className="flex flex-wrap gap-2">{card.row.state==='preparing'&&<button className={button} disabled={locked||!!busy} onClick={()=>act(card,'Reprise de l’envoi…',()=>sendDotb(card,card.row.dotb_publish===false?'draft':'live')).catch(()=>{})}>Reprendre l’envoi</button>}{['scheduled','attention'].includes(card.row.state)&&<button className={button} disabled={locked} onClick={()=>refresh(card)}>Vérifier maintenant</button>}{card.row.state==='attention'&&<a className={button} href="https://dotb.io" target="_blank" rel="noreferrer">Ouvrir Dotb ↗</a>}</div>{card.row.state==='vinted_draft'&&<form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();if(card.link.trim())published(card)}}><input aria-label={`Lien Vinted de ${f.title}`} className={input+' flex-1 min-w-48'} inputMode="url" placeholder="Brouillon publié sur Vinted ? Colle le lien de l’annonce" value={card.link} disabled={locked} onChange={e=>{card.link=e.target.value;render()}}/><button className={button} disabled={locked||!card.link.trim()}>Notée publiée</button></form>}</div>}
     {stage==='published'&&<p className="text-sm text-emerald-900">Publiée{card.row.published_at?` ${hour(card.row.published_at)}`:''}. {card.row.url&&<a className="underline underline-offset-4" href={card.row.url} target="_blank" rel="noopener noreferrer">Voir sur Vinted ↗</a>}</p>}
    </div>
   </div>
   {open&&editable&&details(card,options)}
   {open&&!editable&&<div className="border-t bg-slate-50/60 p-3 sm:p-4 flex flex-wrap gap-2">{card.photos.map((p,i)=><img key={p.path} src={p.url} alt={`Photo ${i+1}`} className="h-24 w-20 rounded-lg border object-contain bg-white"/>)}</div>}
  </article>
 }

 const sizes=dropped?[1,2,3,4].filter(n=>n>1&&dropped.length%n===0&&dropped.length>n):[]
 return <section className="space-y-4">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div className="min-w-0"><button className={link} disabled={working} onClick={()=>withBusy('Enregistrement…',async()=>{await saveAll();onBack()})}>← Changer de compte</button><h1 className="mt-2 text-2xl font-bold break-all"><span className="text-teal-700">#{account.profile_number||'—'}</span> · {account.login}</h1>
    <p className="mt-1 text-sm text-slate-500">{dotb?`Publication via Dotb${settings?.effective?.spacing_minutes?`, une annonce toutes les ${settings.effective.spacing_minutes} min`:''}. Tu peux aussi publier une annonce à la main.`:'Publication à la main sur Vinted : copie le titre et la description, puis colle le lien de l’annonce.'}</p></div>
   <div className="flex flex-wrap gap-2"><button className={button} aria-expanded={showSettings} disabled={!settings} onClick={()=>setShowSettings(v=>!v)}>Réglages</button><button className={button} disabled={working||loading} onClick={()=>withBusy('Actualisation…',load)}>Actualiser</button></div>
  </header>
  {showSettings&&settings&&<ListingSettingsPanel key={JSON.stringify(settings)} settings={settings} account={account} request={request} serverDotb={serverDotb} aiModels={meta.ai_models} onClose={()=>setShowSettings(false)} onSaved={value=>{settingsRef.current=value;setSettings(value);setDotb(serverDotb&&value.effective.dotb===true);setShowSettings(false);setNotice('Réglages enregistrés. Ils s’appliquent aux prochains articles préparés.')}}/>}
  {settings&&!showSettings&&<p className="text-xs text-slate-500">Réglages {settings.effective.custom?'propres à ce compte':'communs'} : {settings.effective.no_brand?'Sans marque · ':''}{settings.effective.condition} · colis {settings.effective.package.toLocaleLowerCase('fr')}{settings.effective.description_footer?' · fin de description personnalisée':''}. <button className="underline" onClick={()=>setShowSettings(true)}>Modifier</button></p>}
  {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{notice}</p>}

  <label onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)drop(e.dataTransfer.files)}} className={`block rounded-2xl border-2 border-dashed p-5 sm:p-6 text-center ${busy?'opacity-60 border-slate-200':'cursor-pointer border-teal-300 bg-teal-50/40 hover:border-teal-600'}`}>
   <span className="block font-semibold text-teal-900">Glisse ici les photos de tes articles</span>
   <span className="block mt-1 text-xs text-slate-500">Depuis ton ordinateur · JPG, PNG ou WebP · 8 Mo par photo. Mets la photo principale en premier (01, 02…).</span>
   <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={!!busy} aria-label="Ajouter les photos d’un ou plusieurs articles" className="block mx-auto mt-3 max-w-full text-xs" onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';drop(files)}}/>
  </label>
  {dropped&&<div role="group" aria-label="Regrouper les photos" className="rounded-2xl border border-teal-200 bg-white p-4 space-y-3"><p className="text-sm font-semibold">{dropped.length} photos sélectionnées. Ce sont :</p><div className="flex flex-wrap gap-2">
   <button className={primary} onClick={()=>withBusy('Ajout de l’article…',()=>addArticles([dropped.slice().sort(byName)]))}>Un seul article ({dropped.length} photos)</button>
   {sizes.map(n=><button key={n} className={button} onClick={()=>withBusy('Ajout des articles…',()=>addArticles(groupFiles(dropped,n)))}>{dropped.length/n} articles de {n} photos</button>)}
   <button className={button} onClick={()=>withBusy('Ajout des articles…',()=>addArticles(groupFiles(dropped,1)))}>{dropped.length} articles (1 photo chacun)</button>
   <button className={link} onClick={()=>setDropped(null)}>Annuler</button>
  </div><p className="text-xs text-slate-500">Les photos sont regroupées dans l’ordre de leur nom de fichier.</p></div>}

  {busy&&<p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{busy}</p>}
  {!loading&&!!active.length&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white border p-3">
   <p className="text-sm text-slate-600">{[['inputs','à compléter'],['prepare','à préparer'],['review','à vérifier'],['ready','prêtes à publier'],['dotb','chez Dotb']].map(([k,l])=>count(k)?`${count(k)} ${l}`:null).filter(Boolean).join(' · ')||'—'}</p>
   <div className="flex flex-wrap gap-2"><button className={primary} disabled={!!busy||!toPrepare} onClick={()=>withBusy('Rédaction…',prepareAll)}>Tout préparer avec l’IA{toPrepare?` (${toPrepare})`:''}</button>{dotb&&<><button className={button} disabled={!!busy||!count('ready')} onClick={()=>withBusy('Envoi à Dotb…',()=>sendAll('draft'))}>Tout en brouillon Vinted ({count('ready')})</button><button className={button} disabled={!!busy||!count('ready')} onClick={()=>withBusy('Envoi à Dotb…',()=>sendAll('live'))}>Tout publier en ligne via Dotb ({count('ready')})</button></>}</div>
  </div>}
  {loading?<p role="status" className="py-10 text-center text-slate-500">Chargement de la session…</p>:!rows.length?<p className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-500">Aucun article en cours sur ce compte. Glisse des photos ci-dessus pour commencer.</p>:<div className="space-y-3">{active.map(([c,s])=>renderCard(c,s))}</div>}
  {!!done.length&&<details className="rounded-2xl border bg-white p-3 sm:p-4" open={!active.length}><summary className="cursor-pointer text-sm font-semibold">Publiées depuis hier · {done.length}</summary><div className="mt-3 space-y-3">{done.map(([c,s])=>renderCard(c,s))}</div></details>}
 </section>
}
