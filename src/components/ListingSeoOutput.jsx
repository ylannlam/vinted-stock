import {useEffect,useState} from 'react'

async function copyText(value){
  try{
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);return}
  }catch{}
  const previous=document.activeElement
  const field=document.createElement('textarea')
  field.value=value;field.readOnly=true;field.style.position='fixed';field.style.opacity='0'
  document.body.appendChild(field)
  try{field.select();if(!document.execCommand('copy'))throw Error('Copie indisponible dans ce navigateur.')}
  finally{field.remove();previous?.focus?.({preventScroll:true})}
}

export default function ListingSeoOutput({title,description}){
  const [notice,setNotice]=useState('')
  useEffect(()=>{setNotice('')},[title,description])
  if(!title&&!description)return null
  async function copy(value,message){
    try{await copyText(value);setNotice(message)}
    catch{setNotice('La copie a échoué. Tu peux sélectionner le texte ci-dessus.')}
  }
  return <section className="sc-seo" aria-label="Texte de l’annonce">
    {title&&<div><h3>Titre SEO</h3><p><strong>{title}</strong></p><button type="button" onClick={()=>copy(title,'Titre copié.')}>Copier le titre</button></div>}
    {description&&<div><h3>Bio</h3><p className="sc-seo-bio">{description}</p><button type="button" onClick={()=>copy(description,'Bio et hashtags copiés.')}>Copier la bio + 16 hashtags</button></div>}
    <span role="status">{notice}</span>
  </section>
}
