import { useState, useRef } from 'react'

export default function ItemCard({ item, categories, onMarkSold, onMarkSent, onMarkUnsent, onDelete, onUpdateCategory, onBordereauDrop, onEdit, onMarkReceived }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)
  const [confirmReceived, setConfirmReceived] = useState(false)
  const [editingCategory, setEditingCategory] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const pdfInputRef = useRef(null)

  async function handlePdfInput(e) {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') return
    e.target.value = ''
    setUploading(true)
    await onBordereauDrop(item.id, file)
    setUploading(false)
  }
  const isOrdered = item.status === 'a_recevoir'
  const isStock   = item.status === 'en_stock'
  const isPending = item.status === 'vendu'
  const isSent    = item.status === 'envoye'

  const canDropBordereau = isPending || isSent

  function handleDragEnter(e) {
    if (!canDropBordereau) return
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragOver(e) {
    if (!canDropBordereau) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false)
  }

  async function handleDrop(e) {
    e.preventDefault()
    setIsDragOver(false)
    if (!canDropBordereau) return
    const file = e.dataTransfer.files[0]
    if (!file || file.type !== 'application/pdf') return
    setUploading(true)
    await onBordereauDrop(item.id, file)
    setUploading(false)
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`bg-white rounded-xl overflow-hidden shadow-sm border transition-all relative ${
        isDragOver  ? 'border-blue-400 scale-[1.02] shadow-md' :
        isOrdered   ? 'border-purple-200' :
        isPending   ? 'border-orange-200' :
        isSent      ? 'border-blue-100'   :
                      'border-gray-100'
      }`}
    >

      {/* Photo */}
      <div className="aspect-square relative overflow-hidden bg-gray-100">
        {item.photo_url ? (
          <img
            src={item.photo_url}
            alt=""
            loading="lazy"
            className={`w-full h-full object-cover pointer-events-none transition-opacity ${(!isStock && !isOrdered) ? 'opacity-70' : ''}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center pointer-events-none">
            <svg className="w-10 h-10 text-purple-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* Badge statut — haut droite */}
        <span className={`absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shadow-sm pointer-events-none leading-tight ${
          isOrdered ? 'bg-purple-500 text-white' :
          isStock   ? 'bg-white text-gray-700'   :
          isPending ? 'bg-orange-500 text-white' :
                      'bg-blue-500 text-white'
        }`}>
          {isOrdered ? 'À recevoir' : isStock ? 'Stock' : isPending ? 'Vendre' : 'Envoyé'}
        </span>

        {/* Bouton poubelle / confirmation — haut gauche */}
        {confirmDelete ? (
          <div className="absolute top-1.5 left-1.5 flex gap-1">
            <button
              onClick={() => { setConfirmDelete(false); onDelete(item.id) }}
              className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold shadow-sm"
            >
              Suppr.
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="bg-white text-gray-600 text-[10px] px-1.5 py-0.5 rounded-full shadow-sm"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="absolute top-1.5 left-1.5 w-6 h-6 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-white transition-colors shadow-sm"
            aria-label="Supprimer"
          >
            <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        {/* Bouton édition — bas droite */}
        <button
          onClick={() => onEdit(item)}
          className="absolute bottom-1.5 right-1.5 w-6 h-6 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center text-gray-400 hover:text-teal-500 hover:bg-white transition-colors shadow-sm"
          aria-label="Modifier"
        >
          <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 012.828 2.828L11.828 15.828A2 2 0 0110.414 16.5H8v-2.414a2 2 0 01.586-1.414z" />
          </svg>
        </button>
      </div>

      {/* Infos bas de carte */}
      <div className="px-2 py-1.5">

        {/* Catégorie + édition inline */}
        <div className="flex items-center gap-0.5 mb-1 min-w-0">
          {editingCategory ? (
            <select
              autoFocus
              value={item.category}
              onChange={e => { onUpdateCategory(item.id, e.target.value); setEditingCategory(false) }}
              onBlur={() => setEditingCategory(false)}
              className="text-[10px] text-gray-700 font-medium bg-white border border-teal-400 rounded px-1 py-0.5 focus:outline-none w-full"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          ) : (
            <>
              <p className="text-[10px] text-gray-400 truncate flex-1 leading-tight">{item.category}</p>
              <button
                onClick={() => setEditingCategory(true)}
                className="flex-shrink-0 text-gray-200 hover:text-teal-400 transition-colors"
                aria-label="Modifier la catégorie"
              >
                <svg className="w-2.5 h-2.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 012.828 2.828L11.828 15.828A2 2 0 0110.414 16.5H8v-2.414a2 2 0 01.586-1.414z" />
                </svg>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-1">
          {/* Taille + lien Shein */}
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded-full leading-tight flex-shrink-0">
              {item.size}
            </span>
            {item.shein_url && (
              <a
                href={item.shein_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="w-5 h-5 flex items-center justify-center rounded-full bg-pink-50 text-pink-400 hover:bg-pink-100 transition-colors flex-shrink-0"
                aria-label="Voir sur Shein"
              >
                <svg className="w-2.5 h-2.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>

          {/* Action selon statut — icône seule */}
          {isOrdered && (
            <button
              onClick={() => setConfirmReceived(true)}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-purple-500 text-white hover:bg-purple-600 active:bg-purple-700 transition-colors flex-shrink-0"
              aria-label="Marquer reçu"
            >
              <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          )}

          {isStock && (
            <button
              onClick={() => onMarkSold(item)}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600 active:bg-green-700 transition-colors flex-shrink-0"
              aria-label="Marquer vendu"
            >
              <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          )}

          {isPending && (
            <button
              onClick={() => setConfirmSent(true)}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700 transition-colors flex-shrink-0"
              aria-label="Marquer envoyé"
            >
              <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          )}

          {isSent && (
            <button
              onClick={() => onMarkUnsent(item)}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 text-gray-500 hover:bg-orange-100 hover:text-orange-500 transition-colors flex-shrink-0"
              aria-label="Remettre en À envoyer"
            >
              <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </button>
          )}

          {(isPending || isSent) && (
            <>
              {item.bordereau_url && (
                <a
                  href={item.bordereau_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded-full transition-colors flex-shrink-0"
                  aria-label="Télécharger bordereau"
                >
                  <svg className="w-2.5 h-2.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  PDF
                </a>
              )}
              <button
                onClick={() => pdfInputRef.current?.click()}
                className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-blue-100 hover:text-blue-500 transition-colors flex-shrink-0"
                aria-label="Ajouter un bordereau"
              >
                <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                onChange={handlePdfInput}
                className="hidden"
              />
            </>
          )}
        </div>
      </div>

      {/* Overlay confirmation envoi */}
      {confirmSent && (
        <div className="absolute inset-0 z-10 bg-blue-600/95 flex flex-col items-center justify-center rounded-xl p-2 gap-2">
          <p className="text-white text-[10px] font-bold text-center leading-tight">
            Alicia gros caca 💩{'\n'}t'as bien emballé l'article ?
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => { setConfirmSent(false); onMarkSent(item) }}
              className="bg-white text-blue-600 text-[10px] font-bold px-2.5 py-1 rounded-full"
            >
              Oui !
            </button>
            <button
              onClick={() => setConfirmSent(false)}
              className="bg-blue-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full border border-blue-400"
            >
              Non
            </button>
          </div>
        </div>
      )}

      {/* Overlay confirmation reçu */}
      {confirmReceived && (
        <div className="absolute inset-0 z-10 bg-purple-600/95 flex flex-col items-center justify-center rounded-xl p-2 gap-2">
          <p className="text-white text-[10px] font-bold text-center leading-tight">
            L'article est bien arrivé ?
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => { setConfirmReceived(false); onMarkReceived(item) }}
              className="bg-white text-purple-600 text-[10px] font-bold px-2.5 py-1 rounded-full"
            >
              Oui !
            </button>
            <button
              onClick={() => setConfirmReceived(false)}
              className="bg-purple-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full border border-purple-400"
            >
              Non
            </button>
          </div>
        </div>
      )}

      {/* Overlay drag PDF */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-500/90 flex flex-col items-center justify-center rounded-xl pointer-events-none">
          <svg className="w-8 h-8 text-white mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="text-white text-[10px] font-bold">Déposer le bordereau</span>
        </div>
      )}

      {/* Overlay upload en cours */}
      {uploading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-xl pointer-events-none">
          <svg className="w-6 h-6 animate-spin text-orange-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}
    </div>
  )
}
