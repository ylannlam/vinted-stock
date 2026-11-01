import {nextStage,blocked} from './fulfillment.js'
export function commonNextStage(lines){
 if(!lines.length||lines.some(blocked))return null
 const stages=new Set(lines.map(nextStage))
 return stages.size===1?[...stages][0]||null:null
}
export function directionReady(account,background){return !!(background&&!background.archived_at&&(account.prompt_front??background.content??'').trim()&&(account.prompt_back??background.content_back??'').trim())}
export async function readAllRows(makeQuery,size=250){
 const all=[]
 for(let offset=0;;offset+=size){const {data,error,count}=await makeQuery().range(offset,offset+size-1);if(error)throw error;all.push(...data);if(data.length<size||(Number.isFinite(count)&&all.length>=count))return all}
}
export const fieldLabels={status:'Statut',statut:'Statut du compte',stage:'Préparation',size:'Taille',emplacement:'Emplacement',location:'Emplacement',supplier_order_ref:'Commande fournisseur',supplier_tracking:'Suivi fournisseur',sku_override:'SKU',actual_cost:'Coût payé',fees_amount:'Frais',refund_amount:'Remboursement',finance_confirmed:'Coûts vérifiés',deleted_at:'Corbeille',enabled:'Compte sélectionné',background_id:'Fond',is_ready:'Prêt',is_shadowbanned:'Mis de côté',creation_stage:'Préparation du compte',commande_id:'Commande de stock'}
