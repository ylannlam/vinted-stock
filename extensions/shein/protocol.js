import {SITE} from './engine.js'
export function trustedSender(sender,message,runtime) {
  if(sender.id!==runtime.id)return false
  if(sender.url===runtime.getURL('popup.html'))return true
  try {
    return message.fromSite===true&&sender.frameId===0&&new URL(sender.url).origin===SITE
      &&new URL(sender.tab?.url).origin===SITE&&['status','connect','start','pause','resume','open'].includes(message.action)
  } catch{return false}
}
export function publicState(state,token,version) {
  return {version,connected:!!token&&!state.needsConnection,device_id:token?.match(/^svpc_([0-9a-f-]{36})\./)?.[1]||null,
    enabled:!!state.enabled,phase:state.phase,blockedCode:state.blockedCode||null,message:state.message,
    completed:state.completed||0,reviewed:state.reviewed||0,hasTab:state.tabId!=null,
    job:state.job?{id:state.job.id,input:state.job.input,expected_sku:state.job.expected_sku}:null}
}
