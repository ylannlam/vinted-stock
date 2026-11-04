import {useEffect,useRef,useState} from 'react'
import {groupBoard,stateLabel,sinceLabel} from '../lib/teamBoard'
import {ErrorNotice,buttonClass,primaryClass,fieldClass} from './WorkspaceUI'

const defaultRequest=(...a)=>import('../lib/api').then(m=>m.listingStudioRequest(...a))
const date=v=>new Date(v).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
const tones={now:'border-amber-200 bg-amber-50 text-amber-900',feed:'border-teal-200 bg-teal-50 text-teal-900',rest:'border-slate-200 bg-slate-50 text-slate-700',blocked:'border-rose-200 bg-rose-50 text-rose-800'}

function PublishedLink({draft,busy,onSave}) {
  const [url,setUrl]=useState('')
  return <form className="flex flex-wrap gap-2 items-center" onSubmit={e=>{e.preventDefault();if(url.trim())onSave(draft,url.trim())}}>
    <span className="min-w-0 flex-1 text-sm truncate" title={draft.title}>{draft.title}</span>
    <input aria-label={`Lien Vinted de ${draft.title}`} className={`${fieldClass} sm:w-64`} inputMode="url" placeholder="Colle le lien Vinted une fois publiée" value={url} disabled={busy} onChange={e=>setUrl(e.target.value)}/>
    <button className={buttonClass} disabled={busy||!url.trim()}>Publiée</button>
  </form>
}

