import test from 'node:test'
import assert from 'node:assert/strict'
import {runInNewContext} from 'node:vm'
import {parseHTML} from 'linkedom'
import {inspectDOM} from './dotb-ui.mjs'
import {FEATURES,START,PAUSE,STOP} from './dotb.mjs'

function fixture(){
  const {document,window}=parseHTML('<html><body><div id="extension"></div></body></html>')
  const root=document.querySelector('#extension').attachShadow({mode:'closed'})
  const rectangles=new Map();let next=0,launches=0,menuOpens=0
  function prepare(){for(const e of root.querySelectorAll('*'))if(!rectangles.has(e)){
    const x=++next*20;rectangles.set(e,{x,y:0,width:10,height:10})
    e.getBoundingClientRect=()=>rectangles.get(e);e.scrollIntoView=()=>{};e.focus=()=>{}
  }}
  root.elementFromPoint=(x,y)=>[...rectangles].find(([e,r])=>e.isConnected&&x>=r.x&&x<=r.x+r.width&&y>=0&&y<=10)?.[0]
  function panel(){
    root.innerHTML=FEATURES.map(f=>'<section><h3>'+f.titles[0]+'</h3>'+(f.lookback?'<button role="combobox">Traiter uniquement les nouveaux messages</button>':'')+'<button class="start">Démarrer</button></section>').join('')
    for(const section of root.querySelectorAll('section')){
      section.querySelector('.start').addEventListener('click',e=>{launches++;e.currentTarget.textContent='Pause'})
      const range=section.querySelector('[role="combobox"]')
      range?.addEventListener('keydown',e=>{
        if(e.key!=='ArrowDown')return
        const option=document.createElement('div');option.setAttribute('role','option');option.textContent='Traiter les 12 dernières heures';root.append(option);prepare()
        option.addEventListener('keydown',e=>{if(e.key==='Enter'){range.textContent=option.textContent;option.remove()}})
      })
    }prepare()
  }
  root.innerHTML='<button aria-haspopup="menu"><svg class="lucide-bot"></svg></button>';prepare()
  root.querySelector('button').addEventListener('pointerdown',()=>{
    menuOpens++;const item=document.createElement('div');item.setAttribute('role','menuitem');item.textContent='Automatisations';item.addEventListener('click',panel);root.append(item);prepare()
  })
  class UIEvent extends window.Event{constructor(type,init){super(type,init);for(const key of ['key','code','pointerType','button'])this[key]=init[key]}}
  const inspect=runInNewContext('('+inspectDOM.toString()+')',{getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),KeyboardEvent:UIEvent,PointerEvent:UIEvent})
  const call=(action='read',id)=>inspect.call(root,{features:FEATURES,start:START,pause:PAUSE,stop:STOP,action,id})
  return {root,call,panel,counts:()=>({launches,menuOpens})}
}

test('closed Dotb menu opens, both 12-hour selections persist, and all four starts are confirmed',()=>{
  const f=fixture();assert.equal(f.call().launcher,true);assert.equal(f.call().menu,false)
  assert.equal(f.call('launcher').clicked,true);assert.equal(f.call().menu,true)
  f.call('menu');assert.equal(f.call().cards.length,4)
  for(const id of ['likes','agent']){
    assert.equal(f.call().cards.find(c=>c.id===id).twelveHours,false)
    f.call('range',id);f.call('twelveHours',id)
    assert.equal(f.call().cards.find(c=>c.id===id).twelveHours,true)
  }
  for(const feature of FEATURES){f.call('start',feature.id);assert.equal(f.call().cards.find(c=>c.id===feature.id).state,'running')}
  assert.equal(f.call('start','agent').error,'La commande Dotb est absente ou ambiguë.')
  assert.deepEqual(f.counts(),{launches:4,menuOpens:1})
})

test('ambiguous automation cards never receive a start click',()=>{
  const f=fixture();f.panel()
  const duplicate=f.root.querySelector('section').cloneNode(true);f.root.append(duplicate)
  for(const e of [duplicate,...duplicate.querySelectorAll('*')])e.getBoundingClientRect=()=>({x:0,y:0,width:10,height:10})
  assert.equal(f.call('start','likes').error,'La commande Dotb est absente ou ambiguë.')
  assert.equal(f.counts().launches,0)
})
