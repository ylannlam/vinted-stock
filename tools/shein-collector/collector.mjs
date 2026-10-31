import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises'
import {createInterface} from 'node:readline/promises'
import {stdin,stdout} from 'node:process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {readSheinPage,readSheinSearch} from './extract.mjs'

const root=path.dirname(fileURLToPath(import.meta.url)),dataDir=path.join(root,'.data')
const apiUrl='https://vinted-stock.vercel.app/api/collector'
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const tokenPattern=/^svpc_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/
export function allowedPage(value) {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['fr.shein.com','www.shein.com'].includes(u.hostname)}catch{return false}
}
export async function apiCall(token,body,fetcher=fetch) {
  const response=await fetcher(apiUrl,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)})
  const result=await response.json().catch(()=>({}))
  if(!response.ok){const e=new Error(result.error||`Serveur indisponible (${response.status}).`);e.status=response.status;throw e}
  return result
}
async function saveJSON(name,value) {
  const target=path.join(dataDir,name)
  await writeFile(`${target}.tmp`,JSON.stringify(value),{mode:0o600})
  await rename(`${target}.tmp`,target)
}
async function loadJSON(name) {try{return JSON.parse(await readFile(path.join(dataDir,name),'utf8'))}catch{return null}}
async function openProduct(page,url) {
  if(!allowedPage(url))throw Object.assign(Error('Lien Shein invalide.'),{code:'page_unavailable'})
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000})
  if(!allowedPage(page.url()))throw Object.assign(Error('La fiche a redirigé vers une autre adresse.'),{code:'page_unavailable'})
  await page.waitForFunction(()=>document.getElementById('productMainPriceId')||/vérifier que vous êtes humain|je suis humain|verify (that )?you are human/i.test(document.body?.innerText||''),undefined,{timeout:20000}).catch(()=>{})
  const initial=await page.evaluate(readSheinPage)
  if(initial.error)return initial
  // Expand only product information. Never interact with a verification challenge.
  for(const label of [/^Description/i,/^Tailles?\s*&\s*Mesures/i]) {
    const button=page.getByRole('button',{name:label}).first()
    if(await button.count() && await button.isVisible() && await button.getAttribute('aria-expanded')==='false') {
      await button.click({timeout:5000}).catch(()=>{})
      const details=await page.evaluate(readSheinPage)
      if(details.error==='human_check')return details
    }
  }
  const expanded=await page.evaluate(readSheinPage)
  return expanded.error ? expanded : {...expanded,description:expanded.description||initial.description}
}
export async function collect(page,job) {
  if(job.expected_supplier_id)return openProduct(page,job.input)
  const sku=job.expected_sku
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(sku||''))return {error:'sku_not_found'}
  await page.goto(`https://fr.shein.com/pdsearch/${encodeURIComponent(sku)}/`,{waitUntil:'domcontentloaded',timeout:45000})
  if(!allowedPage(page.url()))return {error:'page_unavailable'}
  await page.waitForFunction(()=>[...document.querySelectorAll('a[href]')].some(a=>/-p-\d+\.html/.test(a.href))||/vérifier que vous êtes humain|je suis humain|verify (that )?you are human/i.test(document.body?.innerText||''),undefined,{timeout:20000}).catch(()=>{})
  const search=await page.evaluate(readSheinSearch)
  if(search.error)return search
  for(const url of search.urls) {
    const result=await openProduct(page,url)
    if(result.error==='human_check')return result
    if(result.supplier_sku?.toLowerCase()===sku.toLowerCase())return result
    await wait(2000)
  }
  return {error:'sku_not_found'}
}

