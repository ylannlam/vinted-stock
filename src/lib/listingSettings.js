import {listingSizes,matchingSize} from './listingStudio.js'

// Réglages des annonces : valeurs appliquées à chaque article préparé, puis modifiables sur la fiche.
// L'état et le colis sont enregistrés par leur nom Vinted, puis retrouvés dans les options de la catégorie.
export const LISTING_CONDITIONS=['Neuf avec étiquette','Neuf sans étiquette','Très bon état','Bon état','Satisfaisant']
export const LISTING_PACKAGES=['Petit','Moyen','Grand']
export const LISTING_AI_MODELS=[
 {id:'gemini-3.5-flash-lite',label:'Rapide : Gemini 3.5 Flash-Lite (celui utilisé jusqu’ici)'},
 {id:'gemini-3.5-flash',label:'Plus précis : Gemini 3.5 Flash (crédits Google payants)'}
]
export const DEFAULT_LISTING_SETTINGS={no_brand:true,condition:'Très bon état',package:'Petit',size_in_title:true,keywords_line:true,title_rules:'',description_footer:'',ai_model:'gemini-3.5-flash-lite',publisher:'ylavint',publish_mode:'live'}
const SHARED=['no_brand','condition','package','size_in_title','keywords_line','title_rules','description_footer']
export const MAX_SPACING_MINUTES=720
// Outil et mode d'envoi : un seul choix pour tous les comptes.
export const LISTING_PUBLISHERS=[['ylavint','YlaVint'],['dotb','Dotb']]
export const LISTING_MODES=[['live','En ligne directement'],['draft','En brouillon Vinted']]

function text(input,key,max,label){
 const value=input[key]??''
 if(typeof value!=='string'||value.length>max)throw Error(`${label} : ${max} caractères au maximum.`)
 return value.trim()
}
function flag(input,key,fallback){
 const value=input[key]
 if(value==null)return fallback
 if(typeof value!=='boolean')throw Error('Un réglage est invalide.')
 return value
}
function choice(input,key,list,fallback,label){
 const value=input[key]??fallback
 if(!list.includes(value))throw Error(`Choisis ${label} dans la liste.`)
 return value
}

// Réglages communs (scope « default ») ou propres à un compte. Rien d'autre n'est enregistré.
export function cleanListingSettings(input,{account=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Les réglages sont invalides.')
 const shared={
  no_brand:flag(input,'no_brand',DEFAULT_LISTING_SETTINGS.no_brand),
  condition:choice(input,'condition',LISTING_CONDITIONS,DEFAULT_LISTING_SETTINGS.condition,'l’état'),
  package:choice(input,'package',LISTING_PACKAGES,DEFAULT_LISTING_SETTINGS.package,'le format du colis'),
  size_in_title:flag(input,'size_in_title',DEFAULT_LISTING_SETTINGS.size_in_title),
  keywords_line:flag(input,'keywords_line',DEFAULT_LISTING_SETTINGS.keywords_line),
  title_rules:text(input,'title_rules',600,'Consignes pour le titre'),
  description_footer:text(input,'description_footer',600,'Fin de description')
 }
 if(!account)return {...shared,ai_model:choice(input,'ai_model',LISTING_AI_MODELS.map(m=>m.id),DEFAULT_LISTING_SETTINGS.ai_model,'le modèle de rédaction'),
  publisher:choice(input,'publisher',LISTING_PUBLISHERS.map(p=>p[0]),DEFAULT_LISTING_SETTINGS.publisher,'l’outil de publication'),
  publish_mode:choice(input,'publish_mode',LISTING_MODES.map(m=>m[0]),DEFAULT_LISTING_SETTINGS.publish_mode,'le mode d’envoi')}
 const spacing=input.spacing_minutes??30
 if(!Number.isSafeInteger(spacing)||spacing<0||spacing>MAX_SPACING_MINUTES)throw Error(`L’écart entre deux publications doit être compris entre 0 et ${MAX_SPACING_MINUTES} minutes.`)
 const custom=flag(input,'custom',false)
 // A compte without its own presets keeps only its Dotb choice: it follows the shared presets.
 return {dotb:flag(input,'dotb',false),spacing_minutes:spacing,custom,...(custom?shared:{})}
}

// Valeurs effectivement utilisées pour un compte. Toute valeur abîmée revient au réglage par défaut.
export function effectiveListingSettings(global,account){
 let shared=DEFAULT_LISTING_SETTINGS,own={dotb:false,spacing_minutes:30,custom:false}
 try{if(global)shared=cleanListingSettings(global)}catch{}
 try{if(account)own=cleanListingSettings(account,{account:true})}catch{}
 const picked=own.custom?Object.fromEntries(SHARED.map(k=>[k,own[k]])):{}
 return {...shared,...picked,dotb:own.dotb,spacing_minutes:own.spacing_minutes,custom:own.custom}
}

const normalized=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const byTitle=(rows,title)=>(rows||[]).find(row=>normalized(row.title)===normalized(title))?.id||null
const has=(rows,id)=>(rows||[]).some(row=>row.id===id)

// Complète uniquement ce qui manque ou ne correspond plus à la catégorie : un choix déjà valide est gardé.
export function applyListingPresets(fields,options,settings){
 const next={...fields}
 if(settings?.no_brand&&!next.brand_id){next.brand_id=1;next.brand_title='Sans marque'}
 if(!options||options.catalog?.id!==Number(next.catalog_id))return next
 if(!has(listingSizes(options),next.size_id))next.size_id=matchingSize(next.size_text,options)
 if(!has(options.conditions,next.status_id))next.status_id=byTitle(options.conditions,settings?.condition)
 if(!has(options.package_sizes,next.package_size_id))next.package_size_id=options.parcel_measurements?null:byTitle(options.package_sizes,settings?.package)
 next.item_attributes=(next.item_attributes||[]).filter(entry=>{const attr=options.attributes?.find(a=>a.code===entry.code);return attr&&entry.ids.length<=(attr.selection_limit||1)&&entry.ids.every(id=>has(attr.options,id))})
 return next
}

// Vinted refuse plus de 6 majuscules hors initiales ; un titre ne contient ni emoji ni hashtag.
const extraCapitals=title=>title.split(' ').reduce((n,word)=>n+[...word.slice(1)].filter(c=>c!==c.toLocaleLowerCase('fr')&&c===c.toLocaleUpperCase('fr')).length,0)
export function tidyListingTitle(value){
 let title=String(value||'').replace(/\p{Extended_Pictographic}|️/gu,' ').replace(/[#*_~|<>{}[\]"“”«»]+/g,' ').replace(/\s+/g,' ').trim()
 if(extraCapitals(title)>6)title=title.split(' ').map(w=>w.length>3?w[0]+w.slice(1).toLocaleLowerCase('fr'):w).join(' ')
 if(extraCapitals(title)>6)title=title[0]+title.slice(1).toLocaleLowerCase('fr')
 if(title.length>100){const cut=title.slice(0,100);title=title[100]===' '?cut:(cut.replace(/\s+\S*$/,'')||cut);title=title.trim()}
 return title
}
export const titleCapitalsOk=title=>extraCapitals(String(title||''))<=6

// La fin de description choisie par l'équipe est ajoutée telle quelle, sans dépasser 2 000 caractères.
export function composeListingDescription(body,footer){
 const end=String(footer||'').trim(),text=String(body||'').trim()
 if(!end)return text.slice(0,2000).trim()
 return `${text.slice(0,Math.max(0,2000-end.length-2)).trim()}\n\n${end}`
}
