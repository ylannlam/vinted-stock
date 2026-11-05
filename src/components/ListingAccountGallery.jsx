import {useState} from 'react'

// Choisir où publier : chaque compte avec son fond (celui de ses photos d'annonce), son pseudo dessous.
// Les comptes à éviter (restreints, bloqués) sont rangés à part, en fin de liste.
const since=v=>{if(!v)return null;const m=Math.round((Date.now()-Date.parse(v))/60000);if(m<60)return `il y a ${Math.max(1,m)} min`;const h=Math.round(m/60);if(h<24)return `il y a ${h} h`;const d=Math.round(h/24);return `il y a ${d} jour${d>1?'s':''}`}
const initial=login=>(String(login||'?').replace(/[^\p{L}\p{N}]/gu,'')[0]||'?').toLocaleUpperCase('fr')

function AccountTile({account,info,busy,onStart}){
 const avoid=!!info?.health?.attention,bg=info?.background
 const [failedImages,setFailedImages]=useState([])
 const imageUrl=bg&&[bg.url,bg.original_url].find(url=>url&&!failedImages.includes(url))
 const stats=[info?.today?`${info.today} aujourd’hui`:null,info?.in_progress?`${info.in_progress} en cours`:null].filter(Boolean).join(', ')
 return <li>
  <button type="button" disabled={busy||account.country!=='FR'} onClick={()=>onStart(account.id)} aria-label={`Publier sur ${account.login}`} className="group block w-full text-left disabled:opacity-40">
   <span className={`relative block aspect-[3/4] overflow-hidden rounded-2xl bg-[#efebe4] ring-1 ring-[#e8e4dd] transition-shadow group-hover:ring-2 group-hover:ring-[#087f5b] group-focus-visible:ring-2 group-focus-visible:ring-[#087f5b] ${avoid?'grayscale':''}`}>
    {imageUrl?<img src={imageUrl} alt="" loading="lazy" onError={()=>setFailedImages(old=>[...old,imageUrl])} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"/>:<span className="grid h-full place-items-center"><span className="text-center"><span className="block text-5xl font-semibold text-[#cfc8bd]">{initial(account.login)}</span><span className="mt-1 block text-xs text-[#9a958c]">{bg?'Fond indisponible':'Pas encore de fond'}</span></span></span>}
    <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold tabular-nums text-[#087f5b] shadow-sm">#{account.profile_number||'—'}</span>
    {account.dotb&&!avoid&&<span className="absolute right-2.5 top-2.5 rounded-full bg-[#323630]/80 px-2 py-0.5 text-[11px] font-medium text-white">Dotb</span>}
    {avoid&&<span className="absolute right-2.5 top-2.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-950">À éviter</span>}
    {stats&&!avoid&&<span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2.5 pt-8 text-xs font-medium text-white">{stats}</span>}
   </span>
   <span className="mt-2.5 block truncate text-[15px] font-semibold text-[#323630]">{account.login}</span>
   <span className="block truncate text-xs text-[#79756f]">{avoid?info.health.label:info?.last_at?`Dernière publication ${since(info.last_at)}`:'Aucune publication notée'}</span>
  </button>
 </li>
}

export default function ListingAccountGallery({accounts,picker,profiles=[],configured,busy,onStart,onAccounts,onStyles}){
 const [search,setSearch]=useState('')
 const info=id=>picker?.accounts?.[id]
 const visible=accounts.filter(a=>`${a.profile_number} ${a.login}`.toLocaleLowerCase('fr').includes(search.trim().toLocaleLowerCase('fr')))
 const byNumber=(a,b)=>Number(b.profile_number||0)-Number(a.profile_number||0)
 const good=visible.filter(a=>!info(a.id)?.health?.attention).sort(byNumber),avoid=visible.filter(a=>info(a.id)?.health?.attention).sort(byNumber)
 const unlinked=profiles.filter(p=>!accounts.some(a=>a.profile_id===p.id))
 const missingBackgrounds=picker?accounts.filter(a=>!info(a.id)?.background).length:0
 return <section aria-label="Choisir le compte" className="space-y-6">
  <header className="flex flex-wrap items-end justify-between gap-4">
   <div><h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[#323630]">Sur quel compte publier ?</h1><p className="mt-1.5 max-w-xl text-sm text-[#79756f]">Chaque compte avec son fond : les photos de tes annonces doivent lui ressembler. Clique sur un compte pour préparer ses articles.</p></div>
   <div className="flex flex-wrap items-center gap-2">{accounts.length>6&&<input aria-label="Chercher un compte" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pseudo ou n° AdsPower" className="w-56 rounded-lg border border-[#e3ded6] bg-white px-3 py-2 text-sm focus:border-[#087f5b] focus:outline-none focus:ring-2 focus:ring-[#087f5b]/20"/>}{onAccounts&&<button type="button" className="rounded-lg border border-[#e3ded6] bg-white px-3 py-2 text-sm font-medium hover:bg-[#fbfaf7]" onClick={onAccounts}>Gérer mes comptes</button>}</div>
  </header>
  {picker?.health_unavailable&&<p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">L’état des restrictions n’a pas pu être chargé. Vérifie le compte dans AdsPower avant de publier.</p>}
  {!accounts.length?<div className="rounded-3xl border border-dashed border-[#d6d0c6] bg-[#fffefa] p-8 text-sm text-[#5d615a]">{configured?'Relie tes profils AdsPower à leurs comptes Vinted pour les voir ici.':'Ouvre l’onglet AdsPower pour choisir les comptes sur lesquels tu publies.'}{onAccounts&&<button className="mt-3 block font-medium text-[#08664c] underline underline-offset-4" onClick={onAccounts}>Ouvrir mes comptes AdsPower</button>}</div>:<>
   <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{good.map(a=><AccountTile key={a.id} account={a} info={info(a.id)} busy={busy} onStart={onStart}/>)}</ul>
   {!visible.length&&<p className="text-sm text-[#79756f]">Aucun compte ne correspond à cette recherche.</p>}
   {!!avoid.length&&<div className="space-y-3 border-t border-[#e8e4dd] pt-5"><h2 className="text-sm font-semibold text-[#5d615a]">À éviter pour l’instant · {avoid.length}</h2><ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{avoid.map(a=><AccountTile key={a.id} account={a} info={info(a.id)} busy={busy} onStart={onStart}/>)}</ul></div>}
   {(!!missingBackgrounds||!!unlinked.length)&&<p className="text-xs text-[#79756f]">{missingBackgrounds?<>{missingBackgrounds} compte{missingBackgrounds>1?'s n’ont':' n’a'} pas encore de fond. {onStyles&&<button className="underline underline-offset-4" onClick={onStyles}>Choisir les fonds</button>}</>:null}{unlinked.length?` ${unlinked.length} profil${unlinked.length>1?'s':''} AdsPower à relier à Vinted : ${unlinked.map(p=>`#${p.number}`).join(', ')}.`:''}</p>}
  </>}
 </section>
}
