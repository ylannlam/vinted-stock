import VintedAccountsTab from './components/VintedAccountsTab'
import CategoryTabs from './components/CategoryTabs'
import { TAB_SALES, TAB_BUDGET, TAB_COMPTES_VINTED } from './constants'
import BudgetTab from './components/BudgetTab'
import { validateTracker } from '../server/drop-tracker'
import React, {useState} from 'react'
import { createRoot } from 'react-dom/client'
import SalesTab from './components/SalesTab'
import { validateEdit } from '../server/dotb'
import { nextStage, blocked, supplierOf, skuOf } from './lib/fulfillment'
import './index.css'
const catalog = []
const lines = ['to_order','ordered','in_transit','received','prepared','shipped'].map((stage,i)=>({
  id:`demo-${i}`,updated_at:new Date().toISOString(),stage,
  source:{title:['Blouse fleurie','Robe côtelée','Chemisier satiné','Gilet court','Jupe plissée','Top manches longues'][i],sku:`DEMO-${100+i}-M`,selling_price:'24.90',supplier_link:'https://fr.shein.com/'},
  supplier_order_ref:i?'DEMO-COMMANDE-01':null,
  order:{id:`vente-${i}`,account_login:`Compte démo ${i%2+1}`,currency:'EUR',status:'label_sent',deadline:new Date(Date.now()+(i+1)*86400000).toISOString()},
}))
async function request(method='GET',body) {
  if(method==='GET')return {lines:structuredClone(lines),catalog:structuredClone(catalog),count:lines.length,connected:true}
  if(method==='POST')return {processed:lines.length,has_more:false}
  const line=lines.find(l=>l.id===body.id)
  if(body.action==='edit') {
    const {edit,product}=validateEdit(body);Object.assign(line,edit)
    if(product){const old=catalog.find(p=>p.sku===product.sku);if(old)Object.assign(old,product);else catalog.push(product)}
  } else {
    if(blocked(line)||nextStage(line)!==body.stage)throw Error('Étape indisponible.')
    if(body.stage==='ordered'&&(!skuOf(line)||!supplierOf(line,catalog)||!line.supplier_order_ref))throw Error('Renseignez la référence de commande Shein avant de continuer.')
    line.stage=body.stage
  }
  line.updated_at=new Date().toISOString();return {saved:true}
}
let tracker = {revision:0,payload:{accounts:[{id:'demo1',pseudo:'Compte démo',email:'demo@example.com',phone:'',browser:'Chrome',createdAt:Date.now(),stage:'post1',nextAt:Date.now()+86400000,notes:''}],expenses:[{id:'expense1',date:'2026-10-30',type:'out',cat:'Emballage',label:'Exemple',amount:12}],settings:{budget:100}}}
async function trackerRequest(url, options) {
  if(options?.method==='PUT') {
    const body=JSON.parse(options.body)
    if(body.revision!==tracker.revision) throw Error('Version périmée')
    tracker={payload:validateTracker(body.payload),revision:tracker.revision+1}
  }
  return {ok:true,json:async()=>structuredClone(tracker)}
}
const demoAccounts = [
  {id:'account1',pseudo:'Compte démo',email:'demo@example.com',telephone:'',browser:'Chrome',statut:'en_preparation',creation_stage:'post1',creation_next_at:new Date(Date.now()+86400000).toISOString(),created_at:new Date().toISOString(),proxy_id:null,is_ready:false},
  {id:'account2',pseudo:'Compte prêt',email:'',statut:'actif',creation_stage:'ready',is_ready:true,proxy_id:null,created_at:new Date().toISOString()},
]
const demoClient={from(table){
  let patch=null;const filters=[];
  const result=()=>{const list=(table==='vinted_accounts'?demoAccounts:[]).filter(a=>filters.every(([k,v])=>a[k]===v));if(patch)list.forEach(a=>Object.assign(a,patch));return {data:structuredClone(list),error:null}}
  const q={select(){return q},order(){return q},eq(k,v){filters.push([k,v]);return q},update(p){patch=p;return q},then(resolve){return Promise.resolve(result()).then(resolve)},async maybeSingle(){const r=result();return {data:r.data[0]||null,error:null}}};return q
}}
function PreviewApp(){
 const [tab,setTab]=useState(location.hash==='#suivi'?TAB_BUDGET:location.hash==='#comptes'?TAB_COMPTES_VINTED:TAB_SALES)
 return <div className="min-h-screen bg-gray-50"><div className="bg-amber-100 text-amber-900 px-4 py-2 text-sm font-medium">DÉMO · Données fictives · Réinitialisée à chaque rechargement</div><header className="bg-white px-4 py-3 font-bold text-teal-700">Stock Vinted</header><CategoryTabs active={tab} onChange={setTab} items={[]} commandes={[]} userRole="admin"/>{tab===TAB_BUDGET?<BudgetTab request={trackerRequest}/>:tab===TAB_COMPTES_VINTED?<VintedAccountsTab client={demoClient}/>:<SalesTab isAdmin request={request}/>}</div>
}
createRoot(document.getElementById('root')).render(<PreviewApp/>)
