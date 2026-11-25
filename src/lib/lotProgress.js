import {publicationDate,publicationProgress} from './publicationTracking.js'

export function lotProgress(entry){
  if(entry.status==='stopped'||entry.job?.status==='cancelled')return {group:'stopped',label:'Arrêtée',detail:entry.message||entry.job?.reason}
  if(entry.status==='failed')return {group:'problem',label:'À corriger',detail:entry.message}
  if(entry.status==='uncertain')return {group:'check',label:'À vérifier',detail:entry.message}
  if(entry.status==='queued'){
    if(!entry.job)return {group:'queue',label:'En file Scalency',detail:'Mise en file confirmée.'}
    const job=entry.job,progress=publicationProgress(job)
    const group=job.status==='done'&&job.new_item_id?'live':['queued','sent'].includes(job.status)?'queue':'check'
    return {group,...progress}
  }
  const resume=entry.status==='pending'&&entry.message&&Date.parse(entry.next_attempt)>Date.now()
  if(entry.status==='pending'&&Date.parse(entry.scheduled_for)>Date.now()&&!resume)
    return {group:'waiting',label:'Programmée',detail:''}
  return {group:'waiting',label:resume?'En pause':entry.status==='sending'?'Transmission à Scalency':'En préparation',
    detail:resume?entry.message+' Prochain essai à partir du '+publicationDate(entry.next_attempt)+'.':entry.message||''}
}
