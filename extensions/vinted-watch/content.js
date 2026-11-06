// À chaque page Vinted chargée : on lit le bandeau du compte et on transmet au service de l'extension.
(() => {
  const send = () => { try { const r = globalThis.readVintedAccount(); if (r) chrome.runtime.sendMessage({type: 'observation', observation: r}) } catch {} }
  send()
  setTimeout(send, 4000) // le bandeau peut s'afficher après le chargement
})()
