export async function copyText(value){
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
