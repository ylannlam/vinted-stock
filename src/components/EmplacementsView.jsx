import { useState } from 'react'
import { getCapacities, getCustomCapacities, saveCustomCapacity, softDeleteCarton, restoreCarton, getDeletedCartons } from '../lib/emplacements'

export default function EmplacementsView({ items, onClose }) {
  const [customCaps, setCustomCaps] = useState(() => getCustomCapacities())
  const [deletedCartons, setDeletedCartons] = useState(() => getDeletedCartons())
  const [showForm, setShowForm] = useState(false)
  const [newLetter, setNewLetter] = useState('')
  const [newCapacity, setNewCapacity] = useState('')
  const [formError, setFormError] = useState('')

  const caps = getCapacities(items)
  const sortedLetters = Object.keys(caps).sort()

  const dbCaps = (() => {
    const c = {}
    for (const item of (items || [])) {
      const m = (item.emplacement || '').trim().toUpperCase().match(/^([A-Z])(\d+)$/)
      if (!m) continue
      c[m[1]] = Math.max(c[m[1]] || 0, parseInt(m[2]))
    }
    c['J'] = Math.max(c['J'] || 0, 16)
    return c
  })()

  const occupiedMap = Object.fromEntries(
    (items || []).filter(i => i.emplacement).map(i => [i.emplacement.trim().toUpperCase(), i])
  )

  const totalSlots = Object.values(caps).reduce((a, b) => a + b, 0)
  const occupiedCount = Object.keys(occupiedMap).length

  function handleAdd(e) {
    e.preventDefault()
    setFormError('')
    const letter = newLetter.trim().toUpperCase()
    const cap = parseInt(newCapacity)
    if (!letter.match(/^[A-Z]$/)) { setFormError('Une seule lettre A-Z'); return }
    if (!cap || cap < 1 || cap > 99) { setFormError('Entre 1 et 99 cases'); return }
    saveCustomCapacity(letter, cap)
    setCustomCaps(getCustomCapacities())
    setNewLetter('')
    setNewCapacity('')
    setShowForm(false)
  }

  function handleRemove(letter, capacity) {
    softDeleteCarton(letter, capacity)
    setCustomCaps(getCustomCapacities())
    setDeletedCartons(getDeletedCartons())
  }

  function handleRestore(letter) {
    restoreCarton(letter)
    setCustomCaps(getCustomCapacities())
    setDeletedCartons(getDeletedCartons())
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">Plan des emplacements</h2>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="flex items-center gap-1 text-xs text-red-500">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />
                {occupiedCount} occupés
              </span>
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 border border-emerald-300 inline-block" />
                {totalSlots - occupiedCount} libres
              </span>
              <span className="text-xs text-gray-400">{totalSlots} total</span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Corps */}
        <div className="overflow-y-auto px-5 py-4 space-y-5 flex-1">
          {sortedLetters.map(letter => {
            const cap = caps[letter] || 0
            const isCustomOnly = !dbCaps[letter]
            const occupiedInCarton = Array.from({ length: cap }, (_, i) => `${letter}${i + 1}`)
              .filter(s => occupiedMap[s]).length
            const pct = Math.round((occupiedInCarton / cap) * 100)

            return (
              <div key={letter}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-bold text-gray-800 w-16 flex-shrink-0">
                    Carton {letter}
                  </span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-12 text-right flex-shrink-0">
                    {occupiedInCarton}/{cap}
                  </span>
                  {isCustomOnly && (
                    <button
                      onClick={() => handleRemove(letter, caps[letter])}
                      className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                      title="Supprimer ce carton"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: cap }, (_, i) => i + 1).map(n => {
                    const slot = `${letter}${n}`
                    const item = occupiedMap[slot]
                    return (
                      <div
                        key={slot}
                        title={item ? `${slot} · T.${item.size}` : `${slot} · Libre`}
                        style={item?.photo_url ? {
                          backgroundImage: `url(${item.photo_url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        } : undefined}
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-[9px] font-bold relative overflow-hidden cursor-default select-none transition-transform hover:scale-110 ${
                          item ? 'text-white shadow-sm' : 'bg-emerald-100 text-emerald-600 border border-emerald-200 hover:bg-emerald-200'
                        }`}
                      >
                        {item ? (
                          <>
                            {item.photo_url && <div className="absolute inset-0 bg-black/40" />}
                            <span className="relative z-10">{item.size}</span>
                          </>
                        ) : (
                          <span className="text-[10px]">{n}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {sortedLetters.length === 0 && !showForm && (
            <div className="text-center py-8 text-gray-400">
              <p className="font-medium">Aucun carton détecté</p>
              <p className="text-sm mt-1">Ajoutez un carton ci-dessous pour commencer.</p>
            </div>
          )}

          {/* Cartons supprimés — restauration */}
          {deletedCartons.length > 0 && (
            <div className="border border-dashed border-gray-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Cartons supprimés</p>
              {deletedCartons.map(({ letter, capacity }) => {
                const surviving = (items || []).filter(i => {
                  if (!i.emplacement) return false
                  const m = i.emplacement.trim().toUpperCase().match(/^([A-Z])(\d+)$/)
                  return m && m[1] === letter
                })
                return (
                  <div key={letter} className="flex items-center gap-3 py-1">
                    <span className="text-sm font-bold text-gray-500 w-8">
                      {letter}
                    </span>
                    <span className="text-xs text-gray-400 flex-1">
                      {capacity} cases
                      {surviving.length > 0 && (
                        <span className="ml-2 text-orange-500 font-semibold">
                          · {surviving.length} article{surviving.length > 1 ? 's' : ''} non envoyé{surviving.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => handleRestore(letter)}
                      className="flex items-center gap-1 text-xs font-semibold text-teal-600 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-full transition-colors flex-shrink-0"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Restaurer
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Formulaire ajout carton */}
          {showForm ? (
            <form onSubmit={handleAdd} className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Nouveau carton</p>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Lettre</label>
                  <input
                    type="text"
                    value={newLetter}
                    onChange={e => setNewLetter(e.target.value.slice(-1))}
                    placeholder="K"
                    maxLength={1}
                    autoFocus
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-teal-500 text-center"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Nombre de cases</label>
                  <input
                    type="number"
                    value={newCapacity}
                    onChange={e => setNewCapacity(e.target.value)}
                    placeholder="16"
                    min={1}
                    max={99}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
              {formError && <p className="text-xs text-red-500">{formError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowForm(false); setFormError('') }}
                  className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                  Annuler
                </button>
                <button type="submit"
                  className="flex-1 bg-teal-500 text-white rounded-xl py-2 text-sm font-semibold hover:bg-teal-600 transition-colors">
                  Ajouter
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-teal-300 hover:text-teal-500 transition-colors font-medium"
            >
              + Ajouter un carton
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
