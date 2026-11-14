import {BASE,cid} from './ylavint-visible.mjs'
import {review,conversationUrl} from './ylavint-ui.mjs'
import {VisibleCommerce,readOrderDetail,readExtensionState} from './ylavint-commerce.mjs'
import {typePublication} from './ylavint-typing.mjs'

// Only a native Vinted form with explicit day choices can authorize submission.
export function extensionForm(){
 const shown=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'
 const text=e=>e?.innerText?.trim()||''
 const matches=selector=>[...document.querySelectorAll(selector)].filter(e=>shown(e)&&/Prolonger le délai d.envoi/i.test(text(e)))
 const dialogs=matches('[role="dialog"],dialog'),container=dialogs.length?'dialog':'form'
 const containers=dialogs.length?dialogs:matches('form')
 const root=containers.length===1?containers[0]:null
 if(!root)return {recognized:false}
 const label=e=>e.getAttribute('aria-label')||e.labels?.[0]?.innerText?.trim()||text(e.closest('label'))||text(e)
 const radios=[...root.querySelectorAll('input[type="radio"],[role="radio"]')].map(e=>({name:label(e),selected:e.checked===true||e.getAttribute('aria-checked')==='true',visible:shown(e)||shown(e.closest('label'))})).filter(e=>e.visible)
 const selectors=[...root.querySelectorAll('select')].filter(shown).flatMap(e=>[...e.options].map(o=>({name:o.label,selected:o.selected,select:true})))
 const buttons=[...root.querySelectorAll('button,[role="button"]')].filter(shown).map(e=>({name:label(e),enabled:!e.disabled&&e.getAttribute('aria-disabled')!=='true'}))
 const fields=[...root.querySelectorAll('textarea,input:not([type]),input[type="text"]')].filter(shown).map(e=>({name:label(e),placeholder:e.getAttribute('placeholder')||'',value:e.value}))
 return {recognized:true,container,choices:[...radios,...selectors],buttons,fields}
}
const daysOf=v=>String(v).match(/^\s*\+?\s*([35])\s+jours? ouvr[ée]s?(?:\s|$)/i)?.[1]
export function validateExtensionForm(form,days,reason='',requireSelection=false){
 if(!form.recognized)throw review('Le formulaire de prolongation n’est pas reconnu. Vérifie-le dans Vinted.')
 const choice=form.choices.filter(c=>Number(daysOf(c.name))===days)
 const submit=form.buttons.filter(c=>/^Envoyer la demande$/i.test(c.name))
 if(choice.length!==1||submit.length!==1||requireSelection&&(!choice[0].selected||!submit[0].enabled))throw review('Les jours ouvrés ou le bouton de demande ne sont pas confirmés.')
 if(form.fields.length>1||reason&&form.fields.length!==1||requireSelection&&form.fields.some(f=>f.value!==reason))throw review('Le motif de prolongation n’est pas confirmé. Le formulaire est conservé.')
 return choice[0]
}
export async function requestVisibleExtension({reader,authorize,journal,task},payload){
 const id=cid(payload.conversation_id),days=payload.days,reason=String(payload.reason||'')
 if(!id||payload.desktop_order!==true||![3,5].includes(days)||reason.length>200)throw review('Demande de prolongation invalide.')
 const page=reader.page,commerce=new VisibleCommerce({reader,authorize})
 await authorize();await reader.open(conversationUrl(id));await reader.identity()
 const thread=await reader.thread();if(!payload.item_id||thread.item?.id!==String(payload.item_id))throw review('L’article de cette vente n’est pas confirmé.')
 let snapshot=await commerce.snapshot(),detail=readOrderDetail(snapshot,{conversation_id:id,title:payload.title,status:'À expédier'})
 if(['pending','accepted','declined'].includes(detail.extension_state))return {skipped:'Cette vente a déjà une demande de prolongation.',extension_state:detail.extension_state,conversation_id:id}
 if(!snapshot.system.some(b=>/article à emballer|envoyer la commande|jours? restants? pour envoyer le colis|paiement.*validé/i.test(b.text)))throw review('La vente à expédier n’est pas confirmée par Vinted.')
 const matches=()=>snapshot.controls.filter(c=>/^Prolonger le délai d[’']envoi$/i.test(c.text)&&c.enabled)
 if(matches().length!==1){
  const details=snapshot.links.filter(l=>{try{const u=new URL(l.href);return u.origin===BASE&&u.pathname===`/inbox/${id}/details`}catch{return false}})
  if(details.length!==1)return {skipped:'Le lien des détails de la vente n’est pas identifiable.',extension_state:'unavailable',conversation_id:id}
  await reader.clickLink(details[0].href);await reader.settle();snapshot=await commerce.snapshot()
 }
 if(matches().length!==1)return {skipped:'Vinted ne propose pas de prolongation pour cette vente.',extension_state:'unavailable',conversation_id:id}
 await authorize();await page.getByRole('button',{name:matches()[0].text,exact:true}).or(page.getByRole('link',{name:matches()[0].text,exact:true})).click();await reader.settle()
 let form=await page.evaluate(extensionForm),choice=validateExtensionForm(form,days,reason)
 const root=page.locator(form.container==='dialog'?'[role="dialog"]:visible,dialog:visible':'form:visible').filter({hasText:/Prolonger le délai d.envoi/i})
 if(await root.count()!==1)throw review('Plusieurs formulaires sont ouverts. Vérifie Vinted.')
 if(choice.select){const select=root.locator('select');if(await select.count()!==1)throw review('Choix des jours ambigu.');await select.selectOption({label:choice.name})}
 else await root.getByRole('radio',{name:choice.name,exact:true}).check()
 if(reason){const field=root.getByRole('textbox');if(await field.count()!==1)throw review('Le champ du motif est ambigu.');await typePublication(field,reason,{pace:reader.pace,check:()=>reader.check(),sleep:ms=>reader.sleep(ms)})}
 reader.update({state:'reading',message:`Relecture de la demande de ${days} jours ouvrés`})
 await reader.sleep(reader.pace.publication_review_seconds*1000)
 await reader.identity();await authorize();form=await page.evaluate(extensionForm);validateExtensionForm(form,days,reason,true)
 if(cid(new URL(page.url()).pathname.split('/')[2])!==id)throw review('La conversation a changé.')
 const saved=await journal.read(task.id);if(saved?.steps?.extension)throw review('Cette demande a déjà été tentée. Vérifie Vinted avant de continuer.')
 await journal.step(task.id,'extension','submitting')
 try{
  await root.getByRole('button',{name:'Envoyer la demande',exact:true}).click()
  for(let i=0;i<12;i++){await reader.sleep(1000);snapshot=await commerce.snapshot();if(snapshot.conversation&&cid(new URL(snapshot.url).pathname.split('/')[2])===id&&readExtensionState(snapshot)==='pending'){
    await journal.step(task.id,'extension','confirmed');return {requested:true,conversation_id:id,days,extension_state:'pending'}
  }}
  throw review('La demande a été cliquée mais son résultat n’est pas confirmé. Vérifie Vinted : aucun nouvel envoi automatique.')
 }catch(e){e.keep_page=true;throw e}
}
