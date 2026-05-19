const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

export default function FilterBar({ sizes, onSizesChange, searchQuery, onSearchChange, sortByEmplacement, onSortToggle, onShowEmplacements, total }) {
  function toggleSize(s) {
    onSizesChange(prev => prev.includes(s) ? [] : [s])
  }

  const hasFilters = sizes.length > 0 || searchQuery

  return (
    <div className="bg-white border-b border-gray-100 px-3 py-2.5 space-y-2">
      {/* Barre de recherche */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Emplacement (ex : A1, B3…) ou taille"
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-full focus:outline-none focus:border-teal-400 bg-gray-50"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          onClick={onSortToggle}
          className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors flex-shrink-0 ${
            sortByEmplacement
              ? 'bg-teal-500 text-white border-teal-500'
              : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
          }`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Trier
        </button>
        <button
          onClick={onShowEmplacements}
          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-teal-300 transition-colors flex-shrink-0"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
          Plan
        </button>
      </div>

      {/* Tailles */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-12 flex-shrink-0">Taille</span>
        {SIZES.map(s => (
          <button
            key={s}
            onClick={() => toggleSize(s)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              sizes.includes(s)
                ? 'bg-teal-500 text-white border-teal-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Résumé + reset */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {total} article{total !== 1 ? 's' : ''}
        </span>
        {hasFilters && (
          <button
            onClick={() => { onSizesChange([]); onSearchChange('') }}
            className="text-xs text-teal-600 font-medium hover:text-teal-800 transition-colors"
          >
            Effacer les filtres
          </button>
        )}
      </div>
    </div>
  )
}
