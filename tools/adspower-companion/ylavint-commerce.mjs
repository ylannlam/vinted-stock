// All Vinted navigation starts with a visible link or control. No Vinted API calls.
import {readFile,stat} from 'node:fs/promises'
import {BASE,cid,euros} from './ylavint-visible.mjs'
import {review,conversationUrl} from './ylavint-ui.mjs'

export function commercePage(){
 const shown=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'
 const text=e=>e?.innerText?.trim()||''
 const all=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(shown)
 const controls=(root=document)=>all('a[href],button,[role="button"]',root).map(e=>({text:text(e)||e.getAttribute('aria-label')||'',href:e.href||null,enabled:!e.disabled&&e.getAttribute('aria-disabled')!=='true'}))
 const field=label=>{
  const matches=all('span,p,div,h1,h2,h3').filter(e=>text(e)===label&&!all('span,p,div,h1,h2,h3',e).some(c=>text(c)===label))
  if(matches.length!==1)return null
  let parent=matches[0].parentElement
  for(let i=0;i<4&&parent;i++,parent=parent.parentElement){const value=text(parent);if(value.includes('€'))return value}
  return null
 }
 const content=document.querySelector('[data-testid="conversation-content"]')
 // Buyer messages are untrusted; only Vinted's status rows can authorize a label.
 const system=content?all('[class*="conversation-message-container"]',content).filter(e=>!e.querySelector('[class*="Bubble__bubble"],[aria-label^="Message from "]')&&!e.closest('[class*="Bubble__bubble"]')):[]
 const links=all('a[href]').map(e=>({href:e.href,text:text(e),image:e.querySelector('img')?.src||null,alt:e.querySelector('img')?.alt||''}))
 const selected=all('[aria-current],[aria-selected="true"]').map(e=>text(e))
 return {url:location.href,heading:all('h1,h2').map(text).join(' '),text:text(document.body).slice(0,30000),available:field('Montant disponible'),pending:field('Montant en attente'),controls:controls(),links,selected,
  system:system.map(e=>({text:text(e).slice(0,1500),controls:controls(e)})),conversation:!!content}
}
export function readWallet(snapshot){
 const u=new URL(snapshot.url)
 if(u.origin!==BASE||!u.pathname.startsWith('/wallet/'))throw review('Le porte-monnaie Vinted n’est pas ouvert.')
 const amount=value=>{
  const matches=String(value||'').match(/\d[\d\s.,\u00a0\u202f]*\s*€/g)||[]
  if(matches.length!==1)return null
  const n=euros(matches[0]);return Number.isFinite(n)?n:null
 }
 const available=amount(snapshot.available),pending=amount(snapshot.pending)
 if(available==null||pending==null)throw review('Les montants disponible et en attente ne sont pas lisibles séparément. Vérifie le porte-monnaie.')
 const transfer=snapshot.controls.filter(c=>/^(Transférer|Transférer vers (?:ton|mon) compte bancaire|Transfer|Withdraw)$/i.test(c.text))
 return {available,pending,currency:'EUR',withdrawal:available===0?'unavailable':transfer.length===1?(transfer[0].enabled?'available':'unavailable'):'unknown'}
}
const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function readOrderCards(snapshot){
 const u=new URL(snapshot.url)
 if(u.origin!==BASE||u.pathname!=='/my_orders'||!snapshot.text.includes('Mes commandes'))throw review('La page des commandes n’est pas reconnue.')
 const seen=new Set(),rows=[]
 for(const a of snapshot.links){
  const link=new URL(a.href),id=link.origin===BASE?cid(link.pathname.match(/^\/inbox\/([^/]+)\/?$/)?.[1]):null
  if(!id||seen.has(id)||!a.image||euros(a.text)==null)continue
  const lines=a.text.split('\n').map(s=>s.trim()).filter(Boolean),status=lines.at(-1)
  if(!status||/€/.test(status))continue
  seen.add(id);rows.push({conversation_id:id,title:lines.slice(0,lines.findIndex(l=>l.includes('€'))).join(' ')||a.alt,status,price:euros(a.text),photo_url:a.image,label_state:'unavailable',detail_read:false})
 }
 if(!rows.length&&!/aucune (commande|vente)|pas encore de (commande|vente)/i.test(snapshot.text))throw review('Les ventes visibles ne sont pas lisibles. Aucune commande modifiée.')
 return rows
}
export function readOrderDetail(snapshot,row){
 if(cid(new URL(snapshot.url).pathname.split('/')[2])!==row.conversation_id||!snapshot.conversation)throw review('Une autre conversation est ouverte.')
 const block=snapshot.system.at(-1),text=block?.text||'',plain=normalize(text)
 const controls=(block?.controls||[]).filter(c=>/^(Imprimer|Télécharger|Afficher) (?:le |ton )?bordereau(?: d[’']envoi)?$/i.test(c.text))
 const blocked=/attente de reponse.*prolongation|commande annulee|transaction annulee|rembourse|litige|retour|commande suspendue/.test(plain)
 const ready=!blocked&&controls.length===1&&controls[0].enabled&&/article a emballer|imprime le bordereau|telecharger.*bordereau|bordereau.*pret/i.test(plain)
 const carrier=text.match(/Mondial Relay|Shop2Shop(?: by Chronopost)?|Chronopost|Colissimo|Vinted Go|Relais Colis|UPS|DHL|DPD|InPost|Bpost|PostNL/i)?.[0]||null
 return {...row,detail_read:true,label_state:ready?'ready':'waiting',label_note:ready?null:/prolongation/.test(plain)?'Réponse à la demande de prolongation en attente.':blocked?'Commande à vérifier sur Vinted.':'Bordereau pas encore accessible sur la page.',
  carrier,deadline_text:text.match(/(?:avant le|expédie.*?avant le)\s+[^)\n]+/i)?.[0]||null,
  status:/article a emballer/.test(plain)?'À expédier':row.status,
  labelControl:ready?controls[0]:null}
}
export const validLabelUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='svc-shipping-labels.s3.eu-central-1.amazonaws.com'||u.hostname==='www.vinted.fr'||/^[a-z0-9.-]+\.vinted\.net$/.test(u.hostname))}catch{return false}}
export function validatePdf(bytes){
 if(!bytes||bytes.length<100||bytes.length>3*1024*1024||Buffer.from(bytes).subarray(0,5).toString()!=='%PDF-')throw review('Le document ouvert n’est pas un bordereau PDF valide (3 Mo maximum).')
 return Buffer.from(bytes)
}

