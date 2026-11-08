// Interface sombre de YlaVint : mêmes noms que WorkspaceUI pour que les rubriques passent d'un thème à l'autre.
export const fieldClass='w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none disabled:opacity-50'
export const buttonClass='inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-50'
export const primaryClass='inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'
export const compactClass=fieldClass.replace('w-full ','')

const PILLS={blue:'bg-blue-500/15 text-blue-300 ring-blue-500/30',green:'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',red:'bg-rose-500/15 text-rose-300 ring-rose-500/30',
 amber:'bg-amber-500/15 text-amber-300 ring-amber-500/30',violet:'bg-violet-500/15 text-violet-300 ring-violet-500/30',zinc:'bg-zinc-700/40 text-zinc-300 ring-zinc-600/40'}
export const Pill=({tone='zinc',children,icon})=><span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PILLS[tone]}`}>{icon&&<span aria-hidden="true">{icon}</span>}{children}</span>

export const Card=({className='',children})=><div className={`rounded-xl border border-zinc-800 bg-[#1c1c1f] ${className}`}>{children}</div>

// Titre de page centré, comme les tableaux de bord de gestion Vinted.
export function PageTitle({title,hint,aside}){
 return <header className="relative pb-2 text-center">
  <h1 className="text-lg font-bold text-white">{title}</h1>{hint&&<p className="mx-auto mt-1 max-w-3xl text-xs text-zinc-400">{hint}</p>}
  {aside&&<div className="mt-3 flex flex-wrap justify-center gap-2 lg:absolute lg:right-0 lg:top-0 lg:mt-0">{aside}</div>}
 </header>
}

export function StatCard({label,value,icon,sub,tone,onClick}){
 const Tag=onClick?'button':'div'
 return <Tag onClick={onClick} className={`rounded-xl border border-zinc-800 bg-[#1c1c1f] p-5 text-left ${onClick?'hover:border-zinc-600':''}`}>
  <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-zinc-200">{label}</p>{icon&&<span className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-800 text-sm text-zinc-400" aria-hidden="true">{icon}</span>}</div>
  <p className={`mt-2 text-2xl font-bold tabular-nums ${tone==='red'?'text-rose-400':tone==='amber'?'text-amber-300':tone==='blue'?'text-blue-400':'text-white'}`}>{value}</p>
  {sub&&<p className="mt-1 text-xs text-zinc-500">{sub}</p>}
 </Tag>
}

export function Table({head,children,empty}){
 return <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#1c1c1f]">
  <table className="w-full min-w-[720px] text-left text-sm">
   <thead className="border-b border-zinc-800 text-xs font-semibold text-zinc-300"><tr>{head.map((h,i)=><th key={i} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead>
   <tbody className="divide-y divide-zinc-800/80">{children}</tbody>
  </table>
  {empty&&<p className="p-6 text-center text-sm text-zinc-500">{empty}</p>}
 </div>
}
export const Td=({className='',children,...p})=><td className={`px-4 py-3 align-middle ${className}`} {...p}>{children}</td>

export function Section({title,hint,aside,children}){
 return <section className="space-y-3 rounded-xl border border-zinc-800 bg-[#1c1c1f] p-4 sm:p-5">
  <header className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="font-semibold text-white">{title}</h2>{hint&&<p className="mt-1 text-xs text-zinc-400">{hint}</p>}</div>{aside}</header>
  {children}
 </section>
}
