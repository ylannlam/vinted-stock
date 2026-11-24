import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'

test('dressing, sélection, fiches à imprimer et bordereaux sur demande',async()=>{
  const rootDir=fileURLToPath(new URL('..',import.meta.url))
  const result=await build({stdin:{contents:"export {default as Wardrobe} from './src/components/Wardrobe';export {default as SalesDesk} from './src/components/SalesDesk'",resolveDir:rootDir},
    bundle:true,platform:'node',packages:'external',write:false,jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'private-board',setup(b){
      b.onResolve({filter:/^\.\.\/lib\/scalency$/},()=>({path:'scalency',namespace:'mock'}))
      b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:"export const query=(...args)=>globalThis.shopExample.query(...args);export const act=()=>{throw Error('unexpected write')}"}))
    }}]})
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
  const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(rootDir);mod._compile(result.outputFiles[0].text,fileURLToPath(import.meta.url))
  const root=createRoot(document.getElementById('root')),reads=[]
  const board={drafts:[],emptyOrders:[],groups:[{sku:'TEST-4',key:'test-4',title:'Robe test',sales:[{account:'Exemple',stage:'pending',date:'2026-11-03',qty:1,title:'Robe test'}],listings:[{id:'19',account:'Exemple',status:'en ligne',title:'Robe test',photo:'https://example.org/test.jpg',price:32,views:0,favourites:2}]}],
    sales:[{id:'c1',account:'Exemple',title:'Vente',date:'2026-10-12',state:'ready',status:'label_sent',hasLabel:true,lines:[{id:'v',sku:'TEST-4',title:'Robe test'}]},
      {id:'c2',account:'Exemple',date:'2026-10-12',state:'cancelled',status:'cancelled',hasLabel:true,lines:[{id:'w',title:'Vente annulée'}]}]}
  globalThis.shopExample={query:async(view)=>{reads.push(view);if(view==='shop-board')return board;if(view==='shop-refresh')return {skipped:true};throw Error('indisponible')}}
  const copies=[]
  const originalClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard')
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copies.push(value)}}})
  const click=async(node)=>{assert.ok(node);await act(async()=>{node.click()})}
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text))
  try{
    await act(async()=>root.render(React.createElement(mod.exports.Wardrobe,{params:{},admin:true})))
    assert.equal(document.querySelector('.shop-card .shop-sku').textContent,'SKU TEST-4')
    assert.equal(document.querySelector('.shop-card img').getAttribute('src'),'https://example.org/test.jpg')
    await click(document.querySelector('.shop-card .shop-copy'))
    assert.deepEqual(copies,['TEST-4']);assert.equal(document.querySelector('.shop-copy').textContent,'Copié !')
    assert.equal(document.querySelector('[role=dialog]'),null)
    assert.ok(!document.querySelector('.shop-check input').checked)
    await click(button('Masquées'));assert.equal(document.querySelectorAll('.shop-card').length,0)
    await click(button('En ligne'));assert.equal(document.querySelectorAll('.shop-card').length,1)
    await click(button('Robe test'));assert.ok(document.querySelector('[role=dialog] a[href^="#dressing/sku"]'))
    await click(document.querySelector('[role=dialog] .shop-copy'));assert.deepEqual(copies,['TEST-4','TEST-4'])
    await click(button('Fermer'))
    await act(async()=>root.render(React.createElement(mod.exports.Wardrobe,{params:{section:'sku'},admin:true})))
    const rankCard=document.querySelector('.shop-grid .shop-rank-card')
    assert.equal(rankCard.querySelector('img').getAttribute('src'),'https://example.org/test.jpg')
    assert.equal(rankCard.querySelector('.shop-units').textContent,'1 vendu')
    assert.match(rankCard.querySelector('.shop-sku').textContent,/TEST-4/)
    assert.deepEqual([...rankCard.querySelectorAll('dd')].map(node=>node.textContent),['0','1','1','1','2'])
    assert.match(rankCard.querySelector('.shop-rank-date').textContent,/3 nov\. 2026/)
    assert.match(document.querySelector('.shop-subheading').textContent,/1 article vendu avec SKU/)
    await click(rankCard.querySelector('.shop-copy'));assert.equal(document.querySelector('[role=dialog]'),null)
    await click(rankCard.querySelector('.shop-photo-open'));assert.ok(document.querySelector('[role=dialog]'))
    await click(button('Fermer'));await click(button('Tableau'))
    assert.match(document.querySelector('.shop-rank tbody').textContent,/TEST-4/)
    assert.deepEqual([...document.querySelectorAll('.shop-rank tbody td')].slice(0,3).map(td=>td.textContent),['1','0','1'])
    await click(button('Photos'));assert.ok(document.querySelector('.shop-rank-card .shop-photo'))
    await act(async()=>root.render(React.createElement(mod.exports.SalesDesk,{params:{}})))
    assert.equal(document.querySelectorAll('.shop-sales tbody tr').length,1)
    await click(document.querySelector('.sale-product .shop-copy'));assert.deepEqual(copies,Array(4).fill('TEST-4'))
    assert.ok(button('Imprimer les bordereaux').disabled)
    await click(button('Cocher les bordereaux'))
    assert.equal(button('Imprimer les bordereaux').disabled,false)
    await click(button('Fiches articles'))
    assert.match(document.querySelector('.shop-print-list').textContent,/TEST-4/)
    assert.equal(reads.includes('label'),false)
    await click(button('Fermer'))
    await click(button('Imprimer les bordereaux'));assert.equal(reads.filter(v=>v==='label').length,1)
    await click(button('Fermer'));await click(button('Annulées et incidents'))
    assert.match(document.querySelector('.shop-sales tbody').textContent,/Vente annulée/)
    assert.equal(document.querySelector('.sale-product .shop-copy'),null)
    assert.ok(button('Imprimer les bordereaux').disabled)
  }finally{
    await act(async()=>root.unmount())
    if(originalClipboard)Object.defineProperty(navigator,'clipboard',originalClipboard)
    else delete navigator.clipboard
    delete globalThis.shopExample;delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