function AccountCard({row,section,busy,onCreate,onStyles,onProfiles,onPublished}) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="font-semibold break-all">{row.login}</h3><p className="text-xs text-slate-500 mt-1">{row.profile?.number?`Profil AdsPower n°${row.profile.number}`:row.profile?'Profil AdsPower relié':'Aucun profil AdsPower relié'}{row.profile?.name&&row.profile.name!==row.login?` · ${row.profile.name}`:''}</p></div>
      <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tones[section]}`}>{stateLabel(row)}</span>
    </div>
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
      {[["Aujourd’hui",row.today],['7 jours',row.week],['Dernière',sinceLabel(row.last_at)],['Fiches en cours',row.drafts]].map(([label,value])=><div key={label} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="font-semibold mt-1">{value}</dd></div>)}
    </dl>
    <div className="flex flex-wrap items-center gap-2">
      {['now','feed'].includes(section)?row.can_create&&row.profile?<button className={primaryClass} disabled={busy} onClick={()=>onCreate(row.profile.id)}>Créer une annonce</button>:<button className={buttonClass} disabled={busy} onClick={onProfiles}>Choisir ce compte dans AdsPower</button>:<span className="text-sm text-slate-500">{section==='rest'?'Rien à publier aujourd’hui sur ce compte.':'Ne rien publier sur ce compte.'}</span>}
      {row.style?.ready?<span className="text-xs text-teal-800">✓ Style du compte prêt</span>:<button className={buttonClass} disabled={busy} onClick={onStyles}>{row.style?'Compléter le style du compte':'Créer le style du compte'}</button>}
    </div>
    {!!row.mine.length&&<div className="space-y-2 border-t pt-3"><p className="text-xs font-medium text-slate-500">Mes fiches pour ce compte : colle le lien une fois l’annonce en ligne</p>{row.mine.map(d=><PublishedLink key={d.id} draft={d} busy={busy} onSave={onPublished}/>)}</div>}
    {!!row.recent.length&&<details className="border-t pt-3"><summary className="text-xs font-medium text-slate-500 cursor-pointer">Dernières publications notées ({row.recent.length})</summary><ul className="mt-2 space-y-1 text-sm">{row.recent.map(r=><li key={r.id} className="flex flex-wrap justify-between gap-2"><a className="text-teal-800 underline underline-offset-4 truncate max-w-full" href={r.url} target="_blank" rel="noopener noreferrer">{r.title||'Annonce'}</a><span className="text-xs text-slate-500">{r.author} · {date(r.published_at)}</span></li>)}</ul></details>}
  </article>
}

export default function TeamBoardTab({request=defaultRequest,onCreateListing,onStyles,onAccounts,onProfiles}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('')
  const alive=useRef(true),revision=useRef(0),saving=useRef(false)
  async function load(){const ticket=++revision.current;setBusy(true);try{const next=await request('GET',undefined,'action=board');if(alive.current&&ticket===revision.current){setData(next);setError('')}}catch(e){if(alive.current&&ticket===revision.current)setError(e.message)}finally{if(alive.current&&ticket===revision.current)setBusy(false)}}
  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;revision.current++}},[request])
  async function published(draft,url){
    if(saving.current)return
    saving.current=true;revision.current++;setBusy(true);setError('');setNotice('')
    try{await request('POST',{action:'mark_published',id:draft.id,version:draft.version,url});if(alive.current)setNotice(`« ${draft.title} » est notée comme publiée.`);if(alive.current)await load()}
    catch(e){if(alive.current){setError(e.message);setBusy(false)}}finally{saving.current=false}
  }
  const rows=data?.accounts||[],sections=groupBoard(rows,{search}),today=rows.reduce((n,r)=>n+r.today,0)
  return <main className="workspace-page max-w-screen-2xl mx-auto p-4 sm:p-6 space-y-5 text-slate-800">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Poste de travail d’Alicia</p><h1 className="text-2xl font-bold mt-1">Comptes à alimenter</h1><p className="text-sm text-slate-500 mt-1">Commence par le haut. Rien n’est publié automatiquement : publie à la main sur Vinted, puis colle le lien ici.</p></div><button className={buttonClass} disabled={busy} onClick={load}>Actualiser</button></header>
    <ErrorNotice error={error} retry={load} busy={busy}/>
    {notice&&<p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{notice}</p>}
    {data&&<div className="flex flex-wrap items-center gap-3"><p className="text-sm"><strong>{today}</strong> annonce{today>1?'s':''} publiée{today>1?'s':''} aujourd’hui sur {rows.filter(r=>r.today).length} compte{rows.filter(r=>r.today).length>1?'s':''}</p><input aria-label="Chercher un compte" className={`${fieldClass} sm:w-72 ml-auto`} placeholder="Chercher un compte ou un n° de profil" value={search} onChange={e=>setSearch(e.target.value)}/></div>}
    {!data&&busy&&<p role="status" className="py-12 text-center text-slate-500">Chargement des comptes…</p>}
    {data&&!rows.length&&<p className="rounded-xl border bg-white p-6 text-sm text-slate-600">Aucun compte relié pour l’instant. Les comptes apparaissent ici une fois connectés dans l’onglet AdsPower.</p>}
    {data&&!!rows.length&&!sections.some(s=>s.rows.length)&&<p role="status" className="py-8 text-center text-slate-500">Aucun compte ne correspond à cette recherche.</p>}
    {sections.map(section=>section.rows.length?<section key={section.key} aria-label={section.title} className="space-y-3">
      {section.key==='blocked'?<details><summary className="cursor-pointer font-semibold">{section.title} <span className="font-normal text-slate-400">· {section.rows.length}</span></summary><p className="text-sm text-slate-500 mt-1 mb-3">{section.hint} <button className="underline" onClick={onAccounts}>Voir dans « Comptes »</button></p><div className="grid gap-3 lg:grid-cols-2">{section.rows.map(row=><AccountCard key={row.account_id} row={row} section={section.key} busy={busy} onCreate={onCreateListing} onStyles={onStyles} onProfiles={onProfiles} onPublished={published}/>)}</div></details>:<>
        <div><h2 className="font-semibold text-lg">{section.title} <span className="font-normal text-slate-400">· {section.rows.length}</span></h2><p className="text-sm text-slate-500">{section.hint}</p></div>
        <div className="grid gap-3 lg:grid-cols-2">{section.rows.map(row=><AccountCard key={row.account_id} row={row} section={section.key} busy={busy} onCreate={onCreateListing} onStyles={onStyles} onProfiles={onProfiles} onPublished={published}/>)}</div>
      </>}
    </section>:null)}
  </main>
}