async function main() {
  const {chromium}=await import('playwright-core')
  await mkdir(dataDir,{recursive:true})
  const terminal=createInterface({input:stdin,output:stdout})
  let connection=process.argv.includes('--associer')?null:await loadJSON('connection.json')
  if(!tokenPattern.test(connection?.token||'')) {
    console.log('Stock Vinted — récupération Shein\nSur le site : Catalogue > Récupération > Associer mon PC.\nCopie le code d’association (ce n’est pas ta clé Dotb).')
    const token=(await terminal.question('Code d’association : ')).trim()
    if(!tokenPattern.test(token))throw Error('Code invalide. Relance le programme puis copie le code complet.')
    await apiCall(token,{action:'heartbeat'})
    connection={token};await saveJSON('connection.json',connection)
    console.log('PC associé. Garde ce dossier pour les prochains lancements.')
  }
  let context
  for(const channel of ['msedge','chrome']) {
    try {context=await chromium.launchPersistentContext(path.join(dataDir,'navigateur'),{channel,headless:false,locale:'fr-FR',viewport:{width:1280,height:900},acceptDownloads:false});break}catch{}
  }
  if(!context)throw Error('Installe Microsoft Edge ou Google Chrome puis relance run.bat.')
  const page=context.pages()[0]||await context.newPage()
  let stopping=false,currentJob=null,heartbeatBusy=false
  const promptAbort=new AbortController()
  context.on('close',()=>{stopping=true;promptAbort.abort()})
  process.on('SIGINT',()=>{stopping=true;context.close().catch(()=>{})})
  const pulse=setInterval(async()=>{
    if(heartbeatBusy||stopping)return
    heartbeatBusy=true
    try{await apiCall(connection.token,{action:'heartbeat',...(currentJob?{job_id:currentJob.id,lease:currentJob.lease}:{})})}
    catch(e){if([401,403].includes(e.status)){console.log('PC déconnecté depuis le site.');stopping=true}}
    finally{heartbeatBusy=false}
  },30000)
  console.log('Programme prêt. Ajoute des SKU ou liens sur ton site.\nLes nouvelles vérifications sont prévues toutes les 6 h.\nGarde ce programme ouvert et le PC éveillé. Ferme le navigateur pour arrêter.')
  try {
    while(!stopping) {
      try {
        const pending=await loadJSON('pending.json')
        if(pending) {
          try {await apiCall(connection.token,pending);await unlink(path.join(dataDir,'pending.json'));console.log('Fiche enregistrée sur le site.')}
          catch(e){
            if([401,403].includes(e.status))throw e
            if([400,409].includes(e.status)) {
              console.log(`Résultat non enregistré : ${e.message}`)
              await apiCall(connection.token,{action:'fail',job_id:pending.job_id,lease:pending.lease,status:'failed',code:'price_unreadable'}).catch(err=>{if(err.status!==409)throw err})
              await unlink(path.join(dataDir,'pending.json'))
            }else throw e
          }
          currentJob=null;if(process.argv.includes('--once'))break
          await wait(3000);continue
        }
        const {job,paused}=await apiCall(connection.token,{action:'claim'})
        if(!job){currentJob=null;await wait(paused?30000:15000);continue}
        currentJob=job
        console.log(`Récupération : ${job.expected_sku||job.expected_supplier_id}`)
        let result
        try {result=await collect(page,job)}catch(e){result={error:e.code||'page_unavailable'}}
        if(!result.error && job.expected_sku && result.supplier_sku?.toLowerCase()!==job.expected_sku.toLowerCase())result={error:'sku_mismatch'}
        if(result.error) {
          const human=result.error==='human_check'
          await apiCall(connection.token,{action:'fail',job_id:job.id,lease:job.lease,status:human?'blocked':'failed',code:result.error})
          currentJob=null
          if(human) {
            console.log('Shein demande une vérification humaine. Termine-la toi-même dans la fenêtre du navigateur. Le programme ne la contourne pas.')
            await terminal.question('Une fois la fiche accessible, appuie sur Entrée pour reprendre. ',{signal:promptAbort.signal})
            if(!stopping)await apiCall(connection.token,{action:'resume_blocked',job_id:job.id,lease:job.lease})
          } else console.log(`Fiche à vérifier (${result.error}). Le détail est visible sur le site.`)
        } else await saveJSON('pending.json',{action:'complete',job_id:job.id,lease:job.lease,result})
        if(process.argv.includes('--once')&&!await loadJSON('pending.json'))break
        await wait(4000)
      } catch(error) {
        if([401,403].includes(error.status)){console.log(error.message);break}
        if(!stopping){console.log(`Connexion interrompue : ${error.message}. Nouvelle tentative dans 30 secondes.`);await wait(30000)}
      }
    }
  } finally {clearInterval(pulse);terminal.close();await context.close().catch(()=>{})}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1})
