export const IMAGE_TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}
export const MAX_IMAGE_BYTES=10*1024*1024
export function validateImage(file) {
  if(!file||!Object.hasOwn(IMAGE_TYPES,file.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_IMAGE_BYTES)throw Error('Choisis une image JPG, PNG ou WebP de 10 Mo maximum.')
  return file
}
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function filterResources(rows,{tab='all',search='',category='',favorites=false,sort='recent'}={}) {
  const term=fold(search.trim())
  return rows.filter(r=>(tab==='archived'?!!r.archived_at:!r.archived_at)
    &&(!['prompt','background'].includes(tab)||r.kind===tab)
    &&(!favorites||r.favorite)&&(!category||r.category===category)
    &&(!term||fold([r.title,r.category,r.content,r.notes].join(' ')).includes(term)))
    .sort((a,b)=>sort==='name'?a.title.localeCompare(b.title,'fr'):
      sort==='favorites'?Number(b.favorite)-Number(a.favorite)||Date.parse(b.updated_at)-Date.parse(a.updated_at):Date.parse(b.updated_at)-Date.parse(a.updated_at))
}
