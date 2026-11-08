// Assistance explicite au formulaire. Aucun clic sur Publier / Enregistrer le brouillon,
// aucun appel à l'API de création, aucun contournement d'une restriction.
(() => {
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const jobs = new Set()
  class FormStop extends Error { constructor(code, message) { super(message); this.code = code } }
  async function prepare(task, ui) {
    if (task?.listing?.assisted !== true || !task.id || !task.member_id) throw new FormStop('failed', 'Demande de formulaire invalide.')
    if (jobs.has(task.id)) throw new FormStop('failed', 'Ce formulaire a déjà été traité. Vérifie l’onglet existant.')
    jobs.add(task.id)
    const guard = async () => {
      if (Date.now() > Date.parse(task.listing.deadline) || !Number.isFinite(Date.parse(task.listing.deadline))) throw new FormStop('timeout', 'Demande expirée. Aucun nouvel essai automatique.')
      const who = await ui.identity()
      if (!who || String(who.member_id) !== String(task.member_id)) throw new FormStop('failed', 'Le compte affiché ne correspond pas au compte choisi.')
      if (who.status !== 'ok') throw new FormStop('restricted', 'Le compte Vinted affiche une restriction. Préparation arrêtée.')
      if (await ui.blocked()) throw new FormStop('captcha', 'Vinted demande une vérification ou refuse l’accès. Préparation arrêtée.')
    }
    await guard()
    if (!(await ui.empty())) throw new FormStop('failed', 'Le formulaire contient déjà des informations. Elles sont conservées.')
    const {fields, labels = {}, photos} = task.listing, missing = []
    if (!fields?.title || !Array.isArray(photos) || photos.length < 1 || photos.length > 20) throw new FormStop('failed', 'Fiche ou photos incomplètes.')
    ui.notice('Préparation du formulaire… Vérifie ensuite les informations et publie toi-même.')
    const files = []
    for (let i = 0; i < photos.length; i++) {
      await guard()
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(photos[i].type)) throw new FormStop('failed', 'Format de photo non pris en charge.')
      const file = await ui.photo(photos[i], i)
      if (!file.size || file.size > 8000000) throw new FormStop('failed', 'Photo vide ou trop volumineuse.')
      files.push(file)
    }
    await guard()
    await ui.photos(files) // Le formulaire Vinted gère son propre téléversement.
    const text = [['title', fields.title, 'Titre'], ['description', fields.description, 'Description'], ['price', fields.price, 'Prix']]
    for (const [name, value, label] of text) { await guard(); if (!await ui.text(name, String(value ?? ''))) missing.push(label) }
    const choices = [
      ['category', fields.catalog_id, labels.category_path, 'Catégorie'],
      ['brand', fields.brand_id, fields.brand_title, 'Marque'],
      ['size', fields.size_id, labels.size, 'Taille'],
      ['condition', fields.status_id, labels.condition, 'État'],
      ['color', fields.color_ids, labels.colors, 'Couleurs'],
      ['package', fields.package_size_id, labels.package, 'Colis'],
      ...(labels.attributes || []).map(a => [a.code, a.ids, a.titles, a.title])
    ]
    for (const [index, [name, id, label, title]] of choices.entries()) {
      if (id == null || Array.isArray(id) && !id.length) continue
      await guard()
      if (!await ui.choice(name, id, label)) {
        // Une catégorie ou une liste non résolue peut masquer/changer les champs suivants.
        missing.push(title, ...choices.slice(index + 1).filter(c => c[1] != null && (!Array.isArray(c[1]) || c[1].length)).map(c => c[3]))
        break
      }
    }
    await guard()
    ui.notice(missing.length ? `À compléter : ${missing.join(', ')}. Vérifie aussi les photos, puis publie toi-même.` : 'Formulaire rempli. Vérifie les photos et chaque champ, puis clique toi-même sur Publier ou Enregistrer le brouillon.')
    return {prepared: true, missing, message: missing.length ? `Formulaire ouvert ; à compléter : ${missing.join(', ')}. Aucune publication automatique.` : 'Formulaire rempli ; validation finale à faire sur Vinted. Aucune publication automatique.'}
  }
  globalThis.ylvPrepareForm = prepare
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return
  const visible = e => e && !e.hidden && e.getAttribute('aria-hidden') !== 'true' && (e.getClientRects().length > 0)
  const one = selectors => selectors.map(s => document.querySelector(s)).find(e => e && !e.disabled)
  const ids = {title:['title'],description:['description'],price:['price'],category:['catalog','catalog_id','category'],brand:['brand','brand_id'],size:['size','size_id'],condition:['condition','status','status_id'],color:['color','color_ids'],package:['package_size','package_size_id']}
  const testIds = {title:'title',description:'description',price:'price-input',category:'catalog-select-dropdown',brand:'brand-select-dropdown',color:'color-select-dropdown'}
  function control(name) {
    const names = ids[name] || [name]
    const found = one(names.flatMap(n => [`input[name="${CSS.escape(n)}"]`, `textarea[name="${CSS.escape(n)}"]`, `select[name="${CSS.escape(n)}"]`, `#${CSS.escape(n)}`])) || (testIds[name] && document.querySelector(`[data-testid="${testIds[name]}"]`))
    return found?.matches('input:not([type="hidden"]),textarea,select,[role="combobox"],button[type="button"]') ? found : found?.querySelector('input:not([type="hidden"]),textarea,select,[role="combobox"],button[type="button"]')
  }
  function setValue(e, value) {
    const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, value)
    e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true}))
  }
  function waitFor(read, timeout = 4000) {
    return new Promise((resolve,reject) => {
      let observer, timer
      const check = () => { try { const value = read(); if (value) { observer?.disconnect(); clearTimeout(timer); resolve(value); return true } return false } catch(e) { observer?.disconnect(); clearTimeout(timer); reject(e); return true } }
      if (check()) return
      observer = new MutationObserver(check); observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,characterData:true})
      timer = setTimeout(() => { observer.disconnect(); resolve(null) }, timeout)
    })
  }
  function notice(message) {
    let box = document.getElementById('ylv-form-notice')
    if (!box) { box=document.createElement('aside'); box.id='ylv-form-notice'; box.setAttribute('role','status'); box.style.cssText='position:fixed;bottom:16px;left:16px;max-width:460px;padding:16px;background:white;color:#134e4a;border:2px solid #0f766e;border-radius:12px;z-index:2147483647;font:14px/1.5 sans-serif;box-shadow:0 4px 24px #0003'; document.body.append(box) }
    box.textContent='YlaVint — '+message
  }
  function exactOption(id, label) {
    const candidates=[...document.querySelectorAll('[role="option"],input[type="radio"],input[type="checkbox"]')].filter(e=>visible(e)||e.labels?.length&&[...e.labels].some(visible))
    return candidates.find(e => {
      const labelled=(e.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()
      const text=labelled || e.getAttribute('aria-label') || [...(e.labels||[])].map(l=>l.textContent).join(' ') || e.textContent
      return norm(text)===norm(label) && (e.getAttribute('value')==null || e.value===String(id))
    })
  }
  function selectClick(element) {
    if(element.disabled || element.closest('a[href],[data-testid="upload-form-save-button"],[data-testid="upload-form-save-draft-button"]'))return false
    if(element.tagName==='BUTTON'&&element.getAttribute('type')!=='button')return false
    if(element.tagName==='INPUT'&&['submit','image','button','reset'].includes(element.type))return false
    element.click();return true
  }
  async function choice(name, id, label) {
    if (!label || Array.isArray(label)&&!label.length) return false
    const field=await waitFor(()=>control(name)), values=Array.isArray(id)?id:[id], labels=Array.isArray(label)?label:[label]
    if (field?.tagName==='SELECT') {
      if (values.length>1&&!field.multiple) return false
      const options=values.map((value,i)=>[...field.options].find(o=>o.value===String(value)&&norm(o.textContent)===norm(name==='category'?labels.at(-1)?.title:labels[i])))
      if(options.some(o=>!o))return false
      for(const o of field.options)o.selected=options.includes(o)
      field.dispatchEvent(new Event('change',{bubbles:true})); return true
    }
    if(name==='package') {
      const radio=document.querySelector(`[data-testid="package_type_selector_${Number(id)}"]`)
      if(!radio||!visible(radio))return false
      if(!selectClick(radio))return false
      return !!radio.checked||radio.getAttribute('aria-checked')==='true'
    }
    if (!field || !visible(field)) return false
    if(!selectClick(field))return false
    if(name==='brand') {
      const search=document.querySelector('input[name="brand-search-input"]')
      if(search&&visible(search)&&!search.disabled&&!search.readOnly)setValue(search,String(label))
    }
    if(name==='category') {
      for(const entry of labels) {
        if(!Number.isSafeInteger(entry.id)||!entry.title)return false
        const option=await waitFor(()=>exactOption(entry.id,entry.title))
        if(!option)return false
        if(!option.checked&&option.getAttribute('aria-selected')!=='true'&&!selectClick(option))return false
      }
      return !!await waitFor(()=>norm(field.value||field.textContent)===norm(labels.at(-1)?.title))
    }
    for(let i=0;i<values.length;i++) {
      const option=await waitFor(()=>exactOption(values[i],labels[i]))
      if(!option)return false
      if(option.getAttribute('aria-selected')!=='true'&&!option.checked&&!selectClick(option))return false
    }
    // Aucune fermeture / validation devinée : la sélection doit se refléter dans le champ.
    return !!await waitFor(()=>labels.every(l=>norm(field.value||field.textContent).includes(norm(l))))
  }
  const ui = {
    identity:()=>globalThis.readVintedAccount?.(),
    blocked:()=> location.pathname!=='/items/new' || !!document.querySelector('iframe[src*="captcha"],iframe[src*="challenge"],form[action*="challenge"],[data-testid="item-upload-critical-error-dialog"]'),
    empty:()=> !control('title')?.value && !control('description')?.value && !document.querySelector('[data-testid="media-upload-grid"] img'),
    notice,
    photo:async(photo,index)=>{
      const r=await chrome.runtime.sendMessage({type:'fetch_bytes',url:photo.url})
      if(r?.error||!r?.base64)throw new FormStop('failed',r?.error||'Photo indisponible.')
      const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo.type]
      return new File([Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0))],`photo-${String(index+1).padStart(2,'0')}.${ext}`,{type:photo.type})
    },
    photos:async files=>{
      const input=await waitFor(()=>document.querySelector('input[type="file"][name="photos"]'))
      if(!input||input.disabled||input.files?.length)throw new FormStop('failed','Zone de photos indisponible ou déjà remplie.')
      const transfer=new DataTransfer();for(const file of files)transfer.items.add(file)
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))
      const loaded=await waitFor(()=>{
        if(ui.blocked()||globalThis.readVintedAccount?.()?.status!=='ok')throw new FormStop('restricted','Vinted affiche un blocage pendant l’ajout des photos. Préparation arrêtée.')
        const grid=document.querySelector('[data-testid="media-upload-grid"]')
        if(document.querySelector('[data-testid="item-upload-error-dialog"]'))throw new FormStop('failed','Vinted signale une erreur. Vérifie les photos dans l’onglet ouvert.')
        return grid&&grid.querySelectorAll('img').length===files.length&&!grid.querySelector('[role="progressbar"],[aria-busy="true"]')
      },90000)
      if(!loaded)throw new FormStop('timeout','Les photos ne sont pas toutes visibles. Vérifie l’onglet ; aucun nouvel ajout automatique.')
    },
    text:async(name,value)=>{const field=await waitFor(()=>control(name));if(!field||field.readOnly||field.disabled)return false;setValue(field,value);return field.value===value},
    choice
  }
  if(globalThis.__YLAVINT_FORM_TEST__)globalThis.ylvFormTest={ui,control,choice,setValue}
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
    if(msg?.type!=='prepare_listing')return
    if(window.top!==window||location.origin!=='https://www.vinted.fr')return
    prepare(msg.task,ui).then(result=>reply({ok:true,result}),e=>{notice(e.message);reply({ok:false,code:e.code||'failed',error:e.message})})
    return true
  })
})()
