import {Card,StatCard,Icon,Pill,buttonClass,primaryClass} from './YlaVintUI'
import {isDesktop} from '../lib/ylavintExecution'

const euro=n=>Number(n||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})
const recent=v=>!!v&&Date.now()-Date.parse(v)<15*60000
const time=v=>v?new Date(v).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'—'

export default function YlaVintDashboard({accounts,data,orders,revenue,toShip,transit,range,periodPicker,chart,onNavigate,onRefresh,busy}){
 const enabled=accounts.filter(a=>a.settings?.enabled&&!a.settings.paused).length,paused=accounts.filter(a=>a.settings?.enabled&&a.settings.paused).length
 const stopped=accounts.length-enabled-paused,total=accounts.length||1,a=enabled/total*100,b=(enabled+paused)/total*100
 const pc=accounts.filter(a=>isDesktop(a.settings)).length,unread=data.unread_total||0
 const names=new Map(accounts.map(a=>[a.id,a.login])),logs=(data.log||[]).slice(0,4)
 const status=[['Activés',enabled,'#869bff'],['En pause',paused,'#efbd7b'],['Non activés',stopped,'#41516b']]
 return <div className="space-y-6">
  <section className="ylv-hero rounded-3xl p-6 sm:p-8">
   <div className="flex flex-wrap items-center justify-between gap-4"><p className="ylv-eyebrow">Ton espace de pilotage</p><span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-blue-100">{new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</span></div>
   <div className="mt-5 flex flex-wrap items-end justify-between gap-6"><div><h1 className="font-semibold text-white">Une vue claire.<br/><span className="text-[#b5c2ff]">Toutes tes boutiques.</span></h1><p className="mt-3 max-w-lg text-sm leading-relaxed text-[#b4c3df]">Tes ventes, tes conversations et tes assistants,<br className="hidden sm:block"/> réunis dans un seul espace.</p></div>
    <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={()=>onNavigate('messagerie')}><Icon name="message"/>Messagerie{unread>0&&<span className="rounded-full bg-indigo-400/20 px-1.5 text-xs">{unread}</span>}</button><button className={primaryClass} onClick={()=>onNavigate('assistant-pc')}><Icon name="monitor"/>Ouvrir l’assistant<Icon name="arrow"/></button></div>
   </div>
  </section>
  {!data.ai_ready&&<p className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">La connexion IA doit être configurée pour préparer des réponses.</p>}
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">Ton activité</h2><p className="mt-1 text-xs text-zinc-400">{range==='today'?'Aujourd’hui':range==='7d'?'Les 7 derniers jours':'Les 30 derniers jours'} · ventes synchronisées par YlaVint</p></div><div className="flex flex-wrap gap-2">{periodPicker}<button className={buttonClass} onClick={onRefresh} disabled={busy} aria-label="Actualiser le tableau de bord">↻</button></div></div>
  <div className="grid grid-cols-2 gap-3 min-[1200px]:grid-cols-4 sm:gap-4">
   <StatCard label="Chiffre d’affaires" value={euro(revenue)} icon={<Icon name="chart"/>} tone="blue" sub="Hors annulations et retours"/>
   <StatCard label="Commandes" value={orders.length} icon={<Icon name="bag"/>} tone="violet" sub={`Panier moyen · ${euro(orders.length?revenue/orders.length:0)}`} onClick={()=>onNavigate('commandes')}/>
   <StatCard label="À expédier" value={toShip} icon={<Icon name="box"/>} tone="amber" sub={`${transit} commande${transit>1?'s':''} en transit · toutes périodes`} onClick={()=>onNavigate('commandes')}/>
   <StatCard label="Messages non lus" value={unread} icon={<Icon name="message"/>} tone="green" sub={`${data.human_total||0} à traiter toi-même · tous les comptes`} onClick={()=>onNavigate('messagerie')}/>
  </div>
  <div className="grid gap-4 min-[1200px]:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">
   <Card className="p-5 sm:p-6"><div className="mb-5 flex items-start justify-between gap-3"><div><p className="ylv-eyebrow mb-2">Performance</p><h2 className="text-lg font-semibold text-white">L’évolution de tes ventes</h2></div><Pill tone="blue">{range==='today'?'24 heures':range==='7d'?'7 jours':'30 jours'}</Pill></div>{chart}{!orders.length&&<p className="mt-1 text-xs text-zinc-400">Aucune vente synchronisée pour cette période.</p>}{pc>0&&<p className="mt-2 text-xs text-zinc-400">Les nouvelles ventes se synchronisent avec le mode Extension.</p>}</Card>
   <Card className="p-5 sm:p-6"><p className="ylv-eyebrow mb-2">Tes boutiques</p><h2 className="text-lg font-semibold text-white">État des comptes</h2>
    <div className="mx-auto my-6 grid h-36 w-36 place-items-center rounded-full" role="img" aria-label={`${enabled} comptes activés, ${paused} en pause, ${stopped} non activés`} style={{background:`conic-gradient(#869bff 0% ${a}%,#efbd7b ${a}% ${b}%,#34445f ${b}% 100%)`}}><div className="grid h-[120px] w-[120px] content-center rounded-full bg-[#121c30] text-center"><span className="text-3xl font-semibold text-white">{accounts.length}</span><span className="mt-1 text-xs text-zinc-400">comptes reliés</span></div></div>
    <div className="space-y-2.5">{status.map(([label,count,color])=><div key={label} className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full" style={{background:color}}/><span className="flex-1 text-zinc-300">{label}</span><span className="font-medium tabular-nums text-white">{count}</span></div>)}</div>
    <button className={buttonClass+' mt-5 w-full'} onClick={()=>onNavigate('reglages')}>Gérer mes comptes<Icon name="arrow"/></button>
   </Card>
  </div>
  <div className="grid gap-4 min-[1200px]:grid-cols-2">
   <Card className="p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Tes comptes, en un regard</h2><Pill tone="violet">{pc} en mode PC</Pill></div>
    <ul className="mt-3 max-h-72 overflow-y-auto">{accounts.slice().sort((a,b)=>Number(recent(b.last_seen_at))-Number(recent(a.last_seen_at))).slice(0,8).map(account=><li className="ylv-account-row flex items-center gap-3" key={account.id}><span className="ylv-avatar grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-semibold">{account.login.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white">{account.login}</p><p className="mt-1 text-xs text-zinc-400">{isDesktop(account.settings)?'Assistant PC':'Extension'} · {recent(account.last_seen_at)?'contact récent':'en attente de contact'}</p></div><Pill tone={account.alert?'red':account.settings?.paused?'amber':account.settings?.enabled?'blue':'zinc'}>{account.alert?'À vérifier':account.settings?.paused?'En pause':account.settings?.enabled?'Activé':'Non activé'}</Pill></li>)}</ul>
    {!accounts.length&&<p className="py-6 text-sm text-zinc-400">Relie un premier compte pour commencer.</p>}<p className="mt-3 text-xs leading-relaxed text-zinc-400">Le statut d’exécution sur cet ordinateur est disponible dans Assistant PC.</p>
   </Card>
   <Card className="p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Dernière activité</h2><button className="text-xs font-medium text-indigo-300 hover:text-indigo-200" onClick={()=>onNavigate('journal')}>Tout voir →</button></div>
    <ol className="mt-4 space-y-5">{logs.map((l,i)=><li key={l.id??i} className="flex gap-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${l.level==='error'?'bg-rose-400':l.level==='warn'?'bg-amber-300':'bg-indigo-400'}`}/><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="text-xs font-medium text-zinc-300">{names.get(l.account_id)||'YlaVint'}</p><span className="text-[11px] text-zinc-400">{time(l.created_at)}</span></div><p className="mt-1 text-sm leading-relaxed text-zinc-400">{l.message}</p></div></li>)}</ol>
    {!logs.length&&<p className="py-8 text-sm text-zinc-400">L’activité de tes comptes apparaîtra ici.</p>}
   </Card>
  </div>
 </div>
}
