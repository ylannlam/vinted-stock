import {useEffect,useMemo,useRef,useState} from 'react'
import ListingSettingsPanel from './ListingSettingsPanel'
import {catalogChoices,generationIssues,listingIssues,listingSizes,listingStateLabels,validateListingPhoto,MAX_LISTING_PHOTOS} from '../lib/listingStudio'
import {applyListingPresets} from '../lib/listingSettings'

// Atelier d'annonces : la file des articles du compte à gauche, l'article choisi à droite.
// Pour publier à la main, le « mode publication » suit l'ordre du formulaire Vinted, ligne par ligne.
const field='w-full rounded-lg border border-[#e3ded6] bg-white px-3 py-2 text-sm text-[#323630] placeholder:text-[#a8a39b] focus:border-[#087f5b] focus:outline-none focus:ring-2 focus:ring-[#087f5b]/20 disabled:bg-[#f6f3ee] disabled:text-[#79756f]'
const ghost='rounded-lg border border-[#e3ded6] bg-white px-3 py-2 text-sm font-medium text-[#323630] hover:border-[#c9c2b7] hover:bg-[#fbfaf7] disabled:opacity-40'
const solid='rounded-lg bg-[#087f5b] px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_8px_#087f5b33] hover:bg-[#08664c] disabled:opacity-40 disabled:shadow-none'
const quiet='text-sm font-medium text-[#08664c] underline decoration-[#087f5b]/40 underline-offset-4 hover:decoration-[#087f5b] disabled:opacity-40'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const hour=v=>new Date(v).toLocaleString('fr-FR',{weekday:'short',hour:'2-digit',minute:'2-digit'})
const titleOf=(rows,id)=>(rows||[]).find(r=>r.id===id)?.title||null
const byName=(a,b)=>a.name.localeCompare(b.name,'fr',{numeric:true})
const euros=v=>v?`${String(v).replace('.',',')} €`:'—'

// Où en est un article : ce qui reste à faire, du dépôt des photos à la publication.
export function cardStage(card,options){
 const {row,fields,photos}=card
 if(row.state==='published')return 'published'
 if(row.state!=='draft')return 'dotb'
 if(!fields.title?.trim())return generationIssues(fields,photos).length?'inputs':'prepare'
 if(fields.catalog_id&&!options)return 'loading'
 return listingIssues(fields,photos,options).length?'review':'ready'
}
// Les étapes, dans l'ordre où un article les traverse. « loading » se range avec la vérification.
export const STEPS=[
 {key:'inputs',label:'À compléter',hint:'Photos, SKU, taille et prix',dot:'bg-[#b8b2a8]'},
 {key:'prepare',label:'À rédiger',hint:'Titre et description par l’IA',dot:'bg-sky-500'},
 {key:'review',label:'À vérifier',hint:'Un choix manque',dot:'bg-amber-500'},
 {key:'ready',label:'Prêtes',hint:'À mettre en ligne',dot:'bg-[#087f5b]'},
 {key:'dotb',label:'Chez Dotb',hint:'Envoi ou brouillon',dot:'bg-blue-500'},
 {key:'published',label:'En ligne',hint:'Depuis hier',dot:'bg-[#c83469]'}
]
const stepOf=stage=>stage==='loading'?'review':stage

// Regroupe les photos déposées en articles, dans l'ordre des noms de fichiers (01, 02…).
export function groupFiles(files,size){
 const sorted=[...files].sort(byName),groups=[]
 for(let i=0;i<sorted.length;i+=size)groups.push(sorted.slice(i,i+size))
 return groups
}

