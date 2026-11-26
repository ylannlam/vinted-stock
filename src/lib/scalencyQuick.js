export const vintedCondition='Très bon état'
export const bioCondition='Neuf'

export function accountBrandIssue(fields,expected){
  const actual=fields.brand_title|| (fields.brand_id?'n° '+fields.brand_id:'')
  if(!expected)return 'Vérifie la marque configurée pour ce compte.'
  if(!actual)return 'Marque absente du brouillon. Ce compte utilise « '+expected+' ».'
  if(actual!==expected)return 'Ce brouillon indique « '+actual+' ». Ce compte utilise « '+expected+' ».'
  if(fields.brand_id)return 'Pour ce compte, utilise la marque « '+expected+' » enregistrée dans ses réglages.'
  return 'La marque correspond à « '+expected+' ». Enregistre la fiche pour la revérifier.'
}

export function conditionForCatalog(options){
  return options?.conditions?.find(c=>(c.title||c.name)===vintedCondition)?.id??null
}

export function withBioCondition(fields){
  let description=fields.description||''
  if(description.trim()){
    const label=/(^|\|\s*|\n)[ÉE]tat\s*:\s*[^|\r\n]+/i
    if(label.test(description))description=description.replace(label,(_,prefix)=>prefix+'État : '+bioCondition+(prefix.includes('|')?' ':'')).trimEnd()
    else {
      const tags=description.search(/(?:^|\n)\s*#[\p{L}\p{N}_]+/u)
      description=tags<0?description.trimEnd()+'\n\nÉtat : '+bioCondition:description.slice(0,tags).trimEnd()+'\n\nÉtat : '+bioCondition+'\n\n'+description.slice(tags).trimStart()
    }
  }
  return {...fields,seo_condition:bioCondition,description}
}

// Identifiants des couleurs du catalogue Vinted français.
export const listingColors=Object.entries({
  1:'Noir',2:'Marron',3:'Gris',4:'Beige',5:'Rose',6:'Violet',7:'Rouge',8:'Jaune',9:'Bleu',10:'Vert',11:'Orange',12:'Blanc',13:'Argenté',14:'Doré',15:'Multicolore',16:'Kaki',17:'Turquoise',20:'Crème',21:'Abricot',22:'Corail',23:'Bordeaux',24:'Vieux rose',25:'Lilas',26:'Bleu clair',27:'Bleu marine',28:'Vert foncé',29:'Moutarde',30:'Menthe',32:'Transparent'
}).map(([id,title])=>({id:Number(id),title}))

export function quickIssues(fields,options){
  const missing=[]
  if(!fields.account_id)missing.push('Compte Vinted')
  if(!(Number(fields.price)>0))missing.push('Prix')
  if(!fields.title?.trim())missing.push('Titre')
  if(!fields.description?.trim())missing.push('Bio')
  if(!fields.catalog_id||!options?.catalog||options.offline)missing.push('Catégorie Vinted')
  if(!options?.conditions?.some(c=>c.id===fields.status_id))missing.push('État')
  if(options?.size_groups?.some(g=>g.sizes?.length)&&!options.size_groups.some(g=>g.sizes?.some(s=>s.id===fields.size_id)))missing.push('Taille sur l’étiquette')
  if(!fields.color_ids?.length||fields.color_ids.some(id=>!listingColors.some(c=>c.id===id)))missing.push('Couleur')
  if(!fields.package_size_id||!options?.package_sizes?.some(p=>p.id===fields.package_size_id&&p.title.toLowerCase()==='petit'))missing.push('Petit colis indisponible pour cette catégorie')
  for(const a of options?.attributes||[])if(a.required&&!fields.item_attributes?.some(x=>x.code===a.code&&x.ids?.length&&x.ids.every(id=>a.options?.some(o=>o.id===id))))missing.push(a.title||a.code)
  return missing
}
