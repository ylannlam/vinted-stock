import {previewSelection} from './publicationPreview'
import {emptyListing} from './listingStudio'
import {previewPhotos} from './previewPhotos'
import {DEFAULT_LISTING_SETTINGS,LISTING_AI_MODELS,applyListingPresets,cleanListingSettings,composeListingDescription,effectiveListingSettings} from './listingSettings'
const account='33333333-3333-4333-8333-333333333333'
const metadata={ai_ready:true,ai_models:LISTING_AI_MODELS,dotb_publish_enabled:false,selection_configured:true,selected_profiles:[],accounts:[{id:account,login:'Compte démo · Camille',profile_id:'demo-0',profile_number:'01',country:'FR',connected:true,dotb:false},{id:'44444444-4444-4444-8444-444444444444',login:'Compte démo · Léa',profile_id:'demo-1',profile_number:'02',country:'FR',connected:false,dotb:false}],catalogs:[{id:1,title:'Femmes'},{id:2,parent_id:1,title:'Vêtements'},{id:10,parent_id:2,title:'Robes'},{id:11,parent_id:2,title:'Bodies'}],colors:[{id:1,title:'Noir'},{id:2,title:'Beige'}]}
const options={catalog:{id:11},conditions:[{id:6,title:'Neuf avec étiquette'},{id:2,title:'Très bon état'},{id:3,title:'Bon état'}],package_sizes:[{id:1,title:'Petit'},{id:2,title:'Moyen'}],size_groups:[{id:1,title:'Tailles',sizes:[{id:3,title:'S / 36'},{id:4,title:'M / 38'}]}],attributes:[]}
const now=()=>new Date().toISOString()
const base={id:'22222222-2222-4222-8222-222222222222',state:'draft',version:1,fields:{...emptyListing(),account_id:account,sku:'DEMO-BODY-001',size_text:'M',price:'19.90'},photos:[{path:'demo/front.webp',url:previewPhotos[0][0],type:'image/webp',size:100}],uploaded:0,created_at:now(),updated_at:now()}
const published={...structuredClone(base),id:'22222222-2222-4222-8222-222222222223',state:'published',vinted_id:'4800123456',url:'https://www.vinted.fr/items/4800123456',published_at:now(),fields:{...base.fields,sku:'DEMO-ROBE-002',size_text:'S',price:'34.90',title:'Robe longue noire tulle bustier cœur drapé col bardot princesse soirée cérémonie taille S',description:'Robe longue noire en tulle.',catalog_id:10,brand_id:1,brand_title:'Sans marque'}}
const rows=[structuredClone(base),published],images=new Map(),settings=new Map()
const demoText=size=>({title:`Body noir effet cuir décolleté V manches longues moulant soirée Y2K taille ${size}`,description:`Body noir effet cuir à manches longues et décolleté en V.\n– Coupe moulante, près du corps\n– Aspect cuir brillant\n– Fermeture pressions à l’entrejambe\n– À porter avec un jean taille haute ou une jupe pour une soirée\nTaille : ${size}\nMots-clés : body femme, top effet cuir, body manches longues, haut de soirée, body moulant, look Y2K`})
const readSettings=accountId=>{const global=settings.get('default')||null,own=settings.get(accountId)||null;return {global,account:own,effective:effectiveListingSettings(global?.settings,own?.settings)}}
export async function listingStudioPreview(method='GET',body,query=''){
 const q=new URLSearchParams(query),action=q.get('action')||body?.action||'list'
 if(action==='metadata'||action==='accounts')return {...structuredClone(metadata),selected_profiles:previewSelection.profiles,accounts:metadata.accounts.filter(a=>previewSelection.profiles.some(p=>p.id===a.profile_id))}
 if(action==='options')return {...structuredClone(options),catalog:{id:Number(q.get('catalog_id'))}}
 if(action==='brands')return {data:[{id:99,title:'Shein'}]}
 if(action==='list')return {drafts:structuredClone(rows),count:rows.length}
 if(action==='session'){const id=q.get('account_id');return {account_id:id,settings:readSettings(id),dotb_publish_enabled:false,dotb:false,drafts:structuredClone(rows.filter(r=>r.fields.account_id===id))}}
 if(action==='settings'&&method==='GET')return readSettings(q.get('account_id'))
 if(action==='settings'){const scope=body.scope,value=cleanListingSettings(body.settings,{account:scope!=='default'}),old=settings.get(scope);settings.set(scope,{scope,settings:value,version:(old?.version||0)+1});return readSettings(scope==='default'?null:scope)}
 if(action==='create'){const row={...structuredClone(base),id:body.id,created_at:now(),fields:{...emptyListing(),account_id:body.account_id||''},photos:[]};rows.unshift(row);return {draft:structuredClone(row)}}
 const row=rows.find(r=>r.id===(body?.id||q.get('id')));if(!row)throw Error('Brouillon introuvable.')
 if(action==='discard'){rows.splice(rows.indexOf(row),1);return {removed:row.id}}
 if(action==='save'){row.fields=structuredClone(body.fields);row.photos=body.photos.map(p=>({...p,type:'image/webp',size:100,url:images.get(p.path)||row.photos.find(old=>old.path===p.path)?.url}));row.version++}
 if(action==='generate'){
  await new Promise(resolve=>setTimeout(resolve,600))
  const preset=readSettings(row.fields.account_id).effective,text=demoText(row.fields.size_text)
  row.fields=applyListingPresets({...row.fields,title:text.title,description:composeListingDescription(text.description,preset.description_footer),catalog_id:11,color_ids:[1]},options,preset)
  row.message='Simulation : la matière exacte n’est pas visible sur les photos.';row.ai_updated_at=now();row.version++
 }
 if(action==='mark_published'){const id=String(body.url||'').match(/(?:items\/|^)(\d+)/)?.[1];if(!id)throw Error('Colle le lien Vinted de l’annonce.');row.state='published';row.vinted_id=id;row.url=`https://www.vinted.fr/items/${id}`;row.message='Publiée à la main (simulation).';row.published_at=now();row.version++}
 if(action==='publish'){row.state='preparing';row.message='Préparation de l’envoi (simulation)…';row.version++}
 if(action==='step'){row.uploaded++;row.dotb_item_id='demo';if(row.uploaded>=row.photos.length){row.state='scheduled';row.message='Annonce transmise (simulation).'}row.version++}
 if(action==='refresh'&&row.state==='scheduled'){row.state='published';row.message='Publication confirmée (simulation uniquement).';row.published_at=now();row.version++}
 row.updated_at=now();return {draft:structuredClone(row)}
}
export async function listingStudioPreviewUpload(file){const path=`demo/${crypto.randomUUID()}`;images.set(path,URL.createObjectURL(file));return {path}}
