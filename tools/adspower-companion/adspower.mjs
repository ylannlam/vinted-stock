export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export class LocalError extends Error{constructor(message,status=400){super(message);this.status=status}}
export const validProfile=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id)
export function debugAddress(value){
  let url;try{url=new URL(value)}catch{throw new LocalError('Le navigateur ne fournit pas de connexion locale valide.')}
  if(url.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.port||url.username||url.password||!/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(url.pathname)||url.search||url.hash)throw new LocalError('Connexion du navigateur refusée : adresse locale attendue.')
  return url.href
}
export class AdsPowerClient{
  constructor({apiKey='',port=50325,fetcher=fetch,wait=delay,interval=1100}={}){
    if(!Number.isInteger(port)||port<1024||port>65535)throw new LocalError('Le port AdsPower doit être compris entre 1024 et 65535.')
    this.key=apiKey;this.base=`http://127.0.0.1:${port}`;this.fetcher=fetcher;this.wait=wait;this.interval=interval;this.next=0;this.gate=Promise.resolve()
  }
  async call(path,body){
    // Gate request starts, not completion: independent profiles can load concurrently.
    const previous=this.gate;let release;this.gate=new Promise(resolve=>{release=resolve})
    await previous;try{await this.wait(Math.max(0,this.next-Date.now()));this.next=Date.now()+this.interval}finally{release()}
    let response
    try{response=await this.fetcher(this.base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.key}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(60000)})}
    catch{throw new LocalError('AdsPower ne répond pas. Vérifie qu’il est ouvert et que son API est activée.',503)}
    const result=await response.json().catch(()=>null)
    if(response.status===429||/too many|frequency|rate limit/i.test(result?.msg||''))throw new LocalError('AdsPower demande une pause. Attends quelques secondes puis réessaie.',429)
    if(!response.ok||result?.code!==0){
      if(/api.?key|unauthori|auth|token/i.test(result?.msg||'')||[401,403].includes(response.status))throw new LocalError('La clé AdsPower est absente ou refusée. Ouvre les réglages du connecteur.',401)
      throw new LocalError('AdsPower a refusé la demande. Vérifie le profil dans AdsPower.',502)
    }
    return result.data||{}
  }
  async profiles(){
    const profiles=[],ids=new Set()
    for(let page=1;page<=100;page++){
      const data=await this.call(`/api/v1/user/list?page=${page}&page_size=100`)
      if(!Array.isArray(data.list))throw new LocalError('La liste des profils AdsPower est illisible.',502)
      for(const p of data.list){
        if(!validProfile(p.user_id)||ids.has(p.user_id))throw new LocalError('La liste AdsPower est incomplète. Actualise-la.',502)
        ids.add(p.user_id);profiles.push({id:p.user_id,number:String(p.serial_number||''),name:String(p.name||'Profil sans nom').slice(0,150),group:String(p.group_name||'Sans groupe').slice(0,100)})
      }
      if(data.list.length<100)return profiles
    }
    throw new LocalError('La liste dépasse 10 000 profils. Réduis les profils accessibles à cette clé.')
  }
  async opened(){const data=await this.call('/api/v1/browser/local-active');return new Set((data.list||[]).map(p=>p.user_id))}
  async start(id){
    if(!validProfile(id))throw new LocalError('Profil invalide.')
    const state=await this.call(`/api/v1/browser/active?user_id=${encodeURIComponent(id)}`)
    if(state.status==='Active')return {address:debugAddress(state.ws?.puppeteer),alreadyOpen:true}
    const data=await this.call('/api/v2/browser-profile/start',{profile_id:id,last_opened_tabs:'1',proxy_detection:'0',headless:'0'})
    return {address:debugAddress(data.ws?.puppeteer),alreadyOpen:false}
  }
}
