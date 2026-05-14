import { useState, useRef } from 'react'

export default function LotModal({ items, onClose, onBordereau, onMarkSent }) {
  const [selected, setSelected] = useState(new Set())
  const [confirmSent, setConfirmSent] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  const allSelected = selected.size === items.length && items.length > 0

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)))
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') return
    e.target.value = ''
    setUploading(true)
    await onBordereau([...selected], file)
    setUploading(false)
  }

  async function handleMarkSent() {
    await onMarkSent([...selected])
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 text-base">Faire un lot</h2>
            <p className="text-xs text-gray-400 mt-0.5">Sélectionne les articles à grouper</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tout sélectionner */}
        <div className="px-5 py-2 border-b border-gray-50 flex-shrink-0">
          <button
            onClick={toggleAll}
            className="text-xs font-semibold text-teal-600 hover:text-teal-800 transition-colors"
          >
            {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
          </button>
        </div>

        {/* Liste articles */}
        <div className="overflow-y-auto flex-1">
          {items.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">Aucun article à envoyer</p>
          ) : (
            items.map(item => (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                className={`w-full flex items-center gap-3 px-5 py-3 border-b border-gray-50 transition-colors text-left ${
                  selected.has(item.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                {/* Checkbox */}
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  selected.has(item.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                }`}>
                  {selected.has(item.id) && (
                    <svg className="w-3 h-3 text-white pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>

                {/* Photo */}
                {item.photo_url ? (
                  <img src={item.photo_url} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex-shrink-0" />
                )}

                {/* Infos */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.category}</p>
                  <p className="text-xs text-gray-400">Taille {item.size}</p>
                </div>

                {/* Bordereau déjà attaché */}
                {item.bordereau_url && (
                  <span className="text-[10px] font-semibold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    PDF ✓
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Actions */}
        {selected.size > 0 && (
          <div className="flex-shrink-0 border-t border-gray-100 px-5 py-4">
            {confirmSent ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm font-bold text-gray-800 text-center">
                  Alicia gros caca 💩<br />t'as bien emballé les {selected.size} articles ?
                </p>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => setConfirmSent(false)}
                    className="flex-1 border-2 border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors"
                  >
                    Non
                  </button>
                  <button
                    onClick={handleMarkSent}
                    className="flex-1 bg-orange-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-orange-600 transition-colors"
                  >
                    Oui !
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-400 text-center mb-3">
                  {selected.size} article{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
                </p>
                <div className="flex gap-2">
                  {/* Bordereau */}
                  <button
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    className="flex-1 flex items-center justify-center gap-2 border-2 border-blue-200 text-blue-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
                  >
                    {uploading ? (
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                    )}
                    Bordereau
                  </button>
                  <input ref={inputRef} type="file" accept="application/pdf" onChange={handleFile} className="hidden" />

                  {/* Marquer envoyés */}
                  <button
                    onClick={() => setConfirmSent(true)}
                    className="flex-1 flex items-center justify-center gap-2 bg-orange-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-orange-600 transition-colors"
                  >
                    <svg className="w-4 h-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                    Envoyer
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
