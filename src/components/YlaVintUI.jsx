// Interface sombre de YlaVint : mêmes noms que WorkspaceUI pour que les rubriques passent d'un thème à l'autre.
export const fieldClass='ylv-field w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none disabled:opacity-50'
export const buttonClass='ylv-button inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-50'
export const primaryClass='ylv-primary inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'
export const compactClass=fieldClass.replace('w-full ','')

const PILLS={blue:'bg-blue-500/15 text-blue-300 ring-blue-500/30',green:'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',red:'bg-rose-500/15 text-rose-300 ring-rose-500/30',
 amber:'bg-amber-500/15 text-amber-300 ring-amber-500/30',violet:'bg-violet-500/15 text-violet-300 ring-violet-500/30',zinc:'bg-zinc-700/40 text-zinc-300 ring-zinc-600/40'}
export const Pill=({tone='zinc',children,icon})=><span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PILLS[tone]}`}>{icon&&<span aria-hidden="true">{icon}</span>}{children}</span>

export const Card=({className='',children})=><div className={`ylv-card rounded-2xl border border-zinc-800 ${className}`}>{children}</div>

const paths={grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',message:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 9h10M7 13h6',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',monitor:'M3 4h18v13H3zM8 21h8M12 17v4',bag:'M4 7h16l1 14H3L4 7ZM8 7V5a4 4 0 0 1 8 0v2',chart:'M3 3v18h18M7 15l4-5 4 3 5-7',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',arrow:'M5 12h14M13 6l6 6-6 6',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',check:'m5 12 4 4L19 6',box:'m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7.5 5 16.5 9'}
export const Icon=({name='spark',className=''})=><svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.spark}/></svg>

// En-tête partagé par les rubriques YlaVint.
export function PageTitle({title,hint,aside}){
 return <header className="ylv-page-title flex flex-wrap items-end justify-between gap-4 pb-2">
  <div><p className="ylv-eyebrow mb-2">YlaVint / ton espace</p><h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>{hint&&<p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">{hint}</p>}</div>
  {aside&&<div className="flex flex-wrap gap-2">{aside}</div>}
 </header>
}

export function StatCard({label,value,icon,sub,tone,onClick}){
 const Tag=onClick?'button':'div'
 return <Tag onClick={onClick} className={`ylv-stat ylv-stat-${tone||'blue'} flex flex-col rounded-2xl border border-zinc-800 p-5 text-left ${onClick?'ylv-interactive':''}`}>
  <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-zinc-300">{label}</p>{icon&&<span className="ylv-stat-icon grid h-10 w-10 place-items-center rounded-xl" aria-hidden="true">{icon}</span>}</div>
  <p className="ylv-stat-value mt-3 text-3xl font-semibold tracking-tight tabular-nums text-white">{value}</p>
  {sub&&<p className="mt-2 text-xs leading-relaxed text-zinc-400">{sub}</p>}
 </Tag>
}

export function Table({head,children,empty}){
 return <div className="ylv-table overflow-x-auto rounded-2xl border border-zinc-800">
  <table className="w-full min-w-[720px] text-left text-sm">
   <thead className="border-b border-zinc-800 text-xs font-semibold text-zinc-300"><tr>{head.map((h,i)=><th key={i} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead>
   <tbody className="divide-y divide-zinc-800/80">{children}</tbody>
  </table>
  {empty&&<p className="p-6 text-center text-sm text-zinc-500">{empty}</p>}
 </div>
}
export const Td=({className='',children,...p})=><td className={`px-4 py-3 align-middle ${className}`} {...p}>{children}</td>

export function Section({title,hint,aside,children}){
 return <section className="ylv-card space-y-4 rounded-2xl border border-zinc-800 p-4 sm:p-6">
  <header className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="font-semibold text-white">{title}</h2>{hint&&<p className="mt-1 text-xs text-zinc-400">{hint}</p>}</div>{aside}</header>
  {children}
 </section>
}
