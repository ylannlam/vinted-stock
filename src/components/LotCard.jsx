import { useState } from 'react'

export default function LotCard({ items, lotIndex, onMarkSent, onDeleteLot }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const bordereau_url = items[0]?.bordereau_url

  return (
    <div className="col-span-full bg-white rounded-xl border border-orange-200 overflow-hidden shadow-sm">
      <div className="px-3 pt-2 pb-2 bg-orange-50 space-y-1.5">

        {/* Ligne 1 : titre + tailles */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-orange-600 flex-shrink-0">Lot {lotIndex}</span>
          <span className="text-[10px] text-gray-400 flex-shrink-0">{items.length} article{items.length > 1 ? 's' : ''}</span>
          {items.map(item => (
            <span key={item.id} className="text-[10px] font-bold bg-white text-gray-700 px-1.5 py-0.5 rounded-full border border-gray-200 flex-shrink-0">
              {item.size}
            </span>
          ))}
        </div>

        {/* Ligne 2 : actions */}
        <div className="flex items-center gap-1.5">
          {bordereau_url && (
            <a
              href={bordereau_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-1.5 py-1 rounded-full transition-colors"
            >
              <svg className="w-2.5 h-2.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              PDF
            </a>
          )}

          <button
            onClick={() => setOpen(v => !v)}
            className="text-[10px] font-semibold text-gray-500 bg-white border border-gray-200 px-2 py-1 rounded-full hover:bg-gray-50 transition-colors"
          >
            {open ? 'Réduire' : 'Voir articles'}
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-600 font-medium">Remettre en stock ?</span>
                <button
                  onClick={() => { setConfirmDelete(false); onDeleteLot(items[0].bordereau_url) }}
                  className="text-xs font-bold bg-red-500 text-white px-2.5 py-1 rounded-full"
                >Oui</button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full"
                >Non</button>
              </div>
            ) : !confirm ? (
              <>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1 text-xs font-bold bg-red-100 text-red-500 px-2.5 py-1 rounded-full hover:bg-red-200 transition-colors"
                >
                  <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Supprimer
                </button>
                <button
                  onClick={() => setConfirm(true)}
                  className="flex items-center gap-1 text-xs font-bold bg-orange-500 text-white px-3 py-1 rounded-full hover:bg-orange-600 transition-colors"
                >
                  <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                  Envoyer
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-600 font-medium">Bien emballé ?</span>
                <button
                  onClick={() => { setConfirm(false); onMarkSent(items.map(i => i.id)) }}
                  className="text-xs font-bold bg-orange-500 text-white px-2.5 py-1 rounded-full"
                >Oui</button>
                <button
                  onClick={() => setConfirm(false)}
                  className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full"
                >Non</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Articles du lot */}
      {open && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 p-2">
          {items.map(item => (
            <div key={item.id} className="bg-gray-50 rounded-lg overflow-hidden">
              {item.photo_url
                ? <img src={item.photo_url} alt="" className="w-full aspect-square object-cover" />
                : <div className="w-full aspect-square bg-gray-100" />
              }
              <div className="px-1.5 py-1">
                <p className="text-[10px] text-gray-400 truncate">{item.category}</p>
                <p className="text-[10px] font-bold text-gray-700">{item.size}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
