// All writes use the visible Vinted form. No API-send fallback after a UI failure.
const ID=/^(?:[1-9]\d{0,17}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i
export const review=message=>Object.assign(Error(message),{code:'desktop_review',status:409})
export function conversationUrl(id){if(!ID.test(String(id)))throw review('Conversation inconnue.');return 'https://www.vinted.fr/inbox/'+id}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function unique(locator,label){await locator.first().waitFor({state:'visible',timeout:15000});if(await locator.count()!==1)throw review(`${label} ambigu : vérifie la conversation.`);return locator}

export class VintedMessenger{
  constructor({page,identity,member,journal,task,check,update,recheck,authorize,thread,confirm,pace={typing_delay_ms:70,page_wait_seconds:3},sleep=pause}){Object.assign(this,{page,identity,member,journal,task,check,update,recheck,authorize,thread,confirm,pace,sleep});this.opened=null}
  async guard(){
    this.check()
    const who=await this.identity(this.page)
    if(String(who?.member_id)!==this.member||who?.status!=='ok')throw review('Le compte Vinted a changé ou demande une vérification.')
    this.check()
  }
  async open(conversation){
    const url=conversationUrl(conversation)
    if(new URL(this.page.url()).pathname!==new URL(url).pathname)await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})
    await this.guard()
    if(new URL(this.page.url()).pathname!==new URL(url).pathname)throw review('La conversation attendue ne s’est pas ouverte.')
    await this.page.bringToFront()
    await this.sleep(this.pace.page_wait_seconds*1000)
  }
  async type(locator,value,inspect=async()=>null){
    if((await locator.inputValue()).trim())throw review('Un brouillon est déjà saisi : traite-le avant de relancer.')
    let typed=''
    // Fixed readable cadence, punctuation pauses; never insert typos or conceal automation.
    for(const part of value.match(/[^.!?\n]+[.!?\n]*|[.!?\n]+/g)||[]){
      this.check()
      const lines=part.split('\n')
      for(let i=0;i<lines.length;i++){
        if(i){await locator.press('Shift+Enter');typed+='\n'}
        for(let start=0;start<lines[i].length;start+=12){
          this.check()
          if(await locator.inputValue()!==typed)throw Object.assign(review('Le brouillon a été modifié : tu gardes la main.'),{keep_page:true})
          if(typed&&locator.evaluate&&!await locator.evaluate(e=>document.activeElement===e&&document.hasFocus()))throw Object.assign(review('La fenêtre ou le champ a perdu le focus. Reprends la main puis relance si nécessaire.'),{keep_page:true})
          const chunk=lines[i].slice(start,start+12)
          await locator.pressSequentially(chunk,{delay:this.pace.typing_delay_ms,timeout:15000});typed+=chunk
          const current=await inspect()
          if(current?.cancelled){if(await locator.inputValue()===typed)await locator.fill('');return current}
        }
      }
      if(/[.!?\n]$/.test(part))await this.sleep(250)
    }
    if(await locator.inputValue()!==value)throw Object.assign(review('Le texte saisi a changé. Vérifie le brouillon avant l’envoi.'),{keep_page:true})
    return null
  }
  async send({task_id,conversation_id,body}){
    const expected=this.task.payload.message??this.task.payload.body
    if(task_id!==this.task.id||typeof body!=='string'||body!==expected||body.length>2500)throw review('Message différent de celui prévu.')
    if(this.task.payload.conversation_id&&String(this.task.payload.conversation_id)!==conversation_id)throw review('Conversation différente de celle prévue.')
    await this.open(conversation_id)
    const first=await this.recheck(conversation_id)
    if(first.cancelled)return {...first,desktop_cancelled:first.cancelled}
    this.update({state:'typing',message:'Saisie du message dans Vinted · conversation surveillée'})
    const editor=await unique(this.page.locator('textarea[data-testid="composer-input"]:visible'),'Champ de message')
    const interrupted=await this.type(editor,body,()=>this.recheck(conversation_id))
    if(interrupted)return {...interrupted,desktop_cancelled:interrupted.cancelled}
    await this.guard()
    const current=await this.recheck(conversation_id)
    if(current.cancelled){if(await editor.inputValue()===body)await editor.fill('');return {...current,desktop_cancelled:current.cancelled}}
    // Observed on the current Vinted composer: the arrow has no accessible name.
    const send=await unique(this.page.locator('[data-testid="composer"] button[type="button"]:visible'),'Bouton Envoyer')
    await this.authorize()
    const final=await this.recheck(conversation_id)
    if(final.cancelled){if(await editor.inputValue()===body)await editor.fill('');return {...final,desktop_cancelled:final.cancelled}}
    await this.journal.step(task_id,'message','submitting')
    this.check()
    const before=(await this.thread()).messages
    await send.click({timeout:5000})
    const message=await this.confirm({kind:'message',body,before})
    if(!message?.id)throw review('Envoi non confirmé dans la conversation visible : vérifie Vinted.')
    await this.journal.step(task_id,'message','confirmed')
    this.messageConfirmed=true
    return {reply:{id:String(message.id)}}
  }
  async offer({task_id,conversation_id,price}){
    if(task_id!==this.task.id||price!==this.task.payload.offer_price||!Number.isFinite(price)||price<1)throw review('Réduction différente de celle prévue.')
    await this.open(conversation_id)
    const first=await this.recheck(conversation_id,{afterMessage:this.messageConfirmed===true})
    if(first.cancelled)return {desktop_cancelled:first.cancelled,message_confirmed:this.messageConfirmed===true}
    this.update({state:'preparing',message:'Préparation de la réduction dans Vinted'})
    await (await unique(this.page.getByRole('button',{name:/^(Faire une offre|Make an offer)$/i}).filter({visible:true}),'Bouton de réduction')).click()
    const dialog=await unique(this.page.locator('[data-testid="offer-modal"][role="dialog"]:visible'),'Fenêtre de réduction')
    const priceField=await unique(dialog.locator('input[data-testid="offer-price-field--input"]:visible'),'Prix de l’offre')
    if((await priceField.inputValue()).trim())throw review('Un prix est déjà saisi : vérifie cette offre à la main.')
    await priceField.pressSequentially(price.toFixed(2),{delay:this.pace.typing_delay_ms})
    if(Number((await priceField.inputValue()).replace(',','.'))!==price)throw review('Le montant de l’offre ne correspond pas au réglage.')
    const submit=await unique(dialog.locator('button[data-testid="offer-submit-button"]'),'Validation de l’offre')
    await this.guard()
    const current=await this.recheck(conversation_id,{afterMessage:this.messageConfirmed===true})
    if(current.cancelled){
      if(Number((await priceField.inputValue()).replace(',','.'))===price)await priceField.fill('')
      await priceField.press('Escape')
      return {desktop_cancelled:current.cancelled,message_confirmed:this.messageConfirmed===true}
    }
    await this.authorize()
    const final=await this.recheck(conversation_id,{afterMessage:this.messageConfirmed===true})
    if(final.cancelled){
      if(Number((await priceField.inputValue()).replace(',','.'))===price)await priceField.fill('')
      await priceField.press('Escape')
      return {desktop_cancelled:final.cancelled,message_confirmed:this.messageConfirmed===true}
    }
    await this.journal.step(task_id,'offer','submitting')
    this.check()
    const before=(await this.thread()).messages
    await submit.click({timeout:5000})
    if(!await this.confirm({kind:'offer',price,before}))throw review('Réduction non confirmée dans la conversation visible : vérifie Vinted.')
    await this.journal.step(task_id,'offer','confirmed')
    return true
  }
}
