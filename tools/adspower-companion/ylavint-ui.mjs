// All writes use the visible Vinted form. No API-send fallback after a UI failure.
const ID=/^(?:[1-9]\d{0,17}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i
export const review=message=>Object.assign(Error(message),{code:'desktop_review',status:409})
export function conversationUrl(id){if(!ID.test(String(id)))throw review('Conversation inconnue.');return 'https://www.vinted.fr/inbox/'+id}
export function matchingReply(request,conversation,body){
  try{
    const u=new URL(request.url()),allowed=(u.origin==='https://www.vinted.fr'&&u.pathname===`/api/v2/conversations/${conversation}/replies`)||(u.origin==='https://api.vinted.fr'&&u.pathname===`/messaging/main/conversations/${conversation}/replies`)
    if(!allowed||request.method()!=='POST')return false
    const p=request.postDataJSON(),text=p?.content??p?.reply?.body??p?.reply?.content??p?.body
    return text===body
  }catch{return false}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function unique(locator,label){await locator.first().waitFor({state:'visible',timeout:15000});if(await locator.count()!==1)throw review(`${label} ambigu : vérifie la conversation.`);return locator}

export class VintedMessenger{
  constructor({page,identity,member,journal,task,check,update,recheck,sleep=pause}){Object.assign(this,{page,identity,member,journal,task,check,update,recheck,sleep});this.opened=null}
  async guard(){
    this.check()
    const who=await this.identity(this.page)
    if(String(who?.member_id)!==this.member||who?.status!=='ok')throw review('Le compte Vinted a changé ou demande une vérification.')
    this.check()
  }
  async open(conversation){
    const url=conversationUrl(conversation)
    if(this.page.url()!==url)await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})
    await this.guard()
    if(new URL(this.page.url()).pathname!==new URL(url).pathname)throw review('La conversation attendue ne s’est pas ouverte.')
    await this.page.bringToFront()
    await this.sleep(1200)
  }
  async type(locator,value){
    if((await locator.inputValue()).trim())throw review('Un brouillon est déjà saisi : traite-le avant de relancer.')
    // Fixed readable cadence, punctuation pauses; never insert typos or conceal automation.
    for(const part of value.match(/[^.!?\n]+[.!?\n]*|[.!?\n]+/g)||[]){
      this.check()
      const lines=part.split('\n')
      for(let i=0;i<lines.length;i++){if(i)await locator.press('Shift+Enter');await locator.pressSequentially(lines[i],{delay:45,timeout:45000})}
      if(/[.!?\n]$/.test(part))await this.sleep(250)
    }
    if(await locator.inputValue()!==value)throw review('Le texte saisi a changé. Vérifie le brouillon avant l’envoi.')
  }
  async send({task_id,conversation_id,body}){
    const expected=this.task.payload.message??this.task.payload.body
    if(task_id!==this.task.id||typeof body!=='string'||body!==expected||body.length>2500)throw review('Message différent de celui prévu.')
    if(this.task.payload.conversation_id&&String(this.task.payload.conversation_id)!==conversation_id)throw review('Conversation différente de celle prévue.')
    await this.open(conversation_id)
    const first=await this.recheck(conversation_id)
    if(first.cancelled)return {desktop_cancelled:first.cancelled}
    this.update({message:'Saisie du message dans Vinted'})
    const editor=await unique(this.page.locator('textarea[data-testid="composer-input"]:visible'),'Champ de message')
    await this.type(editor,body)
    await this.guard()
    const current=await this.recheck(conversation_id)
    if(current.cancelled){if(await editor.inputValue()===body)await editor.fill('');return {desktop_cancelled:current.cancelled}}
    // Observed on the current Vinted composer: the arrow has no accessible name.
    const send=await unique(this.page.locator('[data-testid="composer"] button[type="button"]:visible'),'Bouton Envoyer')
    await this.journal.step(task_id,'message','submitting')
    this.check()
    const response=this.page.waitForResponse(r=>matchingReply(r.request(),conversation_id,body),{timeout:20000}).catch(()=>null)
    await send.click({timeout:5000})
    const received=await response
    if(!received?.ok())throw review('Envoi non confirmé par Vinted : vérifie la conversation avant de reprendre.')
    const data=await received.json().catch(()=>null),message=data?.reply||data?.message||data?.data||data
    if(!message?.id)throw review('Vinted n’a pas confirmé l’identifiant du message. Vérifie la conversation.')
    await this.journal.step(task_id,'message','confirmed')
    this.messageConfirmed=true
    return {reply:{id:String(message.id)}}
  }
  async offer({task_id,conversation_id,price}){
    if(task_id!==this.task.id||price!==this.task.payload.offer_price||!Number.isFinite(price)||price<1)throw review('Réduction différente de celle prévue.')
    await this.open(conversation_id)
    const first=await this.recheck(conversation_id,{afterMessage:this.messageConfirmed===true})
    if(first.cancelled)return {desktop_cancelled:first.cancelled,message_confirmed:this.messageConfirmed===true}
    this.update({message:'Préparation de la réduction dans Vinted'})
    await (await unique(this.page.getByRole('button',{name:/^(Faire une offre|Make an offer)$/i}).filter({visible:true}),'Bouton de réduction')).click()
    const dialog=await unique(this.page.locator('[data-testid="offer-modal"][role="dialog"]:visible'),'Fenêtre de réduction')
    const priceField=await unique(dialog.locator('input[data-testid="offer-price-field--input"]:visible'),'Prix de l’offre')
    if((await priceField.inputValue()).trim())throw review('Un prix est déjà saisi : vérifie cette offre à la main.')
    await priceField.pressSequentially(price.toFixed(2),{delay:100})
    if(Number((await priceField.inputValue()).replace(',','.'))!==price)throw review('Le montant de l’offre ne correspond pas au réglage.')
    const submit=await unique(dialog.locator('button[data-testid="offer-submit-button"]'),'Validation de l’offre')
    await this.guard()
    const current=await this.recheck(conversation_id,{afterMessage:this.messageConfirmed===true})
    if(current.cancelled){
      if(Number((await priceField.inputValue()).replace(',','.'))===price)await priceField.fill('')
      await priceField.press('Escape')
      return {desktop_cancelled:current.cancelled,message_confirmed:this.messageConfirmed===true}
    }
    await this.journal.step(task_id,'offer','submitting')
    this.check()
    // Accept only the existing, known offer endpoint and the exact amount submitted by this form.
    const response=this.page.waitForResponse(r=>{
      try{const q=r.request(),u=new URL(q.url()),p=q.postDataJSON();return q.method()==='POST'&&u.origin==='https://www.vinted.fr'&&/^\/api\/v2\/transactions\/\d+\/offers$/.test(u.pathname)&&Number(p?.offer?.price?.amount??p?.offer?.price??p?.price?.amount??p?.price)===price}catch{return false}
    },{timeout:20000}).catch(()=>null)
    await submit.click({timeout:5000})
    const received=await response
    if(!received?.ok())throw review('Réduction non confirmée : vérifie Vinted. Le message ne sera pas renvoyé automatiquement.')
    const data=await received.json().catch(()=>null)
    if(!data||data.code&&data.code!==0)throw review('La réduction n’a pas été confirmée par Vinted.')
    await this.journal.step(task_id,'offer','confirmed')
    return true
  }
}
