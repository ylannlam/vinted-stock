export const RESPONSE_TARGET_MS=4*60_000
export const priorityResponses=settings=>settings?.messaging?.executor==='desktop'&&settings.messaging.desktop?.response_priority!==false
export const responseTask=task=>['reply_message','accept_offer','like_message'].includes(task.kind)&&!task.payload?.followup
export function responseTiming(eventAt,now=Date.now()){
 const parsed=Date.parse(eventAt),received=Number.isFinite(parsed)?Math.min(parsed,now):now
 return {response_received_at:new Date(received).toISOString(),response_deadline_at:new Date(received+RESPONSE_TARGET_MS).toISOString()}
}
export function responseWait(tasks,accountId,now=Date.now()){
 const waiting=tasks.filter(t=>t.account_id===accountId&&responseTask(t)&&['queued','running'].includes(t.state)&&t.response_deadline_at)
  .sort((a,b)=>Date.parse(a.response_deadline_at)-Date.parse(b.response_deadline_at))
 const task=waiting[0];if(!task)return null
 const seconds=Math.max(0,Math.floor((now-Date.parse(task.response_received_at))/1000))
 return {task,count:waiting.length,seconds,overdue:now>Date.parse(task.response_deadline_at),label:`${Math.floor(seconds/60)} min ${String(seconds%60).padStart(2,'0')} s`}
}
