import {useEffect,useRef,useState} from 'react'
import {buttonClass,primaryClass,fieldClass} from './YlaVintUI'

const ago=v=>{if(!v)return '';const m=Math.round((Date.now()-Date.parse(v))/60000);if(m<1)return 'à l’instant';if(m<60)return `${m} min`;if(m<1440)return `${Math.round(m/60)} h`;return new Date(v).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}
const hour=v=>v?new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):''
const FILTERS=[['all','Toutes'],['unread','Non lues'],['human','À traiter'],['ai','Agent IA']]
const AI_BADGE={drafted:['Proposition IA','bg-violet-50 text-violet-700'],queued:['Réponse IA programmée','bg-teal-50 text-teal-700'],human:['À traiter toi-même','bg-amber-50 text-amber-800'],error:['IA en erreur','bg-rose-50 text-rose-700'],pending:['IA en cours…','bg-slate-100 text-slate-600'],drafting:['IA en cours…','bg-slate-100 text-slate-600']}
const STATE_TEXT={queued:'en attente d’envoi',failed:'non envoyé',cancelled:'annulé'}

function Avatar({src,name}){
 return src?<img src={src} alt="" className="h-10 w-10 shrink-0 rounded-full bg-slate-100 object-cover"/>:<span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500">{(name||'?').slice(0,1).toUpperCase()}</span>
}

