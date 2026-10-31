// This script runs only on the Stock Vinted origin, in Chrome's isolated world.
(() => {
  const origin='https://vinted-stock.vercel.app'
  const commands=new Set(['status','connect','start','pause','resume','open'])
  if(location.origin!==origin||window.top!==window)return
  window.addEventListener('message',async event=>{
    const m=event.data
    if(event.source!==window||event.origin!==origin||m?.channel!=='stock-vinted-request'||!commands.has(m.action)
      ||typeof m.id!=='string'||m.id.length>80)return
    const message={action:m.action,fromSite:true}
    if(m.action==='connect') {
      if(typeof m.token!=='string'||m.token.length>120)return
      message.token=m.token
    }
    let reply
    try{reply=await chrome.runtime.sendMessage(message)}catch{reply={ok:false,error:'Recharge la page du catalogue pour reconnecter l’extension.'}}
    window.postMessage({channel:'stock-vinted-response',id:m.id,...reply},origin)
  })
})()
