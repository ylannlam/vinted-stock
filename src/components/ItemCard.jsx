import { useState } from 'react'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export default function ItemCard({ item, onMarkSold, onMarkSent, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isStock   = item.status === 'en_stock'
  const isPending = item.status === 'vendu'
  const isSent    = item.status === 'envoye'

  return (
    <div className={`bg-white rounded-2xl overflow-hidden shadow-sm border transition-all ${
      isPending ? 'border-orange-200' :
      isSent    ? 'border-blue-100'   :
                  'border-gray-100'
    }`}>

      {/* Photo */}
      <div className="aspect-square relative overflow-hidden bg-gray-100">
        <img
          src={item.photo_url}
          alt=""
          loading="lazy"
          className={`w-full h-full object-cover pointer-events-none transition-opacity ${!isStock ? 'opacity-70' : ''}`}
        />

        {/* Badge statut — haut droite */}
        <span className={`absolute top-2 right-2 text-xs font-semibold px-2 py-1 rounded-full shadow-sm pointer-events-none ${
          isStock   ? 'bg-white text-gray-700'     :
          isPending ? 'bg-orange-500 text-white'   :
                      'bg-blue-500 text-white'
        }`}>
          {isStock ? 'En stock' : isPending ? 'À envoyer' : 'Envoyé'}
        </span>

        {/* Bouton poubelle / confirmation — haut gauche */}
        {confirmDelete ? (
          <div className="absolute top-2 left-2 flex gap-1">
            <button
              onClick={() => { setConfirmDelete(false); onDelete(item.id) }}
              className="bg-red-500 text-white text-xs px-2 py-1 rounded-full font-semibold shadow-sm"
            >
              Supprimer
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="bg-white text-gray-600 text-xs px-2 py-1 rounded-full shadow-sm"
            >
              Annuler
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="absolute top-2 left-2 w-7 h-7 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-white transition-colors shadow-sm"
            aria-label="Supprimer"
          >
            <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Infos bas de carte */}
      <div className="px-3 py-2.5">

        {/* Catégorie (visible dans les onglets À envoyer et Envoyés) */}
        {!isStock && (
          <p className="text-xs text-gray-500 truncate mb-1.5 font-medium">{item.category}</p>
        )}

        <div className="flex items-center justify-between gap-2">
          {/* Badge taille */}
          <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full flex-shrink-0">
            {item.size}
          </span>

          {/* Action selon statut */}
          {isStock && (
            <button
              onClick={() => onMarkSold(item)}
              className="flex items-center gap-1 text-xs bg-green-500 text-white px-2.5 py-1 rounded-full font-semibold hover:bg-green-600 active:bg-green-700 transition-colors"
            >
              <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Vendu
            </button>
          )}

          {isPending && (
            <button
              onClick={() => onMarkSent(item)}
              className="text-xs bg-blue-500 text-white px-2.5 py-1 rounded-full font-semibold hover:bg-blue-600 active:bg-blue-700 transition-colors"
            >
              Déjà envoyé
            </button>
          )}

          {isSent && item.bordereau_url && (
            <a
              href={item.bordereau_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-600 font-medium hover:text-blue-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Bordereau
            </a>
          )}
        </div>

        {/* Date d'envoi */}
        {isSent && item.sent_at && (
          <p className="text-xs text-gray-400 mt-1.5">
            Envoyé le {formatDate(item.sent_at)}
          </p>
        )}
      </div>
    </div>
  )
}