export default function ListingSession({request,upload,account,meta,onBack,onOpenDraft}){
 const cards=useRef(new Map()),optionCache=useRef(new Map()),alive=useRef(true),settingsRef=useRef(null),dragDepth=useRef(0)
 const [order,setOrder]=useState([]),[,setTick]=useState(0)
 const [settings,setSettings]=useState(null),[dotb,setDotb]=useState(false),[serverDotb,setServerDotb]=useState(!!meta.dotb_publish_enabled)
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [dropped,setDropped]=useState(null),[showSettings,setShowSettings]=useState(false),[copied,setCopied]=useState('')
 const [selected,setSelected]=useState(null),[filter,setFilter]=useState('all'),[dragging,setDragging]=useState(false),[photoIndex,setPhotoIndex]=useState(0)
 const choices=useMemo(()=>catalogChoices(meta.catalogs||[]),[meta.catalogs])
 // Rédaction automatique : dès qu'un article a ses photos et sa taille, l'IA l'écrit (3 à la fois au plus).
 const aiSlots=useRef(0),aiWaiters=useRef([]),aiPaused=useRef(false),[autoWrite,setAutoWrite]=useState(()=>{try{return localStorage.getItem('listing-auto-write')!=='off'}catch{return true}})
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
 // La rédaction automatique attend 2 secondes sans frappe, pour ne jamais partir au milieu d'une saisie.
 function touch(card){card.dirty=true;card.rev++;card.error='';card.editedAt=Date.now();clearTimeout(card.timer);card.timer=setTimeout(()=>save(card).catch(()=>{}),900);clearTimeout(card.idle);card.idle=setTimeout(render,2100);render()}
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
   const card=remember(draft);setOrder(old=>[card.id,...old.filter(id=>id!==card.id)]);if(g===0){setSelected(card.id);setPhotoIndex(0);setFilter('all')}
   await uploadInto(card,groups[g],(i,n)=>setBusy(`${label} : photo ${i} sur ${n}…`))
  }
  setNotice(groups.length>1?`${groups.length} articles ajoutés. Indique le SKU, la taille et le prix de chacun, puis lance la rédaction par l’IA.`:'Article ajouté. Indique son SKU, sa taille et son prix.')
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
 // Tous les déclencheurs partagent les mêmes trois places, y compris les clics pendant une rédaction automatique.
 async function writeCard(card){
  card.autoTried=true
  return act(card,'Rédaction…',async()=>{
   if(aiSlots.current>=3)await new Promise(resolve=>aiWaiters.current.push(resolve));else aiSlots.current++
   try{
    if(aiPaused.current)throw Error('Rédaction en pause : quota IA atteint. Réessaie plus tard.')
    if(!alive.current)return
    return await prepare(card)
   }catch(e){if(/quota/i.test(e.message)){aiPaused.current=true;setError(e.message)}throw e}
   finally{const next=aiWaiters.current.shift();if(next)next();else aiSlots.current--;render()}
  })
 }
 const prepareOne=card=>{aiPaused.current=false;return writeCard(card).catch(()=>{})}
 // Plusieurs articles sont rédigés en même temps (3 au plus) : un lot de 9 prend le temps de 3.
 async function prepareAll(){
  aiPaused.current=false
  const waiting=list().filter(c=>c.row.state==='draft'&&!c.fields.title?.trim())
  const ready=waiting.filter(c=>!generationIssues(c.fields,c.photos).length&&!c.busy)
  if(!ready.length)throw Error(waiting.length?'Indique d’abord le SKU, la taille et le prix des articles à rédiger.':'Tous les articles ont déjà leur texte.')
  let done=0,failed=0,next=0,stop=false
  const worker=async()=>{while(!stop&&next<ready.length){const card=ready[next++];setBusy(`Rédaction : ${done+failed} sur ${ready.length} terminées…`);try{await writeCard(card);done++}catch(e){failed++;if(/quota/i.test(e.message)){stop=true;setError(e.message)}}}}
  await Promise.all(Array.from({length:Math.min(3,ready.length)},worker))
  setNotice([`${done} article${done>1?'s':''} rédigé${done>1?'s':''}.`,waiting.length>ready.length?`${waiting.length-ready.length} attend${waiting.length-ready.length>1?'ent':''} encore son SKU, sa taille, son prix ou ses photos.`:'',failed?`${failed} en erreur : regarde l’article concerné.`:''].filter(Boolean).join(' '))
 }
 useEffect(()=>{
  if(!autoWrite||meta.ai_ready===false||busy||loading||aiPaused.current)return
  let available=3-aiSlots.current-aiWaiters.current.length
  for(const card of list()){
   if(available<=0)break
   if(card.row.state!=='draft'||card.fields.title?.trim()||card.row.ai_updated_at||card.autoTried||card.busy||card.dirty||Date.now()-(card.editedAt||0)<2000||generationIssues(card.fields,card.photos).length)continue
   available--;writeCard(card).catch(()=>{})
  }
 })

 async function copy(card,key,text){
  try{await navigator.clipboard.writeText(text)}catch{
   // Ancien navigateur ou page non sécurisée : copie par une zone de texte temporaire.
   const area=document.createElement('textarea')
   try{area.value=text;document.body.appendChild(area);area.select?.();if(document.execCommand?.('copy')!==true)throw Error('copy unavailable')}catch{setError('La copie automatique est indisponible : reviens à la fiche pour sélectionner le texte.');return false}finally{area.remove()}
  }
  setCopied(`${card.id}:${key}`);setTimeout(()=>{if(alive.current)setCopied(v=>v===`${card.id}:${key}`?'':v)},2000)
  return true
 }
 const download=card=>act(card,'Préparation des photos…',async()=>{
  const {draft}=await request('GET',undefined,`action=draft&id=${card.id}`)
  const {exportListing,downloadListingFile}=await import('../lib/listingExport')
  downloadListingFile(await exportListing(draft,account,meta,optionsFor(draft.fields.catalog_id),{onProgress:label=>{card.busy=label;render()}}))
  return true
 }).catch(()=>false)
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
  setNotice(`${done} annonce${done>1?'s':''} transmise${done>1?'s':''} à Dotb sur ${ready.length}. ${mode==='draft'?'Dotb crée les brouillons sur Vinted un par un, à l’heure indiquée sur chaque article : il te restera à les publier depuis Vinted.':'Dotb les publie une par une, à l’heure indiquée sur chaque article.'}`)
 }
 const refresh=card=>act(card,'Vérification…',async()=>accept(card,(await request('POST',{action:'refresh',id:card.id})).draft)).catch(()=>{})
 const discard=card=>act(card,'Retrait…',async()=>{await request('POST',{action:'discard',id:card.id,version:card.row.version});advance(card);cards.current.delete(card.id);setOrder(old=>old.filter(id=>id!==card.id))}).catch(()=>{})
 async function saveAll(){for(const c of cards.current.values())if(c.dirty)await save(c)}
 const openFull=card=>withBusy('Enregistrement…',async()=>{await saveAll();onOpenDraft(card.row)})

 // ——— Ce qui est affiché ———
 const rows=list(),staged=rows.map(c=>[c,cardStage(c,optionsFor(c.fields.catalog_id))])
 const stageById=new Map(staged.map(([c,s])=>[c.id,s]))
 const counts=Object.fromEntries(STEPS.map(s=>[s.key,staged.filter(([,x])=>stepOf(x)===s.key).length]))
 const visible=staged.filter(([,s])=>filter==='all'||stepOf(s)===filter)
 const working=!!busy||rows.some(c=>c.busy)
 const toPrepare=rows.filter(c=>c.row.state==='draft'&&!c.fields.title?.trim()&&!generationIssues(c.fields,c.photos).length).length
 const firstActive=visible.find(([,s])=>s!=='published')?.[0]||visible[0]?.[0]||null
 const current=visible.find(([c])=>c.id===selected)?.[0]||firstActive
 const nav=visible.map(([c])=>c.id),position=current?nav.indexOf(current.id):-1
 function select(id){if(id===current?.id)return;setSelected(id);setPhotoIndex(0)}
 // Après une publication, on passe à l'article prêt suivant (sinon au suivant de la file).
 function advance(from){
  const ids=staged.map(([c])=>c.id),start=ids.indexOf(from.id)
  const after=[...staged.slice(start+1),...staged.slice(0,start)]
  const next=after.find(([c,s])=>c.id!==from.id&&s==='ready')||after.find(([c,s])=>c.id!==from.id&&s!=='published')
  if(next){if(filter!=='all'&&stepOf(next[1])!==filter)setFilter('all');select(next[0].id)}
 }
 const steps=STEPS.filter(s=>s.key!=='dotb'||counts.dotb||dotb)
 const stepFor=stage=>STEPS.find(s=>s.key===stepOf(stage))

 function onDragEnter(e){if(!e.dataTransfer?.types?.includes('Files'))return;e.preventDefault();dragDepth.current++;setDragging(true)}
 function onDragLeave(){dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false)}
 function onDrop(e){e.preventDefault();dragDepth.current=0;setDragging(false);if(!busy)drop(e.dataTransfer.files)}
 useEffect(()=>{if(!showSettings)return;const close=e=>{if(e.key==='Escape')setShowSettings(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[showSettings])

 function pill(stage,card){
  const step=stepFor(stage),label=stage==='loading'?'Chargement…':stage==='dotb'?listingStateLabels[card.row.state]:step.label
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e8e4dd] bg-[#fffefa] px-2.5 py-1 text-xs font-medium text-[#4a4e47]"><span className={`h-2 w-2 rounded-full ${card.row.state==='attention'?'bg-amber-500':step.dot}`}/>{label}</span>
 }

 function queueItem(card,stage){
  const f=card.fields,on=current?.id===card.id,step=stepFor(stage)
  return <li key={card.id}><button type="button" onClick={()=>select(card.id)} aria-current={on?'true':undefined} aria-label={f.title||f.sku||'Nouvel article'} className={`relative flex w-full items-center gap-3 rounded-xl py-2 pl-3 pr-2.5 text-left ${on?'bg-white shadow-[0_6px_18px_#4c3d2614] ring-1 ring-[#087f5b]/35':'hover:bg-white/70'}`}>
   {on&&<span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[#087f5b]"/>}
   <span className="h-14 w-11 shrink-0 overflow-hidden rounded-md bg-[#efebe4]">{card.photos[0]?.url?<img src={card.photos[0].url} alt="" className="h-full w-full object-cover"/>:<span className="grid h-full place-items-center text-lg text-[#c2bcb2]">+</span>}</span>
   <span className="min-w-0 flex-1"><span className={`line-clamp-2 text-[13px] leading-snug ${f.title?'font-medium text-[#323630]':'text-[#79756f]'}`}>{f.title||f.sku||'Nouvel article'}</span>
    <span className="mt-1 flex items-center gap-1.5 text-xs text-[#79756f]"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${card.row.state==='attention'?'bg-amber-500':step.dot}`}/><span className="truncate">{card.busy||(stage==='loading'?'Chargement…':stage==='dotb'?listingStateLabels[card.row.state]:step.label)}</span></span></span>
   <span className="shrink-0 text-xs tabular-nums text-[#79756f]">{f.price?euros(f.price):''}</span>
  </button></li>
 }

 function gallery(card){
  const editable=card.row.state==='draft'&&!card.row.dotb_item_id&&!card.busy,index=Math.min(photoIndex,Math.max(0,card.photos.length-1)),photo=card.photos[index]
  const move=(from,to)=>{const next=[...card.photos];const [item]=next.splice(from,1);next.splice(to,0,item);setPhotos(card,next);setPhotoIndex(to)}
  return <div className="space-y-2.5">
   <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-[#efebe4]">
    {photo?.url?<img src={photo.url} alt={`Photo ${index+1} de l’article`} className="h-full w-full object-contain"/>:<label className="grid h-full cursor-pointer place-items-center p-6 text-center text-sm text-[#79756f]"><span><span className="block text-3xl text-[#c2bcb2]">+</span>Ajoute les photos de cet article<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Ajouter des photos à cet article" disabled={!editable} onChange={e=>{const files=Array.from(e.target.files||[]).sort(byName);e.target.value='';uploadInto(card,files).catch(()=>{})}}/></span></label>}
    {photo&&index===0&&<span className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-[#323630]">Couverture</span>}
    {photo&&<span className="absolute bottom-2.5 right-2.5 rounded-full bg-[#323630]/75 px-2 py-0.5 text-[11px] tabular-nums text-white">{index+1} / {card.photos.length}</span>}
   </div>
   {!!card.photos.length&&<div className="flex flex-wrap gap-1.5">
    {card.photos.map((p,i)=><button type="button" key={p.path} onClick={()=>setPhotoIndex(i)} aria-label={`Voir la photo ${i+1}`} aria-pressed={i===index} className={`h-14 w-11 overflow-hidden rounded-md bg-[#efebe4] ${i===index?'ring-2 ring-[#087f5b] ring-offset-1':'opacity-80 hover:opacity-100'}`}><img src={p.url} alt="" className="h-full w-full object-cover"/></button>)}
    {editable&&card.photos.length<MAX_LISTING_PHOTOS&&<label className="grid h-14 w-11 cursor-pointer place-items-center rounded-md border border-dashed border-[#c9c2b7] text-lg text-[#79756f] hover:border-[#087f5b] hover:text-[#087f5b]" title="Ajouter des photos">+<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Ajouter des photos à cet article" onChange={e=>{const files=Array.from(e.target.files||[]).sort(byName);e.target.value='';uploadInto(card,files).catch(()=>{})}}/></label>}
   </div>}
   {editable&&photo&&<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
    {index>0&&<button type="button" className={quiet+' !text-xs'} onClick={()=>move(index,0)}>Mettre en couverture</button>}
    {index>0&&<button type="button" className={quiet+' !text-xs'} aria-label={`Avancer la photo ${index+1}`} onClick={()=>move(index,index-1)}>← Avancer</button>}
    {index<card.photos.length-1&&<button type="button" className={quiet+' !text-xs'} aria-label={`Reculer la photo ${index+1}`} onClick={()=>move(index,index+1)}>Reculer →</button>}
    <button type="button" className="text-xs text-rose-700 underline underline-offset-4" aria-label={`Retirer la photo ${index+1}`} onClick={()=>{setPhotos(card,card.photos.filter((_,n)=>n!==index));setPhotoIndex(Math.max(0,index-1))}}>Retirer</button>
   </div>}
  </div>
 }

 // Longueur du titre : la recherche Vinted favorise les titres complets (80 à 100 caractères).
 function lengthMeter(length){
  const good=length>=80,ok=length>=60
  return <div className="mt-1.5 flex items-center gap-3"><div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#efebe4]" aria-hidden="true"><span className="absolute inset-y-0 left-[80%] right-0 bg-[#087f5b]/15"/><span className={`absolute inset-y-0 left-0 rounded-full ${good?'bg-[#087f5b]':ok?'bg-amber-400':'bg-[#c9c2b7]'}`} style={{width:`${Math.min(100,length)}%`}}/></div><span className={`shrink-0 text-xs tabular-nums ${good?'text-[#08664c]':ok?'text-amber-800':'text-[#79756f]'}`}>{length} / 100{good?' · bonne longueur':' · ajoute couleur, matière, coupe ou occasion'}</span></div>
 }

 function fiche(card,options,stage){
  const f=card.fields,locked=!!card.busy,search=card.categorySearch||'',issues=stage==='review'?listingIssues(f,card.photos,options):[]
  const missing=key=>issues.some(i=>i.key===key)
  const filtered=search?choices.filter(c=>c.label.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))).slice(0,300):choices
  const category=choices.find(c=>c.id===f.catalog_id)
  const row=(label,key,control,hint)=><div key={label} className="grid gap-1.5 px-4 py-3 sm:grid-cols-[9.5rem_1fr] sm:items-center"><dt className={`flex items-center gap-2 text-sm ${missing(key)?'font-medium text-amber-900':'text-[#79756f]'}`}>{missing(key)&&<span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true"/>}{label}</dt><dd className="min-w-0">{control}{hint&&<p className="mt-1 text-xs text-[#79756f]">{hint}</p>}</dd></div>
  const select=(label,value,list,onChange,empty='Choisir…')=><select aria-label={label} className={field} value={value||''} onChange={e=>onChange(e.target.value?Number(e.target.value):null)}><option value="">{empty}</option>{list.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select>
  const loadingOptions=f.catalog_id&&!options
  return <fieldset disabled={locked} className="space-y-5">
   <label className="block"><span className="text-sm font-medium text-[#323630]">Titre</span><textarea rows={2} className={field+' mt-1.5 resize-none text-[17px] font-semibold leading-snug'} maxLength={100} value={f.title} onChange={e=>edit(card,{title:e.target.value.replace(/\s*\n\s*/g,' ')})}/>{lengthMeter(f.title.length)}</label>
   <label className="block"><span className="flex items-baseline justify-between text-sm font-medium text-[#323630]">Description<span className="text-xs font-normal tabular-nums text-[#79756f]">{f.description.length} / 2000</span></span><textarea className={field+' mt-1.5 min-h-48 leading-relaxed'} maxLength={2000} value={f.description} onChange={e=>edit(card,{description:e.target.value})}/></label>
   {card.row.message&&<p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-950"><span className="font-medium">À relire :</span> {card.row.message}</p>}
   <dl className="divide-y divide-[#eee9e1] rounded-2xl border border-[#e8e4dd] bg-[#fffefa]">
    {row('Catégorie','category',<div className="space-y-1.5"><input className={field} placeholder="Rechercher une catégorie…" value={search} onChange={e=>{card.categorySearch=e.target.value;render()}}/><select aria-label="Catégorie Vinted" className={field} value={f.catalog_id||''} onChange={e=>changeCategory(card,Number(e.target.value)||null)}><option value="">Choisir la catégorie</option>{category&&!filtered.some(c=>c.id===category.id)&&<option value={category.id}>{category.label}</option>}{filtered.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></div>)}
    {loadingOptions?<p className="px-4 py-3 text-sm text-[#79756f]">{optionCache.current.get(Number(f.catalog_id)) instanceof Error?'Les options de cette catégorie n’ont pas pu être chargées. Actualise la session.':'Chargement des tailles et des options…'}</p>:options&&<>
     {!!listingSizes(options).length&&row('Taille Vinted','size',select('Taille Vinted',f.size_id,listingSizes(options),size_id=>edit(card,{size_id})),f.size_text?`Taille notée : ${f.size_text}`:null)}
     {!!options.conditions?.length&&row('État','condition',select('État',f.status_id,options.conditions,status_id=>edit(card,{status_id})))}
     {!!options.package_sizes?.length&&!options.parcel_measurements&&row('Colis','package',select('Format du colis',f.package_size_id,options.package_sizes,package_size_id=>edit(card,{package_size_id})))}
     {options.parcel_measurements&&row('Colis','package',<p className="text-sm text-amber-900">Cette catégorie demande les dimensions du colis : renseigne-les dans Dotb ou sur Vinted.</p>)}
     {(options.attributes||[]).map(a=>{const ids=f.item_attributes.find(x=>x.code===a.code)?.ids||[],multi=(a.selection_limit||1)>1;return row(`${a.title}${a.required?'':' (facultatif)'}`,`attribute-${a.code}`,<select aria-label={a.title} className={field} multiple={multi} value={multi?ids.map(String):String(ids[0]||'')} onChange={e=>{const chosen=Array.from(e.target.selectedOptions).map(o=>Number(o.value)).filter(Boolean);edit(card,{item_attributes:[...f.item_attributes.filter(x=>x.code!==a.code),...(chosen.length?[{code:a.code,ids:chosen}]:[])]})}}>{!multi&&<option value="">Choisir…</option>}{a.options.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select>)})}
    </>}
    {row('Couleurs','color',<div className="grid gap-1.5 sm:grid-cols-2">{select('Couleur principale',f.color_ids[0],meta.colors||[],id=>edit(card,{color_ids:id?[id,...f.color_ids.slice(1).filter(v=>v!==id)]:[]}))}{select('Deuxième couleur',f.color_ids[1],(meta.colors||[]).filter(c=>c.id!==f.color_ids[0]),id=>edit(card,{color_ids:id?[...f.color_ids.slice(0,1),id]:f.color_ids.slice(0,1)}),'Pas de deuxième couleur')}</div>)}
    {row('Marque','brand',<div className="flex flex-wrap items-center gap-3 text-sm"><span className="font-medium">{f.brand_id===1?'Sans marque':f.brand_title||'À choisir'}</span>{f.brand_id!==1&&<button type="button" className={ghost+' !py-1'} onClick={()=>edit(card,{brand_id:1,brand_title:'Sans marque'})}>Sans marque</button>}<button type="button" className={quiet} onClick={()=>openFull(card)}>Chercher une marque</button></div>)}
   </dl>
   <label className="block text-sm font-medium text-[#323630]">Détails à mentionner <span className="font-normal text-[#79756f]">(facultatif, pris en compte à la prochaine rédaction)</span><textarea className={field+' mt-1.5 min-h-16'} maxLength={1500} value={f.notes} placeholder="Défauts, matière vérifiée, mesures…" onChange={e=>edit(card,{notes:e.target.value})}/></label>
  </fieldset>
 }

 // Essentiel saisi à la main : SKU, taille et prix. Toujours visible tant que l'article n'est pas parti.
 function essentials(card,stage){
  const f=card.fields,editable=card.row.state==='draft',needs=stage==='inputs'?generationIssues(f,card.photos):stage==='review'?listingIssues(f,card.photos,optionsFor(f.catalog_id)):[]
  const warn=key=>needs.some(i=>i.key===key)?' !border-amber-400 bg-amber-50/40':''
  if(!editable)return <p className="text-sm text-[#79756f]">{[f.sku&&`SKU ${f.sku}`,f.size_text&&`taille ${f.size_text}`,f.price&&euros(f.price)].filter(Boolean).join(', ')}</p>
  return <fieldset disabled={!!card.busy} className="grid grid-cols-[1.6fr_1fr_1fr] gap-2.5">
   <label className="text-xs font-medium text-[#79756f]">SKU Shein<input className={field+' mt-1'+warn('sku')} value={f.sku} maxLength={200} placeholder="sz…" onChange={e=>edit(card,{sku:e.target.value})}/></label>
   <label className="text-xs font-medium text-[#79756f]">Taille<input className={field+' mt-1'+warn('size-text')} value={f.size_text} maxLength={80} placeholder="M" onChange={e=>edit(card,{size_text:e.target.value,size_id:null})}/></label>
   <label className="text-xs font-medium text-[#79756f]">Prix (€)<input className={field+' mt-1 tabular-nums'+warn('price')} inputMode="decimal" value={String(f.price||'').replace('.',',')} maxLength={12} placeholder="24,90" onChange={e=>edit(card,{price:e.target.value})}/></label>
  </fieldset>
 }

 // Mode publication : les champs dans l'ordre du formulaire « Vends ton article » de Vinted.
 function publishMode(card,options){
  const f=card.fields,checks=card.checks||(card.checks=new Set()),tick=key=>{checks.has(key)?checks.delete(key):checks.add(key);render()}
  const isCopied=key=>copied===`${card.id}:${key}`
  const category=choices.find(c=>c.id===f.catalog_id)?.label
  const lines=[
   {key:'photos',label:'Photos',value:`${card.photos.length} photo${card.photos.length>1?'s':''}, la couverture en premier`,action:<button type="button" className={ghost+' !py-1.5'} disabled={!!card.busy} onClick={async()=>{if(await download(card)){checks.add('photos');render()}}}>Télécharger</button>},
   {key:'title',label:'Titre',value:f.title,copy:f.title},
   {key:'description',label:'Description',value:f.description.split('\n')[0],copy:f.description},
   {key:'category',label:'Catégorie',value:category},
   {key:'brand',label:'Marque',value:f.brand_id===1?'Sans marque':f.brand_title},
   ...(listingSizes(options).length?[{key:'size',label:'Taille',value:titleOf(listingSizes(options),f.size_id)}]:[]),
   ...(options?.conditions?.length?[{key:'condition',label:'État',value:titleOf(options.conditions,f.status_id)}]:[]),
   {key:'color',label:'Couleur',value:f.color_ids.map(id=>titleOf(meta.colors,id)).filter(Boolean).join(', ')},
   ...(options?.attributes||[]).filter(a=>f.item_attributes.some(v=>v.code===a.code&&v.ids.length)).map(a=>({key:`attribute-${a.code}`,label:a.title,value:f.item_attributes.find(v=>v.code===a.code).ids.map(id=>titleOf(a.options,id)).join(', ')})),
   {key:'price',label:'Prix',value:euros(f.price),copy:String(f.price).replace('.',',')},
   ...(options?.package_sizes?.length&&!options.parcel_measurements?[{key:'package',label:'Colis',value:titleOf(options.package_sizes,f.package_size_id)}]:[])
  ]
  const done=lines.filter(l=>checks.has(l.key)).length
  return <section aria-label="Publier sur Vinted" className="overflow-hidden rounded-2xl border border-[#d9e9e1] bg-white shadow-[0_10px_30px_#4c3d2612]">
   <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e8e4dd] bg-[#f3f8f5] px-4 py-4 sm:px-5">
    <div className="min-w-0"><h2 className="text-lg font-semibold text-[#323630]">Publier sur Vinted</h2><p className="mt-1 text-sm text-[#5d615a]">Dans AdsPower, ouvre <strong className="font-semibold">#{account.profile_number||'—'} {account.login}</strong> puis « Vends tes articles ». Suis les lignes dans l’ordre du formulaire : copier une ligne la coche.</p></div>
    <button type="button" className={quiet} onClick={()=>{card.publishing=false;render()}}>Revenir à la fiche</button>
   </header>
   <div className="h-1 bg-[#efebe4]" aria-hidden="true"><div className="h-full bg-[#087f5b] transition-[width] duration-300" style={{width:`${Math.round(done/lines.length*100)}%`}}/></div>
   <ol className="divide-y divide-[#eee9e1]">{lines.map((l,i)=>{const on=checks.has(l.key);return <li key={l.key} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${on?'bg-[#fafcfb]':''}`}>
    <button type="button" onClick={()=>tick(l.key)} aria-pressed={on} aria-label={`${l.label} : ${on?'fait':'à faire'}`} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums ${on?'border-[#087f5b] bg-[#087f5b] text-white':'border-[#d6d0c6] bg-white text-[#79756f] hover:border-[#087f5b]'}`}>{on?'✓':i+1}</button>
    <div className="min-w-0 flex-1"><p className="text-xs text-[#79756f]">{l.label}</p><p className={`truncate text-sm ${l.value?'text-[#323630]':'text-amber-800'} ${on?'opacity-60':''}`}>{l.value||'À choisir sur Vinted'}</p></div>
    {l.copy!=null?<button type="button" className={(isCopied(l.key)?solid:ghost)+' !py-1.5 shrink-0'} onClick={async()=>{if(await copy(card,l.key,l.copy)){checks.add(l.key);render()}}}>{isCopied(l.key)?'Copié ✓':'Copier'}</button>:l.action||null}
   </li>})}</ol>
   <form className="space-y-2 border-t border-[#e8e4dd] bg-[#fbfaf7] px-4 py-4 sm:px-5" onSubmit={e=>{e.preventDefault();if(card.link.trim())published(card).then(()=>{if(card.row.state==='published'){setNotice(`« ${f.title.slice(0,60)}${f.title.length>60?'…':''} » est notée publiée.`);advance(card)}})}}>
    <label className="block text-sm font-medium text-[#323630]">Une fois publiée, colle le lien de l’annonce<input aria-label={`Lien Vinted de ${f.title}`} className={field+' mt-1.5'} inputMode="url" placeholder="https://www.vinted.fr/items/…" value={card.link} disabled={!!card.busy} onChange={e=>{card.link=e.target.value;render()}}/></label>
    <button className={solid+' w-full'} disabled={!!card.busy||!card.link.trim()}>{card.busy||'Noter comme publiée et passer à la suivante'}</button>
   </form>
  </section>
 }

 // Suivi Dotb : création, photos, puis mise en ligne ou brouillon à l'heure prévue.
 function dotbStatus(card){
  const r=card.row,draftMode=r.dotb_publish===false,locked=!!card.busy
  const stepsDone=[['Fiche créée chez Dotb',!!r.dotb_item_id],['Photos envoyées',!!r.dotb_item_id&&r.uploaded>=card.photos.length],[draftMode?`Brouillon prévu${r.scheduled_at?` ${hour(r.scheduled_at)}`:''}`:`Mise en ligne prévue${r.scheduled_at?` ${hour(r.scheduled_at)}`:''}`,['scheduled','published','vinted_draft'].includes(r.state)],[draftMode?'Brouillon sur Vinted':'En ligne sur Vinted',['published','vinted_draft'].includes(r.state)]]
  return <section aria-label="Suivi de l’envoi Dotb" className="space-y-4 rounded-2xl border border-[#e8e4dd] bg-white p-4 sm:p-5">
   <p className={`rounded-xl px-4 py-3 text-sm ${r.state==='attention'||r.last_error?'bg-amber-50 text-amber-950':'bg-[#f1f6fb] text-[#1d3b5c]'}`}>{r.last_error||r.message}</p>
   <ol className="grid gap-2 sm:grid-cols-2">{stepsDone.map(([label,ok],i)=><li key={label} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${ok?'border-[#cfe6da] text-[#08664c]':'border-[#e8e4dd] text-[#79756f]'}`}><span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${ok?'bg-[#087f5b] text-white':'bg-[#efebe4]'}`}>{ok?'✓':i+1}</span>{label}</li>)}</ol>
   <div className="flex flex-wrap gap-2">{r.state==='preparing'&&<button className={ghost} disabled={locked||!!busy} onClick={()=>act(card,'Reprise de l’envoi…',()=>sendDotb(card,draftMode?'draft':'live')).catch(()=>{})}>Reprendre l’envoi</button>}{['scheduled','attention'].includes(r.state)&&<button className={ghost} disabled={locked} onClick={()=>refresh(card)}>Vérifier maintenant</button>}{r.state==='attention'&&<a className={ghost} href="https://dotb.io" target="_blank" rel="noreferrer">Ouvrir Dotb</a>}</div>
   {r.state==='vinted_draft'&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();if(card.link.trim())published(card).then(()=>{if(card.row.state==='published')advance(card)})}}><label className="block text-sm font-medium">Brouillon publié sur Vinted ? Colle le lien de l’annonce<input aria-label={`Lien Vinted de ${card.fields.title}`} className={field+' mt-1.5'} inputMode="url" placeholder="https://www.vinted.fr/items/…" value={card.link} disabled={locked} onChange={e=>{card.link=e.target.value;render()}}/></label><button className={solid} disabled={locked||!card.link.trim()}>Noter comme publiée</button></form>}
  </section>
 }

 function actionBar(card,stage){
  const locked=!!card.busy,issues=stage==='review'?listingIssues(card.fields,card.photos,optionsFor(card.fields.catalog_id)):[],needs=stage==='inputs'?generationIssues(card.fields,card.photos):[]
  const prev=position>0?nav[position-1]:null,next=position>=0&&position<nav.length-1?nav[position+1]:null
  return <div className="sticky bottom-0 z-10 -mx-1 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e8e4dd] bg-[#fffefa]/95 px-3 py-2.5 shadow-[0_-6px_20px_#4c3d260f] backdrop-blur">
   <div className="flex items-center gap-1"><button type="button" className={ghost+' !px-2.5'} disabled={!prev} onClick={()=>select(prev)} aria-label="Article précédent">←</button><span className="px-1.5 text-xs tabular-nums text-[#79756f]">{position+1} sur {nav.length}</span><button type="button" className={ghost+' !px-2.5'} disabled={!next} onClick={()=>select(next)} aria-label="Article suivant">→</button></div>
   <div className="flex flex-wrap items-center justify-end gap-2">
    {stage==='inputs'&&<><span className="text-xs text-[#79756f]">Ajoute {needs.map(i=>i.label).join(', ')}</span><button className={solid} disabled>Rédiger avec l’IA</button></>}
    {stage==='prepare'&&<button className={solid} disabled={locked||!!busy} onClick={()=>prepareOne(card)}>{card.busy||'Rédiger avec l’IA'}</button>}
    {stage==='loading'&&<span className="text-xs text-[#79756f]">Chargement des options…</span>}
    {stage==='review'&&<><span className="text-xs text-amber-900">{issues.length} choix à faire : {issues.map(i=>i.label).join(', ')}</span><button className={solid} disabled>Publier</button></>}
    {stage==='ready'&&<>{dotb&&<><button className={ghost} disabled={locked||!!busy} onClick={()=>sendOne(card,'draft')}>Brouillon Vinted via Dotb</button><button className={ghost} disabled={locked||!!busy} onClick={()=>sendOne(card,'live')}>En ligne via Dotb</button></>}{!card.publishing&&<button className={solid} disabled={locked} onClick={()=>{card.publishing=true;render()}}>Publier sur Vinted</button>}</>}
    {(stage==='dotb'||stage==='published')&&next&&<button className={ghost} onClick={()=>select(next)}>Article suivant</button>}
   </div>
  </div>
 }

 function detail(card){
  const stage=stageById.get(card.id),options=optionsFor(card.fields.catalog_id),editable=card.row.state==='draft'
  const publishing=card.publishing&&stage==='ready'
  return <article aria-label={card.fields.title||card.fields.sku||'Nouvel article'} className="min-w-0">
   <div className="grid gap-6 xl:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
    <div className={`mx-auto w-full max-w-[260px] xl:sticky xl:top-24 xl:max-w-none xl:self-start ${publishing?'hidden xl:block':''}`}>{gallery(card)}</div>
    <div className="min-w-0 space-y-5">
     <div className="flex flex-wrap items-center justify-between gap-2">{pill(stage,card)}<span role="status" className="text-xs text-[#79756f]">{card.busy||(card.dirty?'Enregistrement…':editable?'Enregistré':'')}</span></div>
     {card.error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{card.error}{card.dirty&&<button className={quiet+' ml-2'} disabled={!!card.busy} onClick={()=>save(card).catch(()=>{})}>Réessayer l’enregistrement</button>}</p>}
     {publishing?publishMode(card,options):<>
      {essentials(card,stage)}
      {stage==='dotb'&&dotbStatus(card)}
      {stage==='published'&&<p className="rounded-xl border border-[#cfe6da] bg-[#f1f8f4] px-4 py-3 text-sm text-[#08664c]">En ligne{card.row.published_at?` depuis ${hour(card.row.published_at)}`:''}. {card.row.url&&<a className="font-medium underline underline-offset-4" href={card.row.url} target="_blank" rel="noopener noreferrer">Voir l’annonce sur Vinted</a>}</p>}
      {editable&&!card.fields.title?.trim()?<div className="rounded-2xl border border-dashed border-[#c9dccf] bg-[#f6faf7] p-5"><p className="font-medium text-[#323630]">{card.busy==='Rédaction…'?'L’IA rédige cet article…':autoWrite&&stage==='prepare'?'La rédaction va démarrer.':'L’IA rédige le titre, la description, la catégorie et les couleurs à partir des photos.'}</p><p className="mt-1 text-sm text-[#5d615a]">Tes réglages complètent ensuite l’état ({settings?.effective?.condition?.toLocaleLowerCase('fr')||'—'}), le colis et la marque. Tu pourras tout modifier.</p>
       <label className="mt-4 block text-sm font-medium text-[#323630]">Détails à mentionner <span className="font-normal text-[#79756f]">(facultatif)</span><textarea className={field+' mt-1.5 min-h-16'} maxLength={1500} disabled={!!card.busy} value={card.fields.notes} placeholder="Défauts, matière vérifiée, mesures…" onChange={e=>edit(card,{notes:e.target.value})}/></label></div>
      :editable?fiche(card,options,stage):<div className="space-y-2 rounded-2xl border border-[#e8e4dd] bg-white p-4 sm:p-5"><p className="text-[17px] font-semibold leading-snug">{card.fields.title}</p><p className="whitespace-pre-line text-sm leading-relaxed text-[#5d615a]">{card.fields.description}</p></div>}
      {editable&&<div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#eee9e1] pt-4">{card.fields.title&&<button type="button" className={quiet} disabled={!!card.busy||!!busy} onClick={()=>prepareOne(card)}>Refaire le texte avec l’IA</button>}<button type="button" className={quiet} onClick={()=>openFull(card)}>Ouvrir la fiche complète</button><span className="flex-1"/>
       {!card.row.dotb_item_id&&(card.confirm?<span className="flex items-center gap-2 text-sm">Retirer cet article ?<button type="button" className={ghost+' !text-rose-700'} onClick={()=>discard(card)}>Oui, retirer</button><button type="button" className={ghost} onClick={()=>{card.confirm=false;render()}}>Non</button></span>:<button type="button" className="text-sm text-rose-700 underline underline-offset-4" onClick={()=>{card.confirm=true;render()}}>Retirer de la session</button>)}</div>}
     </>}
    </div>
   </div>
   {actionBar(card,stage)}
  </article>
 }

 const sizes=dropped?[2,3,4].filter(n=>dropped.length%n===0&&dropped.length>n):[]
 const presets=settings?.effective
 return <section className="relative space-y-5" onDragEnter={onDragEnter} onDragOver={e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault()}} onDragLeave={onDragLeave} onDrop={onDrop}>
  {dragging&&<div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-3xl border-2 border-dashed border-[#087f5b] bg-[#f3f8f5]/90 text-center backdrop-blur-sm"><div><p className="text-xl font-semibold text-[#08664c]">Lâche les photos ici</p><p className="mt-1 text-sm text-[#5d615a]">Tu choisiras ensuite combien d’articles elles forment.</p></div></div>}

  <header className="flex flex-wrap items-end justify-between gap-4">
   <div className="min-w-0"><button className={quiet} disabled={working} onClick={()=>withBusy('Enregistrement…',async()=>{await saveAll();onBack()})}>← Changer de compte</button>
    <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[#323630]"><span className="tabular-nums text-[#087f5b]">#{account.profile_number||'—'}</span><span className="break-all">{account.login}</span></h1>
    <p className="mt-1.5 text-sm text-[#79756f]">{dotb?`Publication à la main ou via Dotb${presets?.spacing_minutes?`, une annonce toutes les ${presets.spacing_minutes} min`:''}.`:'Publication à la main sur Vinted, guidée ligne par ligne.'}{presets&&<> Réglages {presets.custom?'propres à ce compte':'communs'} : {[presets.no_brand&&'sans marque',presets.condition.toLocaleLowerCase('fr'),`colis ${presets.package.toLocaleLowerCase('fr')}`].filter(Boolean).join(', ')}.</>}</p></div>
   <div className="flex flex-wrap items-center gap-2"><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e3ded6] bg-white px-3 py-2 text-sm" title="L’IA écrit chaque article dès qu’il a ses photos et sa taille"><input type="checkbox" checked={autoWrite} onChange={e=>{setAutoWrite(e.target.checked);try{localStorage.setItem('listing-auto-write',e.target.checked?'on':'off')}catch{}}}/>Rédaction automatique</label><button className={ghost} aria-expanded={showSettings} disabled={!settings} onClick={()=>setShowSettings(true)}>Réglages</button><button className={ghost} disabled={working||loading} onClick={()=>withBusy('Actualisation…',load)}>Actualiser</button></div>
  </header>

  <nav aria-label="Étapes des articles" className="relative flex gap-1 overflow-x-auto rounded-2xl border border-[#e8e4dd] bg-[#fffefa] p-1 shadow-[0_3px_10px_#4c3d2610]">
   <button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')} className={`shrink-0 rounded-xl px-3.5 py-2 text-sm ${filter==='all'?'bg-[#323630] text-white':'text-[#5d615a] hover:bg-[#f6f3ee]'}`}>Tous <span className="ml-1 tabular-nums opacity-70">{rows.length}</span></button>
   {steps.map((s,i)=><button type="button" key={s.key} aria-pressed={filter===s.key} title={s.hint} onClick={()=>setFilter(filter===s.key?'all':s.key)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm ${filter===s.key?'bg-[#323630] text-white':counts[s.key]?'text-[#323630] hover:bg-[#f6f3ee]':'text-[#a8a39b] hover:bg-[#f6f3ee]'}`}><span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden="true"/><span className="sr-only">Étape {i+1} :</span>{s.label}<span className="font-semibold tabular-nums">{counts[s.key]}</span></button>)}
  </nav>

  {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-[#cfe6da] bg-[#f1f8f4] px-4 py-3 text-sm text-[#08664c]">{notice}</p>}
  {busy&&<p role="status" className="rounded-xl bg-[#f1eee8] px-4 py-3 text-sm text-[#4a4e47]">{busy}</p>}

  <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
   <aside aria-label="Articles du compte" className="space-y-3 lg:sticky lg:top-24">
    <label className={`flex items-center gap-3 rounded-2xl border border-dashed px-4 py-3.5 ${busy?'border-[#e3ded6] opacity-60':'cursor-pointer border-[#9fcdb6] bg-[#f6faf7] hover:border-[#087f5b]'}`}>
     <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#087f5b] text-lg text-white" aria-hidden="true">+</span>
     <span className="min-w-0"><span className="block text-sm font-semibold text-[#08664c]">Ajouter des articles</span><span className="block text-xs text-[#79756f]">Glisse les photos n’importe où sur la page</span></span>
     <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={!!busy} aria-label="Ajouter les photos d’un ou plusieurs articles" className="sr-only" onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';drop(files)}}/>
    </label>
    {dropped&&<div role="group" aria-label="Regrouper les photos" className="space-y-2 rounded-2xl border border-[#cfe6da] bg-white p-3.5"><p className="text-sm font-medium">{dropped.length} photos sélectionnées. Ce sont :</p>
     <div className="grid gap-1.5"><button className={solid} onClick={()=>withBusy('Ajout de l’article…',()=>addArticles([dropped.slice().sort(byName)]))}>Un seul article ({dropped.length} photos)</button>
      {sizes.map(n=><button key={n} className={ghost} onClick={()=>withBusy('Ajout des articles…',()=>addArticles(groupFiles(dropped,n)))}>{dropped.length/n} articles de {n} photos</button>)}
      <button className={ghost} onClick={()=>withBusy('Ajout des articles…',()=>addArticles(groupFiles(dropped,1)))}>{dropped.length} articles (1 photo chacun)</button></div>
     <div className="flex items-center justify-between"><p className="text-xs text-[#79756f]">Regroupées dans l’ordre des noms de fichiers.</p><button className={quiet+' !text-xs'} onClick={()=>setDropped(null)}>Annuler</button></div></div>}
    {(toPrepare>0||(dotb&&counts.ready>0))&&<div className="grid gap-1.5">
     {toPrepare>0&&<button className={solid} disabled={!!busy} onClick={()=>withBusy('Rédaction…',prepareAll)}>Rédiger les {toPrepare} article{toPrepare>1?'s':''} avec l’IA</button>}
     {dotb&&counts.ready>0&&<><button className={ghost} disabled={!!busy} onClick={()=>withBusy('Envoi à Dotb…',()=>sendAll('draft'))}>Tout en brouillon Vinted ({counts.ready})</button><button className={ghost} disabled={!!busy} onClick={()=>withBusy('Envoi à Dotb…',()=>sendAll('live'))}>Tout publier en ligne via Dotb ({counts.ready})</button></>}
    </div>}
    {loading?<p role="status" className="px-2 py-6 text-sm text-[#79756f]">Chargement de la session…</p>:<ul className="max-h-[22rem] space-y-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-22rem)]">{visible.map(([c,s])=>queueItem(c,s))}{!visible.length&&<li className="px-2 py-6 text-sm text-[#79756f]">{rows.length?'Aucun article à cette étape.':'Aucun article pour l’instant.'}</li>}</ul>}
   </aside>

   <div className="min-w-0">{loading?null:current?detail(current):<div className="grid min-h-[22rem] place-items-center rounded-3xl border border-dashed border-[#d6d0c6] bg-[#fffefa] p-8 text-center"><div className="max-w-sm"><p className="text-lg font-semibold">Aucun article en cours sur ce compte</p><p className="mt-2 text-sm text-[#79756f]">Glisse les photos de tes articles sur la page, ou clique sur « Ajouter des articles ». Indique le SKU, la taille et le prix de chaque article : l’IA rédige aussitôt, pendant que tu passes au suivant.</p></div></div>}</div>
  </div>

  {showSettings&&settings&&<div className="fixed inset-0 z-50 flex justify-end bg-[#323630]/25" onClick={e=>{if(e.target===e.currentTarget)setShowSettings(false)}}><div role="dialog" aria-modal="true" aria-label="Réglages des annonces" className="h-full w-full max-w-xl overflow-y-auto bg-[#faf8f5] p-3 sm:p-5 shadow-2xl"><ListingSettingsPanel key={JSON.stringify(settings)} settings={settings} account={account} request={request} serverDotb={serverDotb} aiModels={meta.ai_models} onClose={()=>setShowSettings(false)} onSaved={value=>{settingsRef.current=value;setSettings(value);setDotb(serverDotb&&value.effective.dotb===true);setShowSettings(false);setNotice('Réglages enregistrés. Ils s’appliquent aux prochains articles rédigés.')}}/></div></div>}
 </section>
}
