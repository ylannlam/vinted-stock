import {tidyListingTitle} from './listingSettings.js'

const bundleSentence='Achat en lot possible, je fais un prix.'
const publishedCondition=condition=>{
  const label=condition?.trim()
  if(!label||label==='Neuf avec étiquette'||label==='Neuf sans étiquette')return 'Neuf'
  return label
}
const sizeValue=value=>{
  const size=String(value||'').replace(/\s+/g,' ').trim()||'M'
  return /^(?:[2-9]?x{0,4}[sl]|m)$/i.test(size)?size.toUpperCase():size
}
const sizeTag=size=>'#taille'+size.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toUpperCase()

function sizedTitle(base,size){
  const suffix=' taille '+size
  const title=tidyListingTitle(base).replace(/\s+taille\s+\S+(?:\s*\/\s*\S+)*$/i,'').trim()
  const room=100-suffix.length
  let head=title
  if(head.length>room){
    head=head.slice(0,room)
    if(title[room]!==' ')head=head.replace(/\s+\S*$/,'')
    head=head.trimEnd()
  }
  if(!head||head.length<3)throw Error('Titre SEO incomplet.')
  return head+suffix
}

export function composeVintedSeo(parts,{size,condition,measures=[]}={}){
  size=sizeValue(size)
  const sentences=parts?.sentences
  if(!Array.isArray(sentences)||sentences.length<2||sentences.length>3)throw Error('La bio doit contenir deux ou trois phrases.')
  const paragraph=sentences.map(s=>{
    if(typeof s!=='string'||s.trim().length<4||s.length>220||/[\n\r#|]/.test(s)||s.includes(bundleSentence))throw Error('Phrase de bio invalide.')
    const line=s.trim()
    if([...new Intl.Segmenter('fr',{granularity:'sentence'}).segment(line)].length!==1)throw Error('Une phrase par élément est attendue.')
    return /[.!?…]$/.test(line)?line:line+'.'
  }).join(' ')
  const tags=[],seen=new Set()
  for(const value of Array.isArray(parts.hashtags)?parts.hashtags:[]){
    if(typeof value!=='string')continue
    const tag=value.trim().replace(/^#/,'').normalize('NFC')
    const key=tag.toLocaleLowerCase('fr')
    if(!/^[\p{L}\p{N}_]{2,45}$/u.test(tag)||/^taille(?:xxs|xs|s|m|l|xl|xxl|\d)/i.test(tag)||key===sizeTag(size).slice(1).toLowerCase()||seen.has(key))continue
    seen.add(key);tags.push('#'+tag)
    if(tags.length===15)break
  }
  if(tags.length!==15)throw Error('La génération doit fournir quinze hashtags distincts avant le hashtag de taille.')
  tags.push(sizeTag(size))
  const measurements=measures.map(m=>m.name+' '+m.value).join(', ')
  const line='Taille : '+size+' | État : '+publishedCondition(condition)+' | Mesures : '+(measurements||'sur demande')
  const description=[paragraph,bundleSentence,line,tags.join(' ')].join('\n\n')
  if(description.length>2000)throw Error('La bio dépasse la longueur acceptée par Vinted.')
  if(typeof parts.title!=='string'||parts.title.trim().length<3)throw Error('Titre SEO manquant.')
  return {title:sizedTitle(parts.title,size),description}
}

// Actualise uniquement les champs du gabarit, sans réécrire le texte édité à la main.
export function updateSeoDetails(fields,{size,condition}){
  const match=fields.description?.match(/^Taille : ([^\n|]+?) \| État : ([^\n|]+?) \| Mesures : ([^\n]+)$/m)
  if(!match||!fields.description.includes(bundleSentence))return {}
  const nextSize=sizeValue(size===undefined?match[1]:size)
  const nextCondition=condition===undefined?match[2]:publishedCondition(condition)
  const sizeChanged=nextSize!==match[1]
  const nextLine='Taille : '+nextSize+' | État : '+nextCondition+' | Mesures : '+(sizeChanged?'sur demande':match[3])
  let description=fields.description.replace(match[0],()=>nextLine)
  if(sizeChanged)description=description.split(/\s+/).includes(sizeTag(match[1]))?description.replace(/#[\p{L}\p{N}_]+/gu,t=>t===sizeTag(match[1])?sizeTag(nextSize):t):description
  const previousSuffix=' taille '+match[1]
  if(sizeChanged&&fields.title?.endsWith(previousSuffix))return {title:sizedTitle(fields.title.slice(0,-previousSuffix.length),nextSize),description}
  return {description}
}
