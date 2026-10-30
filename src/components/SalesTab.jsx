import { useEffect, useState } from 'react'
const defaultRequest = (...args) => import('../lib/api').then(m => m.salesRequest(...args))
import { STAGES, skuOf, supplierOf, stageOf, blocked, deadline, money, nextStage, ORDER_LABELS } from '../lib/fulfillment'

export default function SalesTab({ isAdmin, request = defaultRequest }) {
  const [data, setData] = useState({ lines: [], catalog: [] })
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(null)
  async function load() {
    const first = await request()
    const lines = [...first.lines], catalog = [...first.catalog]
    for (let offset = 250; offset < Math.max(first.count, first.catalog_count || 0); offset += 250) {
      const page = await request('GET', undefined, `?offset=${offset}`)
      lines.push(...page.lines); catalog.push(...page.catalog)
    }
    setData({ ...first, lines, catalog })
  }
  async function run(fn) { setBusy(true); setError(''); try { await fn() } catch(e) { setError(e.message) } finally { setBusy(false) } }
  useEffect(() => { run(load) }, [])
  async function sync() {
    let page
    do {
      page = await request('POST', {})
      setNotice(`${page.processed} commandes lues…`)
      if (page.has_more) await new Promise(resolve => setTimeout(resolve, 1700))
    } while(page.has_more)
    await load(); setNotice('Synchronisation terminée. Les données de préparation ont été conservées.')
  }
  const active = data.lines.filter(l => !blocked(l))
  const visible = data.lines.filter(l => (filter === 'all' || (filter === 'review' ? blocked(l) : !blocked(l) && stageOf(l) === filter)) &&
    `${l.source.title || ''} ${skuOf(l)} ${l.order.account_login || ''} ${l.supplier_order_ref || ''}`.toLowerCase().includes(search.toLowerCase()))
  function edit(line) {
    const product = data.catalog.find(p => p.sku === skuOf(line))
    setEditing({ ...line, sku: skuOf(line), supplier_url: supplierOf(line, data.catalog) || '', variant: product?.variant || '', actual_cost: line.actual_cost ?? '' })
  }
  const input = 'border border-gray-300 rounded-md px-3 py-2 text-sm w-full focus:outline-teal-600'
  return <main className="max-w-screen-2xl mx-auto p-4 space-y-4">
    <div className="flex flex-wrap justify-between gap-3 items-center">
      <div><h1 className="text-xl font-bold text-gray-900">Ventes & achats</h1><p className="text-sm text-gray-500">De la vente Vinted au colis déposé.</p></div>
      <div className="flex gap-2"><button disabled={busy} onClick={() => run(load)} className="border rounded-lg px-3 py-2 text-sm">Actualiser</button>
        {isAdmin && <button disabled={busy || data.setup_required || !data.connected} onClick={() => run(sync)} className="rounded-lg px-4 py-2 bg-teal-700 text-white text-sm disabled:opacity-40">{busy ? 'Traitement…' : data.resume ? 'Reprendre l’import' : 'Synchroniser Dotb'}</button>}</div>
    </div>
    {error && <div role="alert" className="bg-red-50 border border-red-200 p-3 rounded-lg text-red-800 text-sm">{error}</div>}
    {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
    {data.setup_required ? <div className="bg-amber-50 border border-amber-200 rounded-lg p-4"><h2 className="font-semibold">Activation du suivi nécessaire</h2><p className="text-sm mt-1">La nouvelle structure de données doit être installée avant le premier import. Le stock existant reste disponible dans les autres onglets.</p></div> : data.connected === false && <p className="bg-amber-50 p-3 rounded-lg text-sm">La connexion Dotb n’est pas encore activée. Les ventes déjà importées restent consultables.</p>}
    <div className="flex flex-wrap gap-1 border-b pb-3">
      {[{id:'all',label:'Toutes'}, ...STAGES, {id:'review',label:'À vérifier'}].map(s => <button key={s.id} disabled={busy} onClick={()=>setFilter(s.id)} className={`px-3 py-2 rounded-md text-sm ${filter===s.id?'bg-teal-700 text-white':'bg-white border text-gray-600'}`}>
        {s.label} <span className="opacity-70">{s.id==='all'?data.lines.length:s.id==='review'?data.lines.length-active.length:active.filter(l=>stageOf(l)===s.id).length}</span>
      </button>)}
    </div>
    <input aria-label="Rechercher une vente" className={input} placeholder="Rechercher un article, un SKU, un compte ou une commande Shein…" value={search} onChange={e=>setSearch(e.target.value)} />
    <div className="overflow-x-auto border rounded-lg bg-white"><table className="w-full text-sm text-left"><thead className="bg-gray-50 text-gray-500 text-xs"><tr>{['Article / SKU','Compte / Vente','Approvisionnement','Échéance','Actions'].map(t=><th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>
      {visible.map(line => { const due=deadline(line), stage=stageOf(line), supplier=supplierOf(line,data.catalog); return <tr key={line.id} className="border-t hover:bg-gray-50">
        <td className="p-3 min-w-48"><div className="font-medium">{line.source.title || 'Article sans titre'}</div><div className={skuOf(line)?'text-gray-500 text-xs':'text-amber-700 text-xs'}>{skuOf(line)||'SKU à renseigner'}</div>{supplier && <a className="text-teal-700 text-xs underline" href={supplier} target="_blank" rel="noreferrer">Voir le fournisseur</a>}</td>
        <td className="p-3"><div>{line.order.account_login || 'Compte inconnu'}</div><div>{money(line.source.selling_price,line.order.currency)}</div><small className="text-gray-500">{ORDER_LABELS[line.order.status] || 'Statut à vérifier'}</small></td>
        <td className="p-3"><span className="bg-teal-50 text-teal-800 rounded px-2 py-1 text-xs">{STAGES.find(s=>s.id===stage)?.label}</span><div className="text-xs text-gray-500 mt-2">{line.supplier_order_ref || 'Commande Shein non renseignée'}</div>{line.location && <small>Emplacement : {line.location}</small>}</td>
        <td className={`p-3 whitespace-nowrap ${due?.urgent?'text-red-700':'text-gray-500'}`}>{due?.text || '—'}</td>
        <td className="p-3"><div className="flex flex-col items-start gap-2"><button disabled={busy} onClick={()=>edit(line)} className="text-teal-700 underline">Renseigner</button>
          {!blocked(line) && nextStage(line) && <button disabled={busy} onClick={()=>run(async()=>{ if(nextStage(line)==='shipped' && !window.confirm('Confirmer que cet article a été déposé auprès du transporteur ?')) return; await request('PATCH',{action:'advance',id:line.id,updated_at:line.updated_at,stage:nextStage(line)}); await load() })} className="border rounded px-2 py-1 text-xs">{STAGES.find(s=>s.id===stage)?.action} →</button>}
          {line.order.label_url && <a href={line.order.label_url} target="_blank" rel="noreferrer" className="text-xs underline">Bordereau</a>}</div></td>
      </tr>})}
      {!visible.length && <tr><td colSpan="5" className="text-center py-16 text-gray-500">{busy?'Chargement…':data.lines.length?'Aucune vente ne correspond à ces filtres.':'Aucune vente importée. Connectez Dotb puis lancez une synchronisation.'}</td></tr>}
    </tbody></table></div>
    <p className="text-xs text-gray-500">Dernier import complet : {data.last_sync ? new Date(data.last_sync).toLocaleString('fr-FR') : 'aucun'} · Les étapes de préparation sont propres à votre site. Les prix fournisseurs ne sont pas suivis automatiquement.</p>
    {editing && <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto p-4 flex items-start justify-center" onKeyDown={e=>{if(e.key==='Escape'&&!busy)setEditing(null)}}>
      <form role="dialog" aria-modal="true" aria-label="Renseigner la vente" onSubmit={e=>{e.preventDefault();run(async()=>{await request('PATCH',{...editing,action:'edit'});setEditing(null);await load()})}} className="bg-white rounded-xl p-5 max-w-xl w-full my-8 space-y-3">
        <div className="flex justify-between"><h2 className="font-bold">Renseigner la vente</h2><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Fermer</button></div>
        <p className="text-xs text-gray-500">Le lien fournisseur sera partagé avec les autres ventes de ce SKU. Le coût payé reste propre à cet article.</p>
        {[['sku','SKU / référence et variante'],['supplier_url','Lien fournisseur HTTPS'],['variant','Taille / couleur'],['supplier_order_ref','Numéro de commande Shein'],['supplier_tracking','Suivi du colis fournisseur'],['actual_cost',`Coût réellement payé (${editing.order.currency || 'devise à vérifier'})`],['location','Emplacement'],['notes','Notes']].map(([key,label])=><label className="block text-xs text-gray-600" key={key}>{label}<input autoFocus={key==='sku'} className={input} value={editing[key]??''} maxLength={key==='notes'?1000:key==='supplier_url'?2000:200} onChange={e=>setEditing({...editing,[key]:e.target.value})}/></label>)}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}<button disabled={busy} className="bg-teal-700 text-white px-4 py-2 rounded-lg">{busy?'Enregistrement…':'Enregistrer'}</button>
      </form>
    </div>}
  </main>
}
