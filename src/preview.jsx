import ListingStudio from './components/ListingStudio'
import {accountHealthPreview,accountHealthAdsPreview} from './lib/accountHealthPreview'
import {listingStudioPreview,listingStudioPreviewUpload} from './lib/listingStudioPreview'
import {publicationPreview} from './lib/publicationPreview'
import PublicationRunnerBadge from './components/PublicationRunnerBadge'
import AccountAlertBanner from './components/AccountAlertBanner'
import {dailyCartDemo,dailyCartPreview} from './lib/dailyCartPreview'
import AdsPowerTab from './components/AdsPowerTab'
import {adsPowerPreview} from './lib/adspowerPreview'
import {factoryPreviewStore} from './lib/adspowerFactoryPreview'
import Header from './components/Header'
import {newestSalesFirst} from './lib/salesOrder'
import {sheinOrdersPreview} from './lib/sheinOrdersPreview'
import {previewPhotos} from './lib/previewPhotos'
import HomeTab from './components/HomeTab'
import HistoryTab from './components/HistoryTab'
import PhotoPreparation from './components/PhotoPreparation'
import {workspacePreview} from './lib/workspacePreview'
import {TAB_HOME,TAB_HISTORY,TAB_PUBLICATION} from './constants'
import PublicationTab from './components/PublicationTab'
import {plannerPreview} from './lib/plannerPreview'
import VintedAccountsTab from './components/VintedAccountsTab'
import CategoryTabs from './components/CategoryTabs'
import { TAB_ADSPOWER, TAB_LISTINGS, TAB_SALES, TAB_BUDGET, TAB_COMPTES_VINTED, TAB_CATALOG, TAB_RESOURCES } from './constants'
import ResourcesTab from './components/ResourcesTab'
import {resourcesPreview,resourcesPreviewUpload} from './lib/resourcesPreview'
import {creativeAccountsPreview} from './lib/creativeAccountsPreview'
import CatalogueTab from './components/CatalogueTab'
import { catalogPreview, collectorPreview, collectorBridgePreview } from './lib/catalogPreview'
import BudgetTab from './components/BudgetTab'
import { validateTracker } from '../server/drop-tracker'
import React, {useState,useEffect} from 'react'
import { createRoot } from 'react-dom/client'
import SalesTab from './components/SalesTab'
import { validateEdit, validateSaleSku } from '../server/dotb'
import {saleVariant} from '../server/workspace'
import {shipmentInput} from './lib/shipments'
import {accountGroup} from './lib/accountOverview'
import { nextStage, blocked, supplierOf, skuOf } from './lib/fulfillment'
import './index.css'
import './workspace.css'
const catalog = [{sku:'DEMO-100-M',photo_url:previewPhotos[0][1],supplier_url:'https://fr.shein.com/Demo-p-123456.html',price:12.50,currency:'EUR',color:'Beige',sizes:[{size:'M',availability:'available'},{size:'L',availability:'unavailable'}],retrieval_status:'failed',retrieval_message:'Connexion interrompue. Le dernier relevé reste conservé.',observed_at:new Date().toISOString()},
  {sku:'DEMO-101-M',photo_url:previewPhotos[1][1],retrieval_status:'queued'}]
const lines = ['to_order','ordered','in_transit','received','prepared','shipped'].map((stage,i)=>({
  id:`demo-${i}`,updated_at:new Date().toISOString(),stage,
  sale_date:new Date(Date.now()-i*3*3600000).toISOString(),
  listing_photo_url:i<3?previewPhotos[i%3][0]:null,
  source:{title:['Body à manches longues','Robe à épaules dénudées','Combinaison côtelée','Body noir','Robe de soirée','Combinaison noire'][i],thumbnail_url:previewPhotos[i%3][0],sku:i===0||i===2?null:`DEMO-${100+i}-M`,selling_price:'24.90',supplier_link:'https://fr.shein.com/'},
  supplier_size:i%2?'S':'M',supplier_size_manual:false,
  supplier_order_ref:i?'DEMO-COMMANDE-01':null,
  order:{id:`vente-${i}`,account_login:`Compte démo ${i%2+1}`,currency:'EUR',status:'label_sent',deadline:new Date(Date.now()+(i+1)*86400000).toISOString()},
}))
// Démo réception : le même article vendu deux fois et un lot de deux articles.
for(const [n,sku,size,order,days,title] of [[6,'DEMO-101-M','S','vente-6',2,'Robe à épaules dénudées'],[7,'DEMO-104-M','M','vente-lot',4,'Body noir'],[8,'DEMO-105-M','S','vente-lot',4,'Robe de soirée']])lines.push({id:`demo-${n}`,updated_at:new Date().toISOString(),stage:'in_transit',sale_date:new Date(Date.now()-n*3600000).toISOString(),listing_photo_url:previewPhotos[n%3][0],
  source:{title,thumbnail_url:previewPhotos[n%3][0],sku,selling_price:'29.90',supplier_link:'https://fr.shein.com/'},supplier_size:size,supplier_size_manual:false,supplier_order_ref:'DEMO-COMMANDE-02',
  order:{id:order,account_login:`Compte démo ${n%2+1}`,currency:'EUR',status:'label_sent',deadline:new Date(Date.now()+days*86400000).toISOString()}})
