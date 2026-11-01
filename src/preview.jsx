import HomeTab from './components/HomeTab'
import HistoryTab from './components/HistoryTab'
import PhotoPreparation from './components/PhotoPreparation'
import {workspacePreview} from './lib/workspacePreview'
import {TAB_HOME,TAB_HISTORY} from './constants'
import VintedAccountsTab from './components/VintedAccountsTab'
import CategoryTabs from './components/CategoryTabs'
import { TAB_SALES, TAB_BUDGET, TAB_COMPTES_VINTED, TAB_CATALOG, TAB_RESOURCES } from './constants'
import ResourcesTab from './components/ResourcesTab'
import {resourcesPreview,resourcesPreviewUpload} from './lib/resourcesPreview'
import {creativeAccountsPreview} from './lib/creativeAccountsPreview'
import CatalogueTab from './components/CatalogueTab'
import { catalogPreview, collectorPreview, collectorBridgePreview } from './lib/catalogPreview'
import BudgetTab from './components/BudgetTab'
import { validateTracker } from '../server/drop-tracker'
import React, {useState} from 'react'
import { createRoot } from 'react-dom/client'
import SalesTab from './components/SalesTab'
import { validateEdit, validateSaleSku } from '../server/dotb'
import { nextStage, blocked, supplierOf, skuOf } from './lib/fulfillment'
import './index.css'
const catalog = [{sku:'DEMO-100-M',supplier_url:'https://fr.shein.com/Demo-p-123456.html',price:12.50,currency:'EUR',color:'Beige',observed_at:new Date().toISOString()},
  {sku:'DEMO-101-M',retrieval_status:'queued'}]
