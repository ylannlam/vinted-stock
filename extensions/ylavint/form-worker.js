// Ouvre le formulaire dans CE profil de navigateur, puis laisse la validation à la personne.
// Les outils de test injectent un faux navigateur ; ce module ne contacte pas Vinted.
export async function openListingForm(task, browser, {now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if(task?.listing?.assisted!==true||task.kind!=='publish_item')throw Error('L’envoi direct est désactivé. Prépare une nouvelle demande de formulaire.')
  if(!Number.isFinite(Date.parse(task.listing.deadline))||Date.parse(task.listing.deadline)<now()+60000)throw Error('Demande trop ancienne. Aucun onglet ouvert.')
  const key='form:'+task.id
  const existing=(await browser.storage.local.get(key))[key]
  if(existing)throw Error('Cette demande a déjà ouvert un formulaire. Vérifie l’onglet existant ; aucun second remplissage.')
  await browser.storage.local.set({[key]:{state:'opening',at:now()}})
  const tab=await browser.tabs.create({url:'https://www.vinted.fr/items/new',active:true})
  await browser.storage.local.set({[key]:{state:'opened',tab_id:tab.id,at:now()}})
  for(let n=0;n<60;n++) {
    const current=await browser.tabs.get(tab.id)
    if(current.status==='complete') {
      const url=new URL(current.url)
      if(url.origin!=='https://www.vinted.fr'||url.pathname!=='/items/new')throw Error('Vinted a redirigé vers une autre page. Termine toi-même la connexion ou la vérification.')
      // Un seul envoi. Une réponse perdue ne déclenche jamais de second ajout des photos.
      return browser.tabs.sendMessage(tab.id,{type:'prepare_listing',task})
    }
    await wait(500)
  }
  throw Error('Le formulaire n’a pas fini de charger. Vérifie l’onglet ouvert.')
}
