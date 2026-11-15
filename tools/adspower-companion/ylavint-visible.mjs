// Read only rendered Vinted elements. No cookies, hydration state, fetch or XHR.
import {createHash} from 'node:crypto'
import {review,conversationUrl} from './ylavint-ui.mjs'
import {PUBLICATION_PACE} from './ylavint-typing.mjs'
import {randomInt,varied} from './ylavint-routine.mjs'
import {renderedListing,visibleDraft,favouriteMatches} from './ylavint-browsing.mjs'
export const BASE='https://www.vinted.fr'
export const PACE={typing_delay_ms:70,page_wait_seconds:3,session_minutes:25,pause_minutes:5,browse_enabled:false,browse_every_minutes:30,browse_items:3,browse_item_seconds:8,browse_scrolls:2,active_days:[1,2,3,4,5,6,7],absent_until:null,browse_keywords:'',browse_price_min:0,browse_price_max:0,browse_photos:false,browse_memory_hours:24,reply_max_age_hours:24,...PUBLICATION_PACE,wallet_hours:[9,18],browse_variety:true,browse_between_actions:true,browse_after_actions_min:3,browse_after_actions_max:7,browse_like_enabled:false,browse_like_keywords:'robe',browse_like_price_min:20,browse_like_price_max:50,browse_like_per_day:5,browse_like_percent:25,pause_close_percent:0}
export const cid=v=>/^(?:[1-9]\d{0,17}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(String(v))?String(v):null
Object.assign(PACE,{navigation_seconds:10,action_pause_seconds:20})
// Vinted redirects /items/123 to /items/123-title. Compare the stable article
// identifier, never a prefix that could also match another item or an edit page.
export function sameVintedRoute(left,right){
 const a=new URL(left,BASE),b=new URL(right,BASE)
 if(a.origin!==BASE||b.origin!==BASE)return false
 const item=u=>u.pathname.match(/^\/items\/([1-9]\d{0,17})(?:-[^/]+)?\/?$/)?.[1]
 const ai=item(a),bi=item(b)
 return a.pathname===b.pathname||!!ai&&ai===bi
}
export const euros=v=>{const m=String(v??'').replace(/\u00a0|\u202f/g,' ').match(/(\d+(?:[ .,]\d{3})*(?:[,.]\d{1,2})?)\s*€/);return m?Number(m[1].replace(/ /g,'').replace(',','.')):null}
// A relative label is rounded down conservatively; it must never make an old like look new.
export function visibleDate(value,now=Date.now()){
 const s=String(value||'').trim(),m=s.match(/il y a\s+(\d+|une?|quelques)\s+(seconde|minute|heure|jour|semaine|mois|an)/i)
 if(m){const unit={seconde:1000,minute:60000,heure:3600000,jour:86400000,semaine:604800000,mois:2678400000,an:31622400000}[m[2].toLowerCase()];return new Date(now-((Number(m[1])||1)+1)*unit).toISOString()}
 if(/^\d{4}-\d{2}-\d{2}T/.test(s)&&Number.isFinite(Date.parse(s)))return new Date(s).toISOString()
 return null
}
export function uiMessageId(conversation,message,occurrence){return 'ui:'+createHash('sha256').update(JSON.stringify([conversation,message.from_me,message.kind,message.body,occurrence])).digest('hex').slice(0,48)}

// Kept self-contained so Playwright can run it in the page and DOM fixtures can test it.
export function renderedPage(){
 const shown=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'
 const all=(s,root=document)=>[...root.querySelectorAll(s)].filter(shown)
 const txt=e=>e?.innerText?.trim()||''
 const link=e=>({href:e.href,text:txt(e),title:e.getAttribute('title')||e.getAttribute('aria-label')||'',image:e.querySelector('img')?.src||null,alt:e.querySelector('img')?.alt||''})
 const content=document.querySelector('[data-testid="conversation-content"]')
 const bubbles=content?all('[class*="Bubble__bubble"]',content):[]
 const introductions=content?all('[class*="conversation-message"][class*="intro"]',content):[]
 const messages=bubbles.map(b=>{
   // Received requests use a different visible price label from sent offers.
   const price=b.querySelector('[data-testid="offer-current-price-label"],[data-testid="offer-request-current-price-label"]'),label=b.querySelector('[aria-label^="Message from "]')
   const body=txt(label||b),fromMe=label?/^Message from me(?::|$)/.test(label.getAttribute('aria-label')):b.className.includes('Bubble__inverse')
   let holder=b,when=null
   for(let i=0;i<5&&holder&&holder!==content;i++,holder=holder.parentElement){
     const t=holder.querySelector('time[datetime]');if(t){when=t.getAttribute('datetime');break}
     const prev=holder.previousElementSibling,s=txt(prev);if(s.length<100&&/il y a /i.test(s)){when=s;break}
   }
   const offerRoot=b.closest('[class*="conversation-message-container"]')||b
   const accept=price?all('button,[role="button"]',offerRoot).filter(e=>/^Accepter l[’']offre$/i.test(txt(e))&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'):[]
   const amounts=body.match(/\d[\d\s.,\u00a0\u202f]*\s*€/g)||[]
   return {body,from_me:fromMe,kind:price?'offer':label?'message':b.querySelector('img')?'photo':'unknown',price:txt(price),offer_original:price&&amounts.length===2?amounts[1]:null,offer_pending:!fromMe&&accept.length===1,offer_accepted:price&&/\bAcceptée\b/i.test(body),when,intro:introductions.some(e=>e.contains(b))||!label&&/^Bonjour, je suis /i.test(body)}
 }).filter(m=>!m.intro)
 const user=document.querySelector('[data-testid="user-menu-button"] img')
 const links=all('a[href]').map(link)
 // The current inbox uses role=button rows rather than anchors. Read their
 // visible test IDs; do not infer conversations from hydration data or APIs.
 const inboxRows=all('[data-testid="conversation-list"] [role="button"][data-testid^="inbox-list-item-"]').map(e=>({id:e.getAttribute('data-testid').slice('inbox-list-item-'.length),text:txt(e)}))
 const notices=all('a[data-testid="user-notification-item"]').map(e=>({...link(e),text:txt(e.querySelector('[data-testid="user-notification-item--content"]')||e)}))
 const cards=all('a[href*="/items/"]').filter(e=>!e.href.includes('/items/new')).map(e=>{const box=e.closest('[data-testid="grid-item"]')||e.parentElement;return {...link(e),text:txt(box)||e.getAttribute('title')||'',image:box.querySelector('img')?.src||null}})
 const editors=all('textarea[data-testid="composer--input"],textarea[data-testid="composer-input"]')
 const editor=editors.length===1?editors[0]:null
 const composer=all('[data-testid="composer"]').length>0
 const hero=all('a[data-testid="hero-message"]')[0],header=document.querySelector('[data-testid="conversation-header"]')
 return {url:location.href,scroll_y:typeof scrollY==='number'?scrollY:0,login:user?.alt||null,links,inboxRows,notices,cards,messages,conversation:!!content,composer_unknown:composer&&!editor,allow_reply:!!editor&&!editor.disabled&&!editor.hasAttribute('disabled')&&!editor.readOnly&&!editor.hasAttribute('readonly')&&editor.getAttribute('aria-disabled')!=='true',
   history_start:introductions.length>0||!!content&&all('[class*="conversation-message-container"]',content).some(e=>/^Bonjour, je suis /.test(txt(e))&&!e.querySelector('[aria-label^="Message from "]')),
   threadLinks:header?all('a[href]',header).map(link):[],threadItem:hero?{...link(hero),text:txt(hero)}:null,
   text:txt(document.body).slice(0,60000),conversationText:txt(content),heading:all('h1').map(txt).join(' '),ratings:all('[aria-label]').map(e=>e.getAttribute('aria-label')).filter(s=>/étoile|rating|sur 5|out of 5/i.test(s))}
}

export function readLikes(snapshot,now=Date.now()){
 const likes=[]
 for(const n of snapshot.notices){
   const u=new URL(n.href,BASE),user=u.searchParams.get('receiver_id'),item=u.searchParams.get('item_id')
   if(u.origin!==BASE||u.pathname!=='/inbox/want_it'||!/^\d+$/.test(user||'')||!/^\d+$/.test(item||'')||!n.text.includes('comme favori'))continue
   const when=n.text.match(/il y a[^\n]+/i)?.[0],login=n.text.match(/^(.+?) a marqué ton article /)?.[1]
   const liked_at=visibleDate(when,now)
   if(liked_at&&login)likes.push({item_id:item,user_id:user,login,liked_at})
 }
 return {likes,complete:false,more_history:false}
}
export function readThread(snapshot,now=Date.now()){
 const id=cid(new URL(snapshot.url).pathname.split('/')[2])
 if(!id||!snapshot.conversation)throw review('La conversation visible n’est pas reconnue.')
 const other=(snapshot.threadLinks||[]).filter(l=>/\/member\/\d+/.test(new URL(l.href).pathname)&&l.text&&l.text!==snapshot.login&&!/Mon profil/i.test(l.text))
 const uniqueOther=[...new Map(other.map(l=>[new URL(l.href).pathname.match(/\/member\/(\d+)/)[1],l])).entries()]
 const item=snapshot.threadItem
 const counts=new Map(),messages=snapshot.messages.map(m=>{
   const signature=JSON.stringify([m.from_me,m.kind,m.body]),n=(counts.get(signature)||0)+1;counts.set(signature,n)
   return {...m,id:uiMessageId(id,m,n),sent_at:visibleDate(m.when,now)}
 })
 const itemId=item&&new URL(item.href).pathname.match(/^\/items\/(\d+)/)?.[1]
 const offers=uniqueOther.length===1&&itemId?messages.filter(m=>m.kind==='offer'&&m.offer_pending&&!m.from_me&&euros(m.price)!=null&&euros(m.offer_original)!=null).map(m=>({id:m.id,desktop:true,pending:true,buyer_id:uniqueOther[0][0],item_id:itemId,is_bundle:false,currency:'EUR',price:euros(m.price),original_price:euros(m.offer_original),created_at:m.sent_at})):[]
 return {id,other:uniqueOther.length===1?{id:uniqueOther[0][0],login:uniqueOther[0][1].text}:null,
   item:item&&new URL(item.href).pathname.match(/^\/items\/(\d+)/)?{id:new URL(item.href).pathname.match(/^\/items\/(\d+)/)[1],title:item.title||item.alt||item.text.split('\n')[0],price:euros(item.text),photo:item.image}:null,
   messages,allow_reply:snapshot.allow_reply,composer_unknown:snapshot.composer_unknown===true,unread:false,updated_at:messages.at(-1)?.sent_at||null,preview:messages.at(-1)?.body||null,
   uncertain:messages.some(m=>m.kind==='unknown')||[...counts.values()].some(n=>n>1),history_start:snapshot.history_start===true,pending_offer:messages.some(m=>m.offer_pending),offers,complete:false}
}

export function browseCandidates(cards,pace,visited=new Map(),now=Date.now()){
 const plain=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 const words=plain(pace.browse_keywords).split(',').map(s=>s.trim()).filter(Boolean)
 return [...new Map(cards.map(c=>{let u;try{u=new URL(c.href)}catch{return [null,null]};const id=u.origin===BASE?u.pathname.match(/^\/items\/(\d+)/)?.[1]:null;return [id,id?{...c,id}:null]})).values()].filter(c=>{
  if(!c||visited.get(c.id)>now-(pace.browse_memory_hours||24)*3600000)return false
  if(words.length&&!words.some(w=>plain([c.title,c.alt,c.text].join(' ')).includes(w)))return false
  const price=euros(c.text)
  return (!(pace.browse_price_min||pace.browse_price_max)||price!=null)&&(!pace.browse_price_min||price>=pace.browse_price_min)&&(!pace.browse_price_max||price<=pace.browse_price_max)
 })
}

export class VisibleVinted{
 constructor({page,binding,check,sleep,update,control,memory,routine,pace=PACE,random=Math.random,now=Date.now}){Object.assign(this,{page,binding,check,sleep,update,control,pace,routine,random,now});this.memory=memory||{visited:new Map(),record:async(id,at)=>this.memory.visited.set(id,at)};this.verified=false;this.browseCount=0;this.photoCount=0;this.favouriteCount=0;this.feedScrollCount=0}
 async snapshot(){this.check();const u=new URL(this.page.url());if(u.origin!==BASE)throw review('La page ouverte n’est plus Vinted.');const s=await this.page.evaluate(renderedPage);if(/vérifie que tu es humain|vérification de sécurité|compte (?:a été |est )?(?:bloqué|restreint)|trop de requêtes/i.test(s.text))throw review('Vinted demande une vérification. Reprends la main sur ce profil.');return s}
 async beforeNavigation(){
   this.check()
   const remaining=(this.settledAt??-Infinity)+Math.max(6,Number(this.pace.navigation_seconds)||10)*1000-this.now()
   if(remaining>0){this.update?.({message:'Lecture de la page avant de poursuivre',next_navigation_at:new Date(this.now()+remaining).toISOString()});await this.sleep(remaining);this.check()}
   this.update?.({next_navigation_at:null})
 }
 async settle(expected){
   await this.page.bringToFront()
   await this.sleep(Math.max(3,Number(this.pace.page_wait_seconds)||3)*1000)
   // Poll the rendered page, without refreshing it. Lazy loading and SPA route
   // transitions must finish before identity checks or subsequent navigation.
   let previous=null
   for(let attempt=0;attempt<30;attempt++){
     this.check();const s=await this.snapshot(),url=new URL(s.url),target=expected&&new URL(expected,BASE)
     const route=!target||sameVintedRoute(url.href,target.href)||(target.pathname==='/inbox'&&!!cid(url.pathname.split('/')[2]))
     const contentReady=!/^\/inbox(?:\/|$)/.test(url.pathname)||!!s.conversation||/aucun message|pas encore de (message|conversation)/i.test(s.text)
     const ready=route&&s.login&&s.text?.trim()&&contentReady
     const key=JSON.stringify([url.pathname,s.login,s.conversation,s.threadItem?.href,s.messages?.length,s.cards?.length,s.notices?.length])
     if(ready&&key===previous){this.settledAt=this.now();this.loadedAt=this.now();return s}
     previous=ready?key:null;await this.sleep(500)
   }
   throw review('La page Vinted ne s’est pas stabilisée. L’onglet reste ouvert pour vérification.')
 }
 async open(path,{refresh=false}={}){
   this.check();const u=new URL(path,BASE);if(u.origin!==BASE)throw review('Destination non autorisée.')
   const current=new URL(this.page.url())
   const same=current.origin===BASE&&(sameVintedRoute(current.href,u.href)&&(current.search===u.search||!!cid(u.pathname.split('/')[2])&&u.pathname.startsWith('/inbox/'))||u.pathname==='/inbox'&&!!cid(current.pathname.split('/')[2]))
   // Reuse the live DOM, including the inbox sidebar. Never reload an already
   // open route just because another task wants to read it.
   if(same){
     if(!refresh||this.loadedAt==null||this.now()-this.loadedAt<180000)return this.snapshot()
     // A page left open for several minutes may not receive live updates.
     // One deliberate refresh is allowed; never retry it in a tight loop.
     await this.assertNoDraft();await this.beforeNavigation();await this.assertNoDraft();await this.page.reload({waitUntil:'domcontentloaded',timeout:30000});return this.settle(current.href)
   }
   if(current.origin===BASE)await this.assertNoDraft()
   await this.beforeNavigation()
   if(current.origin===BASE)await this.assertNoDraft()
   const s=current.origin===BASE?await this.snapshot():null
   const link=s?.links.find(l=>{const v=new URL(l.href,BASE);return sameVintedRoute(v.href,u.href)&&v.search===u.search})
   const threadId=u.pathname.startsWith('/inbox/')&&cid(u.pathname.split('/')[2])
   const row=threadId&&s?.inboxRows?.some(r=>r.id===threadId)?this.page.locator(`[data-testid="conversation-list"] [role="button"][data-testid="inbox-list-item-${threadId}"]`):null
   if(row){if(await row.count()!==1)throw review('La ligne de conversation n’est pas unique.');await row.click({timeout:10000})}
   else if(link)await this.clickLink(link.href,'a[href]',false)
   else await this.page.goto(u.href,{waitUntil:'domcontentloaded',timeout:30000})
   // The header bell has the notifications URL but opens a popover first.
   // Follow its visible "Voir tout" link; do not reload to get past the menu.
   if(link&&u.pathname==='/member/notifications'&&new URL(this.page.url()).pathname!==u.pathname){
     const all=this.page.getByRole('link',{name:/^(Voir tout|View all)$/i}).filter({visible:true})
     await all.first().waitFor({state:'visible',timeout:5000})
     if(await all.count()!==1||new URL(await all.getAttribute('href'),BASE).pathname!==u.pathname)throw review('Le lien « Voir tout » des notifications n’est pas identifiable.')
     await this.sleep(1200);this.check();await all.click({timeout:5000})
   }
   return this.settle(u.href)
 }
 async identity(full=false){
   let s=await this.snapshot()
   if(!s.login||s.login!==this.binding.login)throw review('Le compte affiché dans le menu Vinted ne correspond pas au compte choisi.')
   if(full||!this.verified){
     const menu=this.page.locator('[data-testid="user-menu-button"]');await menu.click();await this.sleep(300);s=await this.snapshot()
     const own=s.links.filter(l=>/^(Mon profil|My profile)$/i.test(l.text))
     if(own.length!==1||new URL(own[0].href).pathname.match(/^\/member\/(\d+)/)?.[1]!==this.binding.member_id)throw review('L’identifiant du compte n’est pas confirmé dans « Mon profil ».')
     await menu.click();this.verified=true
   }
   return {status:'ok',member_id:this.binding.member_id}
 }
 async thread(){return readThread(await this.snapshot())}
 async likes(){const s=await this.open('/member/notifications',{refresh:true});await this.identity();if(!/Notifications/i.test(s.text))throw review('La liste des notifications ne s’est pas ouverte.');return readLikes(s)}
 async wardrobe(){
   const s=await this.open('/member/'+this.binding.member_id);await this.identity()
   const items=[],seen=new Set()
   for(const c of s.cards){const id=new URL(c.href).pathname.match(/^\/items\/(\d+)/)?.[1];if(!id||seen.has(id))continue;seen.add(id);items.push({id,title:c.title||c.alt||c.text.split('\n')[0],price:euros(c.text),currency:'EUR',photo_url:c.image,is_sold:/\bVendu\b/i.test(c.text),is_hidden:/\bMasqué\b/i.test(c.text)})}
   if(!items.length&&!/aucun article|dressing.*vide/i.test(s.text))throw review('Le dressing visible ne contient pas de cartes lisibles.')
   return {items,complete:false}
 }
 async inbox(payload={}){
   const s=await this.open('/inbox',{refresh:true});await this.identity()
   const found=[...(s.inboxRows||[]).map(r=>cid(r.id)),...s.links.map(l=>cid(new URL(l.href).pathname.match(/^\/inbox\/([^/?]+)/)?.[1]))].filter(Boolean)
   const pool=[...new Set(found)],offset=(this.inboxOffset||0)%Math.max(1,pool.length)
   // A rotating batch alone leaves new replies waiting behind old threads.
   // Recheck recent threads every scan, prioritize changed visible previews,
   // and reserve the remaining places for the older conversations.
   this.inboxPreviews??=new Map()
   const preview=r=>String(r.text||'').replace(/(?:il y a|dans)\s+(?:\d+|une?|quelques)\s+(?:secondes?|minutes?|heures?|jours?|semaines?|mois|ans?)/gi,'').replace(/\s+/g,' ').trim()
   const previews=new Map((s.inboxRows||[]).map(r=>[r.id,preview(r)]))
   const changed=pool.filter(id=>this.inboxPreviews.has(id)&&previews.has(id)&&this.inboxPreviews.get(id)!==previews.get(id))
   const priority=[...new Set([...changed,...pool.slice(0,2)])].slice(0,3)
   const rotated=[...pool.slice(offset),...pool.slice(0,offset)].filter(id=>!priority.includes(id))
   const explicit=payload.conversation_ids?.length>0
   const ids=[...new Set(explicit?payload.conversation_ids:[...priority,...rotated])].slice(0,4),conversations=[]
   if(!explicit){const lastRotated=ids.filter(id=>!priority.includes(id)).at(-1);if(lastRotated)this.inboxOffset=(pool.indexOf(lastRotated)+1)%Math.max(1,pool.length)}
   if(!ids.length&&!/aucun message|pas encore de (message|conversation)/i.test(s.text))throw review('La liste des conversations visibles n’est pas reconnue.')
   for(const id of ids){await this.open(conversationUrl(id));const c=await this.thread();if(c.uncertain)c.allow_reply=false;conversations.push(c);if(previews.has(id))this.inboxPreviews.set(id,previews.get(id))}
   return {conversations,complete:false,more_history:false}
 }
 async openLike(payload){
   if(payload.conversation_id){await this.open(conversationUrl(payload.conversation_id));return String(payload.conversation_id)}
   const s=await this.open('/member/notifications'),notice=s.notices.find(n=>{const u=new URL(n.href);return u.searchParams.get('receiver_id')===String(payload.user_id)&&u.searchParams.get('item_id')===String(payload.item_id)})
   if(!notice)throw review('Le favori n’est plus présent dans la liste visible. Aucun message envoyé.')
   await this.clickLink(notice.href,'a[data-testid="user-notification-item"]');await this.settle()
   // Vinted opens an empty offer dialog when following a favourite notification.
   const dialog=this.page.locator('[data-testid="offer-modal"]:visible')
   if(await dialog.count())await this.closeEmptyOffer(dialog)
   const conversation=cid(new URL(this.page.url()).pathname.split('/')[2]);if(!conversation)throw review('Vinted n’a pas ouvert la conversation du favori.');return conversation
 }
 async closeEmptyOffer(dialog){
   const price=dialog.locator('input[data-testid="offer-price-field--input"]')
   if(await price.count()!==1||(await price.inputValue()).trim())throw review('Un prix est déjà saisi dans le formulaire d’offre. Vérifie-le avant de reprendre.')
   const closed=async()=>{try{await dialog.waitFor({state:'hidden',timeout:1500});return true}catch{this.check();return false}}
   await this.page.keyboard.press('Escape')
   if(await closed())return
   // Observed on the visible offer form: the cross is an unnamed button.
   const close=dialog.locator('button[data-testid="offer-modal-navigation-close-button"]:visible')
   if(await close.count()!==1)throw review('Le bouton de fermeture de l’offre n’est pas identifiable. Ferme ce formulaire puis reprends.')
   await close.click({timeout:5000})
   if(!await closed())throw review('Le formulaire d’offre est encore ouvert. Vérifie Vinted avant de reprendre.')
 }
 async verifyFavourite(like){
   await this.availableItem(like.item_id)
   const conversation=await this.openLike(like)
   await this.identity()
   const thread=await this.thread()
   if(thread.id!==conversation)throw review('La conversation du favori ne peut pas être confirmée.')
   if(thread.composer_unknown)throw review('Le champ de message visible n’est pas reconnu. Aucun envoi ni abandon du favori.')
   return {conversation_id:conversation}
 }
 async clickLink(href,selector='a[href]',paced=true){
   if(paced)await this.beforeNavigation()
   await this.page.bringToFront()
   // all() returns positional locators: a re-render can shift a link while the
   // loop is reading it. Bind the exact observed href before clicking instead.
   const links=await this.page.locator(selector).all()
   for(const a of links){
     const raw=await a.getAttribute('href')
     if(raw&&new URL(raw,BASE).href===href&&await a.isVisible()){
       const target=this.page.locator(`${selector}[href=${JSON.stringify(raw)}]:visible`)
       if(await target.count()!==1)throw review('Plusieurs liens correspondent à cette destination. Vérifie la page Vinted.')
       this.update?.({message:'Ouverture de la page Vinted sélectionnée'})
       await target.click({timeout:10000});return
     }
   }
   throw review('Le lien attendu n’est plus visible sur cette page.')
 }
 async memberFilter(p){
   const f=p.filters||{}
   if(f.ignored?.includes(String(p.login||'').toLowerCase()))return 'Membre dans la liste des comptes ignorés.'
   if(!f.skip_unrated&&f.min_rating==null)return null
   const s=await this.open('/member/'+p.user_id);await this.identity()
   if(/\b0 évaluation|aucune évaluation/i.test(s.text))return f.skip_unrated?'Membre sans évaluation.':f.min_rating>0?'Note insuffisante.':null
   const rating=s.ratings.map(v=>v.match(/([0-5](?:[,.]\d+)?)\s*(?:sur|out of|\/)\s*5/i)).find(Boolean)
   if(!rating)throw review('Le filtre d’évaluations est actif mais la note du membre n’est pas lisible sur sa page.')
   return f.min_rating!=null&&Number(rating[1].replace(',','.'))<f.min_rating?'Note du membre inférieure au réglage.':null
 }
 async recheck(task,conversation,{afterMessage=false}={}){
   await this.identity();const c=await this.thread(),p=task.payload
   if(c.id!==conversation||c.uncertain)throw review('Le contenu de la conversation ne peut pas être confirmé.')
   if(c.composer_unknown)throw review('Le champ de message visible n’est pas reconnu. Vérifie le formulaire avant de reprendre.')
   if(!c.allow_reply)return {cancelled:'Vinted ne permet plus d’écrire dans cette conversation.'}
   if(task.kind==='like_message'){
     if(c.messages.some(m=>!m.from_me&&['message','offer','photo'].includes(m.kind)))return {cancelled:'L’acheteur a répondu ou fait une offre.',buyer_engaged:true}
     if(!c.history_start)throw review('Le début de cette conversation n’est pas chargé : impossible de vérifier l’absence de réponse avant une relance.')
     if(c.other?.id!==String(p.user_id)||c.item?.id!==String(p.item_id))throw review('Le membre ou l’article visible ne correspond pas au favori.')
     if(p.offer_requested&&(c.item.price===null||c.item.price!==Number(p.expected_price)))throw review('Le prix affiché a changé ou n’est pas lisible : réduction à vérifier.')
     if(!afterMessage&&!p.followup&&c.messages.some(m=>m.from_me))return {cancelled:'Ce membre a déjà reçu un message ou une offre.'}
   }
   if(task.kind==='reply_message'){
     const last=c.messages.at(-1),source=p.source_message_id||p.context_message_id
     if(source&&(!last||last.id!==source)||p.source==='ai'&&!p.manual&&(!last||last.from_me||!source))return {cancelled:'La conversation a changé : réponse à revoir.',context_changed:true,review_required:p.source!=='ai'||p.manual===true}
   }
   const signature=JSON.stringify(c.messages.map(m=>m.id))
   if(task.kind==='reply_message'&&this.baseline?.task===task.id&&this.baseline.signature!==signature)return {cancelled:'Un nouveau message est arrivé pendant la préparation de la réponse.',context_changed:true,review_required:p.source!=='ai'||p.manual===true}
   this.baseline={task:task.id,signature}
   return {ok:true}
 }
 async availableItem(item){
   if(!/^\d{1,18}$/.test(String(item)))throw review('Article inconnu.')
   await this.open('/items/'+item);await this.identity()
   const available=this.page.getByRole('button',{name:/^Indiquer comme vendu$/i}).or(this.page.getByRole('link',{name:/^Indiquer comme vendu$/i}))
   if(await available.count()!==1||!await available.isVisible())throw review('L’article n’est pas confirmé disponible sur sa fiche Vinted. Vérifie son état avant de contacter le membre.')
 }
 async confirm({kind,body,price,before}){
   for(let i=0;i<20;i++){this.check();const c=await this.thread(),added=c.messages.filter(m=>!before.some(b=>b.id===m.id));const match=added.find(m=>m.from_me&&(kind==='message'?m.kind==='message'&&m.body===body:m.kind==='offer'&&euros(m.price)===price));if(match)return match;await this.sleep(1000)}
   throw review('Envoi non confirmé dans la conversation visible : vérifie Vinted avant de reprendre.')
 }
 async assertNoDraft(){
   this.check()
   if(await this.page.evaluate(visibleDraft))throw Object.assign(review('Un brouillon est présent dans l’onglet de l’assistant. Termine-le puis reprends ; l’onglet reste ouvert.'),{keep_page:true})
 }
 async browseAllowed(){
   this.check();const state=await this.control();this.check()
   this.pace={...PACE,...state.pace}
   return state.allowed===true&&state.in_window===true&&this.pace.browse_enabled===true
 }
 async listing(){
   await this.identity();const detail=await this.page.evaluate(renderedListing)
   return {...detail,price:/^\d[\d\s.,]*€$/.test(detail.price_text.trim())?euros(detail.price_text):null}
 }
 async maybeFavourite(id){
   if(!await this.browseAllowed()||!this.pace.browse_like_enabled||!this.routine)return false
   if(!this.routine.canLike(id,this.pace.browse_like_per_day)||this.random()*100>=this.pace.browse_like_percent)return false
   let detail=await this.listing()
   if(!favouriteMatches(detail,this.pace,this.binding.member_id,id))return false
   if(!await this.browseAllowed()||!this.pace.browse_like_enabled)return false
   detail=await this.listing()
   if(!favouriteMatches(detail,this.pace,this.binding.member_id,id))return false
   // Reserve before clicking; an interruption or uncertain result must never cause a retry.
   if(!await this.routine.reserveLike(id,this.pace.browse_like_per_day))return false
   if(!await this.browseAllowed()||!this.pace.browse_like_enabled)return false
   detail=await this.listing()
   if(!favouriteMatches(detail,this.pace,this.binding.member_id,id))return false
   const button=this.page.locator('button[data-testid="favourite-button"]').filter({visible:true})
   if(await button.count()!==1||await button.getAttribute('aria-pressed')!=='false')return false
   this.check()
   try{
     await button.click({timeout:10000})
     for(let i=0;i<8;i++){
       this.check();await this.sleep(500);detail=await this.listing()
       if(new URL(detail.url).pathname.match(/^\/items\/(\d+)(?:-|\/|$)/)?.[1]!==id)break
       if(detail.favourite==='true'){await this.routine.confirmLike(id);this.favouriteCount++;this.update({message:'Annonce ajoutée aux favoris : '+detail.title});return true}
     }
     throw Error('unconfirmed')
   }catch{
     throw Object.assign(review('L’ajout au favori n’est pas confirmé à l’écran. Vérifie l’annonce ; aucun second clic ne sera tenté.'),{keep_page:true})
   }
 }
 async browseOne(){
   if(!await this.browseAllowed())return false
   await this.assertNoDraft()
   this.update({state:'browsing',message:'Consultation du fil entre les tâches'})
   let s=await this.open('/');await this.identity()
   if(this.listScroll){
     if(!await this.browseAllowed())return false
     await this.page.mouse.wheel(0,Math.min(2000,this.listScroll));await this.sleep(500);s=await this.snapshot()
   }
   const scrolls=this.pace.browse_variety?randomInt(1,this.pace.browse_scrolls,this.random):0
   for(let i=0;i<scrolls;i++){
     if(!await this.browseAllowed())return false
     await this.identity();await this.page.mouse.wheel(0,randomInt(200,520,this.random)*(i>0&&this.random()<0.2?-1:1));this.feedScrollCount++
     await this.sleep(randomInt(900,2200,this.random));s=await this.snapshot()
   }
   let links=browseCandidates(s.cards,this.pace,this.memory.visited,this.now())
   if(!links.length){
     if(!await this.browseAllowed())return false
     await this.page.mouse.wheel(0,350);this.feedScrollCount++;await this.sleep(700);s=await this.snapshot();links=browseCandidates(s.cards,this.pace,this.memory.visited,this.now())
   }
   if(!links.length){this.listScroll=s.scroll_y||0;this.update({message:'Aucune nouvelle annonce correspondant aux critères dans la page chargée.'});return false}
   if(!await this.browseAllowed())return false
   const card=links[this.pace.browse_variety?randomInt(0,links.length-1,this.random):0];this.listScroll=s.scroll_y||0
   await this.clickLink(card.href);await this.settle()
   for(let i=0;i<this.pace.browse_scrolls;i++){
     if(!await this.browseAllowed())return false
     await this.identity()
     if(new URL(this.page.url()).pathname.match(/^\/items\/(\d+)(?:-|\/|$)/)?.[1]!==card.id)throw review('L’annonce consultée a changé. Reprends la main sur cet onglet.')
     await this.page.mouse.wheel(0,this.pace.browse_variety?randomInt(180,360,this.random):240+i*40)
     await this.sleep(varied(this.pace.browse_item_seconds*1000/this.pace.browse_scrolls,this.pace.browse_variety,this.random))
   }
   if(this.pace.browse_photos){
     const next=this.page.getByRole('button',{name:/^(Photo suivante|Image suivante|Next photo|Next image)$/i}).filter({visible:true})
     if(await this.browseAllowed()&&await next.count()===1){await next.click();await this.sleep(this.pace.page_wait_seconds*1000);this.photoCount++}
   }
   await this.memory.record(card.id,this.now());this.browseCount++
   await this.maybeFavourite(card.id)
   if(!await this.browseAllowed())return true
   await this.assertNoDraft()
   await this.beforeNavigation();await this.page.goBack({waitUntil:'domcontentloaded',timeout:30000});await this.settle();await this.identity()
   return true
 }
}
