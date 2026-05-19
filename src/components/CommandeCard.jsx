import { useState } from 'react'

export default function CommandeCard({ commande, items, onReception, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="bg-white rounded-xl border border-purple-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full uppercase tracking-wide">
              En attente
            </span>
            <span className="text-[10px] text-gray-400">
              {new Date(commande.created_at).toLocaleDateString('fr-FR')}
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-900 truncate font-mono">{commande.tracking_number}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                onClick={() => { setConfirmDelete(false); onDelete(commande.id) }}
                className="text-[10px] font-bold bg-red-500 text-white px-2 py-1 rounded-full"
              >
                Suppr.
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] text-gray-500 bg-gray-100 px-2 py-1 rounded-full"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-7 h-7 flex items-center justify-center rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={() => onReception(commande, items)}
            className="flex items-center gap-1.5 bg-purple-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full hover:bg-purple-600 active:bg-purple-700 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Réceptionner
          </button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="px-4 pb-3 flex gap-2 items-center flex-wrap">
          {items.map(item => (
            <div key={item.id} className="relative">
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                {item.photo_url ? (
                  <img src={item.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <span className="absolute -bottom-1 -right-1 text-[9px] font-bold bg-white border border-gray-200 px-1 py-0.5 rounded-full leading-none text-gray-600">
                {item.size}
              </span>
            </div>
          ))}
          <span className="text-xs font-semibold text-purple-400 bg-purple-50 px-2 py-1 rounded-full ml-1">
            {items.length} article{items.length > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
