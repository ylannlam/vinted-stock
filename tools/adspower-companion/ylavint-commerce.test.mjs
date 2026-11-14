import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {parseHTML} from 'linkedom'
import {commercePage,readWallet,readOrderCards,readOrderDetail,validLabelUrl,validatePdf,VisibleCommerce} from './ylavint-commerce.mjs'

const id='01a1babe-a720-7963-879d-eb437fc23e79'
const pdf=Buffer.from('%PDF-1.7\n'+'x'.repeat(130)),wallet={url:'https://www.vinted.fr/wallet/balance',available:'0,00 €\nMontant disponible',pending:'Montant en attente\n92,00 €',controls:[{text:'Transférer',enabled:false}]}
test('wallet separates the two rendered labels, preserves zero and refuses ambiguous or missing numbers',()=>{
 assert.deepEqual(readWallet(wallet),{available:0,pending:92,currency:'EUR',withdrawal:'unavailable'})
 assert.deepEqual(readWallet({...wallet,available:'1 234,56 €\nMontant disponible',controls:[{text:'Transférer',enabled:true}]}),{available:1234.56,pending:92,currency:'EUR',withdrawal:'available'})
 assert.equal(readWallet({...wallet,available:'30,00 €',controls:[]}).withdrawal,'unknown')
 for(const patch of [{pending:null},{available:'0,00 € 92,00 €'},{available:'Chargement…'},{url:'https://example.com/wallet/balance'}])assert.throws(()=>readWallet({...wallet,...patch}))
})
test('DOM extraction reads labels without hydration or API data and excludes buyer bubbles',()=>{
 const {document}=parseHTML(`<html><body><section><div><span>Montant en attente</span><span>92,00 €</span></div><div><h2>0,00 €</h2><span>Montant disponible</span></div><button disabled>Transférer</button></section><div data-testid="conversation-content"><div class="conversation-message-container"><div class="Bubble__bubble">Article à emballer <button>Imprimer le bordereau d'envoi</button></div></div><div class="conversation-message-container"><p>En attente de réponse quant à la demande de prolongation</p><button>Annuler la demande</button></div></div></body></html>`)
 const saved={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle}
 try{globalThis.document=document;globalThis.location={href:wallet.url};globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'});for(const e of document.querySelectorAll('*'))e.getClientRects=()=>[{}]
  const s=commercePage();assert.deepEqual(readWallet(s),readWallet(wallet));assert.equal(s.system.length,1);assert.match(s.system[0].text,/prolongation/)
 }finally{Object.assign(globalThis,saved)}
})
test('only links with an order image, amount and status become visible orders',()=>{
 const s={url:'https://www.vinted.fr/my_orders',text:'Mes commandes Ventes',links:[{href:'https://www.vinted.fr/inbox/'+id,image:'https://images.vinted.net/a.jpg',text:'Robe longue\n52,00 €\nBordereau envoyé au vendeur'},{href:'https://evil.test/inbox/'+id,image:'x',text:'Robe\n2,00 €\nPayée'}]}
 const rows=readOrderCards(s);assert.equal(rows.length,1);assert.equal(rows[0].conversation_id,id);assert.equal(rows[0].price,52);assert.equal(rows[0].label_state,'unavailable')
 assert.throws(()=>readOrderCards({...s,links:[]}));assert.deepEqual(readOrderCards({...s,links:[],text:'Mes commandes : aucune vente'}),[])
})
test('an existing label can be retrieved; cancellation, extension requests and generation steps are never clicked',()=>{
 const row={conversation_id:id,title:'Robe',status:'Bordereau envoyé au vendeur'},control={text:"Imprimer le bordereau d'envoi",enabled:true}
 const base={url:'https://www.vinted.fr/inbox/'+id,conversation:true,system:[{text:'Article à emballer et envoyer (avant le 23 nov. 10:00)\nImprime le bordereau. Mondial Relay',controls:[control]}]}
 const r=readOrderDetail(base,row);assert.equal(r.label_state,'ready');assert.equal(r.carrier,'Mondial Relay');assert.equal(r.deadline_text,'avant le 23 nov. 10:00')
 for(const block of [{text:'En attente de réponse quant à la demande de prolongation',controls:[{text:'Annuler la demande',enabled:true}]},{text:'Commande annulée',controls:[control]},{text:'Article à emballer',controls:[{text:'Obtenir le bordereau',enabled:true}]},{text:'Article à emballer',controls:[control,control]}])assert.equal(readOrderDetail({...base,system:[block]},row).label_state,'waiting')
 assert.throws(()=>readOrderDetail({...base,url:'https://www.vinted.fr/inbox/99'},row))
})
test('PDF validation rejects unrelated destinations, credentials, HTML and oversized files',()=>{
 assert.ok(validLabelUrl('https://svc-shipping-labels.s3.eu-central-1.amazonaws.com/file?signature=opaque'))
 for(const url of ['http://www.vinted.fr/a','https://evil.amazonaws.com/a','https://www.vinted.fr.evil.test/a','https://user:password@www.vinted.fr/a'])assert.equal(validLabelUrl(url),false)
 assert.deepEqual(validatePdf(pdf),pdf)
 for(const bytes of [Buffer.from('<html>error</html>'),Buffer.from('%PDF'),Buffer.alloc(3*1024*1024+1)])assert.throws(()=>validatePdf(bytes))
})
test('saving a PDF is driven by one visible click and accepts only a document opened by that page',async()=>{
 const context=new EventEmitter(),page=new EventEmitter();let clicks=0,closed=0,front=0
 const popup=new EventEmitter();Object.assign(popup,{opener:async()=>page,close:async()=>{closed++},isClosed:()=>false,url:()=> 'https://svc-shipping-labels.s3.eu-central-1.amazonaws.com/label'})
 const button={or(){return this},count:async()=>1,click:async()=>{
  clicks++;page.emit('popup',popup)
  context.emit('response',{url:()=>popup.url(),headers:()=>({'content-type':'application/pdf','content-length':String(pdf.length)}),request:()=>({isNavigationRequest:()=>true,frame:()=>({page:()=>popup})}),body:async()=>pdf})
 }}
 Object.assign(page,{context:()=>context,getByRole:()=>button,bringToFront:async()=>{front++}})
 const reader={page,check:()=>{},sleep:async()=>{await new Promise(setImmediate)}}
 assert.deepEqual(await new VisibleCommerce({reader}).download({text:"Imprimer le bordereau d'envoi"}),pdf)
 assert.equal(clicks,1);assert.equal(closed,1);assert.equal(front,1);assert.equal(context.listenerCount('response'),0);assert.equal(page.listenerCount('popup'),0)
})
