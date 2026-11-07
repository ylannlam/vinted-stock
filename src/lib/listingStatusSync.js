// Vérification uniquement : ne crée, ne reprend et ne republie aucune annonce.
export const needsPublicationCheck=row=>['scheduled','attention'].includes(row.state)&&!!row.dotb_item_id
export async function syncListingStatuses(rows,request,{onDraft=()=>{},onError=()=>{},active=()=>true}={}){
 let changed=false
 const seen=new Set()
 for(const row of rows){
  if(!active())break
  if(!needsPublicationCheck(row)||seen.has(row.id))continue
  seen.add(row.id)
  try{
   const {draft}=await request('POST',{action:'refresh',id:row.id})
   if(!active())break
   if(!draft||draft.id!==row.id)throw Error('Le statut reçu ne correspond pas à cette annonce.')
   changed=changed||draft.state!==row.state
   await onDraft(draft)
  }catch(e){if(active())onError(row,e);if(e.status===429)break}
 }
 return changed
}