export class VisibleCommerce{
 constructor({reader,authorize=async()=>{}}){this.reader=reader;this.page=reader.page;this.authorize=authorize}
 async snapshot(){await this.reader.snapshot();return this.page.evaluate(commercePage)}
 async menu(name){
  await this.authorize();await this.reader.identity()
  await this.page.locator('[data-testid="user-menu-button"]').click();await this.reader.sleep(350)
  const entries=(await this.snapshot()).links.filter(l=>name.test(l.text))
  if(entries.length!==1)throw review('Le lien du menu Vinted n’est pas reconnu.')
  await this.reader.clickLink(entries[0].href);await this.reader.settle();await this.reader.identity()
 }
 async wallet(){
  this.reader.update({state:'reading',message:'Lecture du porte-monnaie · disponible et en attente'})
  await this.menu(/^Mon porte-monnaie(?:\s+[\d\s,.]+\s*€)?$/i)
  // Wait for both rendered amounts; never substitute zero for a loading placeholder.
  let snapshot
  for(let i=0;i<15;i++){snapshot=await this.snapshot();if(snapshot.available&&snapshot.pending)break;await this.reader.sleep(1000)}
  await this.authorize();await this.reader.identity()
  return readWallet(snapshot)
 }
 async orders(){
  this.reader.update({state:'reading',message:'Lecture des ventes et des bordereaux disponibles'})
  await this.menu(/^Mes commandes$/i)
  const sales=this.page.getByRole('link',{name:'Ventes',exact:true}).or(this.page.getByRole('button',{name:'Ventes',exact:true}))
  if(await sales.count()!==1)throw review('L’onglet Ventes n’est pas identifiable.')
  await sales.click();await this.reader.settle()
  const all=this.page.getByRole('button',{name:'Toutes',exact:true}).or(this.page.getByRole('link',{name:'Toutes',exact:true}))
  if(await all.count()===1){await all.click();await this.reader.settle()}
  let snapshot=await this.snapshot(),rows=readOrderCards(snapshot)
  // Small bounded scrolling, not an invisible history crawl.
  for(let i=0;i<2&&rows.length<30;i++){
   this.reader.check();await this.page.mouse.wheel(0,380);await this.reader.sleep(this.reader.pace.page_wait_seconds*1000)
   snapshot=await this.snapshot();rows=[...new Map([...rows,...readOrderCards(snapshot)].map(o=>[o.conversation_id,o])).values()]
  }
  const offset=(this.reader.orderOffset||0)%Math.max(1,rows.length),chosen=[...rows.slice(offset),...rows.slice(0,offset)].filter(o=>!/annul|rembours|termin|livr|colis envoy|en transit/i.test(o.status)).slice(0,4)
  this.reader.orderOffset=(offset+Math.max(1,chosen.length))%Math.max(1,rows.length)
  for(const row of chosen){
   await this.authorize();await this.reader.open(conversationUrl(row.conversation_id));await this.reader.identity()
   const detail=readOrderDetail(await this.snapshot(),row)
   const thread=await this.reader.thread();detail.item_id=thread.item?.id||null
   delete detail.labelControl;Object.assign(row,detail)
  }
  return {orders:rows,complete:false}
 }
 async label(payload){
  const id=cid(payload.conversation_id);if(!id)throw review('Conversation de la vente inconnue.')
  await this.authorize();await this.reader.open(conversationUrl(id));await this.reader.identity()
  const thread=await this.reader.thread()
  if(payload.item_id&&thread.item?.id!==String(payload.item_id))throw review('L’article de la vente a changé.')
  const detail=readOrderDetail(await this.snapshot(),{conversation_id:id,title:payload.title,status:'À expédier'})
  if(detail.label_state!=='ready')return {conversation_id:id,pending:true,reason:detail.label_note}
  await this.authorize()
  const bytes=await this.download(detail.labelControl)
  await this.reader.identity()
  return {conversation_id:id,pdf_base64:validatePdf(bytes).toString('base64')}
 }
 async download(control){
  const page=this.page,context=page.context(),popups=[],downloads=[]
  let bytes=null,error=null
  const accept=async download=>{
   try{if(!validLabelUrl(download.url()))throw review('La destination du bordereau n’est pas reconnue.');const file=await download.path();if(!file||(await stat(file)).size>3*1024*1024)throw review('Bordereau trop volumineux.');bytes=validatePdf(await readFile(file))}catch(e){error=e}
  }
  const onDownload=d=>{const work=accept(d);downloads.push(work)}
  const onPopup=p=>{popups.push(p);p.on('download',onDownload)}
  // Save only the PDF document loaded by this visible click; never call its URL ourselves.
  const onResponse=async response=>{
   try{
    if(!validLabelUrl(response.url())||!String(response.headers()['content-type']||'').includes('application/pdf')||!response.request().isNavigationRequest())return
    const owner=response.request().frame().page()
    if(owner!==page&&await owner.opener()!==page)return
    const length=Number(response.headers()['content-length']);if(length>3*1024*1024){error=review('Bordereau trop volumineux.');return}
    bytes=validatePdf(await response.body())
   }catch{/* Chromium's PDF viewer may own the response; use its visible download button below. */}
  }
  page.on('download',onDownload);page.on('popup',onPopup);context.on('response',onResponse)
  try{
   const button=page.getByRole('button',{name:control.text,exact:true}).or(page.getByRole('link',{name:control.text,exact:true}))
   if(await button.count()!==1)throw review('Le bouton du bordereau est ambigu.')
   await button.click()
   let viewerClicked=false
   for(let i=0;i<45&&!bytes&&!error;i++){
    this.reader.check()
    if(i>=5&&!viewerClicked){
     const viewer=popups.find(p=>!p.isClosed()&&validLabelUrl(p.url()))
     if(viewer){
      const save=viewer.getByRole('button',{name:/^(Télécharger|Download)(?: le fichier)?$/i})
      if(await save.count()===1&&await save.isVisible()){await viewer.bringToFront();await save.click();viewerClicked=true}
     }
    }
    await this.reader.sleep(1000)
   }
   if(error)throw error
   if(!bytes)throw review('Le PDF ouvert n’a pas pu être enregistré. Vérifie cet onglet avant de reprendre.')
   for(const popup of popups)await popup.close().catch(()=>{})
   await page.bringToFront();return bytes
  }finally{page.off('download',onDownload);page.off('popup',onPopup);context.off('response',onResponse);for(const popup of popups)popup.off('download',onDownload);await Promise.allSettled(downloads)}
 }
}
