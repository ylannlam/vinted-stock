import {supabase} from './supabase'
import {readAllRows} from './workspace'

const checked=result=>{if(result.error)throw result.error;return result.data}

// Accès base de la section « Profils et proxys ». Les mots de passe des proxys ne sont lus
// qu'au moment de créer un profil, pour être transmis au connecteur de ce PC.
export function createFactoryStore(client=supabase){
  return {
    async load(){
      const [proxies,accounts,log]=await Promise.all([
        readAllRows(()=>client.from('proxies').select('id,nom,adresse,port,username,fournisseur,created_at',{count:'exact'}).order('created_at').order('id')),
        readAllRows(()=>client.from('vinted_accounts').select('id,pseudo,ads_power_num,proxy_id,statut,creation_stage,is_shadowbanned',{count:'exact'}).is('deleted_at',null).order('created_at').order('id')),
        client.from('adspower_fingerprint_log').select('profile_id,profile_no,action,resolution,threads,gpu,chrome_major,created_at').order('created_at',{ascending:false}).limit(1000).then(checked),
      ])
      return {proxies,accounts,log}
    },
    async secret(id){
      const row=checked(await client.from('proxies').select('adresse,port,username,password').eq('id',id).single())
      return {host:row.adresse,port:row.port,user:row.username,password:row.password}
    },
    // Les proxys déjà enregistrés (même adresse, port et identifiant) sont ignorés.
    async addProxies(rows){return (checked(await client.from('proxies').upsert(rows,{onConflict:'adresse,port,username',ignoreDuplicates:true}).select('id'))||[]).length},
    async precheck(accountId,proxyId){checked(await client.rpc('link_adspower_profile',{p_account:accountId,p_proxy:proxyId}))},
    async link(accountId,proxyId,profile){
      return checked(await client.rpc('link_adspower_profile',{p_account:accountId,p_proxy:proxyId,p_profile_id:profile.profile_id,p_profile_no:profile.profile_no,
        p_resolution:profile.resolution,p_threads:profile.threads,p_gpu:profile.gpu,p_chrome:profile.chrome??null}))
    },
    async logFingerprint(entry){checked(await client.from('adspower_fingerprint_log').insert(entry))},
  }
}
