const reads=new Set(['sync_inbox','scan_likes','scan_wardrobe','scan_wallet','sync_orders'])
export function taskOutcome(task){
 if(task.state!=='done')return {label:{queued:'En attente',running:'En cours',failed:'À vérifier',cancelled:'Annulée'}[task.state]||task.state,tone:task.state==='failed'?'red':task.state==='running'?'blue':'zinc'}
 const r=task.result||{}
 if(r.skipped)return {label:'Écartée',tone:'zinc'}
 if(reads.has(task.kind))return {label:'Lecture terminée',tone:'blue'}
 if(r.prepared)return {label:'Formulaire préparé',tone:'amber'}
 if(r.message_sent&&r.offer_sent)return {label:'Message et offre confirmés',tone:'green'}
 if(r.message_sent)return {label:'Message confirmé',tone:'green'}
 if(r.accepted||r.offer_sent)return {label:'Offre confirmée',tone:'green'}
 return {label:'Traitement terminé',tone:'zinc'}
}
export const taskPriority=kind=>({reply_message:0,accept_offer:1,sync_inbox:2,like_message:3}[kind]??4)
const duePriority=(task,now)=>['scan_wallet','sync_orders','fetch_label'].includes(task.kind)&&Date.parse(task.not_before)<now-15*60_000?0:taskPriority(task.kind)
export function nextAccountAction(tasks,accountId,now=Date.now(),responsePriority=false){
 const queued=tasks.filter(t=>t.account_id===accountId&&t.state==='queued')
 const due=queued.filter(t=>Date.parse(t.not_before||t.created_at)<=now)
 const rank=t=>!responsePriority?duePriority(t,now):Date.parse(t.response_deadline_at)<=now+90000?1:['sync_inbox','scan_likes'].includes(t.kind)?Date.parse(t.not_before)<=now-60000?2:4:['reply_message','accept_offer','like_message'].includes(t.kind)&&!t.payload?.followup?3:5
 return (due.length?due.sort((a,b)=>rank(a)-rank(b)||(responsePriority?(Date.parse(a.response_deadline_at)||Infinity)-(Date.parse(b.response_deadline_at)||Infinity):0)||(b.priority||0)-(a.priority||0)||Date.parse(a.not_before)-Date.parse(b.not_before)||Date.parse(a.created_at)-Date.parse(b.created_at)):queued.sort((a,b)=>Date.parse(a.not_before)-Date.parse(b.not_before)))[0]||null
}
