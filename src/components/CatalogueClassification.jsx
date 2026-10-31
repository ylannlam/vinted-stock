import {useEffect,useState} from 'react'
import {safeUrl} from '../lib/fulfillment'
const button='rounded-lg border px-3 py-2 text-sm bg-white disabled:opacity-40'
const labels={unclassified:'À classer',included:'Depuis le 30 octobre',excluded:'Avant le 30 octobre'}
export default function CatalogueClassification({items,isAdmin,request,onSaved}) {
  const [group,setGroup]=useState('unclassified'),[search,setSearch]=useState(''),[selected,setSelected]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{setSelected([])},[items,group,search])
  const visible=items.filter(i=>(i.tracking_status||'unclassified')===group&&`${i.title||''} ${i.sku||''}`.toLowerCase().includes(search.toLowerCase()))
  async function classify(status) {
    setBusy(true);setError('')
    try{await request('PATCH',{action:'classify',ids:selected,status});await onSaved();setSelected([])}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="rounded-xl border bg-white p-4 space-y-4">
    <div><h2 className="font-semibold">Quels articles veux-tu suivre ?</h2><p className="text-sm text-gray-500 mt-1">Dotb ne transmet pas leur date de création. Coche uniquement ceux que tu as créés à partir du 30 octobre 2026. Les articles à classer ou antérieurs restent hors des compteurs, des statistiques et de la récupération automatique.</p></div>
    <div className="flex gap-2 flex-wrap">{Object.entries(labels).map(([key,label])=><button className={`${button} ${group===key?'!bg-teal-700 text-white':''}`} key={key} onClick={()=>setGroup(key)}>{label} · {items.filter(i=>(i.tracking_status||'unclassified')===key).length}</button>)}</div>
    <input className="border rounded-lg px-3 py-2 text-sm w-full" aria-label="Rechercher les articles à classer" placeholder="Rechercher un titre ou un SKU…" value={search} onChange={e=>setSearch(e.target.value)}/>
    {isAdmin&&<div className="flex flex-wrap gap-2 items-center"><label className="text-sm mr-3"><input type="checkbox" className="mr-2" checked={visible.length>0&&visible.slice(0,100).every(i=>selected.includes(i.id))} onChange={e=>setSelected(e.target.checked?visible.slice(0,100).map(i=>i.id):[])} disabled={busy||!visible.length}/>Sélectionner {Math.min(100,visible.length)} articles affichés</label><span className="text-xs text-gray-500">{selected.length} sélectionné(s)</span><button className={`${button} !bg-teal-700 text-white`} disabled={busy||!selected.length} onClick={()=>classify('included')}>Inclure : créés depuis le 30 octobre</button><button className={button} disabled={busy||!selected.length} onClick={()=>classify('excluded')}>Exclure : créés avant</button>{group!=='unclassified'&&<button className={button} disabled={busy||!selected.length} onClick={()=>classify('unclassified')}>Remettre à classer</button>}</div>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="divide-y max-h-[36rem] overflow-y-auto">{visible.map(item=><label key={item.id} className="flex gap-3 items-center py-3 cursor-pointer"><input type="checkbox" aria-label={`Sélectionner ${item.title||'article'} ${item.id.slice(-8)}`} disabled={!isAdmin||busy||!selected.includes(item.id)&&selected.length>=100} checked={selected.includes(item.id)} onChange={e=>setSelected(e.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id))}/>{safeUrl(item.photo_url)&&<img src={item.photo_url} alt="" className="w-10 h-14 rounded object-cover" referrerPolicy="no-referrer" loading="lazy"/>}<span className="min-w-0"><span className="block text-sm font-medium">{item.title||'Article sans titre'}</span><span className="block text-xs text-gray-500 font-mono">{item.sku||'Sans SKU'} · {item.id.slice(-8)}</span></span></label>)}{!visible.length&&<p className="text-center py-8 text-sm text-gray-500">Aucun article dans ce groupe. Importe tes articles Dotb pour actualiser cette liste.</p>}</div>
    <p className="text-xs text-gray-500">Tu peux changer ce classement à tout moment. Aucun article n’est supprimé dans Dotb.</p>
  </section>
}
