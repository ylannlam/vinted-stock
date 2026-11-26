import {remote,remoteId,ScalencyError} from './scalency-api.js'
import {isId} from './dotb.js'

const conflict=message=>{throw new ScalencyError(message,409)}
const checked=r=>{if(r.error)throw r.error;return r.data}
export const removalKey=(account,item)=>'remove-listing:'+account+':'+item

export async function managePublication(db,user,{operation,id,version,account},saveRecords,request=remote){
  if(!['discard','stop-local','cancel','remove'].includes(operation))throw new ScalencyError('Action inconnue.')
  account=remoteId(account)
  if(operation==='stop-local'||operation==='discard'){
    if(!isId(id)||!Number.isInteger(version)||version<1)throw new ScalencyError('Fiche invalide.')
    if(operation==='stop-local'){
      const stopped=checked(await db.rpc('scalency_stop_lot_entry',{p_owner:user.id,p_draft:id,p_version:version}))
      if(!stopped)conflict('Transmission déjà engagée. Actualise pour retrouver la demande Scalency.')
      return {message:'Mise en ligne arrêtée. Brouillon conservé.'}
    }
    const result=await db.rpc('scalency_discard_ready_drafts',{p_owner:user.id,p_account:account,p_drafts:[{id,version}]})
    if(result.error?.message==='ready_draft_changed')conflict('Le brouillon a changé. Actualise avant de le supprimer.')
    checked(result)
    return {message:'Brouillon supprimé.'}
  }
  id=remoteId(id)
  const job=await request('jobs/'+id)
  if(job.type!=='publish'||String(job.account_id)!==account||String(job.id)!==id)conflict('Cette publication ne correspond plus à la sélection.')
  if(operation==='cancel'){
    if(job.status==='cancelled')return {message:'Déjà arrêtée.'}
    if(!['queued','sent','waiting','pending','scheduled','planned'].includes(job.status))conflict('Le traitement est terminé. Vérifie le statut avant de continuer.')
    const reply=await request('jobs/'+id+'/cancel',{method:'POST'})
    if(reply.status!=='cancelled'&&reply.job?.status!=='cancelled')conflict('Arrêt non confirmé par Scalency. Actualise le suivi.')
    await saveRecords(db,'jobs',[{...job,...reply.job,status:'cancelled'}])
    return {message:'Mise en ligne arrêtée par Scalency.'}
  }
  if(job.status!=='done'||!/^\d+$/.test(String(job.new_item_id)))conflict('Publication non confirmée sur Vinted.')
  const itemId=String(job.new_item_id)
  const item=await request('items/'+itemId,{query:{account_id:account}})
  if(String(item.id)!==itemId||String(item.account_id)!==account)conflict('La robe ne correspond plus au compte choisi.')
  if(item.sold)conflict('Cette robe a été vendue.')
  const reply=item.status==='deleted'?{status:'already_deleted'}:await request('items/'+itemId,{method:'DELETE',query:{account_id:account}})
  if(!['already_deleted','already_queued','queued'].includes(reply.status))conflict('Retrait non confirmé par Scalency.')
  const existing=(item.jobs||[]).find(j=>j.type==='delete'&&['queued','sent','waiting','pending'].includes(j.status))
  const tracking={status:reply.status==='already_deleted'?'deleted':'removing',job:reply.job?.id?String(reply.job.id):existing?.id?String(existing.id):null}
  checked(await db.from('scalency_commands').upsert({request_id:removalKey(account,itemId),owner_id:user.id,action:'remove-listing',result:tracking},{onConflict:'request_id'}))
  return {message:tracking.status==='deleted'?'Annonce déjà retirée de Vinted.':'Retrait demandé à Scalency.'}
}
