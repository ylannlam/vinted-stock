// Memory only: a short-lived display snapshot, always revalidated by the page.
let owners=new WeakMap(),epoch=0,scope=''
export function viewCacheEpoch(){return epoch}
export function clearViewCache(){owners=new WeakMap();epoch++}
export function setViewCacheScope(next){if(next!==scope){scope=next;clearViewCache()}}
export function readViewCache(owner,key,now=Date.now()) {
  const entry=owners.get(owner)?.get(key)
  return entry&&now-entry.at<60000?entry.value:undefined
}
export function writeViewCache(owner,key,value,version,now=Date.now()) {
  if(version!==epoch)return
  let entries=owners.get(owner)
  if(!entries){entries=new Map();owners.set(owner,entries)}
  entries.delete(key);entries.set(key,{value,at:now})
  if(entries.size>20)entries.delete(entries.keys().next().value)
}
