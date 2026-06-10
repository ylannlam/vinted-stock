import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import AccountFormModal from './AccountFormModal'
import ProxyFormModal from './ProxyFormModal'

const STATUTS = [
  { value: 'en_preparation', label: 'En prépa.',   bg: 'bg-purple-100 text-purple-700' },
  { value: 'actif',          label: 'Actif',       bg: 'bg-green-100 text-green-700' },
  { value: 'banni_temp',     label: 'Banni temp.', bg: 'bg-orange-100 text-orange-700' },
  { value: 'banni_def',      label: 'Banni déf.',  bg: 'bg-red-100 text-red-700' },
  { value: 'suspendu',       label: 'Suspendu',    bg: 'bg-gray-100 text-gray-600' },
]

const METHODE_COLORS = {
  google: 'bg-blue-100 text-blue-700',
  apple:  'bg-gray-800 text-white',
  email:  'bg-teal-100 text-teal-700',
}

// Cycle de vie de création (indépendant du statut actif/banni)
const PHASES = [
  { key: 'phone', label: 'Sur téléphone',   bg: 'bg-gray-100 text-gray-600',     dot: 'bg-gray-400',   active: 'bg-gray-700 text-white' },
  { key: 'verif', label: 'En vérification', bg: 'bg-orange-100 text-orange-700', dot: 'bg-orange-400', active: 'bg-orange-500 text-white' },
  { key: 'ready', label: 'Prêt à utiliser', bg: 'bg-green-100 text-green-700',   dot: 'bg-green-500',  active: 'bg-green-600 text-white' },
]

// Statuts hors pipeline de création (banni / suspendu)
const STATUTS_INACTIFS = ['banni_temp', 'banni_def', 'suspendu']

function getPhase(a) {
  // "Prêt" persiste même si le compte est banni par la suite
  if (a.proxy_id && a.is_ready) return 'ready'
  // Un compte banni/suspendu pas encore prêt n'est pas "en vérification"
  if (STATUTS_INACTIFS.includes(a.statut)) return null
  if (!a.proxy_id) return 'phone'
  return 'verif'
}