function Thread({request,conv,onBack,onChanged}){
 const [data,setData]=useState(null),[text,setText]=useState(''),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const end=useRef(null),key=`${conv.account_id}:${conv.conversation_id}`
 const q=`&view=thread&account_id=${conv.account_id}&conversation_id=${conv.conversation_id}`
 const load=(read=true)=>request('GET',undefined,q+(read?'':'&read=0')).then(r=>{setData(r);setDraft(d=>d||r.conversation.ai_draft||'');setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{setData(null);setText('');setDraft('');load().then(onChanged);const t=setInterval(()=>{if(document.visibilityState==='visible')load(false)},10000);return()=>clearInterval(t)},[key])
 useEffect(()=>{end.current?.scrollIntoView({block:'end'})},[data?.messages?.length])
 async function act(body,after){
  setBusy(true);setError('');setNotice('')
  try{const r=await request('POST',{account_id:conv.account_id,conversation_id:conv.conversation_id,...body});if(r.message)setNotice(r.message);after?.(r);await load();onChanged()}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const c=data?.conversation||conv,agent=data?.agent
 return <div className="flex h-full min-h-[70vh] flex-col">
  <header className="flex items-center gap-3 border-b border-slate-100 px-3 py-3 sm:px-4">
   <button className="rounded-lg px-2 py-1 text-lg text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onBack} aria-label="Retour aux conversations">←</button>
   <Avatar src={c.other_photo} name={c.other_login}/>
   <div className="min-w-0 flex-1"><p className="truncate font-semibold">{c.other_login||'Membre Vinted'}</p><p className="truncate text-xs text-slate-500">Compte {c.login||'—'}{c.transaction_status?` · ${c.transaction_status}`:''}</p></div>
   <button className="rounded-lg px-2 py-1 text-xs text-slate-500 underline hover:bg-slate-50" disabled={busy} onClick={()=>act({action:'refresh_conversation'})}>Relire sur Vinted</button>
  </header>
  {(c.item_title||c.item_photo)&&<div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-3 py-2 sm:px-4">
   {c.item_photo?<img src={c.item_photo} alt="" className="h-12 w-10 rounded-md object-cover"/>:<span className="h-12 w-10 rounded-md bg-slate-100"/>}
   <p className="min-w-0 flex-1 truncate text-sm">{c.item_title||'Article'}</p>{c.item_price!=null&&<span className="text-sm font-semibold">{String(c.item_price).replace('.',',')} €</span>}
  </div>}
  {agent&&(!agent.enabled||agent.paused)&&<p className="bg-amber-50 px-4 py-2 text-xs text-amber-900">{!agent.enabled?'YlaVint n’est pas activé sur ce compte : les réponses ne partiront pas.':`YlaVint est en pause sur ce compte (${agent.pause_reason||'à relancer'}) : tes réponses attendront la reprise.`}</p>}
  <div className="flex-1 space-y-2 overflow-y-auto bg-[#faf8f5] px-3 py-4 sm:px-4">
   {!data&&<p className="text-sm text-slate-500">Chargement…</p>}
   {data&&!data.messages.length&&<p className="text-sm text-slate-500">Les messages arrivent à la prochaine lecture de YlaVint.</p>}
   {data?.messages.map(m=>m.kind==='action'||m.kind==='status'?<p key={m.id} className="mx-auto max-w-md rounded-xl bg-white px-3 py-1.5 text-center text-xs text-slate-500 ring-1 ring-slate-100">{m.body}</p>
    :<div key={m.id} className={`flex ${m.from_me?'justify-end':'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%] ${m.from_me?'rounded-br-md bg-[#08664c] text-white':'rounded-bl-md bg-white ring-1 ring-slate-100'} ${m.state==='failed'?'opacity-70 ring-2 ring-rose-300':''} ${m.state==='cancelled'?'line-through opacity-50':''}`}>
     <p className="whitespace-pre-wrap break-words">{m.kind==='offer'?'💶 ':''}{m.body}</p>
     <p className={`mt-1 text-[11px] ${m.from_me?'text-white/70':'text-slate-400'}`}>{hour(m.sent_at)}{m.source==='ai'?' · agent IA':m.source==='likes'?' · après un like':''}{STATE_TEXT[m.state]?` · ${STATE_TEXT[m.state]}`:''}{m.error?` · ${m.error}`:''}</p>
     {m.state==='queued'&&<button className="mt-1 text-[11px] underline" disabled={busy} onClick={()=>act({action:'cancel_message',message_id:m.message_id})}>Annuler l’envoi</button>}
     {m.state==='failed'&&<button className="mt-1 text-[11px] underline" disabled={busy} onClick={()=>act({action:'retry_message',message_id:m.message_id})}>Renvoyer</button>}
    </div></div>)}
   <div ref={end}/>
  </div>
  {error&&<p role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="bg-teal-50 px-4 py-2 text-xs text-teal-800">{notice}</p>}
  {c.needs_human&&<div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"><span>À traiter toi-même{c.ai_reason?` : ${c.ai_reason}`:''}</span><button className="text-xs underline" disabled={busy} onClick={()=>act({action:'human_done'})}>Marquer comme traité</button></div>}
  {c.ai_draft&&['drafted','human'].includes(c.ai_state)&&<div className="space-y-2 border-t border-violet-100 bg-violet-50/60 px-3 py-3 sm:px-4">
   <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Proposition de l’agent IA</p>
   <textarea className={fieldClass} rows={3} value={draft} onChange={e=>setDraft(e.target.value)} maxLength={2000}/>
   <div className="flex flex-wrap justify-end gap-2"><button className={buttonClass+' py-1.5'} disabled={busy} onClick={()=>act({action:'ai_discard'},()=>setDraft(''))}>Ignorer</button><button className={primaryClass+' py-1.5'} disabled={busy||!draft.trim()||c.allow_reply===false} onClick={()=>act({action:'ai_send',body:draft},()=>setDraft(''))}>Envoyer cette réponse</button></div>
  </div>}
  <form className="flex items-end gap-2 border-t border-slate-100 bg-white px-3 py-3 sm:px-4" onSubmit={e=>{e.preventDefault();if(text.trim())act({action:'reply',body:text},()=>setText(''))}}>
   <textarea className={fieldClass+' min-h-[44px] flex-1 resize-none'} rows={text.split('\n').length>2?4:1} placeholder={c.allow_reply===false?'Vinted ne permet plus de répondre ici':'Écris ta réponse…'} disabled={c.allow_reply===false} value={text} maxLength={2000}
    onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();if(text.trim())act({action:'reply',body:text},()=>setText(''))}}}/>
   <button type="button" className={buttonClass+' shrink-0 px-2.5'} title="Proposer une réponse avec l’agent IA" disabled={busy} onClick={()=>act({action:'ai_suggest'},r=>{if(r.reply)setDraft(r.reply)})}>✨ IA</button>
   <button className={primaryClass+' shrink-0'} disabled={busy||!text.trim()||c.allow_reply===false}>Envoyer</button>
  </form>
 </div>
}

