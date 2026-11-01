import {Component} from 'react'
export const fieldClass='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-teal-600 disabled:opacity-50'
export const buttonClass='inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50'
export const primaryClass='inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50'
export function ErrorNotice({error,retry,busy}){return error?<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span>{error}</span>{retry&&<button disabled={busy} className={buttonClass} onClick={retry}>Réessayer</button>}</div>:null}
export function Pagination({page,count,size=50,onChange,busy}){return <nav aria-label="Pages des résultats" className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-slate-500"><span>{count?`${page*size+1}–${Math.min((page+1)*size,count)} sur ${count}`:'Aucun résultat'}</span><div className="flex gap-2"><button className={buttonClass} disabled={busy||page<=0} onClick={()=>onChange(page-1)}>Précédent</button><button className={buttonClass} disabled={busy||(page+1)*size>=count} onClick={()=>onChange(page+1)}>Suivant</button></div></nav>}
export class PageBoundary extends Component {
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 componentDidCatch(error){console.error('screen_failed',error.name)}
 render(){return this.state.failed?<div className="max-w-3xl mx-auto p-6"><ErrorNotice error="Cet écran n’a pas pu s’afficher. Recharge-le pour réessayer." retry={()=>window.location.reload()}/></div>:this.props.children}
}
