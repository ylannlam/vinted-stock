import {catalogChoices,listingSizes,validateListingPhoto} from './listingStudio.js'

const encoder=new TextEncoder()
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
const header=size=>new Uint8Array(size)
// Store files without recompression: the original JPEG/PNG/WebP bytes stay intact.
export function listingZip(files){
 const parts=[],directory=[];let offset=0,directorySize=0
 for(const file of files){
  if(!/^[a-zA-Z0-9._-]+$/.test(file.name))throw Error('Nom de fichier invalide.')
  const name=encoder.encode(file.name),bytes=file.bytes,crc=crc32(bytes)
  const local=header(30),l=new DataView(local.buffer)
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true)
  l.setUint32(14,crc,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,name.length,true)
  parts.push(local,name,bytes)
  const entry=header(46),d=new DataView(entry.buffer)
  d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true)
  d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true)
  directory.push(entry,name);directorySize+=entry.length+name.length;offset+=local.length+name.length+bytes.length
 }
 const end=header(22),e=new DataView(end.buffer)
 e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,directorySize,true);e.setUint32(16,offset,true)
 return new Blob([...parts,...directory,end],{type:'application/zip'})
}
export function listingMemo(row,account,metadata,options){
 const f=row.fields,find=(rows,id)=>rows?.find(r=>r.id===id)?.title||'À compléter sur Vinted'
 return [
  'FICHE PRIVÉE — NE PAS COPIER EN ENTIER DANS L’ANNONCE',
  `Compte choisi : #${account?.profile_number||'—'} · ${account?.login||'À vérifier'}`,
  `SKU interne : ${f.sku||'—'}`,
  '', 'TITRE',f.title||'', '', 'DESCRIPTION',f.description||'', '', 'INFORMATIONS À VÉRIFIER',
  `Prix : ${f.price||'—'} EUR`, `Taille : ${find(listingSizes(options),f.size_id)} (${f.size_text||'—'})`,
  `Catégorie : ${catalogChoices(metadata.catalogs||[]).find(c=>c.id===f.catalog_id)?.label||'À compléter sur Vinted'}`,
  `Marque : ${f.brand_id===1?'Sans marque':f.brand_title||'À compléter sur Vinted'}`,
  `État : ${find(options?.conditions,f.status_id)}`, `Colis : ${find(options?.package_sizes,f.package_size_id)}`,
  `Couleurs : ${f.color_ids.map(id=>find(metadata.colors,id)).join(', ')||'À compléter sur Vinted'}`,
  ...(options?.attributes||[]).filter(a=>f.item_attributes.some(v=>v.code===a.code&&v.ids.length)).map(a=>`${a.title} : ${f.item_attributes.find(v=>v.code===a.code).ids.map(id=>find(a.options,id)).join(', ')}`),
  '', 'PUBLICATION MANUELLE',
  'Attends la fin du blocage Vinted. Ouvre le compte indiqué, puis « Vends tes articles ».',
  'Décompresse ce dossier et ajoute les photos dans l’ordre : 01, 02, etc.',
  'Copie uniquement le titre et la description. Vérifie les autres champs puis valide sur Vinted.',
  'Ce téléchargement ne publie rien et ne confirme pas la mise en ligne dans Stock Vinted.'
 ].join('\r\n')
}
export async function exportListing(row,account,metadata,options,{fetcher=fetch,onProgress=()=>{}}={}){
 if(row.state!=='draft'||row.dotb_item_id)throw Error('Cette fiche a déjà été transmise à Dotb. Vérifie son état avant de la publier manuellement pour éviter un doublon.')
 if(!row.photos?.length||row.photos.length>20)throw Error('Ajoute de 1 à 20 photos pour préparer le dossier.')
 const files=[]
 for(let i=0;i<row.photos.length;i++){
  onProgress(`Préparation de la photo ${i+1} sur ${row.photos.length}…`)
  const photo=row.photos[i]
  if(!photo.url)throw Error('Une photo est indisponible. Rouvre le brouillon puis réessaie.')
  const response=await fetcher(photo.url,{credentials:'omit',signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw Error(`La photo ${i+1} n’a pas pu être récupérée. Réessaie le téléchargement.`)
  const blob=await response.blob();validateListingPhoto(blob)
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[blob.type]
  files.push({name:`photo-${String(i+1).padStart(2,'0')}.${ext}`,bytes:new Uint8Array(await blob.arrayBuffer())})
 }
 files.push({name:'fiche-privee.txt',bytes:encoder.encode(listingMemo(row,account,metadata,options))})
 return {blob:listingZip(files),filename:`annonce-${String(account?.profile_number||'compte').replace(/[^a-zA-Z0-9_-]/g,'')}-${row.id.slice(0,8)}.zip`}
}
export function downloadListingFile({blob,filename}){
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
}