const parcels=[]
// Suivi Shein de démonstration : un colis en livraison aujourd'hui, un autre en route.
const demoEvents=(steps)=>steps.map(([h,place,text])=>({at:new Date(Date.now()-h*3600000).toISOString(),place,text}))
const demoParcels=[
 {tracking_number:'GFFRDEMO000001',carrier:'GOFO',status_text:'En cours de livraison',delivered:false,eta:'06-12 nov.',track_url:'https://www.gofo.com/fr/tracking-results/?id=GFFRDEMO000001',order_ref:'GDEMO000001',
  steps:[["En transit vers l'aéroport",true],['Transféré au transporteur',true],['En attente de livraison',true],['Prêt pour le ramassage',false],['Livré',false]].map(([name,done])=>({name,done})),
  events:demoEvents([[1.5,'','Cher client, votre commande va être livrée. Gardez votre téléphone allumé.'],[8,'Istres','Le chauffeur est sorti pour la livraison'],[27,'Marseille',"Arrivé à l'installation de destination régionale GOFO"],[30,'Marseille','Arrivé au centre de tri'],[44,'Paris','Le colis a quitté le centre de tri']])},
 {tracking_number:'GFFRDEMO000002',carrier:'GOFO',status_text:'Transféré au transporteur',delivered:false,eta:'10-16 nov.',track_url:'https://www.gofo.com/fr/tracking-results/?id=GFFRDEMO000002',order_ref:'GDEMO000002',
  steps:[["En transit vers l'aéroport",true],['Transféré au transporteur',true],['En attente de livraison',false],['Prêt pour le ramassage',false],['Livré',false]].map(([name,done])=>({name,done})),
  events:demoEvents([[5,'Paris','Arrivé au centre de tri'],[20,'','Votre colis a été déchargé et sera chargé pour le transport sous peu.']])},
]
const parcelOfLine={'demo-1':demoParcels[1],'demo-2':demoParcels[0]}
const summaryOf=p=>({tracking_number:p.tracking_number,carrier:p.carrier,status_text:p.status_text,delivered:p.delivered,eta:p.eta,track_url:p.track_url,order_ref:p.order_ref,steps_done:p.steps.filter(s=>s.done).length,steps_total:p.steps.length,last_event:p.events[0]})
if(new URLSearchParams(location.hash.split('?')[1]||'').get('view')==='cart'){
  const demo=dailyCartDemo();lines.push(...demo.lines);catalog.push(...demo.catalog)
}
async function previewWorkspace(view='overview',query={},body){
 if(view!=='actions')return workspacePreview(view,query,body)
 let rows=lines.filter(l=>l.stage!=='shipped').map(l=>({...l,title:l.source.title,account_login:l.order.account_login,deadline_at:l.order.deadline,sku:skuOf(l),action:({ordered:'receive',in_transit:'receive',received:'prepare',prepared:'ship'})[l.stage]||(!skuOf(l)?'missing_sku':'purchase')}))
 const counts={all:rows.length};for(const l of rows)counts[l.action]=(counts[l.action]||0)+1
 if(query.category&&query.category!=='all')rows=rows.filter(l=>l.action===query.category)
 return {rows:structuredClone(rows),count:rows.length,page:0,page_size:20,counts}
}
async function request(method='GET',body,query='') {
  if(body?.action==='refresh_photos')return {updated:false}
  if(body?.action==='shein_review')return sheinOrdersPreview(lines,body)
  if(body?.action==='receive'){const l=lines.find(x=>x.id===body.id);l.stage='received';l.location=body.location||null;l.updated_at=new Date().toISOString();return {received:true}}
  if(body?.action==='pack'){for(const l of lines.filter(x=>x.order.id===body.order_id)){l.stage='prepared';l.location=null}return {packed:true,dotb_packed:false}}
  if(method==='POST'&&body?.action==='shipping_label')return (await import('./lib/shippingLabelPreview')).shippingLabelPreview()
  if(method==='GET'){
    const q=new URLSearchParams(query.replace(/^\?/,''));let filtered=structuredClone(lines).sort(newestSalesFirst)
    if(q.get('view')==='daily_cart')return dailyCartPreview(lines,catalog,q.get('day'),q.get('include_earlier')==='true')
    if(q.get('view')==='shein_orders')return sheinOrdersPreview(lines)
    if(q.get('view')==='reception')return {lines:structuredClone(lines.map(l=>({...l,effective_stage:l.stage,order_id:l.order.id,resolved_sku:skuOf(l),account_login:l.order.account_login,deadline_at:l.order.deadline,sale_date:l.order.order_date||l.updated_at}))),catalog:structuredClone(catalog.map(c=>({sku:c.sku,photo_url:c.photo_url})))}
    if(q.get('view')==='parcels')return {parcels:demoParcels.map((p,i)=>({...p,last_event_at:p.events[0].at,order_date:'2026-11-0'+(i+1),items:[{id:'it'+i,sku:'DEMO-10'+(i+1)+'-M',title:lines[2-i].source.title,size:i?'S':'M',color:'Noir',photo:lines[2-i].source.thumbnail_url,quantity:1,status:'shipped',sales:[{id:lines[2-i].id,account:lines[2-i].order.account_login,title:lines[2-i].source.title,stage:lines[2-i].stage}]}]})),since:'2026-09-07'}
    const shipRows=parcels.filter(p=>p.line_ids.length).map(p=>({...p,lines:p.line_ids.map(id=>{const l=lines.find(x=>x.id===id);return {id,title:l.source.title,account:l.order.account_login,size:l.supplier_size,updated_at:l.updated_at}})}))
    if(q.get('view')==='shipments')return {shipments:structuredClone(shipRows),count:shipRows.length,page:0,shein_orders:sheinOrdersPreview(lines).orders}
    if(q.get('view')==='detail'){const line=filtered.find(l=>l.id===q.get('id'));if(!line)throw Error('Vente introuvable');return {line:{...line,shipments:structuredClone(shipRows.filter(p=>p.line_ids.includes(line.id)))},catalog:structuredClone(catalog)}}
    if(q.get('account'))filtered=filtered.filter(l=>l.order.account_login===q.get('account'))
    if(q.get('search'))filtered=filtered.filter(l=>`${l.source.title} ${l.source.sku||''} ${l.supplier_order_ref||''}`.toLowerCase().includes(q.get('search').toLowerCase()))
    if(q.get('urgent')==='true')filtered=filtered.filter(l=>l.stage!=='shipped'&&Date.parse(l.order.deadline)<Date.now()+48*3600000)
    const counts={all:filtered.length,missing_sku:filtered.filter(l=>!skuOf(l)).length,review:0};for(const l of filtered)counts[l.stage]=(counts[l.stage]||0)+1
    if(q.get('stage')&&q.get('stage')!=='all')filtered=filtered.filter(l=>q.get('stage')==='missing_sku'?!skuOf(l):l.stage===q.get('stage'))
    filtered=filtered.map(l=>parcelOfLine[l.id]?{...l,parcel:summaryOf(parcelOfLine[l.id])}:l)
    return {lines:filtered,catalog:structuredClone(catalog),count:filtered.length,counts,accounts:[...new Set(lines.map(l=>l.order.account_login))],connected:true,automation:{configured:true,enabled:true,last_received_at:new Date().toISOString()},tracking:{starts_at:'2026-10-30T23:00:00Z',time_zone:'Europe/Paris'}}
  }
  if(method==='POST'&&body.action==='shipment_refresh'){const p=parcels.find(p=>p.id===body.id);p.checked_at=new Date().toISOString();p.refresh_after=new Date(Date.now()+900000).toISOString();p.last_error='GOFO ne fournit pas encore de suivi pour ce numéro. Dernier relevé conservé.';return {refreshed:true}}
  if(body.action==='shipment'){const fields=shipmentInput(body);let p=parcels.find(p=>p.id===body.id||p.tracking_number===fields.tracking_number&&p.carrier===fields.carrier);if(!p){p={...fields,id:crypto.randomUUID(),line_ids:[],status:'pending',events:[],created_at:new Date().toISOString()};parcels.push(p)}else if(body.id)Object.assign(p,fields);for(const l of body.lines||[])if(!p.line_ids.includes(l.id))p.line_ids.push(l.id);p.updated_at=new Date().toISOString();return {id:p.id,saved:true}}
  if(body.action==='shipment_unlink'){const p=parcels.find(p=>p.id===body.id);p.line_ids=p.line_ids.filter(id=>id!==body.line);return {saved:true}}
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
    if(body.updated_at!==line.updated_at)throw Error('Cette vente a changé. Recharge la vente.');const {edit,product}=validateEdit(body),variant=saleVariant(body);Object.assign(line,edit,{supplier_size:variant.size,supplier_color:variant.color},{fees_amount:body.fees_amount,refund_amount:body.refund_amount,finance_confirmed:body.finance_confirmed})
    if(product){const old=catalog.find(p=>p.sku===product.sku);if(old)Object.assign(old,product);else catalog.push(product)}
  } else {
    if(blocked(line)||nextStage(line)!==body.stage)throw Error('Étape indisponible.')
    if(body.stage==='ordered'&&(!skuOf(line)||!supplierOf(line,catalog)||!line.supplier_order_ref))throw Error('Renseignez la référence de commande Shein avant de continuer.')
    line.stage=body.stage
  }
  line.updated_at=new Date().toISOString();return {saved:true}
}
let tracker = {revision:0,automatic_income:[{id:'vinted-demo-0',line_id:'demo-0',source:'vinted',date:new Date().toISOString().slice(0,10),type:'in',cat:'Ventes Vinted',label:'Vente de démonstration',amount:35},{id:'vinted-demo-1',line_id:'demo-1',source:'vinted',date:'2026-10-31',type:'in',cat:'Ventes Vinted',label:'Vente du mois précédent',amount:30}],automatic_expenses:[{id:'shein-GDEMO000001',order_ref:'GDEMO000001',source:'shein',date:new Date().toISOString().slice(0,10),type:'out',cat:'Stock Shein',label:'Commande Shein GDEMO000001',amount:41.09}],payload:{accounts:[{id:'demo1',pseudo:'Compte démo',email:'demo@example.com',phone:'',browser:'Chrome',createdAt:Date.now(),stage:'post1',nextAt:Date.now()+86400000,notes:''}],expenses:[{id:'expense1',date:'2026-10-30',type:'out',cat:'Emballage',label:'Exemple',amount:12}],settings:{budget:100}}}
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
  {id:'account5',blocked_at:new Date().toISOString(),pseudo:'Compte suspendu',email:'suspendu@example.com',statut:'suspendu',creation_stage:'ready',is_ready:true},
]
const demoClient={from(table){
  let patch=null,insert=null,remove=false;const filters=[];
  const result=()=>{const source=table==='vinted_accounts'?demoAccounts:[];if(insert){const row={id:crypto.randomUUID(),created_at:new Date().toISOString(),...insert};source.push(row);return {data:[structuredClone(row)],error:null}}const list=source.filter(a=>filters.every(fn=>fn(a)));if(patch)list.forEach(a=>{const before=accountGroup(a);Object.assign(a,patch);const after=accountGroup(a);if(before!==after){a.blocked_at=after==='blocked'?new Date().toISOString():null;a.ready_at=after==='ready'?new Date().toISOString():null;a.password_changed_at=null}});if(remove)list.forEach(a=>source.splice(source.indexOf(a),1));return {data:structuredClone(list),error:null}}
  const q={select(){return q},order(){return q},eq(k,v){filters.push(a=>(k==='is_shadowbanned'?!!a[k]:a[k])===v);return q},is(k,v){filters.push(a=>(a[k]??null)===v);return q},range(a,b){const r=result();return Promise.resolve({...r,data:r.data.slice(a,b+1)})},in(k,values){filters.push(a=>values.includes(a[k]));return q},update(p){patch=p;return q},insert(p){insert=p;return q},delete(){remove=true;return q},then(resolve){return Promise.resolve(result()).then(resolve)},async maybeSingle(){const r=result();return {data:r.data[0]||null,error:null}},single(){return q.maybeSingle()}};return q
}}
const atelierListingPreview=(method,body,query='')=>/action=ai_usage/.test(query)||body?.action==='ai_price'?plannerPreview(method,body,query):listingStudioPreview(method,body,query)
function PreviewApp(){
 const [photo,setPhoto]=useState(null),[filters,setFilters]=useState(()=>Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]||'')));const navigate=(id,opts={})=>{setFilters(opts);setTab(id)}
 const [tab,setTab]=useState(location.hash==='#publication'?TAB_PUBLICATION:location.hash==='#adspower'?TAB_ADSPOWER:location.hash.split('?')[0]==='#annonces'?TAB_LISTINGS:location.hash==='#accueil'?TAB_HOME:['#ressources','#atelier'].includes(location.hash.split('?')[0])?TAB_RESOURCES:location.hash==='#catalogue'?TAB_CATALOG:['#suivi','#budget'].includes(location.hash)?TAB_BUDGET:location.hash==='#comptes'?TAB_COMPTES_VINTED:TAB_SALES)
 useEffect(()=>{const go=()=>{if(location.hash.startsWith('#ventes'))navigate(TAB_SALES,Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]||'')))};window.addEventListener('hashchange',go);return()=>window.removeEventListener('hashchange',go)},[])
 return <div className="min-h-screen workspace-shell"><div className="preview-notice">DÉMO · Données fictives · Réinitialisée à chaque rechargement</div><Header profile={{pseudo:'Mon atelier',role:'admin'}}/><CategoryTabs active={tab} onChange={navigate} items={[]} commandes={[]} userRole="admin"/><AccountAlertBanner request={accountHealthPreview} onOpen={()=>navigate(TAB_ADSPOWER)}/>{tab!==TAB_PUBLICATION&&<PublicationRunnerBadge onOpen={()=>navigate(TAB_PUBLICATION)}/>}{tab===TAB_PUBLICATION?<PublicationTab request={plannerPreview} step={300} onOpenListings={()=>navigate(TAB_LISTINGS)}/>:tab===TAB_ADSPOWER?<AdsPowerTab watchRequest={async(method,body)=>body?.action==='download'?{filename:'stock-vinted-veille.zip',zip_base64:''}:{keys:[{id:'k1',created_at:new Date(Date.now()-86400000).toISOString(),last_seen_at:new Date(Date.now()-600000).toISOString(),last_login:'lea.vintage'}]}} healthRequest={accountHealthAdsPreview} request={adsPowerPreview} factoryStore={factoryPreviewStore} publications={publicationPreview} onCreateListing={p=>navigate(TAB_LISTINGS,{profile:p.id})}/>:tab===TAB_HOME?<HomeTab isAdmin request={previewWorkspace} onNavigate={navigate}/>:tab===TAB_HISTORY?<HistoryTab isAdmin request={workspacePreview}/>:tab===TAB_LISTINGS?<main className="workspace-page max-w-screen-2xl mx-auto p-4 sm:p-6 text-slate-800"><ListingStudio key={JSON.stringify(filters)} request={listingStudioPreview} upload={listingStudioPreviewUpload} initialProfile={filters.profile} onAccounts={()=>navigate(TAB_ADSPOWER)} onStyles={()=>navigate(TAB_RESOURCES,{section:'accounts'})}/></main>:tab===TAB_RESOURCES?<ResourcesTab request={resourcesPreview} upload={resourcesPreviewUpload} accountsRequest={creativeAccountsPreview} listingRequest={atelierListingPreview} listingUpload={listingStudioPreviewUpload} key={JSON.stringify(filters)} initialSection={filters.section} initialProfile={filters.profile} onAccounts={()=>navigate(TAB_ADSPOWER)}/>:tab===TAB_CATALOG?<CatalogueTab isAdmin request={catalogPreview} collectorRequest={collectorPreview} collectorBridge={collectorBridgePreview}/>:tab===TAB_BUDGET?<BudgetTab request={trackerRequest} financeRequest={workspacePreview} onOpenSale={row=>navigate(TAB_SALES,{line:row.id})}/>:tab===TAB_COMPTES_VINTED?<VintedAccountsTab client={demoClient}/>:<SalesTab key={JSON.stringify(filters)} initialFilters={filters} onPreparePhoto={setPhoto} isAdmin request={request} collectorRequest={collectorPreview} collectorBridge={collectorBridgePreview}/>}{photo&&<PhotoPreparation article={photo} onClose={()=>setPhoto(null)} accountsRequest={creativeAccountsPreview} resourcesRequest={resourcesPreview}/>}</div>
}
createRoot(document.getElementById('root')).render(<PreviewApp/>)
