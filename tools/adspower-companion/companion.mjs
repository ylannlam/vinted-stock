import {createServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {AdsPowerClient,LocalError} from './adspower.mjs'
import {readConfig,saveConfig} from './storage.mjs'
import {LaunchQueue} from './queue.mjs'
import {startDotb} from './dotb.mjs'

export const PORT=17442,SITE='https://vinted-stock.vercel.app',LOCAL=`http://127.0.0.1:${PORT}`
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const html=(token,{configured=false,message='',port=50325}={})=>`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion AdsPower · Stock Vinted</title><style>body{background:#f4f7f6;color:#173e35;font:16px system-ui;margin:0;padding:32px 16px}main{max-width:560px;margin:5vh auto;background:white;border:1px solid #dde7e2;border-radius:24px;padding:32px}p{line-height:1.6;color:#52675f}label{display:block;margin:20px 0 8px;font-weight:600}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #bacdc3;border-radius:10px;font:inherit}button,a{display:inline-block;padding:14px 20px;border:0;border-radius:10px;background:#087f6b;color:white;font:600 15px system-ui;text-decoration:none;margin-top:20px}small{display:block;color:#64756d;margin-top:12px}.notice{background:#e9f6ef;padding:15px;border-radius:12px}</style><main><small>STOCK VINTED · CONNEXION SUR CE PC</small><h1>AdsPower, prêt en un clic.</h1>${message?`<p role="status" class="notice">${escape(message)}</p>`:''}<p>${configured?'Une clé est déjà enregistrée sur ce PC. Tu peux la remplacer ci-dessous.':'Dans AdsPower, ouvre <strong>Automatisation → API</strong>, puis copie ta clé existante ici.'}</p><form method="post" action="/setup" autocomplete="off"><input type="hidden" name="csrf" value="${token}"><label for="key">Clé API AdsPower</label><input type="password" id="key" name="apiKey" required minlength="8" maxlength="512" autocomplete="off"><details><summary>Port de connexion</summary><label for="port">Port indiqué dans AdsPower</label><input type="number" id="port" name="port" value="${port}" min="1024" max="65535" required></details><button>Vérifier et enregistrer sur ce PC</button></form><small>La clé reste sur ce PC. Sous Windows, elle est protégée avec ton compte Windows. Cette étape n’ouvre aucun profil.</small>${configured?`<a href="${SITE}/#adspower">Revenir à mon site →</a>`:''}</main></html>`
async function body(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>16000)throw new LocalError('Demande trop volumineuse.',413);parts.push(part)}return Buffer.concat(parts).toString('utf8')}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}
export async function verifyTicket(ticket,fetcher=fetch){
  if(typeof ticket!=='string'||!/^svads_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket)||ticket.length>1500)throw new LocalError('Connecte-toi au site pour utiliser AdsPower.',401)
  let response;try{response=await fetcher(`${SITE}/api/adspower`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',ticket}),redirect:'error',signal:AbortSignal.timeout(12000)})}catch{throw new LocalError('Le site est momentanément inaccessible. Réessaie.',503)}
  const result=await response.json().catch(()=>({}));if(!response.ok||!result.user_id||!(result.expires_at>Date.now()))throw new LocalError('Autorisation expirée. Actualise le site.',401)
  return result
}
export async function createCompanion({dataDir,verify=verifyTicket,clientFactory=c=>new AdsPowerClient(c),runner=startDotb,load=readConfig,save=saveConfig}={}){
  let config=await load(dataDir).catch(()=>null),ads=config?clientFactory(config):null,profiles=[],listAt=0,loadingList=null,settingUp=false
  const tickets=new Map(),csrf=new Map()
  const queue=new LaunchQueue({run:(profile,update)=>runner(profile,update,ads)})
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
          if(settingUp||queue.running||queue.jobs.some(j=>j.state==='queued'))throw new LocalError('Attends la fin des démarrages avant de changer la connexion.',409)
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
      const cached=tickets.get(ticket)
      if(!cached||cached.until<Date.now()){
        const auth=await verify(ticket);tickets.set(ticket,{until:Math.min(auth.expires_at,Date.now()+10000)});if(tickets.size>20)tickets.delete(tickets.keys().next().value)
      }
      if(req.method==='GET'&&url.pathname==='/state'){json(res,200,{version:'1.0.3',configured:!!config,jobs:queue.snapshot(),list_at:listAt});return}
      if(req.method==='GET'&&url.pathname==='/profiles'){json(res,200,{profiles:await refresh()});return}
      if(req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))throw new LocalError('Format de demande invalide.',415)
        let input;try{input=JSON.parse(await body(req))}catch{throw new LocalError('Demande invalide.')}
        if(url.pathname==='/launch'){
          if(settingUp)throw new LocalError('La connexion est en cours de modification.',409)
          if(!listAt||Date.now()-listAt>60000)await refresh()
          const ids=queue.launch(input,profiles);json(res,202,{ids,jobs:queue.snapshot()});return
        }
        if(url.pathname==='/cancel'){json(res,200,{jobs:queue.cancel()});return}
      }
      throw new LocalError('Commande inconnue.',404)
    }catch(error){json(res,error.status||500,{error:error.status?error.message:'La connexion locale a été interrompue. Relance le connecteur.'})}
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
