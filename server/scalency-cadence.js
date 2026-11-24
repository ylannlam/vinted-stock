import {remoteId,ScalencyError} from './scalency-api.js'

export function capacityResult({data,error}){
  if(error?.message==='daily_capacity'){
    const free=Number(error.details)||0
    throw new ScalencyError('Plafond atteint pour cette sélection. Places disponibles pour ce jour : '+free+'. Les autres fiches restent en brouillon.',409)
  }
  if(error)throw error
  return data
}

export async function cadenceReport(db){
  const accounts=capacityResult(await db.from('scalency_records').select('remote_id,payload->>login')
    .eq('kind','accounts').eq('payload->>linked','true').order('payload->>login'))
  return Promise.all(accounts.map(async a=>({account:a.remote_id,login:a.login||a.remote_id,
    ...capacityResult(await db.rpc('scalency_daily_capacity',{p_account:a.remote_id}))})))
}

export async function setCadence(db,b){
  if(!['normal','starter'].includes(b.mode)||![b.starter,b.normal].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=2147483647))
    throw new ScalencyError('Saisis un nombre entier positif ou zéro pour chaque plafond.')
  return capacityResult(await db.rpc('scalency_set_cadence',{p_account:remoteId(b.account),p_mode:b.mode,p_starter:b.starter,p_normal:b.normal}))
}
