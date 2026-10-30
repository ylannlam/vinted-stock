let draft
const read = document.getElementById('read'), send = document.getElementById('send'), status = document.getElementById('status')
read.addEventListener('click', async () => {
  read.disabled = true; status.textContent = ''; draft = null
  document.getElementById('preview').hidden = true
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!/^https:\/\/(fr|www)\.shein\.com\//.test(tab?.url || '')) throw Error('Ouvrez d’abord une fiche produit Shein dans cet onglet.')
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extractor.js'] })
    if (!result?.result?.supplier_url || result.error) throw Error('Fiche inaccessible. Terminez la vérification Shein et réessayez depuis un produit.')
    draft = { ...result.result, capture_id: crypto.randomUUID() }
    document.getElementById('title').textContent = draft.title || 'Nom à compléter dans le catalogue'
    document.getElementById('price').textContent = draft.price ? `Prix à vérifier : ${draft.price} €` : 'Prix non lisible : vous pourrez le renseigner.'
    document.getElementById('preview').hidden = false
  } catch (error) { status.textContent = error.message || 'Impossible de lire cette page.' }
  finally { read.disabled = false }
})
send.addEventListener('click', async () => {
  if (!draft) return
  send.disabled = true
  try {
    const fragment = encodeURIComponent(JSON.stringify(draft))
    if (fragment.length > 24000) throw Error('Fiche trop volumineuse. Utilisez le formulaire manuel du catalogue.')
    await chrome.tabs.create({ url: `https://vinted-stock.vercel.app/#shein-import=${fragment}` })
    window.close()
  } catch (error) { status.textContent = error.message; send.disabled = false }
})
