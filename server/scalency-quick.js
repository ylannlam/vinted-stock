import {ScalencyError,remote,remoteId} from './scalency-api.js'
import {listingCatalogs} from './scalency-catalogs.js'
import {draftSource} from './scalency-relations.js'
import {generateListingText,listingAiToken,listingFields} from './listing-studio-core.js'
import {readListingSettings} from './listing-settings.js'
import {applyListingPresets} from '../src/lib/listingSettings.js'
import {listingColors,quickIssues,vintedCondition,bioCondition,conditionForCatalog} from '../src/lib/scalencyQuick.js'
import {composeVintedSeo} from '../src/lib/vintedSeo.js'
import {listingFacts} from '../src/lib/library.js'

const checked=r=>{if(r.error)throw r.error;return r.data}
const profileKey=id=>'listing-brand:'+remoteId(id)
export async function quickProfiles(db,user){
  const [accounts,names]=await Promise.all([
    db.from('scalency_records').select('remote_id,payload').eq('kind','accounts').eq('payload->>linked','true').order('payload->>login'),
    db.from('scalency_settings').select('id,value').like('id','listing-brand:%')])
  const lookup=new Map(checked(names).map(p=>[p.id,p.value.name]))
  return {owner:user.id,accounts:checked(accounts).map(a=>({id:a.remote_id,login:a.payload.login,brand:lookup.get(profileKey(a.remote_id))||''}))}
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
export async function accountBrand(db,id){
  await activeAccount(db,id)
  const name=checked(await db.from('scalency_settings').select('value').eq('id',profileKey(id)).maybeSingle())?.value?.name
  if(!name)throw new ScalencyError('Renseigne une fois le nom de ta marque pour ce compte.',409)
  return name
}
export async function verifyQuickFields(db,fields,options){
  const brand=await accountBrand(db,fields.account_id)
  if(fields.brand_title!==brand||fields.brand_id)throw new ScalencyError('La marque du compte a changé. Relance le remplissage.',409)
  const missing=quickIssues(fields,options)
  if(missing.length)throw new ScalencyError('À compléter : '+missing.join(', ')+'.',409)
}
export async function prepareQuickDraft(db,user,req,row,photosFor,review){
  const {fields}=row
  if(!fields.sku?.trim()||!/^\d{1,5}(?:[.]\d{1,2})?$/.test(fields.price)||Number(fields.price)<=0||!row.photos.length)throw new ScalencyError('Ajoute les photos, le SKU et un prix positif.')
  const photos=row.photos.length<=8?row.photos:[...row.photos.slice(0,6),...row.photos.slice(-2)]
  const [brand,presets,catalogs,source,urls]=await Promise.all([
    accountBrand(db,fields.account_id),readListingSettings(db,fields.account_id),listingCatalogs(db),
    draftSource(db,row.stock_item_id,row.catalog_product_id,fields.sku),photosFor(db,photos,300)
  ])
  const product=source.product
  const size=fields.size_text||source.stock?.size||''
  const settings={...presets.effective,condition:vintedCondition,package:'Petit',no_brand:false,description_footer:''}
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
  const category=result.catalog_id,options=category?await remote('catalogs/'+remoteId(category)):null
  const next=applyListingPresets({...fields,brand_id:null,brand_title:brand,title:result.title,description:result.description,
    catalog_id:category,status_id:conditionForCatalog(options),size_id:null,package_size_id:null,size_text:sizeText,color_ids:result.color_ids,item_attributes:[]},options,settings)
  const copy=composeVintedSeo(result.seoParts,{size:sizeText,condition:bioCondition,measures:listingFacts(product,sizeText)?.measures})
  const safe=listingFields({...next,...copy,seo_condition:bioCondition},{scalency:true})
  const missing=quickIssues(safe,options)
  const metadata=review?{payload:{...row.payload,scalency_source:'stock-vinted',batch:{...review(options,missing,safe),ai_model:result.usage?.model||null}}}:{}
  const saved=checked(await db.from('listing_drafts').update({...metadata,fields:safe,catalog_product_id:product?.id||null,version:row.version+1,updated_at:new Date().toISOString()}).eq('id',row.id).eq('owner_id',user.id).eq('version',row.version).eq('state','draft').select('id,fields,version').maybeSingle())
  if(!saved)throw new ScalencyError('Le brouillon a été modifié. Rouvre-le.',409)
  return {...saved,missing}
}
