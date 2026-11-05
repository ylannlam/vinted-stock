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

// À la création, AdsPower tire un User-Agent Windows 11 récent et le noyau assorti.
// Au remplacement, random_ua n'est pas accepté : on garde la version de Chrome du profil
// (son noyau est déjà installé) dans un User-Agent Windows explicite, et on n'envoie pas
// browser_kernel_config : le remplacement ne doit pas demander de changement de noyau.
export function fingerprintConfig(hardware,{chrome=null}={}){
  return {
    ...(chrome?{ua:windowsUserAgent(chrome)}:{random_ua:{ua_browser:['chrome'],ua_system_version:['Windows 11']},browser_kernel_config:{version:'ua_auto',type:'chrome'}}),
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
export async function readChrome(ads,id){return chromeMajor(userAgentIn(await ads.call('/api/v2/browser-profile/ua',{profile_id:[id]}),id))}
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

// Seule l'empreinte est envoyée : proxy, cookies, onglets et session du profil restent intacts.
export async function replaceFingerprint(ads,id,{random=Math.random,dispatch=async()=>{}}={}){
  if(!validProfile(id))throw new LocalError('Profil invalide.')
  const chrome=await readChrome(ads,id)
  if(!chrome)throw new LocalError('La version de Chrome de ce profil est illisible. Ouvre-le une fois dans AdsPower, ferme-le, puis réessaie.',409)
  const hardware=pickHardware(random)
  try{await dispatch();await ads.call('/api/v2/browser-profile/update',{profile_id:id,fingerprint_config:fingerprintConfig(hardware,{chrome})})}
  catch(error){throw refusal(error,null,'AdsPower a refusé la nouvelle empreinte')}
  return {profile_id:id,...summary(hardware,chrome)}
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
