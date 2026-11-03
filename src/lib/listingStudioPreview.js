import {previewSelection} from './publicationPreview'
import {emptyListing} from './listingStudio'
import {previewPhotos} from './previewPhotos'
const account='33333333-3333-4333-8333-333333333333'
const metadata={ai_ready:true,selection_configured:true,selected_profiles:[],accounts:[{id:account,login:'Compte démo · Camille',profile_id:'demo-0',profile_number:'01',country:'FR',connected:true},{id:'44444444-4444-4444-8444-444444444444',login:'Compte démo · Léa',profile_id:'demo-1',profile_number:'02',country:'FR',connected:false}],catalogs:[{id:1,title:'Femmes'},{id:2,parent_id:1,title:'Vêtements'},{id:10,parent_id:2,title:'Robes'},{id:11,parent_id:2,title:'Bodies'}],colors:[{id:1,title:'Noir'},{id:2,title:'Beige'}]}
const options={catalog:{id:11},conditions:[{id:1,title:'Neuf avec étiquette'},{id:2,title:'Très bon état'},{id:3,title:'Bon état'}],package_sizes:[{id:1,title:'Petit'},{id:2,title:'Moyen'}],size_groups:[{id:1,title:'Tailles',sizes:[{id:3,title:'S / 36'},{id:4,title:'M / 38'}]}],attributes:[]}
const base={id:'22222222-2222-4222-8222-222222222222',state:'draft',version:1,fields:{...emptyListing(),account_id:account,sku:'DEMO-BODY-001',size_text:'M',price:'19.90'},photos:[{path:'demo/front.webp',url:previewPhotos[0][0],type:'image/webp',size:100}],uploaded:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
const rows=[structuredClone(base)],images=new Map()
export async function listingStudioPreview(method='GET',body,query=''){
 const q=new URLSearchParams(query),action=q.get('action')||body?.action||'list'
 if(action==='metadata')return {...structuredClone(metadata),selected_profiles:previewSelection.profiles,accounts:metadata.accounts.filter(a=>previewSelection.profiles.some(p=>p.id===a.profile_id))}
 if(action==='options')return {...structuredClone(options),catalog:{id:Number(q.get('catalog_id'))}}
 if(action==='brands')return {data:[{id:99,title:'Shein'}]}
 if(action==='list')return {drafts:structuredClone(rows),count:rows.length}
 if(action==='create'){const row={...structuredClone(base),id:body.id,fields:{...emptyListing(),account_id:body.account_id||''},photos:[]};rows.unshift(row);return {draft:structuredClone(row)}}
 const row=rows.find(r=>r.id===(body?.id||q.get('id')));if(!row)throw Error('Brouillon introuvable.')
 if(action==='save'){row.fields=structuredClone(body.fields);row.photos=body.photos.map(p=>({...p,type:'image/webp',size:100,url:images.get(p.path)||row.photos.find(old=>old.path===p.path)?.url}));row.version++}
 if(action==='generate'){row.fields={...row.fields,title:'Body noir à manches longues',description:`Body noir uni à manches longues et encolure ronde.\nCoupe près du corps. Taille ${row.fields.size_text}.`,catalog_id:11,color_ids:[1]};row.ai_updated_at=new Date().toISOString();row.version++}
 if(action==='publish'){row.state='preparing';row.message='Préparation de l’envoi (simulation)…';row.version++}
 if(action==='step'){row.uploaded++;row.dotb_item_id='demo';if(row.uploaded>=row.photos.length){row.state='scheduled';row.message='Annonce transmise (simulation).'}row.version++}
 if(action==='refresh'&&row.state==='scheduled'){row.state='published';row.message='Publication confirmée (simulation uniquement).';row.published_at=new Date().toISOString();row.version++}
 row.updated_at=new Date().toISOString();return {draft:structuredClone(row)}
}
export async function listingStudioPreviewUpload(file){const path=`demo/${crypto.randomUUID()}`;images.set(path,URL.createObjectURL(file));return {path}}
