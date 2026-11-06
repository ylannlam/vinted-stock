import {LocalError,validProfile} from './adspower.mjs'

// Empreintes cohérentes avec le PC qui fait tourner AdsPower : Windows 11 et RTX 4070.
// Le rendu WebGL réel vient de la carte du PC, donc les cartes annoncées restent des NVIDIA proches
// d'une 4070 (même génération ou voisine), avec la 4070 en tête. Seules des résolutions courantes,
// inférieures à l'écran réel, sont utilisées (jamais 3440×1440).
export const GPUS=[
  {name:'NVIDIA GeForce RTX 4060 Ti',id:'0x00002803',weight:14,high:false},
  {name:'NVIDIA GeForce RTX 4070',id:'0x00002786',weight:50,high:true},
  {name:'NVIDIA GeForce RTX 4070 SUPER',id:'0x00002783',weight:20,high:true},
  {name:'NVIDIA GeForce RTX 4070 Ti',id:'0x00002782',weight:10,high:true},
  {name:'NVIDIA GeForce RTX 3070',id:'0x00002484',weight:6,high:true},
]
export const RESOLUTIONS=['1920_1080','2560_1440']
export const DEFAULT_GROUP='Stock Vinted'

function weighted(entries,random){
  const total=entries.reduce((sum,[,weight])=>sum+weight,0)
  let rest=random()*total
  for(const [value,weight] of entries){rest-=weight;if(rest<0)return value}
  return entries.at(-1)[0]
}
// Une carte haut de gamme va plus souvent avec un écran 1440p et 16 threads annoncés.
export function pickHardware(random=Math.random){
  const gpu=weighted(GPUS.map(g=>[g,g.weight]),random)
  const resolution=weighted(gpu.high?[['2560_1440',60],['1920_1080',40]]:[['1920_1080',65],['2560_1440',35]],random)
  const threads=weighted(gpu.high?[[16,75],[8,25]]:[[16,45],[8,55]],random)
  return {gpu:gpu.name,gpuId:gpu.id,resolution,threads}
}
export function chromeMajor(ua){
  if(typeof ua!=='string'||/Firefox\//.test(ua))return null
  const match=/\bChrome\/(\d{2,3})\.\d/.exec(ua),major=match?Number(match[1]):null
  return major>=90&&major<=999?major:null
}
export const windowsUserAgent=major=>`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
// User-Agent Chrome Windows tel qu'AdsPower les génère (version complète), sans Edge ni Opera.
export const windowsChromeUserAgent=ua=>typeof ua==='string'&&ua.length<=300&&/^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d{2,3}\.\d{1,5}\.\d{1,5}\.\d{1,5} Safari\/537\.36$/.test(ua)

// À la création, AdsPower tire un User-Agent Windows 11 récent et le noyau assorti (ua_auto).
// Au remplacement, on conserve le User-Agent complet et on nomme son noyau explicitement
// pour éviter le choix implicite ua_auto. `kernel` vaut un numéro (« 154 ») ou « latest ».
export function fingerprintConfig(hardware,{chrome=null,ua=null,kernel=null}={}){
  return {
    ...(chrome?{ua:ua||windowsUserAgent(chrome),browser_kernel_config:{version:String(kernel||chrome),type:'chrome'}}:{random_ua:{ua_browser:['chrome'],ua_system_version:['Windows 11']},browser_kernel_config:{version:'ua_auto',type:'chrome'}}),
    automatic_timezone:'1',language_switch:'1',page_language_switch:'1',location_switch:'1',location:'ask',
    webrtc:'forward',
    screen_resolution:hardware.resolution,hardware_concurrency:String(hardware.threads),device_memory:'8',
    webgl:'2',webgl_config:{unmasked_vendor:'Google Inc. (NVIDIA)',unmasked_renderer:`ANGLE (NVIDIA, ${hardware.gpu} (${hardware.gpuId}) Direct3D11 vs_5_0 ps_5_0, D3D11)`,webgpu:{webgpu_switch:'1'}},
    gpu:'0',canvas:'1',webgl_image:'1',audio:'1',client_rects:'1',media_devices:'1',speech_switch:'1',device_name_switch:'1',
    mac_address_config:{model:'1',address:''},do_not_track:'default',flash:'block',scan_port_type:'1',
  }
}
const summary=(hardware,chrome)=>({resolution:hardware.resolution,threads:hardware.threads,gpu:hardware.gpu,chrome})

const control=/[\x00-\x1f\x7f]/
function text(value,label,max){
  const result=typeof value==='string'?value.trim():''
  if(!result||result.length>max||control.test(result))throw new LocalError(`${label} invalide.`)
  return result
}
const HOST=/^(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}|(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d))$/
const LOCAL=/^(?:localhost|.*\.local|.*\.localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/
export function readProxy(value){
  if(!value||typeof value!=='object')throw new LocalError('Proxy manquant.')
  const host=typeof value.host==='string'?value.host.trim().toLowerCase():'',port=Number(value.port)
  if(host.length>253||!HOST.test(host)||LOCAL.test(host))throw new LocalError('Adresse du proxy invalide.')
  if(!Number.isInteger(port)||port<1||port>65535)throw new LocalError('Port du proxy invalide.')
  return {host,port,user:text(value.user,'Identifiant du proxy',200),password:text(value.password,'Mot de passe du proxy',200)}
}

async function groupId(ads,name){
  const found=(await ads.call(`/api/v1/group/list?group_name=${encodeURIComponent(name)}&page_size=100`)).list?.find(g=>g?.group_name===name)
  if(found?.group_id!=null)return String(found.group_id)
  const created=await ads.call('/api/v1/group/create',{group_name:name})
  if(created.group_id==null)throw new LocalError('Le groupe AdsPower n’a pas pu être préparé.',502)
  return String(created.group_id)
}
function userAgentIn(data,id){
  const rows=Array.isArray(data)?data:Array.isArray(data?.list)?data.list:[]
  const row=rows.find(r=>r?.profile_id===id||r?.user_id===id)||(rows.length===1?rows[0]:null)
  return [row?.ua,row?.user_agent,data?.ua,data?.[id]].find(v=>typeof v==='string'&&v.startsWith('Mozilla/'))||null
}
export async function readUserAgent(ads,id){return userAgentIn(await ads.call('/api/v2/browser-profile/ua',{profile_id:[id]}),id)}
export async function readChrome(ads,id){return chromeMajor(await readUserAgent(ads,id))}
async function profileNumber(ads,id,given){
  if(/^\d{1,12}$/.test(String(given??'')))return String(given)
  const row=(await ads.call('/api/v2/browser-profile/list',{profile_id:[id],page:1,limit:1})).list?.find(p=>p?.profile_id===id)
  return /^\d{1,12}$/.test(String(row?.profile_no??''))?String(row.profile_no):''
}
// AdsPower explique parfois son refus (proxy injoignable, limite de profils…) : on le montre, sans secret.
function refusal(error,secret,prefix){
  if(!(error instanceof LocalError)||error.status!==502||!error.detail)return error
  const detail=(secret?error.detail.split(secret).join('•••'):error.detail).slice(0,300)
  return new LocalError(`${prefix} : ${detail}`,502)
}

export async function createProfile(ads,input,{random=Math.random,dispatch=async()=>{}}={}){
  const name=text(input?.name,'Nom du profil',100),group=text(input?.group??DEFAULT_GROUP,'Groupe AdsPower',50),proxy=readProxy(input?.proxy)
  const hardware=pickHardware(random)
  let data
  try{
    const group_id=await groupId(ads,group)
    await dispatch()
    data=await ads.call('/api/v2/browser-profile/create',{
      name,group_id,remark:'Créé depuis Stock Vinted',
      user_proxy_config:{proxy_soft:'other',proxy_type:'http',proxy_host:proxy.host,proxy_port:String(proxy.port),proxy_user:proxy.user,proxy_password:proxy.password},
      fingerprint_config:fingerprintConfig(hardware),
    })
  }catch(error){throw refusal(error,proxy.password,'AdsPower a refusé la création du profil')}
  if(!validProfile(data.profile_id))throw new LocalError('AdsPower n’a pas confirmé le profil créé. Vérifie la liste AdsPower avant de recommencer.',502)
  const number=await profileNumber(ads,data.profile_id,data.profile_no).catch(()=>'')
  const chrome=await readChrome(ads,data.profile_id).catch(()=>null)
  return {profile_id:data.profile_id,profile_no:number,name,group,...summary(hardware,chrome)}
}

// Quand AdsPower refuse la version du noyau, son message liste les versions acceptées :
// « browser_kernel_config->version value error,value must be one of ua_auto or latest or 156 or 155 … ».
// Seul ce refus de validation précis autorise les essais de secours ; un message incomplet,
// une panne réseau ou une autre erreur ne donne aucune garantie et ne déclenche pas de nouvel envoi.
function kernelOptions(error){
  const detail=error instanceof LocalError&&error.status===502&&typeof error.detail==='string'?error.detail:''
  const match=/^browser_kernel_config\s*->\s*version\s+value error\s*,?\s*value must be one of\s+((?:ua_auto|latest|\d{2,3})(?:\s+or\s+(?:ua_auto|latest|\d{2,3}))*)\s*[.!]?$/i.exec(detail.trim())
  if(!match)return null
  const tokens=match[1].toLowerCase().split(/\s+or\s+/)
  return {versions:[...new Set(tokens.filter(v=>/^\d+$/.test(v)).map(Number).filter(v=>v>=90&&v<=999))].sort((a,b)=>a-b),latest:tokens.includes('latest')}
}
export const kernelVersions=error=>kernelOptions(error)?.versions??null
// Essais successifs, seulement après le refus de validation ci-dessus :
// 1. la version de Chrome du profil et son User-Agent exact ;
// 2. si AdsPower ne liste pas cette version : la version plus récente la plus proche ;
// 3. « latest » seulement s'il est proposé, avec un User-Agent assorti. Jamais de rétrogradation.
function kernelAttempts(chrome,{versions:allowed,latest}){
  const attempts=[]
  if(!allowed.length)return attempts
  if(!allowed.includes(chrome)){const next=allowed.find(v=>v>chrome);if(next)attempts.push({chrome:next,ua:windowsUserAgent(next),kernel:String(next)})}
  const newest=allowed.at(-1)
  if(latest&&newest>=chrome)attempts.push({chrome:newest,ua:windowsUserAgent(newest),kernel:'latest'})
  return attempts
}

// Seule l'empreinte est envoyée (ni proxy ni cookies). AdsPower peut malgré tout effacer la session
// du profil quand son empreinte change : le compte Vinted est alors déconnecté.
export async function replaceFingerprint(ads,id,{random=Math.random,dispatch=async()=>{}}={}){
  if(!validProfile(id))throw new LocalError('Profil invalide.')
  const current=await readUserAgent(ads,id),chrome=chromeMajor(current)
  if(!chrome)throw new LocalError('La version de Chrome de ce profil est illisible. Ouvre-le une fois dans AdsPower, ferme-le, puis réessaie.',409)
  const hardware=pickHardware(random),prefix='AdsPower a refusé la nouvelle empreinte'
  const send=attempt=>ads.call('/api/v2/browser-profile/update',{profile_id:id,fingerprint_config:fingerprintConfig(hardware,attempt)})
  let attempt={chrome,ua:windowsChromeUserAgent(current)?current:windowsUserAgent(chrome),kernel:String(chrome)}
  await dispatch()
  try{await send(attempt)}
  catch(error){
    const allowed=kernelOptions(error)
    if(!allowed)throw refusal(error,null,prefix)
    let last=error,applied=false
    for(const next of kernelAttempts(chrome,allowed)){
      try{await send(next);attempt=next;applied=true;break}
      catch(again){last=again;if(JSON.stringify(kernelOptions(again))!==JSON.stringify(allowed))break}
    }
    if(!applied)throw refusal(last,null,prefix)
  }
  // L'historique reflète la version relue après succès, pas une supposition sur « latest ».
  // Si la lecture échoue après l'écriture, on garde le succès sans inventer de version ni réécrire.
  const appliedChrome=await readChrome(ads,id).catch(()=>null)
  return {profile_id:id,...summary(hardware,appliedChrome)}
}

// Proxy de chaque profil, sans mot de passe, pour repérer les proxys déjà utilisés.
export async function profileProxies(ads){
  const rows=[],seen=new Set()
  for(let page=1;page<=100;page++){
    const data=await ads.call('/api/v2/browser-profile/list',{page,limit:100})
    if(!Array.isArray(data.list))throw new LocalError('La liste des profils AdsPower est illisible.',502)
    for(const p of data.list){
      if(!validProfile(p?.profile_id)||seen.has(p.profile_id))throw new LocalError('La liste AdsPower est incomplète. Actualise-la.',502)
      seen.add(p.profile_id)
      const c=p.user_proxy_config||{},host=typeof c.proxy_host==='string'?c.proxy_host.trim().toLowerCase().slice(0,253):'',port=Number(c.proxy_port)
      rows.push({id:p.profile_id,number:String(p.profile_no??'').slice(0,30),proxy:host&&Number.isInteger(port)&&port>0?{host,port,user:String(c.proxy_user??'').slice(0,200)}:null})
    }
    if(data.list.length<100)return rows
  }
  throw new LocalError('La liste dépasse 10 000 profils. Réduis les profils accessibles à cette clé.')
}
