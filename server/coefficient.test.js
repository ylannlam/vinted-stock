import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {coefficient,saleCoefficient,totalCoefficient,formatCoefficient,simulateCoefficient,parseAmount} from '../src/lib/coefficient.js'

const sale=(patch={})=>({source:{selling_price:'20'},actual_cost:8,fees_amount:0,refund_amount:0,order:{status:'payment_received',currency:'EUR'},...patch})

test('a sale coefficient uses only the real paid cost, after refunds and fees',()=>{
 assert.equal(saleCoefficient(sale()),2.5)
 assert.equal(saleCoefficient(sale({fees_amount:2,refund_amount:3})),15/8)
 for(const missing of [{actual_cost:null},{actual_cost:''},{actual_cost:0},{source:{selling_price:''}},{source:{}},{actual_cost:-1},{fees_amount:'abc'}])assert.equal(saleCoefficient(sale(missing)),null,JSON.stringify(missing))
 assert.equal(saleCoefficient({...sale({actual_cost:null}),catalog_price:5,product:{price:5}}),null,'catalog price is never used')
 assert.equal(saleCoefficient(sale({order:{status:'returning'}})),null,'returns are not counted')
 assert.equal(saleCoefficient(sale({refund_amount:20})),0,'a full refund without fees gives ×0')
 assert.equal(saleCoefficient(sale({refund_amount:25})),-5/8,'refunds above the sale price preserve the negative net, like SQL')
})
test('French display, and amounts typed with a comma',()=>{
 assert.equal(formatCoefficient(2.5),'×2,5');assert.equal(formatCoefficient(2),'×2,0');assert.equal(formatCoefficient(15/8),'×1,9');assert.equal(formatCoefficient(12.4),'×12')
 assert.equal(formatCoefficient(null),null);assert.equal(formatCoefficient(Infinity),null)
 assert.equal(parseAmount('8,50'),8.5);assert.equal(parseAmount(' 1 250,5 '),1250.5);assert.equal(parseAmount('abc'),null);assert.equal(parseAmount('-2'),null)
 assert.equal(coefficient('20','8,00'),2.5);assert.equal(coefficient(20,0),null)
})
test('the monthly coefficient is total earned ÷ total paid, not an average of ratios',()=>{
 // Two sales: 10 € paid → 40 € (×4) and 30 € paid → 30 € (×1). Weighted: 70 ÷ 40 = ×1,75 (an average would say ×2,5).
 assert.equal(totalCoefficient({coef_revenue:70,coef_cost:40,coef_count:2}),1.75)
 assert.equal(totalCoefficient({coef_revenue:null,coef_cost:null,coef_count:0}),null)
 assert.equal(totalCoefficient({coef_revenue:'25',coef_cost:'12',coef_count:'1'}),25/12)
 assert.equal(totalCoefficient(undefined),null)
})
test('the calculator gives the coefficient, the margin and the resale prices for ×2, ×2,5 and ×3',()=>{
 const r=simulateCoefficient({cost:'8,50',price:'20'})
 assert.equal(r.ready,true);assert.equal(formatCoefficient(r.coefficient),'×2,4');assert.equal(r.margin,11.5)
 assert.deepEqual(r.suggestions,[{k:2,price:17},{k:2.5,price:21.25},{k:3,price:25.5}])
 assert.deepEqual(simulateCoefficient({cost:'7,33',price:''}).suggestions.map(s=>s.price),[14.66,18.33,21.99],'rounded up to the cent')
 const fees=simulateCoefficient({cost:10,price:25,fees:'1,50'})
 assert.equal(fees.coefficient,2.35);assert.equal(fees.margin,13.5);assert.equal(fees.suggestions[0].price,21.5)
 assert.equal(simulateCoefficient({cost:'',price:'20'}).reason,'cost');assert.equal(simulateCoefficient({cost:'0',price:'20'}).ready,false)
 assert.equal(simulateCoefficient({cost:10,price:5}).margin,-5)
})
test('invalid money is not silently treated as zero and excluded sales never get a coefficient',()=>{
 for(const v of ['   ',true,false,[],{},'1e3','0x10','1 2,50','Infinity'])assert.equal(parseAmount(v),null,String(v))
 for(const status of ['cancelled','suspended','returning','',undefined])assert.equal(saleCoefficient(sale({order:{status}})),null)
 for(const price of [' 20 ','20,00',true,[]])assert.equal(saleCoefficient(sale({source:{selling_price:price}})),null,'same source format as SQL')
 for(const fees of ['abc','-2','0,001',true])assert.equal(simulateCoefficient({cost:10,price:20,fees}).reason,'fees')
 assert.equal(simulateCoefficient({cost:10,price:'  '}).ready,false)
 assert.equal(simulateCoefficient({cost:'0,001',price:20}).ready,false)
 assert.equal(simulateCoefficient({cost:10,price:20,fees:'  '}).coefficient,2)
 assert.equal(simulateCoefficient({cost:10,price:5,fees:7}).coefficient,-0.2)
 assert.equal(totalCoefficient({coef_revenue:-5,coef_cost:8,coef_count:1}),-5/8)
 assert.equal(coefficient(Number.MAX_VALUE,Number.MIN_VALUE),null)
 assert.equal(formatCoefficient(-0.625),'×-0,6')
})
test('target prices never fall below the requested multiple after rounding to cents',()=>{
 for(const cost of [0.01,0.29,1.13,7.31,7.33,8.50,999.99]) {
  const result=simulateCoefficient({cost,price:20,fees:0.03})
  for(const {k,price} of result.suggestions)assert.ok((Math.round(price*100)-3)>=k*Math.round(cost*100),`${cost} × ${k}`)
 }
})

