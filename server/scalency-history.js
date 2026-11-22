import {remote,snapshot,collections} from './scalency-api.js'

const check=result=>{if(result.error)throw result.error;return result.data}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))

// Store the cursor only once every row from this page is durable.
// A second worker can repeat a page but cannot move the cursor backwards.
export async function nextHistoryPage(db,kind){
  if(!collections.includes(kind))throw Error('Collection inconnue.')
  const state=check(await db.from('scalency_sync').select('cursor_value,complete').eq('kind',kind).maybeSingle())
  if(!state||state.complete)return {complete:!!state?.complete,imported:0}
  const seen=new Date().toISOString()
  const page=await remote(kind,{query:{limit:100,cursor:state.cursor_value}})
  if(!Array.isArray(page.data)||page.has_more&&(!page.next_cursor||page.next_cursor===state.cursor_value))throw Error('Curseur Scalency invalide.')
  const rows=page.data.map(row=>snapshot(kind,row,seen))
  if(rows.length) check(await db.from('scalency_records').upsert(rows,{onConflict:'kind,account,remote_id'}))
  let advance=db.from('scalency_sync').update({cursor_value:page.next_cursor||null,complete:!page.has_more}).eq('kind',kind).eq('complete',false)
  advance=state.cursor_value?advance.eq('cursor_value',state.cursor_value):advance.is('cursor_value',null)
  check(await advance)
  return {complete:!page.has_more,imported:rows.length}
}

export async function finishHistory(db,{budgetMs=8*60*1000}={}){
  const pending=check(await db.from('scalency_sync').select('kind').eq('complete',false)).map(r=>r.kind)
  const end=Date.now()+budgetMs
  const totals={}
  while(pending.length&&Date.now()<end){
    const kind=pending.shift()
    try{
      const page=await nextHistoryPage(db,kind)
      totals[kind]=(totals[kind]||0)+page.imported
      if(!page.complete)pending.push(kind)
    }catch(error){
      if(error.status===429){pending.unshift(kind);await wait(61000)}
      else console.warn('Historique à reprendre · '+kind+' · '+(error.status||error.code||'lecture'))
    }
    if(pending.length)await wait(1600)
  }
  console.log('Historique Scalency · '+JSON.stringify(totals))
}
