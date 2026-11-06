import {useState} from 'react'
import {useAccountHealth} from '../lib/useAccountHealth'
import {healthView} from '../lib/accountHealth'

const KEY='vs-health-seen'
const day=value=>{const [y,m,d]=String(value).split('-');return `${d}/${m}`}

// Alerte visible sur tout le site dès qu'un message Vinted signale un compte bloqué ou restreint.
// La relecture des alertes Dotb tourne toutes les 5 minutes tant que le site est ouvert.
export default function AccountAlertBanner({onOpen,request}){
 const {data,now}=useAccountHealth(request)
 const [seen,setSeen]=useState(()=>{try{return Number(localStorage.getItem(KEY))||0}catch{return 0}})
 const fresh=(data?.accounts||[]).map(a=>({a,h:healthView(a,now)}))
  .filter(({h})=>h.attention&&h.source==='dotb'&&!['review','verification'].includes(h.status)&&Date.parse(h.checked_at)>seen)
  .sort((x,y)=>Date.parse(y.h.checked_at)-Date.parse(x.h.checked_at))
 if(!fresh.length)return null
 const dismiss=()=>{const at=Date.now();try{localStorage.setItem(KEY,String(at))}catch{};setSeen(at)}
 return <div role="alert" className="mx-auto mt-3 max-w-screen-2xl px-4 sm:px-6">
  <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
   <div className="min-w-0"><p className="font-semibold">Alerte Vinted · {fresh.length>1?`${fresh.length} comptes touchés`:'1 compte touché'}</p>
    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{fresh.slice(0,8).map(({a,h})=><li key={a.id}><strong>{a.login}</strong> — {h.label}{h.until_date?` jusqu’au ${day(h.until_date)}`:''}</li>)}{fresh.length>8&&<li>et {fresh.length-8} autre(s)</li>}</ul></div>
   <div className="flex shrink-0 gap-2"><button className="rounded-lg bg-rose-700 px-3 py-1.5 font-medium text-white hover:bg-rose-800" onClick={onOpen}>Voir les comptes</button><button className="rounded-lg border border-rose-300 px-3 py-1.5 hover:bg-rose-100" onClick={dismiss}>J’ai vu</button></div>
  </div>
 </div>
}