async function render(entry,props) {
 const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
 globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
 const compiled=await build({entryPoints:[fileURLToPath(new URL(entry,import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['../lib/api']})
 const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
 const root=createRoot(document.getElementById('app'))
 await act(async()=>root.render(React.createElement(mod.exports.default,props)))
 await act(async()=>{await new Promise(r=>setTimeout(r,10))})
 return {act,root,props:node=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))],
  async close(){await act(async()=>root.unmount());delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT}}
}
test('the calculator updates as the prices are typed, and a suggested price fills the resale field',async()=>{
 const ui=await render('../src/components/CoefficientSimulator.jsx',{})
 try{
  const [cost,price]=[...document.querySelectorAll('input')]
  assert.ok(document.body.textContent.includes('Indique le prix payé sur Shein'))
  await ui.act(async()=>ui.props(cost).onChange({target:{value:'8,50'}}))
  await ui.act(async()=>ui.props(price).onChange({target:{value:'20'}}))
  assert.ok(document.body.textContent.includes('×2,4'));assert.ok(document.body.textContent.replace(/\s/g,' ').includes('11,50'))
  await ui.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('×3,0')).click())
  assert.equal(document.querySelectorAll('input')[1].value,'25,5');assert.ok(document.body.textContent.includes('×3,0'))
 }finally{await ui.close()}
})
test('the monthly summary shows the weighted coefficient and how many sales it covers, and products show theirs',async()=>{
 const data={totals:[{currency:'EUR',quantity:3,net_revenue:90,missing_revenue:0,purchase_cost:40,cost_count:2,estimated_margin:30,estimated_count:3,confirmed_margin:null,confirmed_count:0,coef_revenue:70,coef_cost:40,coef_count:2}],
  rows:[],count:0,page:0,page_size:50,leaders:[{sku:'SKU-A',currency:'EUR',title:'Body',quantity:2,verified_count:1,confirmed_margin:12,coef_revenue:50,coef_cost:20,coef_count:2}]}
 const ui=await render('../src/components/SalesFinance.jsx',{request:async()=>structuredClone(data)})
 try{
  const text=document.body.textContent
  assert.ok(text.includes('Coefficient moyen'));assert.ok(text.includes('×1,8'),'70 ÷ 40');assert.ok(text.includes('sur 2 vente(s) au prix payé connu'))
  assert.ok(text.includes('×2,5'),'product coefficient 50 ÷ 20')
 }finally{await ui.close()}
})
test('a sale card shows ×N next to the paid price, and nothing next to an indicative catalog price',async()=>{
 const line=(patch={})=>({id:'o:1',stage:'ordered',source:{title:'Body noir',selling_price:'20',sku:'SKU-A'},order:{status:'payment_received',currency:'EUR',account_login:'compte-test',order_date:'2026-11-01T10:00:00Z'},actual_cost:8,supplier_size:'M',...patch})
 const props={catalog:[{sku:'SKU-A',price:5,currency:'EUR'}],busy:false,selecting:false,selected:false,onSelect(){},onDetails(){},onLabel(){},onAction(){}}
 let ui=await render('../src/components/SaleCard.jsx',{...props,line:line()})
 try{const variant=document.querySelector('.sale-variant').textContent;assert.ok(variant.includes('Payé : 8,00'));assert.ok(variant.includes('×2,5'))}finally{await ui.close()}
 ui=await render('../src/components/SaleCard.jsx',{...props,line:line({actual_cost:null})})
 try{const variant=document.querySelector('.sale-variant').textContent;assert.ok(variant.includes('Prix Shein indicatif'));assert.equal(/×\d/.test(variant),false,'no coefficient from the catalog price');assert.equal(variant.includes('Payé :'),false)}finally{await ui.close()}
})
test('a zero coefficient in the product ranking is formatted, not a bare React zero',async()=>{
 const ui=await render('../src/components/SalesFinance.jsx',{request:async()=>({totals:[],rows:[],count:0,page:0,page_size:50,leaders:[{sku:'ZERO',currency:'EUR',title:'Remboursé',quantity:1,verified_count:0,coef_revenue:0,coef_cost:10,coef_count:1}]})})
 try{assert.ok(document.body.textContent.includes('×0,0'))}finally{await ui.close()}
})
test('the calculator explains invalid fees instead of showing a false margin',async()=>{
 const ui=await render('../src/components/CoefficientSimulator.jsx',{})
 try {
  const [cost,price,fees]=[...document.querySelectorAll('input')]
  await ui.act(async()=>{ui.props(cost).onChange({target:{value:'10'}});ui.props(price).onChange({target:{value:'20'}});ui.props(fees).onChange({target:{value:'abc'}})})
  assert.ok(document.body.textContent.includes('Vérifie les frais'))
  assert.equal(document.body.textContent.includes('Marge par article'),false)
 }finally{await ui.close()}
})
