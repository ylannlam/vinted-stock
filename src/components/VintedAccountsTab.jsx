import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { accountDeadline, nextCreationStep, readyWithoutTracking } from '../lib/accountTracking'
import { ACCOUNT_VIEWS, accountGroup, isAccountDue, nextAccountAction, selectAccounts } from '../lib/accountOverview'
import AccountFormModal from './AccountFormModal'
import AccountDetails, { CopyValue } from './AccountDetails'

const secondary = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50'
const selectClass = 'border border-gray-200 bg-white rounded-lg px-3 py-2 text-xs text-gray-600 focus:outline-none focus:border-teal-400'
const tones = {isolation:'bg-amber-50 text-amber-700',shadowban:'bg-gray-100 text-gray-600',ready:'bg-teal-50 text-teal-700',blocked:'bg-red-50 text-red-700'}

export default function VintedAccountsTab({client=supabase}) {
  const [accounts,setAccounts]=useState([])
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [view,setView]=useState('ready'),[search,setSearch]=useState(''),[sort,setSort]=useState('priority'),[dueOnly,setDueOnly]=useState(false)
  const [selectedId,setSelectedId]=useState(null),[editAccount,setEditAccount]=useState(undefined)
  const [now,setNow]=useState(Date.now())
  const [deleteId,setDeleteId]=useState(null)
  useEffect(()=>{fetchAll();const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer)},[])

  async function fetchAll() {
    setLoading(true);setError('')
    try {
      const a=await client.from('vinted_accounts').select('*').order('created_at',{ascending:false})
      if(a.error)throw a.error
      // Preserve the existing automatic release of elapsed temporary bans.
      let list=a.data
      const expired=list.filter(x=>!x.is_shadowbanned&&x.statut==='banni_temp'&&x.deban_at&&Date.parse(x.deban_at)<=Date.now())
      if(expired.length){
        const result=await client.from('vinted_accounts').update({statut:'actif',deban_at:null}).in('id',expired.map(x=>x.id)).select()
        if(result.error)throw result.error
        const updated=new Map(result.data.map(x=>[x.id,x]));list=list.map(x=>updated.get(x.id)||x)
      }
      setAccounts(list)
    } catch(e){setError(e.message||'Impossible de charger les comptes.')}finally{setLoading(false)}
  }
  async function mutate(action,message) {
    if(busy)return false
    setBusy(true);setError('');setNotice('')
    try {await action();setNotice(message);setNow(Date.now());return true}
    catch(e){setError(e.message||'La modification n’a pas été enregistrée.');return false}
    finally{setBusy(false)}
  }
  function replaceAccount(account){setAccounts(prev=>prev.map(a=>a.id===account.id?account:a))}
  async function updateAccount(id,fields){
    const {data,error}=await client.from('vinted_accounts').update(fields).eq('id',id).select().single()
    if(error)throw error;replaceAccount(data)
  }
  async function handleSave(form){
    const ok=await mutate(async()=>{
      const {id,...raw}=form
      const fields=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,v===''?null:v]))
      if(id)await updateAccount(id,fields)
      else {const {data,error}=await client.from('vinted_accounts').insert(fields).select().single();if(error)throw error;setAccounts(prev=>[data,...prev])}
    },'Compte enregistré.')
    if(ok){setEditAccount(undefined);setView(accountGroup(form));setSearch('');setDueOnly(false)}
  }
  async function advance(account){
    const patch=nextCreationStep(account)
    if(!patch)return
    await mutate(async()=>{
      const {data,error}=await client.from('vinted_accounts').update(patch).eq('id',account.id).eq('creation_stage',account.creation_stage).eq('is_shadowbanned',false).select().maybeSingle()
      if(error)throw error
      if(!data)throw Error('Ce compte a changé. Actualisez la liste avant de recommencer.')
      replaceAccount(data)
    },`Étape enregistrée pour ${account.pseudo}.`)
  }
  async function markReady(account){
    const patch=readyWithoutTracking(account)
    if(!patch)return
    await mutate(async()=>{
      let query=client.from('vinted_accounts').update(patch).eq('id',account.id).eq('is_shadowbanned',false)
      query=account.creation_stage==null?query.is('creation_stage',null):query.eq('creation_stage',account.creation_stage)
      query=account.statut==null?query.is('statut',null):query.eq('statut',account.statut)
      const {data,error}=await query.select().maybeSingle()
      if(error)throw error
      if(!data)throw Error('Ce compte a changé. Actualisez la liste avant de recommencer.')
      replaceAccount(data)
    },`${account.pseudo} est maintenant dans les comptes prêts.`)
  }
  async function remove(id){
    const ok=await mutate(async()=>{const {error}=await client.from('vinted_accounts').delete().eq('id',id);if(error)throw error;setAccounts(prev=>prev.filter(a=>a.id!==id))},'Compte supprimé.')
    if(ok){setSelectedId(null);setDeleteId(null)}
  }
  async function archive(account){
    const ok=await mutate(()=>updateAccount(account.id,{is_shadowbanned:true,is_ready:false}),'Compte rangé dans Shadowban.')
    if(ok){setView('shadowban');setSearch('');setDueOnly(false)}
  }
  const counts=Object.fromEntries(ACCOUNT_VIEWS.map(v=>[v.key,accounts.filter(a=>accountGroup(a)===v.key).length]))
  const dueCount=accounts.filter(a=>isAccountDue(a,now)).length
  const displayed=selectAccounts(accounts,{view,search,sort,dueOnly,now})
  const selected=accounts.find(a=>a.id===selectedId)
  const filtered=search||dueOnly
  function reset(){setSearch('');setDueOnly(false)}
  function openEdit(account){setSelectedId(null);setError('');setEditAccount(account)}

  return <main className="max-w-screen-2xl mx-auto p-4 space-y-4">
    <header className="flex flex-wrap justify-between items-center gap-3">
      <div><div className="flex items-center gap-2"><h1 className="text-xl font-bold text-gray-900">Comptes</h1><span className="text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{accounts.length}</span></div><p className="text-sm text-gray-500 mt-1">Les comptes en isolement et les comptes abandonnés restent séparés des comptes prêts.</p></div>
      <div className="flex gap-2"><button disabled={loading||busy} onClick={fetchAll} className={secondary}>Actualiser</button><button disabled={busy} onClick={()=>openEdit(null)} className="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm font-semibold disabled:opacity-50">+ Ajouter un compte</button></div>
    </header>
    {error&&<p role="alert" className="border border-red-200 bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</p>}
    {notice&&<p role="status" className="text-xs text-teal-700">{notice}</p>}
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap justify-between items-center gap-2 border-b border-gray-100 px-3 py-2.5">
        <nav aria-label="État des comptes" className="flex flex-wrap gap-1">{ACCOUNT_VIEWS.map(v=><button key={v.key} aria-pressed={view===v.key} onClick={()=>{setView(v.key);setDueOnly(false);setDeleteId(null)}} className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${view===v.key?'bg-teal-50 text-teal-700':'text-gray-500 hover:bg-gray-50'}`}>{v.label}<span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${view===v.key?'bg-teal-100':'bg-gray-100 text-gray-400'}`}>{counts[v.key]}</span></button>)}</nav>
        {(dueCount>0||dueOnly)&&<button aria-pressed={dueOnly} onClick={()=>{setView('isolation');setDueOnly(!dueOnly)}} className={`px-3 py-1.5 rounded-lg text-xs ${dueOnly?'bg-orange-100 text-orange-800 font-semibold':'text-orange-600 hover:bg-orange-50'}`}>{dueCount} échéance{dueCount>1?'s':''} à traiter{dueOnly?' ×':''}</button>}
      </div>
      <div className="p-3 flex flex-wrap gap-2 items-center bg-gray-50/50">
        <label className="relative flex-1 min-w-52"><span className="sr-only">Rechercher un compte</span><svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" strokeWidth="1.6"/><path d="m15 15 5 5" strokeWidth="1.6"/></svg><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pseudo, email, téléphone, AdsPower ou navigateur…" className="w-full border border-gray-200 rounded-lg py-2 pl-9 pr-3 text-sm bg-white focus:outline-none focus:border-teal-400"/></label>
        <select aria-label="Trier les comptes" value={sort} onChange={e=>setSort(e.target.value)} className={selectClass}><option value="priority">Priorité / échéance</option><option value="adspower">N° AdsPower</option><option value="name">Pseudo A → Z</option><option value="newest">Plus récents</option></select>
        {filtered&&<button onClick={reset} className="text-xs text-gray-500 px-2 py-2 hover:text-teal-600">Effacer les filtres</button>}
      </div>
      {view==='isolation'&&<div className="px-4 py-3 bg-amber-50 text-amber-900 text-xs leading-relaxed"><strong>Isolement sur téléphone</strong> · Jour 1 : création, puis 1re annonce après environ 2 h → Jour 2 : 2e annonce → Jour 3 : prêt à passer sur proxy. Après chaque annonce confirmée, le prochain rappel est fixé 24 h plus tard.</div>}
      {view==='shadowban'&&<p className="px-4 py-3 bg-gray-100 text-gray-600 text-xs">Comptes abandonnés : exclus des comptes prêts et du suivi de création.</p>}
      <div className="overflow-x-auto"><table className="w-full text-left min-w-[820px]"><thead className="text-[10px] uppercase tracking-wide text-gray-400 border-y border-gray-100"><tr>{['Compte','Prochaine étape','Échéance','Environnement','Action'].map(h=><th className="font-semibold px-4 py-3" key={h}>{h}</th>)}</tr></thead>
        <tbody>{loading?<tr><td colSpan="5" className="py-16 text-center text-sm text-gray-400">Chargement des comptes…</td></tr>:displayed.map(a=>{
          const group=accountGroup(a),due=isAccountDue(a,now),deadline=accountDeadline(a,now)
          const action=nextCreationStep(a,now)
          return <tr key={a.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/70 ${due?'bg-orange-50/30':''}`}>
            <td className="px-4 py-3"><div className="flex items-center gap-3"><span className={`w-9 h-9 rounded-lg flex items-center justify-center font-semibold text-xs shrink-0 ${group==='blocked'?'bg-gray-100 text-gray-400':'bg-teal-50 text-teal-700'}`}>{a.ads_power_num?`#${a.ads_power_num}`:a.pseudo?.slice(0,2).toUpperCase()}</span><div className="min-w-0"><button onClick={()=>{setSelectedId(a.id);setError('')}} className="font-semibold text-sm text-gray-900 hover:text-teal-600 text-left" aria-label={`Ouvrir ${a.pseudo}`}>{a.pseudo}</button><div className="text-xs text-gray-400 mt-0.5 flex gap-1.5 items-center"><span className="max-w-52 truncate" title={a.email||''}>{a.email||'Email non renseigné'}</span><CopyValue value={a.email} label={`Copier l’email de ${a.pseudo}`}/></div></div></div></td>
            <td className="px-4 py-3"><span className={`inline-block px-2 py-1 rounded-md text-[11px] font-medium ${tones[group]}`}>{nextAccountAction(a)}</span>{a.statut==='banni_temp'&&a.deban_at&&<p className="text-[10px] text-gray-400 mt-1">Fin prévue le {new Date(a.deban_at).toLocaleDateString('fr-FR')}</p>}</td>
            <td className="px-4 py-3"><p className={`text-xs ${due?'text-orange-700 font-semibold':'text-gray-600'}`}>{group!=='isolation'?'—':deadline||'À planifier'}</p>{deadline&&<p className="text-[10px] text-gray-400 mt-1">{new Date(a.creation_next_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>}</td>
            <td className="px-4 py-3"><p className="text-xs text-gray-700">{a.browser|| (a.ads_power_num?'AdsPower':'Navigateur non renseigné')}</p><p className="text-[11px] text-gray-400 mt-1">{group==='isolation'?'Téléphone · isolement':group==='shadowban'?'Ne plus utiliser':''}</p></td>
            <td className="px-4 py-3"><div className="flex flex-col items-start gap-1.5">{readyWithoutTracking(a)&&<button disabled={busy} onClick={()=>markReady(a)} className="text-xs font-semibold text-teal-600 hover:text-teal-800 disabled:opacity-40">Marquer comme prêt →</button>}{action&&<button disabled={busy} onClick={()=>advance(a)} className="text-xs font-semibold text-teal-600 hover:text-teal-800 disabled:opacity-40">{{post1:'1re annonce faite',post2:'2e annonce faite',wait:'Sortir de l’isolement'}[a.creation_stage]} →</button>}<div className="flex flex-wrap items-center gap-3"><button onClick={()=>{setSelectedId(a.id);setError('')}} className="text-xs text-gray-500 hover:text-gray-800">Voir la fiche</button><button disabled={busy} onClick={()=>{setDeleteId(a.id);setError('')}} aria-label={`Supprimer ${a.pseudo}`} className="text-xs text-red-600 hover:text-red-800 disabled:opacity-40">Supprimer</button></div>{deleteId===a.id&&<div role="group" aria-label={`Confirmer la suppression de ${a.pseudo}`} className="bg-red-50 border border-red-200 rounded-lg p-3 max-w-64 text-xs text-red-800"><p>Supprimer définitivement « {a.pseudo} » du suivi ?</p><p className="mt-1 text-red-600">Cela ne ferme pas le compte sur Vinted.</p><div className="flex gap-3 mt-3"><button disabled={busy} onClick={()=>remove(a.id)} className="font-semibold disabled:opacity-40">{busy?'Suppression…':'Confirmer'}</button><button disabled={busy} onClick={()=>setDeleteId(null)} className="disabled:opacity-40">Annuler</button></div></div>}</div></td>
          </tr>
        })}{!loading&&!displayed.length&&<tr><td colSpan="5" className="py-16 text-center"><p className="text-sm text-gray-500">{accounts.length?'Aucun compte ne correspond à ces filtres.':'Aucun compte dans ce groupe.'}</p>{filtered&&<button onClick={reset} className="mt-3 text-xs text-teal-600 font-semibold">Effacer les filtres</button>}</td></tr>}</tbody>
      </table></div>
      <footer className="px-4 py-3 border-t border-gray-100 flex flex-wrap justify-between gap-2 text-[11px] text-gray-400"><span>{displayed.length} compte{displayed.length>1?'s':''} affiché{displayed.length>1?'s':''} sur {accounts.length}</span><span>Les passages d’étape sont confirmés manuellement.</span></footer>
    </section>
    {selected&&<AccountDetails key={selected.id} account={selected} busy={busy} error={error} now={now} onClose={()=>setSelectedId(null)} onEdit={openEdit} onAdvance={advance} onMarkReady={markReady} onDelete={remove}
      onShadowban={()=>archive(selected)} />}
    {editAccount!==undefined&&<AccountFormModal account={editAccount} onClose={()=>setEditAccount(undefined)} onSave={handleSave} error={error}/>}
  </main>
}
