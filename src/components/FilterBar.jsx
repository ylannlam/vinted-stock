const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

export default function FilterBar({ categories, sizes, onSizesChange, selectedCategories, onCategoriesChange, total }) {
  function toggleSize(s) {
    onSizesChange(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    )
  }

  function toggleCategory(cat) {
    onCategoriesChange(prev =>
      prev.includes(cat) ? prev.filter(x => x !== cat) : [...prev, cat]
    )
  }

  const hasFilters = sizes.length > 0 || selectedCategories.length > 0

  return (
    <div className="bg-white border-b border-gray-100 px-3 py-2.5 space-y-2">
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

      {/* Catégories */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-12 flex-shrink-0">Cat.</span>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => toggleCategory(cat)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors flex-shrink-0 ${
              selectedCategories.includes(cat)
                ? 'bg-teal-500 text-white border-teal-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
            }`}
          >
            {cat}
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
            onClick={() => { onSizesChange([]); onCategoriesChange([]) }}
            className="text-xs text-teal-600 font-medium hover:text-teal-800 transition-colors"
          >
            Effacer les filtres
          </button>
        )}
      </div>
    </div>
  )
}
