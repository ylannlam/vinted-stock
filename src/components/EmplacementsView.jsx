import { CARTONS, getCapacities } from '../lib/emplacements'

export default function EmplacementsView({ items, onClose }) {
  const caps = getCapacities(items)

  const occupiedMap = Object.fromEntries(
    (items || [])
      .filter(i => i.emplacement)
      .map(i => [i.emplacement.trim().toUpperCase(), i])
  )

  const totalSlots = Object.values(caps).reduce((a, b) => a + b, 0)
  const occupiedCount = Object.keys(occupiedMap).length
  const freeCount = totalSlots - occupiedCount

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">Vue des emplacements</h2>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="flex items-center gap-1 text-xs text-red-500">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />
                {occupiedCount} occupés
              </span>
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 border border-emerald-300 inline-block" />
                {freeCount} libres
              </span>
              <span className="text-xs text-gray-400">{totalSlots} total</span>
            </div>
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

        {/* Corps */}
        <div className="overflow-y-auto px-5 py-4 space-y-5 flex-1">
          {CARTONS.map(letter => {
            const cap = caps[letter] || 0
            if (cap === 0) return null
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
                    <div
                      className="h-full bg-teal-400 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-14 text-right flex-shrink-0">
                    {occupiedInCarton}/{cap}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: cap }, (_, i) => i + 1).map(n => {
                    const slot = `${letter}${n}`
                    const item = occupiedMap[slot]

                    return (
                      <div
                        key={slot}
                        title={item
                          ? `${slot} · T.${item.size}${item.shein_url ? ' · Shein disponible' : ''}`
                          : `${slot} · Libre`
                        }
                        style={item?.photo_url ? {
                          backgroundImage: `url(${item.photo_url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        } : undefined}
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-[9px] font-bold relative overflow-hidden cursor-default select-none transition-transform hover:scale-110 ${
                          item
                            ? 'text-white shadow-sm'
                            : 'bg-emerald-100 text-emerald-600 border border-emerald-200 hover:bg-emerald-200'
                        }`}
                      >
                        {item ? (
                          <>
                            {item.photo_url && <div className="absolute inset-0 bg-black/40" />}
                            <span className="relative z-10 leading-tight text-center">
                              {item.size}
                            </span>
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

          {Object.keys(caps).length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="font-medium">Aucun emplacement détecté</p>
              <p className="text-sm mt-1">Assignez des emplacements aux articles pour les voir apparaître ici.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
