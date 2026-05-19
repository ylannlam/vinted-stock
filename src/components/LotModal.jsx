import { useState, useRef } from 'react'

export default function LotModal({ items, onClose, onCreateLot }) {
  const [selected, setSelected] = useState(new Set())
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev =>
      prev.size === items.length ? new Set() : new Set(items.map(i => i.id))
    )
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') return
    e.target.value = ''
    setUploading(true)
    await onCreateLot([...selected], file)
    setUploading(false)
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
            <p className="text-xs text-gray-400 mt-0.5">Sélectionne les articles puis attache le bordereau</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tout sélectionner */}
        <div className="px-5 py-2 border-b border-gray-50 flex items-center justify-between flex-shrink-0">
          <button onClick={toggleAll} className="text-xs font-semibold text-teal-600">
            {selected.size === items.length && items.length > 0 ? 'Tout désélectionner' : 'Tout sélectionner'}
          </button>
          {selected.size > 0 && (
            <span className="text-xs text-gray-400">{selected.size} article{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Liste */}
        <div className="overflow-y-auto flex-1">
          {items.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">Aucun article en stock</p>
          ) : items.map(item => (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              className={`w-full flex items-center gap-3 px-5 py-3 border-b border-gray-50 transition-colors text-left ${
                selected.has(item.id) ? 'bg-teal-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                selected.has(item.id) ? 'bg-teal-500 border-teal-500' : 'border-gray-300'
              }`}>
                {selected.has(item.id) && (
                  <svg className="w-3 h-3 text-white pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              {item.photo_url
                ? <img src={item.photo_url} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                : <div className="w-12 h-12 rounded-xl bg-gray-100 flex-shrink-0" />
              }
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500">Taille {item.size}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        {selected.size > 0 && (
          <div className="flex-shrink-0 border-t border-gray-100 px-5 py-4">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 bg-teal-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors"
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
              Attacher le bordereau ({selected.size} article{selected.size > 1 ? 's' : ''})
            </button>
            <input ref={inputRef} type="file" accept="application/pdf" onChange={handleFile} className="hidden" />
            <p className="text-xs text-gray-400 text-center mt-2">Le lot passera directement dans "À envoyer"</p>
          </div>
        )}
      </div>
    </div>
  )
}
