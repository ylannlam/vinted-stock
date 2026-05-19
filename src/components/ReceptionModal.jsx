import { useState, useMemo } from 'react'
import { computeSuggestions } from '../lib/emplacements'

export default function ReceptionModal({ commande, items, stockItems, onClose, onReceived }) {
  const suggestions = useMemo(() => computeSuggestions(items, stockItems), [])
  const [emplacements, setEmplacements] = useState(() => suggestions)
  const [saving, setSaving] = useState(false)

  const occupiedEmplacements = new Set(
    stockItems.filter(i => i.emplacement).map(i => i.emplacement.trim().toLowerCase())
  )
  const occupiedList = [...stockItems]
    .filter(i => i.emplacement)
    .sort((a, b) => a.emplacement.localeCompare(b.emplacement, undefined, { numeric: true }))

  function getConflict(itemId, value) {
    const v = (value ?? '').trim()
    if (!v) return null
    const vl = v.toLowerCase()
    if (occupiedEmplacements.has(vl)) return 'déjà occupé en stock'
    const dup = items.find(i => i.id !== itemId && (emplacements[i.id] ?? '').trim().toLowerCase() === vl)
    if (dup) return 'saisi deux fois'
    return null
  }

  const allFilled = items.every(i => (emplacements[i.id] ?? '').trim())
  const hasConflict = items.some(i => getConflict(i.id, emplacements[i.id]) !== null)
  const canSubmit = allFilled && !hasConflict

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    await onReceived(commande, emplacements)
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-semibold text-gray-900 text-base">Réception du colis</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{commande.tracking_number}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex items-start gap-2 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2.5">
            <svg className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-xs text-teal-700">Emplacements suggérés automatiquement — modifie si besoin.</p>
          </div>

          <div className="space-y-2">
            {items.map(item => {
              const conflict = getConflict(item.id, emplacements[item.id])
              const val = emplacements[item.id] ?? ''
              return (
                <div key={item.id} className={`flex gap-3 items-center p-3 rounded-xl border transition-colors ${
                  conflict ? 'border-red-300 bg-red-50' :
                  val.trim() ? 'border-teal-200 bg-teal-50/50' :
                  'border-gray-200 bg-gray-50'
                }`}>
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-white border border-gray-200 flex-shrink-0">
                    {item.photo_url ? (
                      <img src={item.photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-bold text-gray-700 bg-white border border-gray-200 px-2 py-0.5 rounded-full flex-shrink-0">
                        {item.size}
                      </span>
                      {conflict && (
                        <span className="text-[10px] text-red-500 font-semibold truncate">⚠ Emplacement {conflict}</span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={val}
                        onChange={e => setEmplacements(prev => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="ex : A1"
                        maxLength={10}
                        className={`w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:ring-2 transition-colors bg-white ${
                          conflict
                            ? 'border-red-300 focus:ring-red-300'
                            : val.trim() && val === suggestions[item.id]
                              ? 'border-teal-300 focus:ring-teal-400'
                              : 'border-gray-200 focus:ring-teal-400'
                        }`}
                      />
                      {val && val === suggestions[item.id] && !conflict && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-teal-500 bg-teal-50 px-1.5 py-0.5 rounded-full pointer-events-none">
                          💡 auto
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {occupiedList.length > 0 && (
            <details className="group">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 font-medium select-none list-none flex items-center gap-1">
                <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Emplacements déjà occupés ({occupiedList.length})
              </summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {occupiedList.map(i => (
                  <span key={i.id} className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-mono">
                    {i.emplacement}
                  </span>
                ))}
              </div>
            </details>
          )}

          {!allFilled && (
            <p className="text-xs text-orange-400 font-medium text-center">Tous les emplacements doivent être remplis</p>
          )}
          {allFilled && hasConflict && (
            <p className="text-xs text-red-500 font-medium text-center">Corrige les conflits d'emplacement avant de valider</p>
          )}

          <div className="flex gap-3 pt-1 pb-2">
            <button type="button" onClick={onClose}
              className="flex-1 border-2 border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="flex-1 bg-teal-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-teal-600 disabled:opacity-40 transition-colors"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Rangement…
                </span>
              ) : `Mettre en stock (${items.length} article${items.length > 1 ? 's' : ''})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
