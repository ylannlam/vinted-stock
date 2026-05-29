import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import ProxyFormModal from './ProxyFormModal'

// Petite icône de copie discrète (inline, pas un gros bouton)
function CopyMini({ value }) {
  const [copied, setCopied] = useState(false)
  if (value === null || value === undefined || value === '') return null
  return (
    <button
      type="button"
      title="Copier"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value))
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {}
      }}
      className={`shrink-0 transition-colors ${copied ? 'text-green-600' : 'text-gray-300 hover:text-gray-600'}`}
    >
      {copied ? (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h4a2 2 0 002-2M8 5a2 2 0 012-2h4a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
        </svg>
      )}
    </button>
  )
}

export default function ProxiesTab() {
  const [proxies, setProxies] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(undefined) // undefined = closed, null = new, obj = edit
  const [deleteId, setDeleteId] = useState(null)
  const [revealed, setRevealed] = useState(new Set())   // mots de passe révélés
  const [expanded, setExpanded] = useState(new Set())   // listes de comptes dépliées
  const [assignFor, setAssignFor] = useState(null)      // proxy_id when inline picker open

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: pData }, { data: aData }] = await Promise.all([
      supabase.from('proxies').select('*').order('created_at', { ascending: false }),
      supabase.from('vinted_accounts').select('id, pseudo, proxy_id'),
    ])
    if (pData) setProxies(pData)
    if (aData) setAccounts(aData)
    setLoading(false)
  }

  const accountsByProxy = useMemo(() => {
    const map = new Map()
    for (const a of accounts) {
      if (!a.proxy_id) continue
      if (!map.has(a.proxy_id)) map.set(a.proxy_id, [])
      map.get(a.proxy_id).push(a)
    }
    return map
  }, [accounts])

  async function handleSave(form) {
    const { id, created_at, ...raw } = form
    const fields = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v === '' ? null : v])
    )
    if (id) {
      const { data, error } = await supabase
        .from('proxies').update(fields).eq('id', id).select().single()
      if (error) { alert('Erreur : ' + error.message); return }
      if (data) setProxies(prev => prev.map(p => p.id === data.id ? data : p))
    } else {
      const { data, error } = await supabase
        .from('proxies').insert(fields).select().single()
      if (error) { alert('Erreur : ' + error.message); return }
      if (data) setProxies(prev => [data, ...prev])
    }
    setEdit(undefined)
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('proxies').delete().eq('id', id)
    if (error) { alert('Erreur : ' + error.message); return }
    setProxies(prev => prev.filter(p => p.id !== id))
    setDeleteId(null)
  }

  async function handleAssignAccount(accountId, proxyId) {
    const { data, error } = await supabase
      .from('vinted_accounts')
      .update({ proxy_id: proxyId })
      .eq('id', accountId)
      .select('id, pseudo, proxy_id')
      .single()
    if (error) { alert('Erreur : ' + error.message); return }
    if (data) setAccounts(prev => prev.map(a => a.id === data.id ? { ...a, ...data } : a))
    setAssignFor(null)
  }

  function toggleSet(setter, id) {
    setter(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  const toggleReveal = id => toggleSet(setRevealed, id)
  const toggleExpand = id => toggleSet(setExpanded, id)

  return (
    <div className="pb-28">
      {/* En-tête : compteur à gauche, bouton + Nouveau proxy à droite */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{proxies.length}</span> proxy{proxies.length > 1 ? 'ies' : ''}
        </div>
        <button
          onClick={() => setEdit(null)}
          className="flex items-center gap-1.5 text-xs font-semibold bg-teal-500 text-white px-3 py-1.5 rounded-full hover:bg-teal-600 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Nouveau proxy
        </button>
      </div>

      <div className="px-3 pt-3 space-y-1.5">
        {loading && <div className="flex justify-center py-10 text-gray-400 text-sm">Chargement…</div>}
        {!loading && proxies.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">Aucun proxy. Appuie sur « Nouveau proxy » pour en créer un.</div>
        )}

        {proxies.map(p => {
          const linked = accountsByProxy.get(p.id) ?? []
          const warn = linked.length >= 5
          const isRevealed = revealed.has(p.id)
          const isOpen = expanded.has(p.id)
          return (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

              {/* Ligne compacte */}
              <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap sm:flex-nowrap">

                {/* Nom / IP + fournisseur */}
                <div className="flex items-center gap-2 min-w-0 sm:w-44 sm:shrink-0 order-1">
                  <span className="font-semibold text-gray-900 text-sm truncate">{p.nom || `${p.adresse}:${p.port}`}</span>
                  {p.fournisseur && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap shrink-0">{p.fournisseur}</span>
                  )}
                </div>

                {/* Infos connexion sur une ligne : adresse:port · username · password */}
                <div className="flex items-center gap-x-2.5 gap-y-1 min-w-0 flex-1 w-full sm:w-auto order-3 sm:order-2 font-mono text-xs text-gray-600 flex-wrap">
                  <span className="flex items-center gap-1 min-w-0" title="Adresse:Port">
                    <span className="truncate">{p.adresse}:{p.port}</span>
                    <CopyMini value={`${p.adresse}:${p.port}`} />
                  </span>
                  <span className="text-gray-200">·</span>
                  <span className="flex items-center gap-1 min-w-0" title="Username">
                    <span className="truncate">{p.username || '—'}</span>
                    <CopyMini value={p.username} />
                  </span>
                  <span className="text-gray-200">·</span>
                  <span className="flex items-center gap-1 min-w-0" title="Password">
                    <span
                      className="truncate max-w-[120px]"
                      style={!isRevealed ? { WebkitTextSecurity: 'disc', textSecurity: 'disc' } : undefined}
                    >
                      {p.password || '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleReveal(p.id)}
                      title={isRevealed ? 'Masquer' : 'Afficher'}
                      className="shrink-0 text-gray-300 hover:text-gray-600 transition-colors"
                    >
                      {isRevealed
                        ? <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                    </button>
                    <CopyMini value={p.password} />
                  </span>
                </div>

                {/* Compteur (déplie/replie) + actions */}
                <div className="flex items-center gap-1 shrink-0 order-2 sm:order-3 ml-auto sm:ml-0">
                  <button
                    onClick={() => toggleExpand(p.id)}
                    title={isOpen ? 'Replier les comptes' : 'Voir les comptes'}
                    className={`text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap flex items-center gap-1 transition-colors hover:opacity-80 ${
                      warn ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {warn ? '⚠ ' : ''}{linked.length} compte{linked.length > 1 ? 's' : ''}
                    <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  <button
                    onClick={() => setEdit(p)}
                    title="Modifier"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>

                  {deleteId === p.id ? (
                    <>
                      <button onClick={() => handleDelete(p.id)} title="Confirmer la suppression"
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      </button>
                      <button onClick={() => setDeleteId(null)} title="Annuler"
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setDeleteId(p.id)} title="Supprimer"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Panneau déplié : comptes liés + assignation + notes */}
              {isOpen && (
                <div className="border-t border-gray-100 bg-gray-50 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Comptes liés</div>
                    {assignFor !== p.id && (
                      <button
                        onClick={() => setAssignFor(p.id)}
                        className="text-[10px] font-semibold text-teal-600 hover:text-teal-700"
                      >
                        + Assigner un compte
                      </button>
                    )}
                  </div>

                  {linked.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {linked.map(a => (
                        <span key={a.id} className="text-[11px] bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded-full">
                          {a.pseudo}
                        </span>
                      ))}
                    </div>
                  )}
                  {linked.length === 0 && assignFor !== p.id && (
                    <div className="text-[11px] text-gray-400 italic">Aucun compte assigné</div>
                  )}

                  {assignFor === p.id && (
                    <div className="flex gap-2 items-center bg-teal-50 border border-teal-200 rounded-lg px-2 py-1.5">
                      <select
                        autoFocus
                        defaultValue=""
                        onChange={e => e.target.value && handleAssignAccount(e.target.value, p.id)}
                        className="flex-1 text-xs border border-teal-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-teal-400"
                      >
                        <option value="" disabled>Choisir un compte…</option>
                        {accounts
                          .filter(a => a.proxy_id !== p.id)
                          .sort((a, b) => (a.pseudo ?? '').localeCompare(b.pseudo ?? ''))
                          .map(a => (
                            <option key={a.id} value={a.id}>
                              {a.pseudo}{!a.proxy_id ? ' · sans proxy' : ' · changer de proxy'}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={() => setAssignFor(null)}
                        className="text-xs font-semibold text-gray-500 px-2 py-1.5 rounded-lg hover:bg-gray-100"
                      >
                        Annuler
                      </button>
                    </div>
                  )}

                  {p.notes && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
                      {p.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {edit !== undefined && (
        <ProxyFormModal
          proxy={edit}
          onClose={() => setEdit(undefined)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
