import VintedAccountsTab from './components/VintedAccountsTab'
import CategoryTabs from './components/CategoryTabs'
import { TAB_SALES, TAB_BUDGET, TAB_COMPTES_VINTED, TAB_CATALOG, TAB_RESOURCES } from './constants'
import ResourcesTab from './components/ResourcesTab'
import {resourcesPreview,resourcesPreviewUpload} from './lib/resourcesPreview'
import CatalogueTab from './components/CatalogueTab'
import { catalogPreview, collectorPreview, collectorBridgePreview } from './lib/catalogPreview'
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
  if(method==='GET')return {lines:structuredClone(lines).map(l=>({...l,tracking_status:'included'})),catalog:structuredClone(catalog),count:lines.length,connected:true,tracking:{starts_at:'2026-10-29T23:00:00Z',time_zone:'Europe/Paris'}}
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
  {id:'legacy',pseudo:'Compte sans suivi',creation_stage:null,statut:'actif',is_ready:false,is_shadowbanned:false},
  {id:'account1',pseudo:'Compte démo',email:'demo@example.com',telephone:'',browser:'Chrome · téléphone',statut:'en_preparation',creation_stage:'post1',creation_next_at:new Date(Date.now()+7200000).toISOString(),created_at:new Date().toISOString(),is_ready:false},
  {id:'account2',pseudo:'Compte prêt',email:'',statut:'actif',creation_stage:'ready',is_ready:true,proxy_id:null,created_at:new Date().toISOString()},
  {id:'account3',pseudo:'Atelier démo',email:'atelier@example.com',browser:'Safari · téléphone',statut:'en_preparation',creation_stage:'post2',creation_next_at:new Date(Date.now()-3600000).toISOString()},
  {id:'account4',pseudo:'Vestiaire démo',email:'vestiaire@example.com',browser:'Firefox · téléphone',statut:'en_preparation',creation_stage:'wait',creation_next_at:new Date(Date.now()-3600000*2).toISOString()},
  {id:'shadow1',pseudo:'Ancien compte',email:'archive@example.com',is_shadowbanned:true,creation_stage:'ready'},
  {id:'account5',pseudo:'Compte suspendu',email:'suspendu@example.com',statut:'suspendu',creation_stage:'ready',is_ready:true},
]
const demoClient={from(table){
  let patch=null,insert=null,remove=false;const filters=[];
  const result=()=>{const source=table==='vinted_accounts'?demoAccounts:[];if(insert){const row={id:crypto.randomUUID(),created_at:new Date().toISOString(),...insert};source.push(row);return {data:[structuredClone(row)],error:null}}const list=source.filter(a=>filters.every(fn=>fn(a)));if(patch)list.forEach(a=>Object.assign(a,patch));if(remove)list.forEach(a=>source.splice(source.indexOf(a),1));return {data:structuredClone(list),error:null}}
  const q={select(){return q},order(){return q},eq(k,v){filters.push(a=>(k==='is_shadowbanned'?!!a[k]:a[k])===v);return q},is(k,v){filters.push(a=>a[k]===v);return q},in(k,values){filters.push(a=>values.includes(a[k]));return q},update(p){patch=p;return q},insert(p){insert=p;return q},delete(){remove=true;return q},then(resolve){return Promise.resolve(result()).then(resolve)},async maybeSingle(){const r=result();return {data:r.data[0]||null,error:null}},single(){return q.maybeSingle()}};return q
}}
function PreviewApp(){
 const [tab,setTab]=useState(location.hash==='#ressources'?TAB_RESOURCES:location.hash==='#catalogue'?TAB_CATALOG:location.hash==='#suivi'?TAB_BUDGET:location.hash==='#comptes'?TAB_COMPTES_VINTED:TAB_SALES)
 return <div className="min-h-screen bg-gray-50"><div className="bg-amber-100 text-amber-900 px-4 py-2 text-sm font-medium">DÉMO · Données fictives · Réinitialisée à chaque rechargement</div><header className="bg-white px-4 py-3 font-bold text-teal-700">Stock Vinted</header><CategoryTabs active={tab} onChange={setTab} items={[]} commandes={[]} userRole="admin"/>{tab===TAB_RESOURCES?<ResourcesTab request={resourcesPreview} upload={resourcesPreviewUpload}/>:tab===TAB_CATALOG?<CatalogueTab isAdmin request={catalogPreview} collectorRequest={collectorPreview} collectorBridge={collectorBridgePreview}/>:tab===TAB_BUDGET?<BudgetTab request={trackerRequest}/>:tab===TAB_COMPTES_VINTED?<VintedAccountsTab client={demoClient}/>:<SalesTab isAdmin request={request}/>}</div>
}
createRoot(document.getElementById('root')).render(<PreviewApp/>)
