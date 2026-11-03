export function readProfileVisibility(storage,key){
  try{const value=JSON.parse(storage.getItem(key));return Array.isArray(value)&&value.every(id=>typeof id==='string')?[...new Set(value)]:null}catch{return null}
}
export function displayedProfiles(profiles,ids){return profiles.filter(profile=>(ids||[]).includes(profile.id))}
export function visibleLaunchIds(profiles,ids,selected){const visible=new Set(displayedProfiles(profiles,ids).map(p=>p.id));return [...new Set(selected)].filter(id=>visible.has(id)).slice(0,100)}

export function legacySelection(storage,owner){return readProfileVisibility(storage,`adspower-visible:${owner}`)??readProfileVisibility(storage,`adspower-selection:${owner}`)??[]}
