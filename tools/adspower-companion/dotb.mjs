import {LocalError,delay} from './adspower.mjs'
import {DotbUI} from './dotb-ui.mjs'

export const FEATURES=[
  {id:'likes',label:'Messages aux likes',titles:['Automatisation des messages aux likes','Item Likes','Messages aux likes','Messages to Likes'],lookback:true},
  {id:'agent',label:'Smart Agent v2',titles:['Smart Agent v2','Smart Agent','Agent intelligent'],lookback:true},
  {id:'orders',label:'Flux de commandes',titles:['Flux de commandes','Order Flows']},
  {id:'bridge',label:'Bridge',titles:['Bridge']},
]
export const START='^(?:Start|Démarrer|Lancer|Resume|Reprendre)$'
export const PAUSE='^(?:Pause|Mettre en pause)$',STOP='^(?:Stop|Arrêter|Arreter)$'
export function controlState(labels){
  const run=labels.filter(label=>new RegExp(START,'i').test(label)),paused=labels.some(label=>new RegExp(PAUSE,'i').test(label)),stopped=labels.some(label=>new RegExp(STOP,'i').test(label))
  if(run.length===1&&!paused)return 'ready'
  if(!run.length&&(paused||stopped))return 'running'
  return 'unknown'
}
export function isVinted(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&/^(?:www\.)?vinted\.(?:fr|be|com|co\.uk|de|es|it|nl|pt|pl|at|lu|ie)$/.test(u.hostname)}catch{return false}}
async function findPanel(uis){
  const panels=[]
  for(const ui of uis){const roots=await ui.inspect();for(const root of roots)if(root.value.cards.length===FEATURES.length)panels.push({ui,root})}
  if(panels.length>1)throw new LocalError('Plusieurs panneaux Dotb sont ouverts. Garde un seul panneau d’automatisation dans ce profil.')
  return panels[0]
}
export async function startDotb(profile,update,ads,{connect}={}){
  const launched=await ads.start(profile.id)
  const connector=connect||((address,options)=>import('playwright-core').then(({chromium})=>chromium.connectOverCDP(address,options)))
  let browser;const uis=[]
  try{
    browser=await connector(launched.address,{timeout:20000,noDefaults:true})
    const context=browser.contexts()[0];if(!context)throw new LocalError('Le navigateur AdsPower ne fournit pas de profil accessible.')
    update({state:'vinted',message:'Ouverture de Vinted'})
    let pages=context.pages().filter(page=>isVinted(page.url()))
    if(!pages.length){const page=await context.newPage();await page.goto('https://www.vinted.fr/',{waitUntil:'domcontentloaded',timeout:45000});pages=[page]}
    async function syncPages(){for(const page of context.pages()){if(isVinted(page.url())&&!uis.some(ui=>ui.page===page))uis.push(await DotbUI.create(page,{features:FEATURES,start:START,pause:PAUSE,stop:STOP}))}}
    await syncPages()
    if(!uis.length)throw new LocalError('Vinted demande une connexion ou une vérification. Termine-la dans ce profil puis réessaie.')
    update({state:'dotb',message:'Ouverture des automatisations Dotb'})
    let panel=await findPanel(uis)
    if(!panel){
      let target
      for(let i=0;i<50&&!target;i++){
        await syncPages()
        for(const ui of uis){const roots=await ui.inspect();const root=roots.find(r=>r.value.menu||r.value.launcher);if(root){target={ui,root};break}}
        if(!target)await delay(600)
      }
      if(!target)throw new LocalError('Dotb n’est pas visible. Vérifie que l’extension est installée et connectée dans ce profil.')
      if(!target.root.value.menu){
        await target.ui.click(target.root,'launcher')
        let menuRoot
        for(let i=0;i<20&&!menuRoot;i++){await delay(150);menuRoot=(await target.ui.inspect()).find(r=>r.value.menu)}
        if(!menuRoot)throw new LocalError('Le menu Dotb ne s’est pas ouvert. Vérifie ce profil puis réessaie.')
        target.root=menuRoot
      }
      await target.ui.click(target.root,'menu')
      for(let i=0;i<50&&!panel;i++){await delay(600);await syncPages();panel=await findPanel(uis)}
      if(!panel)throw new LocalError('Le panneau Dotb ne s’est pas chargé. Ouvre « Automatisations » dans ce profil puis réessaie.')
    }
    const {ui,root}=panel
    // Check all four cards before starting any, and never use a global Start.
    let snapshot=await ui.read(root)
    for(const feature of FEATURES){const card=snapshot.cards.find(c=>c.id===feature.id);if(!card||card.state==='unknown'||card.disabled)throw new LocalError('Vérifie la configuration de « '+feature.label+' » dans Dotb.')}
    for(const feature of FEATURES.filter(f=>f.lookback)){
      const card=snapshot.cards.find(c=>c.id===feature.id)
      if(card.state==='running')continue
      if(!card.twelveHours){
        await ui.click(root,'range',feature.id);await delay(200)
        await ui.click(root,'twelveHours',feature.id);await delay(200)
        snapshot=await ui.read(root)
        if(!snapshot.cards.find(c=>c.id===feature.id)?.twelveHours)throw new LocalError('Le choix des 12 dernières heures n’a pas été confirmé pour « '+feature.label+' ».')
      }
    }
    const completed=[],failures=[]
    for(const feature of FEATURES){
      const before=await ui.read(root),current=before.cards.find(c=>c.id===feature.id)
      if(!current||current.state==='unknown')throw new LocalError('Le panneau Dotb a changé. Vérifie ce profil avant de réessayer.')
      if(current.state==='ready'){
        update({message:'Démarrage : '+feature.label})
        await ui.click(root,'start',feature.id)
        let confirmed=false,configurationRequired=false
        for(let i=0;i<30;i++){
          await delay(350);const after=await ui.read(root)
          if(after.cards.find(c=>c.id===feature.id)?.state==='running'){confirmed=true;break}
          if(after.notices.some(n=>!before.notices.includes(n))){configurationRequired=true;break}
        }
        if(!confirmed){failures.push(feature.label+(configurationRequired?' : configuration requise dans Dotb':' : démarrage non confirmé'));continue}
      }
      completed.push(feature.id);update({features:[...completed]})
    }
    if(failures.length)throw new LocalError(completed.length+'/4 démarrés. '+failures.join(' · '))
    return {features:completed}
  }finally{
    for(const ui of uis)await ui.close()
    // Disconnect CDP only: AdsPower and its automation pages stay open.
    if(browser)await browser.close().catch(()=>{})
  }
}
