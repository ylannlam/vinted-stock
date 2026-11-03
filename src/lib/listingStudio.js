export const MAX_LISTING_PHOTOS=20
export const MAX_LISTING_PHOTO_BYTES=8_000_000
export const listingStateLabels={draft:'Brouillon',preparing:'Envoi en cours',scheduled:'En attente de publication',published:'Publiée',attention:'À vérifier'}
export const emptyListing=()=>({account_id:'',sku:'',size_text:'',price:'',notes:'',title:'',description:'',catalog_id:null,size_id:null,status_id:null,brand_id:null,brand_title:'',color_ids:[],package_size_id:null,item_attributes:[]})
export function validateListingPhoto(file){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||!Number.isInteger(file.size)||file.size<1||file.size>MAX_LISTING_PHOTO_BYTES)throw Error('Choisis une photo JPG, PNG ou WebP de moins de 8 Mo.')
}
export const listingSizes=options=>(options?.size_groups||[]).flatMap(g=>g.sizes||[])
const normalized=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ')
export function matchingSize(text,options){
 const rows=listingSizes(options).filter(x=>normalized(x.title)===normalized(text)||String(x.title).split('/').some(t=>normalized(t)===normalized(text)))
 return rows.length===1?rows[0].id:null
}
export function catalogChoices(rows){
 const map=new Map(rows.map(r=>[r.id,r])),parents=new Set(rows.map(r=>r.parent_id))
 return rows.filter(r=>!parents.has(r.id)).map(row=>{
  let trail=[row.title],p=row.parent_id,seen=new Set([row.id])
  while(p&&map.has(p)&&!seen.has(p)){seen.add(p);const parent=map.get(p);trail.unshift(parent.title);p=parent.parent_id}
  return {...row,label:trail.join(' › ')}
 })
}
export function missingListingFields(f,photos,options){
 const missing=[]
 if(!photos?.length)missing.push('au moins une photo')
 if(!f.account_id)missing.push('le compte')
 if(!f.sku?.trim())missing.push('le SKU')
 if(!/^\d{1,5}([.,]\d{1,2})?$/.test(String(f.price))||Number(String(f.price).replace(',','.'))<=0)missing.push('le prix')
 if(!f.title?.trim()||f.title.trim().length<5||f.title.length>100)missing.push('un titre de 5 à 100 caractères')
 if(!f.description?.trim()||f.description.trim().length<5||f.description.length>2000)missing.push('une description de 5 à 2 000 caractères')
 if(!f.catalog_id||!options||options.catalog?.id!==Number(f.catalog_id))missing.push('la catégorie')
 if(!f.brand_id)missing.push('la marque ou « Sans marque »')
 if(options?.conditions?.length&&!f.status_id)missing.push('l’état')
 if(listingSizes(options).length&&!f.size_id)missing.push('la taille Vinted')
 if(options?.package_sizes?.length&&!f.package_size_id)missing.push('le format du colis')
 if(options?.parcel_measurements)missing.push('les dimensions du colis (à renseigner dans Dotb pour cette catégorie)')
 for(const a of options?.attributes||[])if(a.required&&!f.item_attributes?.find(v=>v.code===a.code)?.ids?.length)missing.push(a.title)
 return missing
}
