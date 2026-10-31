// Only UI status crosses back from the extension; never its token or job lease.
export function collectorBridge(action='status',payload={},host=window) {
  return new Promise((resolve,reject)=>{
    const id=host.crypto.randomUUID(),origin=host.location.origin
    const finish=(error,state)=>{host.clearTimeout(timer);host.removeEventListener('message',receive);error?reject(error):resolve(state)}
    const receive=event=>{
      if(event.source!==host||event.origin!==origin||event.data?.channel!=='stock-vinted-response'||event.data.id!==id)return
      event.data.ok?finish(null,event.data.state):finish(Error(event.data.error||'Connexion au navigateur indisponible.'))
    }
    const timer=host.setTimeout(()=>finish(Error('Extension non détectée dans ce navigateur.')),action==='status'?1200:30000)
    host.addEventListener('message',receive)
    host.postMessage({channel:'stock-vinted-request',id,action,...(action==='connect'?{token:payload.token}:{})},origin)
  })
}
