import DropTrackerTab from './components/DropTrackerTab'
import { validateTracker } from '../server/drop-tracker'
import React from 'react'
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
createRoot(document.getElementById('root')).render(<div className="min-h-screen bg-gray-50"><div className="bg-amber-100 text-amber-900 px-4 py-2 text-sm font-medium">DÉMO · Données fictives · Aucun achat ni aucune modification de tes comptes · Réinitialisée à chaque rechargement</div>{location.hash === '#suivi' ? <DropTrackerTab request={trackerRequest}/> : <SalesTab isAdmin request={request}/>}</div>)
