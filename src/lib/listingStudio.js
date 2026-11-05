export const MAX_LISTING_PHOTOS=20
export const MAX_LISTING_PHOTO_BYTES=8_000_000
export const listingStateLabels={draft:'Brouillon',preparing:'Envoi en cours',scheduled:'En attente de publication',published:'Publiée',attention:'À vérifier',vinted_draft:'Brouillon sur Vinted'}
export const emptyListing=()=>({account_id:'',sku:'',size_text:'',price:'',notes:'',title:'',description:'',catalog_id:null,size_id:null,status_id:null,brand_id:null,brand_title:'',color_ids:[],package_size_id:null,item_attributes:[]})
export function validateListingPhoto(file){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||!Number.isInteger(file.size)||file.size<1||file.size>MAX_LISTING_PHOTO_BYTES)throw Error('Choisis une photo JPG, PNG ou WebP de moins de 8 Mo.')
}
export const listingSizes=options=>(options?.size_groups||[]).flatMap(g=>g.sizes||[])
const normalized=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ')
export function matchingSize(text,options){
 const target=normalized(text)
 if(!target)return null
 const sizes=listingSizes(options),exact=sizes.filter(x=>normalized(x.title)===target)
 // Vinted peut proposer « M » et « M / 38 / 10 » dans la même catégorie.
 // Un libellé exact est prioritaire ; les correspondances ambiguës restent à choisir.
 const rows=exact.length?exact:sizes.filter(x=>String(x.title).split('/').some(t=>normalized(t)===target))
 const ids=[...new Set(rows.map(x=>x.id))]
 return ids.length===1?ids[0]:null
}
export function catalogChoices(rows){
 const map=new Map(rows.map(r=>[r.id,r])),parents=new Set(rows.map(r=>r.parent_id))
 return rows.filter(r=>!parents.has(r.id)).map(row=>{
  let trail=[row.title],p=row.parent_id,seen=new Set([row.id])
  while(p&&map.has(p)&&!seen.has(p)){seen.add(p);const parent=map.get(p);trail.unshift(parent.title);p=parent.parent_id}
  return {...row,label:trail.join(' › ')}
 })
}
export function listingIssues(f,photos,options){
 const missing=[]
 const add=(key,label,step='review')=>missing.push({key,label,step})
 if(!photos?.length)add('photos','au moins une photo','product')
 if(!f.account_id)add('account','le compte')
 if(!f.sku?.trim())add('sku','le SKU','product')
 if(!/^\d{1,5}([.,]\d{1,2})?$/.test(String(f.price))||Number(String(f.price).replace(',','.'))<=0)add('price','le prix','product')
 if(!f.title?.trim()||f.title.trim().length<5||f.title.length>100)add('title','un titre de 5 à 100 caractères')
 // Vinted refuse un titre avec plus de 6 majuscules en dehors de la première lettre des mots.
 else if(f.title.split(/\s+/).reduce((n,w)=>n+[...w.slice(1)].filter(c=>c!==c.toLowerCase()).length,0)>6)add('title','un titre avec moins de majuscules (6 au maximum hors initiales)')
 if(!f.description?.trim()||f.description.trim().length<5||f.description.length>2000)add('description','une description de 5 à 2 000 caractères')
 if(!f.catalog_id||!options||options.catalog?.id!==Number(f.catalog_id))add('category','la catégorie et ses options')
 if(!f.brand_id)add('brand','la marque ou « Sans marque »')
 const has=(rows,id)=>(rows||[]).some(row=>row.id===id)
 if(options?.conditions?.length&&!has(options.conditions,f.status_id))add('condition','l’état réel de l’article')
 if(listingSizes(options).length&&!has(listingSizes(options),f.size_id))add('size','la taille Vinted')
 if(options?.package_sizes?.length&&!has(options.package_sizes,f.package_size_id))add('package','le format du colis')
 if(options?.parcel_measurements)add('package','les dimensions du colis (à renseigner dans Dotb pour cette catégorie)')
 for(const a of options?.attributes||[]){
  const ids=f.item_attributes?.find(v=>v.code===a.code)?.ids||[]
  if(a.required&&!ids.length||ids.some(id=>!has(a.options,id))||ids.length>(a.selection_limit||1))add(`attribute-${a.code}`,a.title)
 }
 return missing
}
export const missingListingFields=(...args)=>listingIssues(...args).map(issue=>issue.label)

export function generationIssues(fields,photos){
 // L'IA n'a besoin que des photos et de la taille : le SKU et le prix peuvent venir après.
 const issues=listingIssues(fields,photos,null).filter(issue=>['photos','account'].includes(issue.key))
 if(!fields.size_text?.trim())issues.push({key:'size-text',label:'la taille de l’article',step:'product'})
 return issues
}
