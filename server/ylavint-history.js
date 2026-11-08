// Une borne fixe à l'activation : les événements suivants restent toujours admissibles.
export function eventTime(value){
  if(value==null||value==='')return null
  const n=typeof value==='number'||/^\d+(\.\d+)?$/.test(String(value))?Number(value):NaN
  const ms=Number.isFinite(n)?n*(n<1e12?1000:1):Date.parse(value)
  return Number.isFinite(ms)?ms:null
}
export function inHistory(value,since){
  if(!since)return true
  const at=eventTime(value),start=eventTime(since)
  return at!==null&&start!==null&&at>=start
}
export function activationSettings(settings,current,enabled,now=Date.now()){
  const changed=[]
  for(const [name,next,previous,on,wasOn] of [
    ['likes',settings.likes,current?.likes,settings.features.likes,current?.features?.likes],
    ['messages',settings.messaging,current?.messaging,settings.features.ai,current?.features?.ai],
    ['offers',settings.messaging.offers,current?.messaging?.offers,settings.messaging.offers.enabled,current?.messaging?.offers?.enabled],
  ]){
    next.history_since=previous?.history_since||null
    if(enabled&&on&&(!current?.enabled||!wasOn||next.history_hours!==(previous?.history_hours??0))){
      next.history_since=new Date(now-next.history_hours*3600000).toISOString()
      changed.push(name)
    }
  }
  return changed
}
