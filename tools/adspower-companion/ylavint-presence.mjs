import {randomUUID} from 'node:crypto'
import {visibleDraft} from './ylavint-browsing.mjs'

export const QUIET_MS=60000
export const interrupted=()=>Object.assign(Error('Tu utilises ce profil. L’assistant attend puis reprend après 60 secondes sans interaction.'),{code:'desktop_interrupted',keep_page:true})
export function mayRetryInterrupted(task,row){
  return task?.kind!=='publish_item'&&!Object.keys(row?.steps||{}).length&&!Object.keys(row?.confirmed||{}).length
}
export function humanActivityClock(now=Date.now){
  let last=null,pending=false
  return {touch(){last=now();pending=true},get pending(){return pending},remaining(){return pending?Math.max(0,last+QUIET_MS-now()):0},reset(){pending=false}}
}

// Observe input events only. No key values, field contents, page text or URLs
// are sent through this binding. Agent inputs are suppressed for their duration.
export function installPresence({key,binding}){
  if(window[key])return
  const state=window[key]={own:[]}
  const notice=e=>{if(e.isTrusted&&!state.own.includes(e.type))void window[binding]().catch(()=>{})}
  for(const name of ['pointerdown','keydown','wheel','input'])window.addEventListener(name,notice,{capture:true,passive:true})
  state.dispose=()=>{for(const name of ['pointerdown','keydown','wheel','input'])window.removeEventListener(name,notice,{capture:true});delete window[key]}
}

const inputs=new Set(['click','dblclick','tap','press','pressSequentially','type','fill','clear','check','uncheck','setChecked','selectOption','setInputFiles','focus','hover','scrollIntoViewIfNeeded','goto','reload','goBack','goForward','bringToFront','down','up','move','wheel','insertText'])
const reads=new Set(['evaluate','evaluateAll','count','inputValue','getAttribute','textContent','innerText','allTextContents','allInnerTexts','isVisible','isEnabled','isEditable','isChecked','waitFor','waitForLoadState','waitForURL'])
const chains=new Set(['locator','getByRole','getByText','getByTestId','getByLabel','getByPlaceholder','getByAltText','getByTitle','filter','first','last','nth','and','or'])
const navigations=new Set(['click','dblclick','tap','press','goto','reload','goBack','goForward'])

export async function createPresence(context,{now=Date.now}={}){
  // Minimal injected readers in unit tests have no browser event surface.
  if(!context.exposeBinding)return null
  const clock=humanActivityClock(now),key='__ylavintPresence_'+randomUUID().replaceAll('-',''),binding=key+'_notify'
  const pages=new Map(),touched=new Set(),proxies=new WeakMap(),raws=new WeakMap()
  let disposed=false,worker=null
  const vinted=page=>/^https:\/\/(?:www\.)?vinted\.fr(?:\/|$)/.test(page.url())
  await context.exposeBinding(binding,({page})=>{if(!disposed&&vinted(page)){touched.add(page);clock.touch()}})
  const attach=async page=>{
    if(pages.has(page))return pages.get(page).ready
    const info={depth:0,navUntil:0,url:page.url()};pages.set(page,info)
    const navigation=frame=>{
      if(frame!==page.mainFrame())return
      const next=page.url(),changed=next!==info.url;info.url=next
      // A SPA may update its URL shortly after our click has resolved. Genuine
      // DOM input still yields immediately, including during this short grace.
      if(changed&&!info.depth&&now()>=info.navUntil&&vinted(page)){touched.add(page);clock.touch()}
    }
    info.navigation=navigation;page.on('framenavigated',navigation)
    info.ready=(async()=>{
      await page.addInitScript(installPresence,{key,binding})
      if(!page.isClosed())await page.evaluate(installPresence,{key,binding})
    })()
    await info.ready
  }
  const onPage=page=>{void attach(page).catch(()=>{if(!disposed)clock.touch()})}
  context.on('page',onPage)
  for(const page of context.pages())await attach(page)
  const guard=async()=>{if(clock.pending)throw interrupted()}
  const wrap=(target,page)=>{
    if(proxies.has(target))return proxies.get(target)
    const proxy=new Proxy(target,{get(object,name){
      const value=Reflect.get(object,name,object)
      if(['keyboard','mouse','touchscreen'].includes(name))return wrap(value,page)
      if(typeof value!=='function')return value
      if(chains.has(name))return (...args)=>wrap(value.apply(object,args.map(a=>raws.get(a)||a)),page)
      if(name==='all')return async(...args)=>(await value.apply(object,args)).map(item=>wrap(item,page))
      if(!inputs.has(name)&&!reads.has(name))return value.bind(object)
      return async(...args)=>{
        await guard()
        if(!inputs.has(name)){const result=await value.apply(object,args);await guard();return result}
        const info=pages.get(page);info.depth++
        try{
          const events=['press','pressSequentially','type','fill','clear','insertText'].includes(name)?['keydown','input']:['click','dblclick','tap','check','uncheck','setChecked','selectOption','setInputFiles','down','up'].includes(name)?['pointerdown','input']:name==='wheel'?['wheel']:[]
          await page.evaluate(({key,events})=>{if(window[key])window[key].own=events},{key,events})
          await guard()
          const result=await value.apply(object,args);await guard();return result
        }catch(e){
          if(clock.pending)throw interrupted()
          throw e
        }finally{
          info.depth--
          if(navigations.has(name))info.navUntil=now()+5000
          await page.evaluate(k=>{if(window[k])window[k].own=[]},key).catch(()=>{})
        }
      }
    }})
    proxies.set(target,proxy);raws.set(proxy,target);return proxy
  }
  const hasDraft=async()=>{
    for(const page of new Set([worker,...touched])){
      if(!page||page.isClosed()||!vinted(page))continue
      if(await page.evaluate(visibleDraft))return true
      if(await page.locator('[role="dialog"] input:visible,[data-testid="offer-modal"] input:visible').evaluateAll(nodes=>nodes.some(e=>!['checkbox','radio','hidden'].includes(e.type)&&e.value.trim())))return true
    }
    return false
  }
  return {guard,get pending(){return clock.pending},touch:()=>clock.touch(),
    async page(page){await attach(page);worker=page;return wrap(page,page)},
    async wait({signal,sleep,control,update}){
      if(!clock.pending)clock.touch()
      while(!signal.aborted){
        if(!(await control()).allowed)return false
        const draft=await hasDraft(),remaining=clock.remaining()
        if(!draft&&!remaining){clock.reset();touched.clear();update({resume_at:null,next_check_at:null,current_action:null,message:'Reprise automatique · vérification des conversations'});return true}
        update({state:'user_wait',message:draft?'Tu as la main · termine ou efface ton brouillon dans Vinted. Reprise automatique après 60 secondes sans interaction.':`Tu as la main · reprise automatique dans ${Math.ceil(remaining/1000)} s sans interaction.`,resume_at:draft?null:new Date(now()+remaining).toISOString(),current_action:null,next_check_at:null})
        await sleep(2000)
      }
      return false
    },
    async dispose(){disposed=true;context.off('page',onPage);for(const [page,info] of pages){page.off('framenavigated',info.navigation);if(!page.isClosed())await page.evaluate(k=>window[k]?.dispose(),key).catch(()=>{})}}
  }
}
