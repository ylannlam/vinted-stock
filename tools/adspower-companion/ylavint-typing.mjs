import {review} from './ylavint-ui.mjs'

export const PUBLICATION_PACE={publication_typing_ms:250,publication_punctuation_ms:600,publication_field_seconds:2,publication_review_seconds:5,publication_corrections:false}
const takeover=()=>Object.assign(review('Le formulaire ou son focus a changé. Tu gardes la main dans l’onglet ouvert.'),{keep_page:true})

// Only a small, ordinary word can receive one transient typo. Numbers, brands,
// sizes and the approved wording are never rewritten by this engine.
export function correctionIndex(value){
 const ordinary=/\b(?:avec|pour|dans|sans|très|jolie|robe|manches|courtes|longues)\b/giu
 const match=ordinary.exec(value)
 return match?match.index+2:-1
}

export async function typePublication(field,value,{pace={},check=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),inspect=async()=>{},corrections=false,onProgress=()=>{}}={}){
 const p={...PUBLICATION_PACE,...pace},text=String(value),typo=corrections&&p.publication_corrections?correctionIndex(text):-1
 let typed='',index=0
 const verify=async()=>{
  check()
  if(await field.inputValue()!==typed||!await field.evaluate(e=>document.activeElement===e&&document.hasFocus()&&(e.selectionStart==null||e.selectionStart===e.value.length&&e.selectionEnd===e.value.length)))throw takeover()
 }
 if(await field.inputValue()!=='')throw Object.assign(review('Un texte est déjà présent. Le brouillon existant est conservé.'),{keep_page:true})
 await field.scrollIntoViewIfNeeded();await field.click();await verify()
 for(const char of text){
  await verify()
  if(index===typo){
   const wrong=char.toLowerCase()==='e'?'r':'e'
   await field.pressSequentially(wrong,{delay:p.publication_typing_ms,timeout:5000});typed+=wrong
   await sleep(p.publication_punctuation_ms);await verify()
   await field.press('Backspace');typed=typed.slice(0,-1);await verify()
  }
  if(char==='\n')await field.press('Shift+Enter')
  else await field.pressSequentially(char,{delay:p.publication_typing_ms,timeout:5000})
  typed+=char;index+=char.length;await verify()
  if(/[.!?;:\n]/.test(char))await sleep(p.publication_punctuation_ms*(char==='\n'?2:1))
  if(index%8===0){await inspect();onProgress(index,text.length)}
 }
 await verify();await inspect();onProgress(text.length,text.length)
 if(typed!==text)throw takeover()
 return text
}
