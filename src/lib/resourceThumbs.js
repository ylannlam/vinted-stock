import {viewCacheEpoch} from './viewCache.js'

// Signed links change at every server response, which defeats the browser cache.
// Reuse the first link of each preview for 50 minutes (they are signed for 60).
const TTL=50*60*1000
const links=new Map(),attempted=new Set()
let epoch=viewCacheEpoch()
function syncScope(){if(epoch!==viewCacheEpoch()){resetThumbCache();epoch=viewCacheEpoch()}}
export const resourceImageKey=row=>`${row.id}:${row.image_bucket||''}/${row.image_path||''}`
export function stableThumbs(rows,now=Date.now()) {
  syncScope()
  for(const [path,entry] of links)if(now-entry.at>=TTL)links.delete(path)
  return rows.map(row=>{
    if(!row?.thumb_path||!row.thumb_url)return row
    const known=links.get(row.thumb_path)
    if(known&&now-known.at<TTL)return known.url===row.thumb_url?row:{...row,thumb_url:known.url}
    links.set(row.thumb_path,{url:row.thumb_url,at:now})
    return row
  })
}
// Each resource is asked at most once per page session, so a broken image never loops.
export function missingThumbs(rows,limit=4) {
  syncScope()
  const missing=rows.filter(r=>r?.image_path&&!r.thumb_url&&!attempted.has(resourceImageKey(r))).slice(0,limit)
  missing.forEach(row=>attempted.add(resourceImageKey(row)))
  return missing.map(row=>row.id)
}
export function mergeThumbnails(rows,thumbnails,requested) {
  const made=new Map((thumbnails||[]).filter(t=>t.thumb_url).map(t=>[t.id,t]))
  return stableThumbs(rows.map(row=>made.has(row.id)&&requested.get(row.id)===resourceImageKey(row)?{...row,...made.get(row.id)}:row))
}
export const thumbOf=row=>row?.thumb_url||row?.image_url||null
export function resetThumbCache(){links.clear();attempted.clear()}
