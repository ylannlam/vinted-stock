import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TaskAssignModal({ employe, fonds, onClose, onCreated }) {
  const [lienShein, setLienShein] = useState('')
  const [fondId, setFondId]       = useState('')
  const [message, setMessage]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!lienShein.trim()) { setError('Le lien Shein est requis.'); return }
    if (!fondId)           { setError('Veuillez choisir un fond.'); return }
    setLoading(true)
    setError('')

    const { data, error: err } = await supabase
      .from('tasks')
      .insert({
        employe_id: employe.id,
        lien_shein: lienShein.trim(),
        fond_id: fondId,
        message: message.trim() || null,
        statut: 'assignee',
      })
      .select()
      .single()

    if (err) { setError(err.message); setLoading(false); return }
    onCreated(data)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-900">Assigner une tâche</h2>
            <p className="text-xs text-gray-500 mt-0.5">à {employe.pseudo}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Lien Shein <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              value={lienShein}
              onChange={e => setLienShein(e.target.value)}
              placeholder="https://..."
              required
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Fond <span className="text-red-500">*</span>
            </label>
            <select
              value={fondId}
              onChange={e => setFondId(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              <option value="">— Choisir un fond —</option>
              {fonds.map(f => (
                <option key={f.id} value={f.id}>
                  {f.nom} — Compte : {f.compte_vinted_pseudo}
                </option>
              ))}
            </select>
          </div>

          {fondId && (() => {
            const fond = fonds.find(f => f.id === fondId)
            return fond ? (
              <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                <img src={fond.image_url} alt={fond.nom} className="w-12 h-12 rounded-xl object-cover border border-gray-200 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-gray-800">{fond.nom}</div>
                  <div className="text-xs text-gray-500">Compte : {fond.compte_vinted_pseudo}</div>
                </div>
              </div>
            ) : null
          })()}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Message (optionnel)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Consignes, remarques..."
              rows={3}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50"
            >
              {loading ? 'Envoi...' : 'Assigner la tâche'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
