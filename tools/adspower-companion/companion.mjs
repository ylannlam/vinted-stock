import {createServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {AdsPowerClient,LocalError} from './adspower.mjs'
import {readConfig,saveConfig} from './storage.mjs'
import {LaunchQueue,pendingStates} from './queue.mjs'
import {startDotb} from './dotb.mjs'
import {RuntimeMonitor} from './monitor.mjs'
import {createProfile,replaceFingerprint,profileProxies} from './factory.mjs'
import {createFactoryJournal} from './factory-journal.mjs'
import {verifyTicket as verifyRemoteTicket,createTicketVerifier} from './authorization.mjs'

export const VERSION='1.1.2',PORT=17442,SITE='https://vinted-stock.vercel.app',LOCAL=`http://127.0.0.1:${PORT}`
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const html=(token,{configured=false,message='',port=50325}={})=>`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion AdsPower · Stock Vinted</title><style>body{background:#f4f7f6;color:#173e35;font:16px system-ui;margin:0;padding:32px 16px}main{max-width:560px;margin:5vh auto;background:white;border:1px solid #dde7e2;border-radius:24px;padding:32px}p{line-height:1.6;color:#52675f}label{display:block;margin:20px 0 8px;font-weight:600}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #bacdc3;border-radius:10px;font:inherit}button,a{display:inline-block;padding:14px 20px;border:0;border-radius:10px;background:#087f6b;color:white;font:600 15px system-ui;text-decoration:none;margin-top:20px}small{display:block;color:#64756d;margin-top:12px}.notice{background:#e9f6ef;padding:15px;border-radius:12px}</style><main><small>STOCK VINTED · CONNEXION SUR CE PC</small><h1>AdsPower, prêt en un clic.</h1>${message?`<p role="status" class="notice">${escape(message)}</p>`:''}<p>${configured?'Une clé est déjà enregistrée sur ce PC. Tu peux la remplacer ci-dessous.':'Dans AdsPower, ouvre <strong>Automatisation → API</strong>, puis copie ta clé existante ici.'}</p><form method="post" action="/setup" autocomplete="off"><input type="hidden" name="csrf" value="${token}"><label for="key">Clé API AdsPower</label><input type="password" id="key" name="apiKey" required minlength="8" maxlength="512" autocomplete="off"><details><summary>Port de connexion</summary><label for="port">Port indiqué dans AdsPower</label><input type="number" id="port" name="port" value="${port}" min="1024" max="65535" required></details><button>Vérifier et enregistrer sur ce PC</button></form><small>La clé reste sur ce PC. Sous Windows, elle est protégée avec ton compte Windows. Cette étape n’ouvre aucun profil.</small>${configured?`<a href="${SITE}/#adspower">Revenir à mon site →</a>`:''}</main></html>`
async function body(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>16000)throw new LocalError('Demande trop volumineuse.',413);parts.push(part)}return Buffer.concat(parts).toString('utf8')}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}
export async function verifyTicket(ticket,fetcher=fetch){
  return verifyRemoteTicket(ticket,{site:SITE,fetcher})
}
export async function createCompanion({dataDir,verify=verifyTicket,clientFactory=c=>new AdsPowerClient(c),runner=startDotb,load=readConfig,save=saveConfig,monitorOptions={}}={}){
  let config=await load(dataDir).catch(()=>null),ads=config?clientFactory(config):null,profiles=[],listAt=0,loadingList=null,settingUp=false
  const authorize=createTicketVerifier(verify),csrf=new Map()
  const queue=new LaunchQueue({run:(profile,update)=>runner(profile,update,ads)})
  const monitor=new RuntimeMonitor({...monitorOptions,getClient:()=>ads})
  // Profile creation and fingerprint changes run one at a time; a replayed request id
  // (network retry from the site) returns the first result instead of creating twice.
  let factoryBusy=false;const journal=await createFactoryJournal(dataDir)
  async function factory(requestId,operation,work){
    if(typeof requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(requestId))throw new LocalError('Demande invalide. Actualise la page.')
    if(!ads)throw new LocalError('Ajoute ta clé AdsPower dans les réglages du connecteur.',409)
    if(settingUp)throw new LocalError('La connexion est en cours de modification.',409)
    if(factoryBusy)throw new LocalError('Une autre opération AdsPower est en cours. Attends qu’elle se termine.',409)
    factoryBusy=true
    try{const result=await journal(requestId,{connection:config,operation},work);listAt=0;return result}
    finally{factoryBusy=false}
  }
  async function refresh(){
    if(!ads)throw new LocalError('Ajoute ta clé AdsPower dans les réglages du connecteur.',409)
    if(!loadingList)loadingList=(async()=>{const rows=await ads.profiles(),open=await ads.opened();profiles=rows.map(p=>({...p,opened:open.has(p.id)}));listAt=Date.now();return profiles})().finally(()=>{loadingList=null})
    return loadingList
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer')
    try{
      const address=server.address(),local=`http://127.0.0.1:${address.port}`
      if(req.headers.host!==`127.0.0.1:${address.port}`)throw new LocalError('Adresse locale invalide.',403)
      const url=new URL(req.url,local),origin=req.headers.origin
      if(url.pathname==='/setup'){
        res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        let message=url.searchParams.get('saved')==='1'?'Connexion enregistrée. Reviens sur le site et actualise la liste des profils.':''
        if(req.method==='POST'){
          if(origin!==local||!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))throw new LocalError('Ouvre les réglages depuis ce PC.',403)
          const form=new URLSearchParams(await body(req)),token=form.get('csrf'),expires=csrf.get(token);csrf.delete(token)
          if(!expires||expires<Date.now())throw new LocalError('Ce formulaire a expiré. Recharge les réglages.',403)
          if(settingUp||factoryBusy||queue.running||queue.jobs.some(j=>j.state==='queued'))throw new LocalError('Attends la fin des démarrages avant de changer la connexion.',409)
          const apiKey=form.get('apiKey')?.trim(),port=Number(form.get('port'))
          if(!apiKey||apiKey.length<8||apiKey.length>512||/[\r\n\x00-\x1f]/.test(apiKey))throw new LocalError('Clé invalide. Recopie la clé API AdsPower.')
          settingUp=true
          try{const candidate=clientFactory({apiKey,port});await candidate.call('/api/v1/user/list?page=1&page_size=1');await save(dataDir,{apiKey,port});config={apiKey,port};ads=candidate;profiles=[];listAt=0}finally{settingUp=false}
          res.writeHead(303,{Location:'/setup?saved=1'});res.end();return
        }
        if(req.method!=='GET')throw new LocalError('Méthode non autorisée.',405)
        const token=randomBytes(24).toString('base64url');csrf.set(token,Date.now()+1200000);if(csrf.size>8)csrf.delete(csrf.keys().next().value)
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html(token,{configured:!!config,message,port:config?.port||50325}));return
      }
      if(origin!==SITE)throw new LocalError('Ouvre cet onglet depuis Stock Vinted.',403)
      res.setHeader('Access-Control-Allow-Origin',SITE);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Private-Network','true')
      if(req.method==='OPTIONS'){
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.writeHead(204);res.end();return
      }
      const ticket=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      await authorize(ticket)
      if(req.method==='GET'&&url.pathname==='/state'){
        void monitor.refresh(profiles,queue.snapshot())
        json(res,200,{version:VERSION,factory:true,configured:!!config,jobs:queue.snapshot(),list_at:listAt,...monitor.snapshot()});return
      }
      if(req.method==='GET'&&url.pathname==='/profiles'){json(res,200,{profiles:await refresh()});return}
      if(req.method==='GET'&&url.pathname==='/profiles/proxies'){
        if(!ads)throw new LocalError('Ajoute ta clé AdsPower dans les réglages du connecteur.',409)
        json(res,200,{profiles:await profileProxies(ads)});return
      }
      if(req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))throw new LocalError('Format de demande invalide.',415)
        let input;try{input=JSON.parse(await body(req))}catch{throw new LocalError('Demande invalide.')}
        if(url.pathname==='/launch'){
          if(settingUp)throw new LocalError('La connexion est en cours de modification.',409)
          if(factoryBusy)throw new LocalError('Un profil est en cours de création ou de modification. Réessaie dans quelques secondes.',409)
          if(!listAt||Date.now()-listAt>60000)await refresh()
          const ids=queue.launch(input,profiles);json(res,202,{ids,jobs:queue.snapshot()});return
        }
        if(url.pathname==='/cancel'){json(res,200,{jobs:queue.cancel()});return}
        if(url.pathname==='/profiles/create'){
          json(res,201,{profile:await factory(input?.requestId,{route:url.pathname,input},async dispatch=>{
            const proxy=input?.proxy
            const used=(await profileProxies(ads)).find(p=>p.proxy&&p.proxy.host===String(proxy?.host).trim().toLowerCase()&&p.proxy.port===Number(proxy?.port)&&p.proxy.user===proxy?.user)
            if(used)throw new LocalError(`Ce proxy est déjà utilisé par le profil #${used.number}. Relie le profil existant au compte dans sa fiche.`,409)
            return createProfile(ads,input,{dispatch})
          })});return
        }
        if(url.pathname==='/profiles/fingerprint'){
          const id=input?.id
          const profile=await factory(input?.requestId,{route:url.pathname,input},async dispatch=>{
            if(!(await refresh()).some(p=>p.id===id))throw new LocalError('Ce profil n’existe plus dans AdsPower. Actualise la liste.',409)
            if(queue.jobs.some(j=>j.profile.id===id&&pendingStates.has(j.state)))throw new LocalError('Ce profil est en cours de lancement. Attends la fin avant de changer son empreinte.',409)
            if((await ads.opened()).has(id))throw new LocalError('Ferme ce profil dans AdsPower avant de changer son empreinte.',409)
            return replaceFingerprint(ads,id,{dispatch})
          })
          json(res,200,{profile});return
        }
      }
      throw new LocalError('Commande inconnue.',404)
    }catch(error){json(res,error.status||500,{error:error.status?error.message:'La connexion locale a été interrompue. Relance le connecteur.',...(error.code?{code:error.code}:{})})}
  })
  server.headersTimeout=15000;server.requestTimeout=20000
  return {server,queue}
}
async function main(){
  const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'.data')
  const {server}=await createCompanion({dataDir:dir})
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Le connecteur est déjà ouvert. Reviens sur ton site.':'Impossible de démarrer le connecteur.');process.exitCode=1})
  server.listen(PORT,'127.0.0.1',()=>console.log(`Stock Vinted · AdsPower\nRéglages : ${LOCAL}/setup\nPrêt. Garde ce programme et AdsPower ouverts. Les profils démarrent seulement depuis ton site.`))
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Le connecteur ne peut pas charger sa connexion. Ouvre les réglages ou contacte ton administrateur.');process.exitCode=1})
