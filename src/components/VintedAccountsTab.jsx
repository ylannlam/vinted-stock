import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AccountFormModal from './AccountFormModal'

const STATUTS = [
  { value: 'actif',      label: 'Actif',       bg: 'bg-green-100 text-green-700' },
  { value: 'banni_temp', label: 'Banni temp.', bg: 'bg-orange-100 text-orange-700' },
  { value: 'banni_def',  label: 'Banni déf.',  bg: 'bg-red-100 text-red-700' },
  { value: 'suspendu',   label: 'Suspendu',    bg: 'bg-gray-100 text-gray-600' },
]

const METHODE_COLORS = {
  google: 'bg-blue-100 text-blue-700',
  apple:  'bg-gray-800 text-white',
  email:  'bg-teal-100 text-teal-700',
}

function StatutBadge({ statut }) {
  const s = STATUTS.find(x => x.value === statut) ?? STATUTS[0]
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.bg}`}>{s.label}</span>
}

export default function VintedAccountsTab() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatut, setFilterStatut] = useState(null)
  const [editAccount, setEditAccount] = useState(undefined)
  const [deleteId, setDeleteId] = useState(null)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => { fetchAccounts() }, [])

  async function fetchAccounts() {
    setLoading(true)
    const { data, error } = await supabase
      .from('vinted_accounts')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setAccounts(data)
    setLoading(false)
  }

  async function handleSave(form) {
    const { id, ...fields } = form
    if (id) {
      const { data, error } = await supabase
        .from('vinted_accounts').update(fields).eq('id', id).select().single()
      if (!error && data) setAccounts(prev => prev.map(a => a.id === data.id ? data : a))
    } else {
      const { data, error } = await supabase
        .from('vinted_accounts').insert(fields).select().single()
      if (!error && data) setAccounts(prev => [data, ...prev])
    }
    setEditAccount(undefined)
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('vinted_accounts').delete().eq('id', id)
    if (!error) setAccounts(prev => prev.filter(a => a.id !== id))
    setDeleteId(null)
    if (expanded === id) setExpanded(null)
  }

  const displayed = filterStatut ? accounts.filter(a => a.statut === filterStatut) : accounts

  return (
    <div className="pb-28">

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
              <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-teal-700">
                  {account.pseudo?.[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 text-sm">{account.pseudo}</p>
                  <StatutBadge statut={account.statut} />
                  {account.methode_connexion && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${METHODE_COLORS[account.methode_connexion] ?? 'bg-gray-100 text-gray-600'}`}>
                      {account.methode_connexion}
                    </span>
                  )}
                </div>
                {account.email && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">{account.email}</p>
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
          onClose={() => setEditAccount(undefined)}
          onSave={handleSave}
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