function StatutBadge({ statut }) {
  const s = STATUTS.find(x => x.value === statut) ?? STATUTS[0]
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.bg}`}>{s.label}</span>
}

// Petite icône de copie discrète (stoppe le clic pour ne pas déplier la carte)
function CopyMini({ value, title = 'Copier' }) {
  const [copied, setCopied] = useState(false)
  if (value === null || value === undefined || value === '') return null
  return (
    <button
      type="button"
      title={title}
      onClick={async (e) => {
        e.stopPropagation()
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

function PhaseBadge({ account }) {
  const key = getPhase(account)
  if (!key) return null
  const p = PHASES.find(x => x.key === key) ?? PHASES[0]
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${p.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </span>
  )
}

function DebanCountdown({ deban_at }) {
  if (!deban_at) return null
  const now = new Date()
  const target = new Date(deban_at)
  const diff = target - now
  if (diff <= 0) return <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Débanni</span>
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const label = days > 0 ? `${days}j ${hours}h` : `${hours}h`
  return (
    <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
      ⏱ {label}
    </span>
  )
}

export default function VintedAccountsTab() {
  const [accounts, setAccounts] = useState([])
  const [proxies, setProxies] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatut, setFilterStatut] = useState(null)
  const [filterPhase, setFilterPhase] = useState(null)
  const [filterProxy, setFilterProxy] = useState(null)
  const [editAccount, setEditAccount] = useState(undefined)
  const [showProxyModal, setShowProxyModal] = useState(false)
  const [deleteId, setDeleteId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [quickAssignFor, setQuickAssignFor] = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: aData }, { data: pData }] = await Promise.all([
      supabase.from('vinted_accounts').select('*').order('created_at', { ascending: false }),
      supabase.from('proxies').select('*').order('created_at', { ascending: false }),
    ])
    if (aData) setAccounts(await autoUnban(aData))
    if (pData) setProxies(pData)
    setLoading(false)
  }

  async function autoUnban(list) {
    const now = new Date()
    const expired = list.filter(a =>
      a.statut === 'banni_temp' && a.deban_at && new Date(a.deban_at) <= now
    )
    if (expired.length === 0) return list
    const ids = expired.map(a => a.id)
    const { data, error } = await supabase
      .from('vinted_accounts')
      .update({ statut: 'actif', deban_at: null })
      .in('id', ids)
      .select()
    if (error || !data) {
      console.warn('auto-unban failed:', error?.message)
      return list
    }
    const updated = new Map(data.map(d => [d.id, d]))
    return list.map(a => updated.get(a.id) ?? a)
  }

  const proxiesById = useMemo(() => {
    const m = new Map()
    for (const p of proxies) m.set(p.id, p)
    return m
  }, [proxies])

  async function handleSaveProxy(form) {
    const { id, created_at, ...raw } = form
    const fields = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v === '' ? null : v])
    )
    const { data, error } = await supabase
      .from('proxies').insert(fields).select().single()
    if (error) { alert('Erreur : ' + error.message); return }
    if (data) setProxies(prev => [data, ...prev])
    setShowProxyModal(false)
  }

  async function handleSave(form) {
    const { id, ...raw } = form
    const fields = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v === '' ? null : v])
    )
    if (id) {
      const { data, error } = await supabase
        .from('vinted_accounts').update(fields).eq('id', id).select().single()
      if (error) { alert('Erreur : ' + error.message); return }
      if (data) setAccounts(prev => prev.map(a => a.id === data.id ? data : a))
    } else {
      const { data, error } = await supabase
        .from('vinted_accounts').insert(fields).select().single()
      if (error) { alert('Erreur : ' + error.message); return }
      if (data) setAccounts(prev => [data, ...prev])
    }
    setEditAccount(undefined)
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('vinted_accounts').delete().eq('id', id)
    if (!error) setAccounts(prev => prev.filter(a => a.id !== id))
    setDeleteId(null)
    if (expanded === id) setExpanded(null)
  }

  async function handleAssignProxy(accountId, proxyId) {
    const { data, error } = await supabase
      .from('vinted_accounts')
      .update({ proxy_id: proxyId || null })
      .eq('id', accountId)
      .select()
      .single()
    if (error) { alert('Erreur : ' + error.message); return }
    if (data) setAccounts(prev => prev.map(a => a.id === data.id ? data : a))
    setQuickAssignFor(null)
  }

  async function handleSetReady(accountId, ready) {
    const { data, error } = await supabase
      .from('vinted_accounts')
      .update({ is_ready: ready })
      .eq('id', accountId)
      .select()
      .single()
    if (error) { alert('Erreur : ' + error.message); return }
    if (data) setAccounts(prev => prev.map(a => a.id === data.id ? data : a))
  }

  const sansProxyCount = accounts.filter(a => !a.proxy_id).length
  const phaseCounts = { phone: 0, verif: 0, ready: 0 }
  for (const a of accounts) {
    const ph = getPhase(a)
    if (ph) phaseCounts[ph]++
  }

  const numOrInf = a => {
    const n = parseInt(a.ads_power_num, 10)
    return Number.isNaN(n) ? Infinity : n
  }
  const displayed = accounts
    .filter(a => !filterStatut || a.statut === filterStatut)
    .filter(a => !filterPhase || getPhase(a) === filterPhase)
    .filter(a => {
      if (filterProxy === null) return true
      if (filterProxy === '__none__') return !a.proxy_id
      return a.proxy_id === filterProxy
    })
    .sort((a, b) => numOrInf(a) - numOrInf(b))

  return (
    <div className="pb-28">

      {/* Tableau de bord du cycle de création */}
      <div className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 px-4 py-2 text-[11px] font-medium flex items-center gap-2 whitespace-nowrap overflow-x-auto scrollbar-hide">
        <span className="text-gray-600"><b className="text-gray-900">{phaseCounts.phone}</b> sur téléphone</span>
        <span className="text-gray-300">·</span>
        <span className="text-orange-600"><b>{phaseCounts.verif}</b> en vérification</span>
        <span className="text-gray-300">·</span>
        <span className="text-green-600"><b>{phaseCounts.ready}</b> prêts</span>
      </div>

      {/* Filtres rapides par phase */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {PHASES.map(p => (
          <button
            key={p.key}
            onClick={() => setFilterPhase(filterPhase === p.key ? null : p.key)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 transition-colors ${
              filterPhase === p.key ? p.active : `${p.bg} hover:opacity-80`
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${filterPhase === p.key ? 'bg-white' : p.dot}`} />
            {p.label} ({phaseCounts[p.key]})
          </button>
        ))}
      </div>

      {sansProxyCount > 0 && (
        <button
          onClick={() => setFilterProxy(filterProxy === '__none__' ? null : '__none__')}
          className={`w-full px-4 py-2 text-xs font-semibold border-b transition-colors flex items-center justify-center gap-2 ${
            filterProxy === '__none__'
              ? 'bg-orange-500 text-white border-orange-600'
              : 'bg-orange-50 text-orange-700 border-orange-100 hover:bg-orange-100'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {sansProxyCount} compte{sansProxyCount > 1 ? 's' : ''} sans proxy {filterProxy === '__none__' ? '· cliquer pour tout afficher' : '· cliquer pour filtrer'}
        </button>
      )}

      {/* Header + filtres */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setFilterStatut(null)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 transition-colors ${
            filterStatut === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Tous ({accounts.length})
        </button>
        {STATUTS.map(s => {
          const count = accounts.filter(a => a.statut === s.value).length
          return (
            <button
              key={s.value}
              onClick={() => setFilterStatut(filterStatut === s.value ? null : s.value)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 transition-colors ${
                filterStatut === s.value ? 'bg-gray-800 text-white' : `${s.bg} hover:opacity-80`
              }`}
            >
              {s.label} {count > 0 && `(${count})`}
            </button>
          )
        })}
      </div>

      {proxies.length > 0 && (
        <div className="bg-white border-b border-gray-100 px-4 py-2 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <span className="text-[10px] uppercase font-semibold text-gray-400 shrink-0">Proxy</span>
          <select
            value={filterProxy ?? ''}
            onChange={e => setFilterProxy(e.target.value === '' ? null : e.target.value)}
            className="text-xs border border-gray-200 rounded-full px-3 py-1 bg-gray-50 focus:outline-none focus:border-teal-400"
          >
            <option value="">Tous</option>
            <option value="__none__">— Sans proxy —</option>
            {proxies.map(p => (
              <option key={p.id} value={p.id}>
                {p.nom || `${p.adresse}:${p.port}`} ({accounts.filter(a => a.proxy_id === p.id).length})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Liste */}
      <div className="px-3 pt-3 space-y-2">
        {loading && (
          <div className="flex justify-center py-10 text-gray-400 text-sm">Chargement...</div>
        )}

        {!loading && displayed.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">Aucun compte</div>
        )}

        {displayed.map(account => (
          <div key={account.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">

            {/* Ligne principale */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer"
              onClick={() => setExpanded(expanded === account.id ? null : account.id)}
            >
              <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0 relative">
                <span className="text-sm font-bold text-teal-700">
                  {account.pseudo?.[0]?.toUpperCase() ?? '?'}
                </span>
                {account.ads_power_num && (
                  <span className="absolute -top-1 -right-1 text-[9px] font-bold bg-gray-700 text-white w-4 h-4 rounded-full flex items-center justify-center">
                    {account.ads_power_num}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 text-sm">{account.pseudo}</p>
                  <PhaseBadge account={account} />
                  <StatutBadge statut={account.statut} />
                  {account.statut === 'banni_temp' && account.deban_at && (
                    <DebanCountdown deban_at={account.deban_at} />
                  )}
                  {account.methode_connexion && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${METHODE_COLORS[account.methode_connexion] ?? 'bg-gray-100 text-gray-600'}`}>
                      {account.methode_connexion}
                    </span>
                  )}
                </div>
                {account.email && (
                  <p className="text-xs text-gray-400 truncate mt-0.5 flex items-center gap-1">
                    <span className="truncate">{account.email}</span>
                    <CopyMini value={account.email} title="Copier l'adresse mail" />
                  </p>
                )}
                {account.proxy_id && proxiesById.get(account.proxy_id) ? (
                  <p className="text-[10px] text-blue-600 font-medium truncate mt-0.5 flex items-center gap-1">
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                    </svg>
                    {proxiesById.get(account.proxy_id).nom || `${proxiesById.get(account.proxy_id).adresse}:${proxiesById.get(account.proxy_id).port}`}
                  </p>
                ) : (
                  <p className="text-[10px] text-orange-600 font-bold truncate mt-0.5 flex items-center gap-1">
                    📱 Sans proxy (téléphone)
                  </p>
                )}
              </div>
              <svg
                className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded === account.id ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {/* Détails expandés */}
            {expanded === account.id && (
              <div className="border-t border-gray-100 px-4 py-3 space-y-2 bg-gray-50">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {account.ads_power_num && (
                    <Info label="N° AdsPower" value={`#${account.ads_power_num}`} mono />
                  )}
                  {account.deban_at && account.statut === 'banni_temp' && (
                    <Info label="Débanni le" value={new Date(account.deban_at).toLocaleDateString('fr-FR')} />
                  )}
                  {account.password && (
                    <Info label="Mot de passe" value={account.password} mono />
                  )}
                  {account.telephone && (
                    <Info label="Téléphone" value={account.telephone} mono />
                  )}
                  {account.telephone_type && (
                    <Info label="Type tél." value={account.telephone_type === 'onoff' ? 'OnOff' : 'Autre'} />
                  )}
                  {account.telephone_email && (
                    <Info label="Email OnOff" value={account.telephone_email} />
                  )}
                  {account.created_at && (
                    <Info label="Créé le" value={new Date(account.created_at).toLocaleDateString('fr-FR')} />
                  )}
                </div>
                {account.notes && (
                  <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-yellow-700">{account.notes}</p>
                  </div>
                )}
                {!account.proxy_id && (
                  <div className="mt-2">
                    {quickAssignFor === account.id ? (
                      <div className="flex gap-2 items-center bg-orange-50 border border-orange-200 rounded-xl px-2.5 py-2">
                        <select
                          autoFocus
                          defaultValue=""
                          onChange={e => e.target.value && handleAssignProxy(account.id, e.target.value)}
                          className="flex-1 text-xs border border-orange-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-teal-400"
                        >
                          <option value="" disabled>Choisir un proxy…</option>
                          {proxies.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.nom ? `${p.nom} — ${p.adresse}:${p.port}` : `${p.adresse}:${p.port} — ${p.username}`}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => setQuickAssignFor(null)}
                          className="text-xs font-semibold text-gray-500 px-2 py-1.5 rounded-lg hover:bg-gray-100"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setQuickAssignFor(account.id)}
                        disabled={proxies.length === 0}
                        className="w-full py-2 text-xs font-semibold bg-orange-100 text-orange-700 rounded-xl hover:bg-orange-200 transition-colors disabled:opacity-50"
                      >
                        {proxies.length === 0 ? 'Crée un proxy d\'abord' : '🔗 Assigner un proxy'}
                      </button>
                    )}
                  </div>
                )}
                {account.proxy_id && (
                  <div className="mt-2">
                    {account.is_ready ? (
                      <button
                        onClick={() => handleSetReady(account.id, false)}
                        className="w-full py-2 text-xs font-semibold bg-orange-100 text-orange-700 rounded-xl hover:bg-orange-200 transition-colors"
                      >
                        ↩ Marquer comme pas prêt (repasser en vérification)
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSetReady(account.id, true)}
                        className="w-full py-2 text-xs font-semibold bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition-colors"
                      >
                        ✓ Marquer comme prêt à utiliser
                      </button>
                    )}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setEditAccount(account)}
                    className="flex-1 py-2 text-xs font-semibold bg-teal-500 text-white rounded-xl hover:bg-teal-600 transition-colors"
                  >
                    Modifier
                  </button>
                  {deleteId === account.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(account.id)}
                        className="flex-1 py-2 text-xs font-bold bg-red-500 text-white rounded-xl"
                      >Supprimer</button>
                      <button
                        onClick={() => setDeleteId(null)}
                        className="flex-1 py-2 text-xs font-semibold bg-gray-200 text-gray-600 rounded-xl"
                      >Annuler</button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDeleteId(account.id)}
                      className="flex-1 py-2 text-xs font-semibold bg-red-100 text-red-600 rounded-xl hover:bg-red-200 transition-colors"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bouton ajouter */}
      <button
        onClick={() => setEditAccount(null)}
        className="fixed bottom-6 right-5 w-14 h-14 bg-teal-500 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-teal-600 hover:scale-105 transition-all z-40"
      >
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {editAccount !== undefined && (
        <AccountFormModal
          account={editAccount}
          proxies={proxies}
          onClose={() => setEditAccount(undefined)}
          onSave={handleSave}
          onCreateProxy={() => setShowProxyModal(true)}
        />
      )}

      {showProxyModal && (
        <ProxyFormModal
          proxy={null}
          onClose={() => setShowProxyModal(false)}
          onSave={handleSaveProxy}
        />
      )}
    </div>
  )
}

function Info({ label, value, mono }) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 font-medium">{label}</p>
      <p className={`text-xs text-gray-800 break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
