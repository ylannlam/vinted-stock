import {LocalError} from './adspower.mjs'

// Inspect only the visible DOM. Dotb renders it in a closed shadow root.
// No extension storage, cookies, conversations or React state are accessed.
export function inspectDOM({features,start,pause,stop,action='read',id}){
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'}
  const all=(selector,parent=this)=>[...parent.querySelectorAll(selector)].filter(visible)
  const text=e=>(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ')
  const matches=(pattern,value)=>new RegExp(pattern,'i').test(value)
  const state=names=>{const starts=names.filter(n=>matches(start,n));if(starts.length===1&&!names.some(n=>matches(pause,n)))return 'ready';if(!starts.length&&names.some(n=>matches(pause,n)||matches(stop,n)))return 'running';return 'unknown'}
  const headings=all('h2,h3,[role="heading"]'),cards=[]
  for(const feature of features){
    const titles=headings.filter(e=>feature.titles.some(t=>t.toLowerCase()===text(e).toLowerCase()))
    if(titles.length!==1)continue
    let container=titles[0],found
    for(let depth=0;depth<6;depth++){
      container=container.parentElement;if(!container)break
      if(headings.some(h=>h!==titles[0]&&container.contains(h)&&features.some(f=>f.titles.includes(text(h)))))break
      const buttons=all('button',container),names=buttons.map(text),status=state(names)
      if(status!=='unknown'){
        const launch=buttons.filter(b=>matches(start,text(b))),ranges=all('[role="combobox"],select',container)
        found={id:feature.id,state:status,disabled:launch.some(b=>b.disabled||b.getAttribute('aria-disabled')==='true'),twelveHours:ranges.length===1&&/^(?:Traiter les 12 dernières heures|Process (?:the )?last 12 hours)$/i.test(text(ranges[0])),launch:launch[0],range:ranges.length===1?ranges[0]:null};break
      }
    }
    if(found)cards.push(found)
  }
  const menus=all('button,a,[role="menuitem"]').filter(e=>/^(?:Automatisations?|Automations?)$/i.test(text(e)))
  const launchers=all('button[aria-haspopup="menu"]').filter(e=>e.querySelector('svg.lucide-bot'))
  if(action==='read')return {cards:cards.map(({launch,range,...c})=>c),menu:menus.length===1,launcher:launchers.length===1,notices:all('[role="status"][data-state="open"],[role="alert"]').map(text).filter(t=>/configuration requise|veuillez configurer|erreur|error|configuration required/i.test(t)).map(t=>t.slice(0,300))}
  let choices=[]
  if(action==='launcher')choices=launchers
  if(action==='menu')choices=menus
  if(action==='start')choices=cards.filter(c=>c.id===id&&c.state==='ready'&&!c.disabled).map(c=>c.launch)
  if(action==='range')choices=cards.filter(c=>c.id===id&&c.state==='ready').map(c=>c.range).filter(Boolean)
  if(action==='twelveHours')choices=all('[role="option"]').filter(e=>/^(?:Traiter les 12 dernières heures|Process (?:the )?last 12 hours)$/i.test(text(e)))
  if(choices.length!==1)return {error:'La commande Dotb est absente ou ambiguë.'}
  const target=choices[0];if(target.disabled||target.getAttribute('aria-disabled')==='true')return {error:'Cette commande Dotb est désactivée.'}
  target.scrollIntoView({block:'nearest',inline:'nearest'})
  const r=target.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2
  const hit=this.elementFromPoint?.(x,y)
  if(!hit||!(target===hit||target.contains(hit)))return {error:'Une fenêtre masque la commande Dotb. Ferme-la puis réessaie.'}
  // AdsPower can ignore CDP pointer input. Dispatch to the actual visible DOM
  // control instead; Radix menu/select triggers listen on pointerdown/up.
  if(action==='range'||action==='twelveHours'){
    const key=action==='range'?'ArrowDown':'Enter'
    target.focus()
    target.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true,composed:true}))
    target.dispatchEvent(new KeyboardEvent('keyup',{key,code:key,bubbles:true,cancelable:true,composed:true}))
    return {clicked:true}
  }
  if(action==='launcher'){
    target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,composed:true,pointerType:'mouse',pointerId:1,button:0,buttons:1,clientX:x,clientY:y}))
    target.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,composed:true,pointerType:'mouse',pointerId:1,button:0,buttons:0,clientX:x,clientY:y}))
  }
  target.click()
  return {clicked:true}
}
export class DotbUI{
  constructor(page,session,settings){this.page=page;this.session=session;this.settings=settings;this.objects=new Set()}
  static async create(page,settings){return new DotbUI(page,await page.context().newCDPSession(page),settings)}
  async inspect(){
    if(this.page.isClosed())return []
    let document;try{document=await this.session.send('DOM.getDocument',{depth:3,pierce:true})}catch{return []}
    const {root}=document,nodes=[root]
    function collect(n){for(const s of n.shadowRoots||[]){nodes.push(s);collect(s)}for(const child of n.children||[])collect(child)}collect(root)
    const results=[]
    for(const node of nodes){try{const {object}=await this.session.send('DOM.resolveNode',{nodeId:node.nodeId});const root={objectId:object.objectId};this.objects.add(root.objectId);const value=await this.read(root);if(value.cards.length||value.menu||value.launcher)results.push({objectId:root.objectId,value})}catch{}}
    return results
  }
  async call(root,action='read',id){
    const result=await this.session.send('Runtime.callFunctionOn',{objectId:root.objectId,functionDeclaration:inspectDOM.toString(),arguments:[{value:{...this.settings,action,id}}],returnByValue:true,userGesture:action!=='read'})
    if(result.exceptionDetails||!result.result.value)throw new LocalError('Le panneau Dotb a changé. Actualise le profil et réessaie.')
    return result.result.value
  }
  read(root){return this.call(root)}
  async click(root,action,id){
    await this.page.bringToFront()
    const point=await this.call(root,action,id);if(point.error)throw new LocalError(point.error)
    if(point.clicked)return
  }
  async close(){for(const objectId of this.objects)await this.session.send('Runtime.releaseObject',{objectId}).catch(()=>{});await this.session.detach().catch(()=>{})}
}
