import {useCachedState} from '../lib/useCachedState'
import {useEffect,useState} from 'react'
import {TAB_SALES,TAB_TOUT,TAB_A_ENVOYER,TAB_A_RECEVOIR} from '../constants'
import {ErrorNotice,buttonClass} from './WorkspaceUI'
import SaleActions from './SaleActions'
const defaultRequest=(...args)=>import('../lib/api').then(m=>m.workspaceRequest(...args))
export default function HomeTab({isAdmin,onNavigate,request=defaultRequest}){
 const [data,setData]=useCachedState(request,'overview',null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function load(){setBusy(true);try{setData(await request());setError('')}catch(e){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},30000);return()=>clearInterval(timer)},[])
 const date=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Paris'}).format(new Date())
 const tiles=data?[
  {label:'Échéances proches',value:data.sales.urgent,detail:'Moins de 48 h ou en retard',tab:TAB_SALES,filters:{urgent:true},warning:true},
  {label:'Achats à passer',value:data.sales.to_order,detail:'Ventes Dotb à approvisionner',tab:TAB_SALES,filters:{stage:'to_order'}},
  {label:'Colis prêts',value:data.sales.to_ship,detail:'Ventes Dotb à déposer',tab:TAB_SALES,filters:{stage:'prepared'}},
  {label:'Références manquantes',value:data.sales.missing_sku,detail:'SKU à compléter',tab:TAB_SALES,filters:{stage:'missing_sku'}},
 ]:[]
 return <main className="workspace-page mx-auto max-w-screen-2xl p-4 sm:p-6 space-y-6">
  <header className="flex flex-wrap justify-between items-center gap-3"><div><p className="text-sm text-teal-700 capitalize">{date}</p><h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">À faire aujourd’hui</h1><p className="mt-2 text-sm text-slate-500">Voici les ventes à préparer et les colis à envoyer.</p></div><button disabled={busy} className={buttonClass} onClick={load}>{busy?'Actualisation…':'Actualiser'}</button></header>
  <ErrorNotice error={error} retry={load} busy={busy}/>
  {!data&&!error?<p role="status" className="p-8 text-slate-500">Chargement des priorités…</p>:data&&<>
   <section aria-label="Priorités des ventes" className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">{tiles.map(t=><button key={t.label} onClick={()=>onNavigate(t.tab,t.filters)} className={`text-left border rounded-2xl p-4 sm:p-5 transition hover:shadow-md ${t.warning&&t.value?'border-amber-200 bg-amber-50':'border-slate-200 bg-white'}`}><p className="text-sm font-medium text-slate-600">{t.label}</p><p className={`text-3xl font-semibold my-3 ${t.warning&&t.value?'text-amber-800':'text-slate-900'}`}>{t.value}</p><p className="text-xs text-slate-500">{t.detail} ↗</p></button>)}</section>
   <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5"><SaleActions request={request} onOpen={id=>onNavigate(TAB_SALES,{line:id})}/><section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4 self-start"><h2 className="font-semibold text-lg">Mon stock physique</h2><p className="text-sm text-slate-500">Les articles que tu as déjà chez toi.</p>{[[`${data.stock.available} articles disponibles`,TAB_TOUT],[`${data.stock.to_ship} articles à envoyer`,TAB_A_ENVOYER],[`${data.stock.receiving} commandes à recevoir`,TAB_A_RECEVOIR]].map(([label,tab])=><button key={tab} className="flex justify-between w-full rounded-xl bg-slate-50 p-3 text-sm font-medium" onClick={()=>onNavigate(tab)}>{label}<span>→</span></button>)}</section></div>

  </>}
 </main>
}
