import ItemCard from './ItemCard'
import LotCard from './LotCard'

export default function Gallery({ items, categories, loading, onMarkSold, onMarkSent, onMarkUnsent, onMarkReceived, onDelete, onUpdateCategory, onUpdateEmplacement, onBordereauDrop, onPhotoDrop, onEdit, onToggleReception, onLotMarkSent, onDeleteLot, isLotTab, showAddHint }) {
  if (loading) {
    return (
      <div className="p-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl overflow-hidden border border-gray-100 animate-pulse">
            <div className="aspect-square bg-gray-200" />
            <div className="px-3 py-2.5 flex gap-2">
              <div className="h-6 w-10 bg-gray-200 rounded-full" />
              <div className="h-6 w-16 bg-gray-200 rounded-full ml-auto" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-gray-500 font-medium">Aucun article ici</p>
        {showAddHint && (
          <p className="text-gray-400 text-sm mt-1">Appuyez sur + pour ajouter un article</p>
        )}
      </div>
    )
  }

  // Onglet "Lots" : grouper par bordereau_url
  if (isLotTab) {
    const grouped = Object.values(
      items.reduce((acc, item) => {
        const key = item.bordereau_url
        if (!acc[key]) acc[key] = []
        acc[key].push(item)
        return acc
      }, {})
    )
    return (
      <div className="p-2 pb-28 space-y-2">
        {grouped.map((group, idx) => (
          <LotCard
            key={group[0].bordereau_url}
            items={group}
            lotIndex={idx + 1}
            onMarkSent={onLotMarkSent}
            onDeleteLot={onDeleteLot}
          />
        ))}
      </div>
    )
  }

  // Vue normale
  return (
    <div className="p-2 pb-28 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
      {items.map(item => (
        <ItemCard
          key={item.id}
          item={item}
          categories={categories}
          onMarkSold={onMarkSold}
          onMarkSent={onMarkSent}
          onMarkUnsent={onMarkUnsent}
          onMarkReceived={onMarkReceived}
          onDelete={onDelete}
          onUpdateCategory={onUpdateCategory}
          onUpdateEmplacement={onUpdateEmplacement}
          onBordereauDrop={onBordereauDrop}
          onPhotoDrop={onPhotoDrop}
          onEdit={onEdit}
          onToggleReception={onToggleReception}
        />
      ))}
    </div>
  )
}