const lines = ['to_order','ordered','in_transit','received','prepared','shipped'].map((stage,i)=>({
  id:`demo-${i}`,updated_at:new Date().toISOString(),stage,
  source:{title:['Blouse fleurie','Robe côtelée','Chemisier satiné','Gilet court','Jupe plissée','Top manches longues'][i],sku:i===0||i===2?null:`DEMO-${100+i}-M`,selling_price:'24.90',supplier_link:'https://fr.shein.com/'},
  supplier_order_ref:i?'DEMO-COMMANDE-01':null,
  order:{id:`vente-${i}`,account_login:`Compte démo ${i%2+1}`,currency:'EUR',status:'label_sent',deadline:new Date(Date.now()+(i+1)*86400000).toISOString()},
}))
async function request(method='GET',body,query='') {
  if(method==='GET'){
    const q=new URLSearchParams(query.replace(/^\?/,''));let filtered=structuredClone(lines)
    if(q.get('account'))filtered=filtered.filter(l=>l.order.account_login===q.get('account'))
    if(q.get('search'))filtered=filtered.filter(l=>`${l.source.title} ${l.source.sku||''} ${l.supplier_order_ref||''}`.toLowerCase().includes(q.get('search').toLowerCase()))
    if(q.get('urgent')==='true')filtered=filtered.filter(l=>l.stage!=='shipped'&&Date.parse(l.order.deadline)<Date.now()+48*3600000)
    const counts={all:filtered.length,missing_sku:filtered.filter(l=>!skuOf(l)).length,review:0};for(const l of filtered)counts[l.stage]=(counts[l.stage]||0)+1
    if(q.get('stage')&&q.get('stage')!=='all')filtered=filtered.filter(l=>q.get('stage')==='missing_sku'?!skuOf(l):l.stage===q.get('stage'))
    return {lines:filtered,catalog:structuredClone(catalog),count:filtered.length,counts,accounts:[...new Set(lines.map(l=>l.order.account_login))],connected:true,automation:{configured:true,enabled:true,last_received_at:new Date().toISOString()},tracking:{starts_at:'2026-10-30T23:00:00Z',time_zone:'Europe/Paris'}}
  }
  if(method==='POST')return {processed:lines.length,has_more:false}
  if(body.action==='batch'){
    const chosen=body.lines.map(x=>lines.find(l=>l.id===x.id));if(chosen.some((l,i)=>!l||l.updated_at!==body.lines[i].updated_at))throw Error('Sélection périmée')
    chosen.forEach(l=>{if(body.operation==='order_ref')l.supplier_order_ref=body.value;else l.stage=body.value;l.updated_at=new Date().toISOString()});return {saved:true}
  }
  const line=lines.find(l=>l.id===body.id)
  if(body.action==='sku') {
    if(body.updated_at!==line.updated_at)throw Error('Cet article a changé. Actualisez la liste avant de recommencer.')
    line.sku_override=validateSaleSku(body)
    if(!catalog.some(p=>p.sku===line.sku_override))catalog.push({sku:line.sku_override,retrieval_status:'queued'})
  } else if(body.action==='edit') {
    const {edit,product}=validateEdit(body);Object.assign(line,edit,{fees_amount:body.fees_amount,refund_amount:body.refund_amount,finance_confirmed:body.finance_confirmed})
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
  const q={select(){return q},order(){return q},eq(k,v){filters.push(a=>(k==='is_shadowbanned'?!!a[k]:a[k])===v);return q},is(k,v){filters.push(a=>(a[k]??null)===v);return q},range(a,b){const r=result();return Promise.resolve({...r,data:r.data.slice(a,b+1)})},in(k,values){filters.push(a=>values.includes(a[k]));return q},update(p){patch=p;return q},insert(p){insert=p;return q},delete(){remove=true;return q},then(resolve){return Promise.resolve(result()).then(resolve)},async maybeSingle(){const r=result();return {data:r.data[0]||null,error:null}},single(){return q.maybeSingle()}};return q
}}
function PreviewApp(){
 const [photo,setPhoto]=useState(null),[filters,setFilters]=useState({});const navigate=(id,opts={})=>{setFilters(opts);setTab(id)}
 const [tab,setTab]=useState(location.hash==='#accueil'?TAB_HOME:location.hash==='#ressources'?TAB_RESOURCES:location.hash==='#catalogue'?TAB_CATALOG:location.hash==='#suivi'?TAB_BUDGET:location.hash==='#comptes'?TAB_COMPTES_VINTED:TAB_SALES)
 return <div className="min-h-screen bg-gray-50"><div className="bg-amber-100 text-amber-900 px-4 py-2 text-sm font-medium">DÉMO · Données fictives · Réinitialisée à chaque rechargement</div><header className="bg-white px-4 py-3 font-bold text-teal-700">Stock Vinted</header><CategoryTabs active={tab} onChange={navigate} items={[]} commandes={[]} userRole="admin"/>{tab===TAB_HOME?<HomeTab isAdmin request={workspacePreview} onNavigate={navigate}/>:tab===TAB_HISTORY?<HistoryTab isAdmin request={workspacePreview}/>:tab===TAB_RESOURCES?<ResourcesTab request={resourcesPreview} upload={resourcesPreviewUpload} accountsRequest={creativeAccountsPreview}/>:tab===TAB_CATALOG?<CatalogueTab isAdmin request={catalogPreview} collectorRequest={collectorPreview} collectorBridge={collectorBridgePreview}/>:tab===TAB_BUDGET?<BudgetTab request={trackerRequest} financeRequest={workspacePreview} onOpenSale={row=>navigate(TAB_SALES,{search:row.title})}/>:tab===TAB_COMPTES_VINTED?<VintedAccountsTab client={demoClient}/>:<SalesTab key={JSON.stringify(filters)} initialFilters={filters} onPreparePhoto={setPhoto} isAdmin request={request} collectorRequest={collectorPreview} collectorBridge={collectorBridgePreview}/>}{photo&&<PhotoPreparation article={photo} onClose={()=>setPhoto(null)} accountsRequest={creativeAccountsPreview} resourcesRequest={resourcesPreview}/>}</div>
}
createRoot(document.getElementById('root')).render(<PreviewApp/>)