// Messagerie centralisée : toutes les conversations de tous les comptes, sur le site comme sur le téléphone.
export default function YlaVintInbox({request,accounts=[]}){
 const [rows,setRows]=useState(null),[filter,setFilter]=useState('all'),[account,setAccount]=useState(''),[search,setSearch]=useState(''),[current,setCurrent]=useState(null),[error,setError]=useState(''),[ai,setAi]=useState(null)
 const query=`&view=inbox&filter=${filter}${account?`&account_id=${account}`:''}${search.trim()?`&q=${encodeURIComponent(search.trim())}`:''}`
 const load=()=>request('GET',undefined,query).then(r=>{setRows(r.conversations);setAi(r.ai);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},20000);return()=>clearInterval(t)},[query])
 const enabled=accounts.filter(a=>a.settings?.enabled&&(a.settings.features.inbox||a.settings.features.ai))
 return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
  <div className="grid lg:grid-cols-[minmax(300px,380px)_1fr]">
   <div className={`border-slate-100 lg:border-r ${current?'hidden lg:block':''}`}>
    <div className="space-y-2 border-b border-slate-100 p-3">
     <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Messagerie</h2>{ai&&<span className={`rounded-full px-2 py-0.5 text-xs ${ai.enabled?'bg-violet-50 text-violet-700':'bg-slate-100 text-slate-500'}`}>Agent IA {ai.enabled?(ai.mode==='auto'?'· répond seul':'· propose'):'coupé'}</span>}</div>
     <div className="flex gap-2"><input className={fieldClass+' py-1.5'} placeholder="Membre ou article" value={search} onChange={e=>setSearch(e.target.value)}/>
      <select className={fieldClass.replace('w-full ','')+' w-36 py-1.5'} value={account} onChange={e=>setAccount(e.target.value)}><option value="">Tous les comptes</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></div>
     <div className="flex gap-1 overflow-x-auto">{FILTERS.map(([k,l])=><button key={k} onClick={()=>setFilter(k)} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${filter===k?'bg-slate-800 text-white':'text-slate-600 hover:bg-slate-100'}`}>{l}</button>)}</div>
    </div>
    {error&&<p role="alert" className="p-3 text-sm text-red-700">{error}</p>}
    {!enabled.length&&<p className="m-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Aucun compte n’a la messagerie activée : YlaVint → Réglages → Régler un compte → « Messagerie centralisée ».</p>}
    <ul className="max-h-[75vh] divide-y divide-slate-50 overflow-y-auto">{rows===null?<li className="p-4 text-sm text-slate-500">Chargement…</li>:!rows.length?<li className="p-4 text-sm text-slate-500">Aucune conversation.</li>:rows.map(r=>{const k=`${r.account_id}:${r.conversation_id}`,badge=AI_BADGE[r.ai_state]
     return <li key={k}><button onClick={()=>setCurrent(r)} className={`flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-slate-50 ${current&&`${current.account_id}:${current.conversation_id}`===k?'bg-teal-50/60':''}`}>
      <Avatar src={r.other_photo} name={r.other_login}/>
      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className={`truncate ${r.unseen?'font-semibold':'font-medium'}`}>{r.other_login||'Membre Vinted'}</span><span className="ml-auto shrink-0 text-[11px] text-slate-400">{ago(r.last_message_at)}</span></span>
       <span className="block truncate text-xs text-slate-500">{r.login} · {r.item_title||'Conversation'}</span>
       <span className={`mt-0.5 block truncate text-sm ${r.unseen?'text-slate-900':'text-slate-500'}`}>{r.last_from_me?'Toi : ':''}{r.last_message||'…'}</span>
       {(badge||r.needs_human)&&<span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${(r.needs_human?AI_BADGE.human:badge)[1]}`}>{(r.needs_human?AI_BADGE.human:badge)[0]}</span>}</span>
      {r.unseen&&<span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[#c83469]" aria-label="non lu"/>}
     </button></li>})}</ul>
   </div>
   <div className={current?'':'hidden lg:block'}>{current?<Thread key={`${current.account_id}:${current.conversation_id}`} request={request} conv={current} onBack={()=>setCurrent(null)} onChanged={load}/>
    :<div className="grid min-h-[60vh] place-items-center p-8 text-center text-sm text-slate-500"><div><p className="text-base font-semibold text-slate-700">Toutes tes conversations, au même endroit</p><p className="mt-1">Choisis une conversation. Tes réponses partent par le Bridge YlaVint du compte dès que son profil AdsPower est ouvert.</p></div></div>}</div>
  </div>
 </section>
}
