import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_BADGE = {
  admin:   'bg-teal-100 text-teal-700',
  stock:   'bg-orange-100 text-orange-700',
  employe: 'bg-purple-100 text-purple-700',
}

const PERIODES = [
  { value: 'all',     label: 'Tout' },
  { value: 'today',   label: "Aujourd'hui" },
  { value: 'week',    label: 'Cette semaine' },
  { value: 'month',   label: 'Ce mois' },
]

function startOfDay(d = new Date()) {
  const n = new Date(d); n.setHours(0, 0, 0, 0); return n
}
function startOfWeek() {
  const d = startOfDay()
  const day = (d.getDay() + 6) % 7 // lundi = 0
  d.setDate(d.getDate() - day)
  return d
}
function startOfMonth() {
  const d = startOfDay(); d.setDate(1); return d
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function LoginLogsTab() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [periode, setPeriode] = useState('all')
  const [userFilter, setUserFilter] = useState('')

  useEffect(() => { fetchLogs() }, [])

  async function fetchLogs() {
    setLoading(true)
    const { data, error } = await supabase
      .from('login_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (!error && data) setLogs(data)
    setLoading(false)
  }

  const usersOptions = useMemo(() => {
    const map = new Map()
    for (const l of logs) {
      if (l.user_id && !map.has(l.user_id)) {
        map.set(l.user_id, l.pseudo || l.email || l.user_id)
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [logs])

  const filtered = useMemo(() => {
    let from = null
    if (periode === 'today') from = startOfDay()
    else if (periode === 'week')  from = startOfWeek()
    else if (periode === 'month') from = startOfMonth()
    return logs.filter(l => {
      if (userFilter && l.user_id !== userFilter) return false
      if (from && new Date(l.created_at) < from) return false
      return true
    })
  }, [logs, periode, userFilter])

  return (
    <div className="p-3 pb-24 space-y-3">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODES.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriode(p.value)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                periode === p.value
                  ? 'bg-teal-500 text-white border-teal-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="ml-auto text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{filtered.length}</span> connexion{filtered.length > 1 ? 's' : ''}
          </div>
        </div>

        <div>
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400 bg-gray-50"
          >
            <option value="">Tous les utilisateurs</option>
            {usersOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm">Aucune connexion sur cette période</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(l => (
            <div key={l.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm truncate">{l.pseudo ?? '—'}</span>
                    {l.role && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_BADGE[l.role] ?? 'bg-gray-100 text-gray-600'}`}>
                        {l.role}
                      </span>
                    )}
                  </div>
                  {l.email && <div className="text-[11px] text-gray-500 truncate">{l.email}</div>}
                </div>
                <div className="text-[11px] text-gray-500 whitespace-nowrap shrink-0">
                  {formatDateTime(l.created_at)}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[11px] text-gray-600">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="truncate">
                    {l.ville || l.pays ? `${l.ville ?? ''}${l.ville && l.pays ? ', ' : ''}${l.pays ?? ''}` : 'Localisation inconnue'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="truncate">{l.appareil ?? 'Appareil inconnu'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                  </svg>
                  <span className="truncate font-mono">{l.ip_address ?? '—'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
