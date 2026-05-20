import { useState, useRef } from 'react'

export default function LotPdfModal({ count, onClose, onConfirm }) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)
  const modalRef = useRef(null)

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') return
    setUploading(true)
    await onConfirm(file)
    setUploading(false)
  }

  function handleDragEnter(e) {
    e.preventDefault()
    if ([...e.dataTransfer.items].some(i => i.type === 'application/pdf')) setIsDragging(true)
  }
  function handleDragLeave(e) {
    e.preventDefault()
    if (!modalRef.current?.contains(e.relatedTarget)) setIsDragging(false)
  }
  function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  function handleDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={modalRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm relative transition-all ${
          isDragging ? 'ring-2 ring-teal-400' : ''
        }`}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 bg-teal-500/10 border-2 border-teal-400 border-dashed rounded-t-3xl sm:rounded-2xl flex flex-col items-center justify-center pointer-events-none">
            <svg className="w-12 h-12 text-teal-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="text-teal-700 font-bold">Déposer le bordereau</span>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900 text-base">Créer le lot</h2>
            <p className="text-xs text-gray-400 mt-0.5">{count} article{count > 1 ? 's' : ''} sélectionné{count > 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-6">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full py-8 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-3 hover:border-teal-400 hover:bg-teal-50/30 transition-all disabled:opacity-50"
          >
            {uploading ? (
              <>
                <svg className="w-10 h-10 animate-spin text-teal-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <span className="text-sm text-teal-600 font-medium">Création du lot…</span>
              </>
            ) : (
              <>
                <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-600">Glisser le bordereau PDF ici</p>
                  <p className="text-xs text-gray-400 mt-0.5">ou cliquer pour choisir</p>
                </div>
              </>
            )}
          </button>
          <input ref={inputRef} type="file" accept="application/pdf"
            onChange={e => { handleFile(e.target.files[0]); e.target.value = '' }}
            className="hidden" />
          <p className="text-xs text-gray-400 text-center mt-3">Le lot passera dans "À envoyer"</p>
        </div>
      </div>
    </div>
  )
}
