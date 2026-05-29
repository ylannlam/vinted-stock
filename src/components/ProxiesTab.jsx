import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import ProxyFormModal from './ProxyFormModal'

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value))
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {}
      }}
      title="Copier"
      className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
        copied ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h4a2 2 0 002-2M8 5a2 2 0 012-2h4a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
        </svg>
      )}
    </button>
  )
}

function Field({ label, value, mono, mask, children }) {
  return (
    <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold">{label}</div>
        <div
          className={`text-xs text-gray-800 truncate ${mono ? 'font-mono' : ''}`}
          style={mask ? { WebkitTextSecurity: 'disc', textSecurity: 'disc' } : undefined}
        >
          {value ?? '—'}
        </div>
      </div>
      {children}
    </div>
  )
}

export default function ProxiesTab() {
  const [proxies, setProxies] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(undefined) // undefined = closed, null = new, obj = edit
  const [deleteId, setDeleteId] = useState(null)
  const [revealed, setRevealed] = useState(new Set())
  const [assignFor, setAssignFor] = useState(null) // proxy_id when inline picker open

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

  function toggleReveal(id) {
    setRevealed(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div className="pb-28">
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <div className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{proxies.length}</span> proxy{proxies.length > 1 ? 'ies' : ''}
        </div>
      </div>

      <div className="px-3 pt-3 space-y-2.5">
        {loading && <div className="flex justify-center py-10 text-gray-400 text-sm">Chargement…</div>}
        {!loading && proxies.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">Aucun proxy. Appuie sur + pour en créer un.</div>
        )}

        {proxies.map(p => {
          const linked = accountsByProxy.get(p.id) ?? []
          const warn = linked.length >= 5
          const isOpen = revealed.has(p.id)
          return (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-100">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm truncate">{p.nom || `${p.adresse}:${p.port}`}</span>
                    {p.fournisseur && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{p.fournisseur}</span>
                    )}
                  </div>
                </div>
                <span className={`text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${
                  warn ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                }`}>
                  {warn ? '⚠ ' : ''}{linked.length} compte{linked.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Adresse" value={p.adresse} mono>
                  <CopyButton value={p.adresse} />
                </Field>
                <Field label="Port" value={p.port} mono>
                  <CopyButton value={p.port} />
                </Field>
                <Field label="Username" value={p.username} mono>
                  <CopyButton value={p.username} />
                </Field>
                <Field
                  label="Password"
                  value={p.password}
                  mono
                  mask={!isOpen}
                >
                  <button
                    type="button"
                    onClick={() => toggleReveal(p.id)}
                    title={isOpen ? 'Masquer' : 'Afficher'}
                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-500 hover:bg-gray-200"
                  >
                    {isOpen
                      ? <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                  </button>
                  <CopyButton value={p.password} />
                </Field>
              </div>

              <div className="px-4 pb-3">
                <div className="flex items-center justify-between mb-1">
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
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
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
                  <div className="flex gap-2 items-center bg-teal-50 border border-teal-200 rounded-lg px-2 py-1.5 mt-1">
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
              </div>

              {p.notes && (
                <div className="px-4 pb-3">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
                    {p.notes}
                  </div>
                </div>
              )}

              <div className="px-4 pb-3 flex gap-2">
                <button onClick={() => setEdit(p)}
                  className="flex-1 py-2 text-xs font-semibold bg-teal-500 text-white rounded-xl hover:bg-teal-600 transition-colors">
                  Modifier
                </button>
                {deleteId === p.id ? (
                  <>
                    <button onClick={() => handleDelete(p.id)}
                      className="flex-1 py-2 text-xs font-bold bg-red-500 text-white rounded-xl">Confirmer</button>
                    <button onClick={() => setDeleteId(null)}
                      className="flex-1 py-2 text-xs font-semibold bg-gray-200 text-gray-600 rounded-xl">Annuler</button>
                  </>
                ) : (
                  <button onClick={() => setDeleteId(p.id)}
                    className="flex-1 py-2 text-xs font-semibold bg-red-100 text-red-600 rounded-xl hover:bg-red-200 transition-colors">
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setEdit(null)}
        className="fixed bottom-6 right-5 w-14 h-14 bg-teal-500 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-teal-600 hover:scale-105 transition-all z-40"
        aria-label="Ajouter un proxy"
      >
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
      </button>

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
