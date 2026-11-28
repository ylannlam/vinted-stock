import {ScalencyError,remoteId} from './scalency-api.js'
import {CatalogTemporarilyUnavailable,listingCatalogs,readCategoryOptions} from './scalency-catalogs.js'
import {draftSource} from './scalency-relations.js'
import {generateListingText,listingAiToken,listingFields} from './listing-studio-core.js'
import {readListingSettings} from './listing-settings.js'
import {applyListingPresets} from '../src/lib/listingSettings.js'
import {accountBrandIssue,listingColors,quickIssues,vintedCondition,bioCondition,conditionForCatalog} from '../src/lib/scalencyQuick.js'
import {composeVintedSeo} from '../src/lib/vintedSeo.js'
import {listingFacts} from '../src/lib/library.js'

const checked=r=>{if(r.error)throw r.error;return r.data}
const profileKey=id=>'listing-brand:'+remoteId(id)
const sizeKey=id=>'listing-size:'+remoteId(id)
export async function quickProfiles(db,user){
  const [accounts,names,sizes]=await Promise.all([
    db.from('scalency_records').select('remote_id,payload').eq('kind','accounts').eq('payload->>linked','true').order('payload->>login'),
    db.from('scalency_settings').select('id,value').like('id','listing-brand:%'),
    db.from('scalency_settings').select('id,value').like('id','listing-size:%')])
  const lookup=new Map(checked(names).map(p=>[p.id,p.value.name]))
  const sizeByAccount=new Map(checked(sizes).map(p=>[p.id,p.value.size]))
  return {owner:user.id,accounts:checked(accounts).map(a=>({id:a.remote_id,login:a.payload.login,brand:lookup.get(profileKey(a.remote_id))||'',default_size:sizeByAccount.get(sizeKey(a.remote_id))||''}))}
}
async function activeAccount(db,id){
  const account=checked(await db.from('scalency_records').select('payload').eq('kind','accounts').eq('remote_id',remoteId(id)).maybeSingle())
  if(!account?.payload?.linked)throw new ScalencyError('Choisis un compte relié à Scalency.',409)
}
export async function saveQuickBrand(db,id,name){
  await activeAccount(db,id)
  if(typeof name!=='string'||!name.trim()||name.trim().length>100||/[\x00-\x1f]/.test(name))throw new ScalencyError('Saisis le nom exact de ta marque.')
  checked(await db.from('scalency_settings').upsert({id:profileKey(id),value:{name:name.trim()}}))
  return {brand:name.trim()}
}
export async function saveQuickSize(db,id,input){
  if(typeof input!=='string'||input.trim().length>80||/[\x00-\x1f\x7f]/.test(input))throw new ScalencyError('Saisis une taille de 80 caractères maximum.')
  await activeAccount(db,id)
  const label=input.trim()
  const size=/^(?:[2-9]x[sl]|x{0,4}[sl]|m)$/i.test(label)?label.toUpperCase():label
  const settings=db.from('scalency_settings')
  if(size)checked(await settings.upsert({id:sizeKey(id),value:{size}}))
  else checked(await settings.delete().eq('id',sizeKey(id)))
  return {default_size:size}
}
async function accountSize(db,id){
  return checked(await db.from('scalency_settings').select('value').eq('id',sizeKey(id)).maybeSingle())?.value?.size||''
}
export async function accountBrand(db,id){
  await activeAccount(db,id)
  const name=checked(await db.from('scalency_settings').select('value').eq('id',profileKey(id)).maybeSingle())?.value?.name
  if(!name)throw new ScalencyError('Renseigne une fois le nom de ta marque pour ce compte.',409)
  return name
}
export async function verifyQuickFields(db,fields,options){
  const brand=await accountBrand(db,fields.account_id)
  if(fields.brand_title!==brand||fields.brand_id)throw new ScalencyError(accountBrandIssue(fields,brand),409)
  const missing=quickIssues(fields,options)
  if(missing.length)throw new ScalencyError('À compléter : '+missing.join(', ')+'.',409)
}
async function generateQuickFields(db,req,row,photosFor,settings){
  const {fields}=row
  const photos=row.photos.length<=8?row.photos:[...row.photos.slice(0,6),...row.photos.slice(-2)]
  const [catalogs,source,urls,defaultSize]=await Promise.all([
    listingCatalogs(db),
    draftSource(db,row.stock_item_id,row.catalog_product_id,fields.sku),photosFor(db,photos,300),
    fields.size_text?'':accountSize(db,fields.account_id)
  ])
  const product=source.product
  const size=fields.size_text||source.stock?.size||defaultSize
  const facts=listingFacts(product,size)
  const result=await generateListingText({...row,fields:{...fields,size_text:size,seo_condition:bioCondition}},urls,catalogs,listingColors,
    {token:listingAiToken(req),settings,quick:true,shein:facts?{details:facts.details}:null})
  let stockSize=''
  if(!size&&!result.label_size&&product?.id){
    const units=checked(await db.from('scalency_physical_catalog').select('size').eq('product_id',product.id).eq('status','en_stock'))
    const labels=new Set(units.map(u=>String(u.size||'').trim().toUpperCase()))
    if(labels.size===1)stockSize=[...labels][0]
  }
  const sizeText=size||result.label_size||stockSize
  const copy=composeVintedSeo(result.seoParts,{size:sizeText,condition:bioCondition,measures:listingFacts(product,sizeText)?.measures})
  return {fields:{...fields,title:result.title,description:result.description,...copy,seo_condition:bioCondition,
    catalog_id:result.catalog_id,status_id:null,size_id:null,package_size_id:null,size_text:sizeText,color_ids:result.color_ids,item_attributes:[]},
    productId:product?.id||null,model:result.usage?.model||null}
}

