import {enableWebhook} from '../server/scalency-webhook.js'
import {createClient} from '@supabase/supabase-js'
import {remote,collections,snapshot} from '../server/scalency-api.js'
import {refreshListingCatalogs} from '../server/scalency-catalogs.js'
import {finishHistory} from '../server/scalency-history.js'

// Populate an empty workspace once. Later refreshes and history imports run in the app.
if(process.env.VERCEL_ENV==='production' && process.env.SCALENCY_API_KEY){
  const db=createClient(process.env.VITE_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  const check=r=>{if(r.error)throw Error(r.error.code||'database');return r.data}
  const me=await remote('me')
  if(!me.subscription?.active)throw Error('Abonnement Scalency inactif.')
  for(const kind of collections){
    const old=check(await db.from('scalency_sync').select('kind').eq('kind',kind).maybeSingle())
    if(old&&kind!=='accounts')continue
    const page=await remote(kind,{query:{limit:100}})
    const rows=(page.data||[]).map(r=>snapshot(kind,r))
    if(rows.length)check(await db.from('scalency_records').upsert(rows,{onConflict:'kind,account,remote_id'}))
    if(!old)check(await db.from('scalency_sync').upsert({kind,cursor_value:page.next_cursor||null,complete:!page.has_more},{onConflict:'kind',ignoreDuplicates:true}))
    console.log('Scalency · '+kind+' · '+rows.length+' entrées vérifiées')
  }
  try{await enableWebhook(db);console.log('Scalency · notifications connectées')}catch(e){console.warn('Scalency · notifications à vérifier dans Comptes (',e.status||'connexion',')')}
  console.log('Catégories Scalency disponibles',await refreshListingCatalogs(db))
  await finishHistory(db)
  check(await db.rpc('scalency_import_references'))
  check(await db.rpc('scalency_connect_pieces'))
}
