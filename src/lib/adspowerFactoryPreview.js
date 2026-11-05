// Données fictives de la démo pour la section « Profils et proxys ».
const proxies=[
  {id:'px1',nom:'Démo 1',adresse:'isp.decodo.com',port:10001,username:'demo-user',fournisseur:'Decodo',created_at:'2026-11-01T10:00:00Z'},
  {id:'px2',nom:'Démo 2',adresse:'isp.decodo.com',port:10002,username:'demo-user',fournisseur:'Decodo',created_at:'2026-11-01T10:00:00Z'},
  {id:'px3',nom:null,adresse:'disp.oxylabs.io',port:8001,username:'user-disp_demo0001',fournisseur:'Oxylabs',created_at:'2026-11-02T10:00:00Z'},
  {id:'px4',nom:null,adresse:'disp.oxylabs.io',port:8001,username:'user-disp_demo0002',fournisseur:'Oxylabs',created_at:'2026-11-02T10:00:00Z'},
]
const accounts=[
  {id:'a1',pseudo:'Dressing Camille',ads_power_num:'01',proxy_id:'px1',creation_stage:'ready',is_shadowbanned:false},
  {id:'a2',pseudo:'Atelier Léa',ads_power_num:'02',proxy_id:'px2',creation_stage:'ready',is_shadowbanned:false},
  {id:'a3',pseudo:'Nouveau compte',ads_power_num:null,proxy_id:null,creation_stage:'ready',is_shadowbanned:false},
  {id:'a4',pseudo:'Compte en isolement',ads_power_num:null,proxy_id:null,creation_stage:'post2',is_shadowbanned:false},
]
const log=[{profile_id:'demo-1',profile_no:'02',action:'update',resolution:'1920_1080',threads:8,gpu:'NVIDIA GeForce RTX 3060',chrome_major:141,created_at:new Date(Date.now()-2*86400000).toISOString()}]
const copy=value=>structuredClone(value)
export const factoryPreviewStore={
  async load(){return {proxies:copy(proxies),accounts:copy(accounts),log:copy(log)}},
  async secret(id){const p=proxies.find(x=>x.id===id);return {host:p.adresse,port:p.port,user:p.username,password:'demo'}},
  async addProxies(rows){let added=0;for(const r of rows)if(!proxies.some(p=>p.adresse===r.adresse&&p.port===r.port&&p.username===r.username)){proxies.push({...r,id:crypto.randomUUID(),nom:null,created_at:new Date().toISOString()});added++}return added},
  async precheck(accountId,proxyId){if(accounts.some(a=>a.proxy_id===proxyId&&a.id!==accountId))throw Error('Ce proxy est déjà utilisé par un autre compte.')},
  async link(accountId,proxyId,profile){const a=accounts.find(x=>x.id===accountId);Object.assign(a,{ads_power_num:profile.profile_no,proxy_id:proxyId});log.unshift({profile_id:profile.profile_id,profile_no:profile.profile_no,action:'create',resolution:profile.resolution,threads:profile.threads,gpu:profile.gpu,chrome_major:profile.chrome,created_at:new Date().toISOString()});return copy(a)},
  async logFingerprint(entry){log.unshift({...entry,created_at:new Date().toISOString()})},
}