export async function prepareQuickDraft(db,user,req,row,photosFor,review){
  const {fields}=row
  if(!/^\d{1,5}(?:[.]\d{1,2})?$/.test(fields.price)||Number(fields.price)<=0||!row.photos.length)throw new ScalencyError('Ajoute les photos et un prix positif.')
  const [brand,presets]=await Promise.all([accountBrand(db,fields.account_id),readListingSettings(db,fields.account_id)])
  const settings={...presets.effective,condition:vintedCondition,package:'Petit',no_brand:false,description_footer:''}
  const batch=row.payload?.batch
  const generated=review&&batch?.catalog_pending&&fields.catalog_id&&fields.title&&fields.description
    ?{fields,productId:row.catalog_product_id,model:batch.ai_model}
    :await generateQuickFields(db,req,row,photosFor,settings)
  let category=generated.fields.catalog_id,options=null,catalogPending=false
  if(category){
    try{options=await readCategoryOptions(category)}
    catch(error){
      if(error.status===404)category=null
      else if(error instanceof CatalogTemporarilyUnavailable)catalogPending=true
      else throw error
    }
  }
  const next=applyListingPresets({...generated.fields,catalog_id:category,brand_id:null,brand_title:brand,status_id:conditionForCatalog(options)},options,settings)
  const safe=listingFields(next,{scalency:true})
  const missing=quickIssues(safe,options).map(issue=>catalogPending&&issue==='Catégorie Vinted'?'Texte enregistré. Options de la catégorie Vinted en attente.':issue)
  const metadata=review?{payload:{...row.payload,scalency_source:'stock-vinted',batch:{...review(options,missing,safe),ai_model:generated.model,...(catalogPending?{catalog_pending:true}:{})}}}:{}
  const saved=checked(await db.from('listing_drafts').update({...metadata,fields:safe,catalog_product_id:generated.productId,version:row.version+1,updated_at:new Date().toISOString()}).eq('id',row.id).eq('owner_id',user.id).eq('version',row.version).eq('state','draft').select('id,fields,version').maybeSingle())
  if(!saved)throw new ScalencyError('Le brouillon a été modifié. Rouvre-le.',409)
  return {...saved,missing}
}
