import { useState, useRef } from 'react'

export default function BatchBar({ count, onBordereau, onMarkSent, onCancel }) {
  const [confirmSent, setConfirmSent] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') return
    e.target.value = ''
    setUploading(true)
    await onBordereau(file)
    setUploading(false)
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-lg px-4 py-3 safe-area-bottom">
      {confirmSent ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-bold text-gray-800 text-center">
            Alicia gros caca 💩 t'as bien emballé les {count} articles ?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { setConfirmSent(false); onMarkSent() }}
              className="bg-blue-500 text-white text-sm font-bold px-4 py-1.5 rounded-full"
            >
              Oui !
            </button>
            <button
              onClick={() => setConfirmSent(false)}
              className="bg-gray-100 text-gray-600 text-sm font-semibold px-4 py-1.5 rounded-full"
            >
              Non
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700 flex-1">
            {count} article{count > 1 ? 's' : ''} sélectionné{count > 1 ? 's' : ''}
          </span>

          {/* Bordereau lot */}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 bg-blue-50 text-blue-600 text-xs font-semibold px-3 py-1.5 rounded-full hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            className="flex items-center gap-1.5 bg-orange-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full hover:bg-orange-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            Envoyer
          </button>

          {/* Annuler */}
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
