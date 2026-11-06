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
    // Un proxy enregistré sans mot de passe (ligne « hôte:port · identifiant ») reçoit son mot de passe
    // quand on le colle en entier ; un mot de passe déjà enregistré n'est jamais écrasé.
    async addProxies(rows){
      const added=(checked(await client.from('proxies').upsert(rows,{onConflict:'adresse,port,username',ignoreDuplicates:true}).select('id'))||[]).length
      for(const r of rows.filter(r=>r.password))checked(await client.from('proxies').update({password:r.password}).eq('adresse',r.adresse).eq('port',r.port).eq('username',r.username).eq('password',''))
      return added
    },
    async precheck(accountId,proxyId){checked(await client.rpc('link_adspower_profile',{p_account:accountId,p_proxy:proxyId}))},
    async link(accountId,proxyId,profile){
      return checked(await client.rpc('link_adspower_profile',{p_account:accountId,p_proxy:proxyId,p_profile_id:profile.profile_id,p_profile_no:profile.profile_no,
        p_resolution:profile.resolution,p_threads:profile.threads,p_gpu:profile.gpu,p_chrome:profile.chrome??null}))
    },
    async logFingerprint(entry){checked(await client.from('adspower_fingerprint_log').insert(entry))},
    // Relie un compte à un profil AdsPower qui existe déjà (number = null pour le délier) et
    // enregistre le proxy de ce profil. Un numéro n'appartient qu'à un compte hors corbeille.
    async linkExisting(accountId,number,proxyId){
      if(number!==null&&!/^\d{1,12}$/.test(String(number)))throw Error('Numéro de profil AdsPower invalide.')
      if(number!==null){
        const taken=checked(await client.from('vinted_accounts').select('pseudo').eq('ads_power_num',String(number)).neq('id',accountId).is('deleted_at',null).limit(1))
        if(taken?.length)throw Error(`Le profil n° ${number} est déjà relié à ${taken[0].pseudo}.`)
      }
      const row=checked(await client.from('vinted_accounts').update({ads_power_num:number===null?null:String(number),proxy_id:proxyId}).eq('id',accountId).is('deleted_at',null).eq('is_shadowbanned',false).select('id,pseudo,ads_power_num,proxy_id').maybeSingle())
      if(!row)throw Error('Ce compte a changé (corbeille ou Shadowban). Actualise la liste.')
      return row
    },
    // Un proxy n'est supprimé que si aucun compte ne l'a, même dans la corbeille.
    async deleteProxy(id){
      const {count,error}=await client.from('vinted_accounts').select('id',{count:'exact',head:true}).eq('proxy_id',id)
      if(error)throw error
      if(count)throw Error('Ce proxy est encore enregistré sur un compte (peut-être dans la corbeille). Retire-le du compte avant de le supprimer.')
      if(!(checked(await client.from('proxies').delete().eq('id',id).select('id'))||[]).length)throw Error('Ce proxy n’existe plus. Actualise la liste.')
    },
  }
}
