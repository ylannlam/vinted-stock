import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES } from '../constants'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const STATUTS = ['en_cours', 'image_faite', 'importe_dotb']
const STATUT_LABELS = { en_cours: 'En cours', image_faite: 'Image faite', importe_dotb: 'Importé DOTB' }
const STATUT_NEXT = { en_cours: 'image_faite', image_faite: 'importe_dotb', importe_dotb: 'en_cours' }

function statutBadgeCls(statut) {
  if (statut === 'en_cours')    return 'bg-gray-100 text-gray-600'
  if (statut === 'image_faite') return 'bg-blue-100 text-blue-600'
  return 'bg-green-100 text-green-600'
}

function adminBadge(s) {
  if (s === 'valide') return { cls: 'bg-green-100 text-green-700', label: '✓ Validé' }
  if (s === 'refuse') return { cls: 'bg-red-100 text-red-700',   label: '✗ Refusé' }
  return { cls: 'bg-gray-100 text-gray-500', label: '· En attente' }
}

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function WorkspaceTab({ profile }) {
  const userId = profile.id
  const note   = profile.note_admin ?? null

  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(false)
  const [noteDismissed, setNoteDismissed] = useState(
    () => note ? sessionStorage.getItem('note_dismissed') === note : true
  )

  // Inline add form
  const [lienShein, setLienShein] = useState('')
  const [categorie, setCategorie] = useState(CATEGORIES[0])
  const [taille, setTaille]       = useState('')
  const [statut, setStatut]       = useState('en_cours')
  const [adding, setAdding]       = useState(false)
  const [addError, setAddError]   = useState('')

  // Edit / delete
  const [editItem, setEditItem]           = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => { fetchItems() }, [userId])

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

  async function handleAdd(e) {
    e.preventDefault()
    if (!lienShein.trim()) return
    setAdding(true)
    setAddError('')
    const { data, error } = await supabase
      .from('work_items')
      .insert({ employe_id: userId, lien_shein: lienShein.trim(), categorie, taille: taille || null, statut })
      .select().single()
    if (error) { setAddError(error.message); setAdding(false); return }
    setItems(prev => [data, ...prev])
    setLienShein('')
    setTaille('')
    setStatut('en_cours')
    setAdding(false)
  }

  async function handleCycleStatus(item) {
    const next = STATUT_NEXT[item.statut]
    const { data, error } = await supabase
      .from('work_items').update({ statut: next }).eq('id', item.id).select().single()
    if (!error && data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleDelete(itemId) {
    const { error } = await supabase.from('work_items').delete().eq('id', itemId)
    if (!error) { setItems(prev => prev.filter(i => i.id !== itemId)); setDeleteConfirm(null) }
  }

  function dismissNote() {
    sessionStorage.setItem('note_dismissed', note)
    setNoteDismissed(true)
  }

  const todayStr    = new Date().toISOString().slice(0, 10)
  const todayItems  = items.filter(i => i.created_at.slice(0, 10) === todayStr)
  const olderItems  = items.filter(i => i.created_at.slice(0, 10) !== todayStr)
  const weekCount   = items.filter(i => i.created_at >= startOfWeek()).length
  const validCount  = items.filter(i => i.admin_status === 'valide').length
  const refuseCount = items.filter(i => i.admin_status === 'refuse').length

  return (
    <div className="p-4 max-w-2xl mx-auto pb-10">

      {/* Message admin */}
      {note && !noteDismissed && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <div className="flex-1">
            <div className="text-xs font-bold text-amber-700 mb-0.5">Message de l'admin</div>
            <p className="text-sm text-amber-800 whitespace-pre-wrap">{note}</p>
          </div>
          <button onClick={dismissNote} className="text-amber-400 hover:text-amber-600 transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[
          { value: todayItems.length, label: "Aujourd'hui", color: 'text-teal-600' },
          { value: weekCount,         label: 'Cette semaine', color: 'text-teal-600' },
          { value: validCount,        label: 'Validés',       color: 'text-green-600' },
          { value: refuseCount,       label: 'Refusés',       color: 'text-red-500' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Formulaire d'ajout */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Ajouter un article</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <input
            type="url"
            value={lienShein}
            onChange={e => setLienShein(e.target.value)}
            required
            placeholder="Lien Shein (https://...)"
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
          />
          <div className="flex gap-2">
            <select
              value={categorie}
              onChange={e => setCategorie(e.target.value)}
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={taille}
              onChange={e => setTaille(e.target.value)}
              className="w-20 border border-gray-300 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              <option value="">Taille</option>
              {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={statut}
              onChange={e => setStatut(e.target.value)}
              className="w-32 border border-gray-300 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              {STATUTS.map(s => <option key={s} value={s}>{STATUT_LABELS[s]}</option>)}
            </select>
          </div>
          {addError && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-3 py-2">{addError}</div>
          )}
          <button
            type="submit"
            disabled={adding}
            className="w-full bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors"
          >
            {adding ? 'Ajout en cours...' : '+ Ajouter'}
          </button>
        </form>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <svg className="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Chargement...
        </div>
      )}

      {!loading && (
        <>
          {/* Articles du jour */}
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-bold text-gray-900">Mes articles du jour</h3>
            <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">{todayItems.length}</span>
          </div>
          {todayItems.length === 0 ? (
            <p className="text-sm text-gray-400 italic mb-6">Aucun article ajouté aujourd'hui.</p>
          ) : (
            <div className="space-y-2 mb-6">
              {todayItems.map(item => (
                <ItemRow key={item.id} item={item} onCycle={handleCycleStatus} onEdit={setEditItem} onDelete={setDeleteConfirm} />
              ))}
            </div>
          )}

          {/* Articles précédents */}
          {olderItems.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold text-gray-900">Articles précédents</h3>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{olderItems.length}</span>
              </div>
              <div className="space-y-2">
                {olderItems.map(item => (
                  <ItemRow key={item.id} item={item} onCycle={handleCycleStatus} onEdit={setEditItem} onDelete={setDeleteConfirm} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Confirm suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer l'article ?</h3>
            <p className="text-sm text-gray-500 mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Annuler
              </button>
              <button onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-red-600">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal édition */}
      {editItem && (
        <WorkItemModal
          item={editItem}
          userId={userId}
          onClose={() => setEditItem(null)}
          onSaved={saved => {
            setItems(prev => prev.map(i => i.id === saved.id ? saved : i))
            setEditItem(null)
          }}
        />
      )}
    </div>
  )
}

function ItemRow({ item, onCycle, onEdit, onDelete }) {
  const ab = adminBadge(item.admin_status ?? 'en_attente')
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <a href={item.lien_shein} target="_blank" rel="noopener noreferrer"
            className="text-sm font-medium text-teal-600 hover:underline block truncate">
            {item.lien_shein}
          </a>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs text-gray-500">{item.categorie}</span>
            {item.taille && (
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{item.taille}</span>
            )}
            <span className="text-xs text-gray-400">
              {new Date(item.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="mt-1.5">
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ab.cls}`}>{ab.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onCycle(item)}
            className={`text-xs font-semibold px-2 py-1 rounded-full transition-colors ${statutBadgeCls(item.statut)}`}
          >
            {STATUT_LABELS[item.statut]}
          </button>
          <button onClick={() => onEdit(item)} className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button onClick={() => onDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function WorkItemModal({ item, userId, onClose, onSaved }) {
  const [lienShein, setLienShein] = useState(item?.lien_shein ?? '')
  const [categorie, setCategorie] = useState(item?.categorie ?? CATEGORIES[0])
  const [taille, setTaille]       = useState(item?.taille ?? '')
  const [statut, setStatut]       = useState(item?.statut ?? 'en_cours')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const payload = { lien_shein: lienShein, categorie, taille: taille || null, statut }
    const { data, error: err } = item
      ? await supabase.from('work_items').update(payload).eq('id', item.id).select().single()
      : await supabase.from('work_items').insert({ ...payload, employe_id: userId }).select().single()
    if (err) { setError(err.message); setLoading(false); return }
    onSaved(data)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Modifier l'article</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Lien Shein</label>
            <input type="url" value={lienShein} onChange={e => setLienShein(e.target.value)} required
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie</label>
            <select value={categorie} onChange={e => setCategorie(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Taille</label>
            <select value={taille} onChange={e => setTaille(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
              <option value="">— Aucune —</option>
              {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Statut</label>
            <select value={statut} onChange={e => setStatut(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
              {STATUTS.map(s => <option key={s} value={s}>{STATUT_LABELS[s]}</option>)}
            </select>
          </div>
          {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Annuler
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50">
              {loading ? 'Enregistrement...' : 'Modifier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
