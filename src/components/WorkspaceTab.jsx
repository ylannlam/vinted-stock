import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES } from '../constants'

const SIZES = ['', 'XS', 'S', 'M', 'L', 'XL', 'XXL']
const STATUTS = ['en_cours', 'image_faite', 'importe_dotb']
const STATUT_LABELS = { en_cours: 'En cours', image_faite: 'Image faite', importe_dotb: 'Importé DOTB' }
const STATUT_NEXT = { en_cours: 'image_faite', image_faite: 'importe_dotb', importe_dotb: 'en_cours' }

function statutBadge(statut) {
  if (statut === 'en_cours')    return 'bg-gray-100 text-gray-600'
  if (statut === 'image_faite') return 'bg-blue-100 text-blue-600'
  if (statut === 'importe_dotb') return 'bg-green-100 text-green-600'
  return 'bg-gray-100 text-gray-500'
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function WorkspaceTab({ userId, userPseudo }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    fetchItems()
  }, [userId])

  async function fetchItems() {
    setLoading(true)
    const { data, error } = await supabase
      .from('work_items')
      .select('*')
      .eq('employe_id', userId)
      .order('created_at', { ascending: false })
    if (!error && data) setItems(data)
    setLoading(false)
  }

  async function handleCycleStatus(item) {
    const nextStatut = STATUT_NEXT[item.statut]
    const { data, error } = await supabase
      .from('work_items')
      .update({ statut: nextStatut })
      .eq('id', item.id)
      .select()
      .single()
    if (!error && data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleDelete(itemId) {
    const { error } = await supabase.from('work_items').delete().eq('id', itemId)
    if (!error) {
      setItems(prev => prev.filter(i => i.id !== itemId))
      setDeleteConfirm(null)
    }
  }

  const todayCount = items.filter(i => i.created_at >= startOfToday()).length
  const weekCount  = items.filter(i => i.created_at >= startOfWeek()).length

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Stats */}
      <div className="flex gap-3 mb-5">
        <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="text-2xl font-bold text-teal-600">{todayCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">Aujourd'hui</div>
        </div>
        <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="text-2xl font-bold text-teal-600">{weekCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">Cette semaine</div>
        </div>
      </div>

      {/* Title */}
      <h2 className="text-base font-bold text-gray-900 mb-3">Mes articles</h2>

      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <svg className="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Chargement...
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm">Aucun article pour l'instant</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <a
                  href={item.lien_shein}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-teal-600 hover:underline block truncate"
                >
                  {item.lien_shein}
                </a>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-xs text-gray-500">{item.categorie}</span>
                  {item.taille && (
                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{item.taille}</span>
                  )}
                  <span className="text-xs text-gray-400">
                    {new Date(item.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleCycleStatus(item)}
                  className={`text-xs font-semibold px-2 py-1 rounded-full transition-colors ${statutBadge(item.statut)}`}
                >
                  {STATUT_LABELS[item.statut] ?? item.statut}
                </button>
                <button
                  onClick={() => { setEditItem(item); setShowModal(true) }}
                  className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
                  aria-label="Modifier"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => setDeleteConfirm(item.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  aria-label="Supprimer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* FAB */}
      <button
        onClick={() => { setEditItem(null); setShowModal(true) }}
        className="fixed bottom-6 right-5 w-14 h-14 bg-teal-500 hover:bg-teal-600 active:bg-teal-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 z-40"
        aria-label="Ajouter un article"
      >
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer l'article ?</h3>
            <p className="text-sm text-gray-500 mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {showModal && (
        <WorkItemModal
          item={editItem}
          userId={userId}
          onClose={() => { setShowModal(false); setEditItem(null) }}
          onSaved={(saved) => {
            if (editItem) {
              setItems(prev => prev.map(i => i.id === saved.id ? saved : i))
            } else {
              setItems(prev => [saved, ...prev])
            }
            setShowModal(false)
            setEditItem(null)
          }}
        />
      )}
    </div>
  )
}

function WorkItemModal({ item, userId, onClose, onSaved }) {
  const [lienShein, setLienShein] = useState(item?.lien_shein ?? '')
  const [categorie, setCategorie] = useState(item?.categorie ?? CATEGORIES[0])
  const [taille, setTaille] = useState(item?.taille ?? '')
  const [statut, setStatut] = useState(item?.statut ?? 'en_cours')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const payload = { lien_shein: lienShein, categorie, taille: taille || null, statut }
    let data, err
    if (item) {
      ;({ data, error: err } = await supabase
        .from('work_items').update(payload).eq('id', item.id).select().single())
    } else {
      ;({ data, error: err } = await supabase
        .from('work_items').insert({ ...payload, employe_id: userId }).select().single())
    }
    if (err) { setError(err.message); setLoading(false); return }
    onSaved(data)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{item ? 'Modifier l\'article' : 'Ajouter un article'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Lien Shein</label>
            <input
              type="url"
              value={lienShein}
              onChange={e => setLienShein(e.target.value)}
              required
              placeholder="https://shein.com/..."
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie</label>
            <select
              value={categorie}
              onChange={e => setCategorie(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Taille</label>
            <select
              value={taille}
              onChange={e => setTaille(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              <option value="">— Aucune —</option>
              {SIZES.filter(s => s).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Statut</label>
            <select
              value={statut}
              onChange={e => setStatut(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              {STATUTS.map(s => <option key={s} value={s}>{STATUT_LABELS[s]}</option>)}
            </select>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>
          )}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Enregistrement...' : (item ? 'Modifier' : 'Ajouter')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
