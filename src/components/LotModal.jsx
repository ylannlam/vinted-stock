import { useState, useRef } from 'react'

export default function LotModal({ items, onClose, onBordereau, onMarkSent }) {
  // Vue : 'lots' (lots existants) | 'nouveau' (créer un lot)
  const [vue, setVue] = useState('lots')
  const [selected, setSelected] = useState(new Set())
  const [confirmSentIds, setConfirmSentIds] = useState(null) // ids à envoyer
  const [uploading, setUploading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const inputRef = useRef(null)

  // Grouper les articles par bordereau_url (= lot)
  const itemsAvecBordereau = items.filter(i => i.bordereau_url)
  const itemsSansBordereau = items.filter(i => !i.bordereau_url)

  // Groupes de lots (même bordereau = même lot)
  const lots = Object.values(
    itemsAvecBordereau.reduce((acc, item) => {
      const key = item.bordereau_url
      if (!acc[key]) acc[key] = { bordereau_url: key, items: [] }
      acc[key].items.push(item)
      return acc
    }, {})
  )

  function toggleNew(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllNew() {
    setSelected(prev =>
      prev.size === itemsSansBordereau.length
        ? new Set()
        : new Set(itemsSansBordereau.map(i => i.id))
    )
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') return
    e.target.value = ''
    setUploading(true)
    await onBordereau([...selected], file)
    setUploading(false)
    setSelected(new Set())
    setSuccessMsg(`Bordereau attaché à ${selected.size} article${selected.size > 1 ? 's' : ''} ✓`)
    setTimeout(() => setSuccessMsg(''), 3000)
    setVue('lots')
  }

  async function handleMarkSent(ids) {
    await onMarkSent(ids)
    setConfirmSentIds(null)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-semibold text-gray-900 text-base">Lots</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Onglets */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          <button
            onClick={() => setVue('lots')}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              vue === 'lots' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Lots prêts {lots.length > 0 && <span className="ml-1 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">{lots.length}</span>}
          </button>
          <button
            onClick={() => setVue('nouveau')}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              vue === 'nouveau' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Nouveau lot {itemsSansBordereau.length > 0 && <span className="ml-1 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{itemsSansBordereau.length}</span>}
          </button>
        </div>

        {/* Message succès */}
        {successMsg && (
          <div className="mx-5 mt-3 flex-shrink-0 bg-green-50 text-green-700 text-xs font-semibold px-3 py-2 rounded-xl text-center">
            {successMsg}
          </div>
        )}

        {/* Confirmation envoi */}
        {confirmSentIds && (
          <div className="mx-5 mt-3 flex-shrink-0 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-center space-y-2">
            <p className="text-sm font-bold text-gray-800">
              Alicia gros caca 💩<br />t'as bien emballé les {confirmSentIds.length} articles ?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmSentIds(null)} className="flex-1 border-2 border-gray-200 text-gray-700 rounded-xl py-2 text-sm font-semibold">Non</button>
              <button onClick={() => handleMarkSent(confirmSentIds)} className="flex-1 bg-orange-500 text-white rounded-xl py-2 text-sm font-semibold">Oui !</button>
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 pb-4">

          {/* VUE : Lots existants */}
          {vue === 'lots' && (
            <div className="px-5 pt-4 space-y-3">
              {lots.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-gray-400 text-sm">Aucun lot avec bordereau</p>
                  <button onClick={() => setVue('nouveau')} className="mt-2 text-orange-500 text-sm font-semibold">Créer un lot →</button>
                </div>
              ) : (
                lots.map((lot, idx) => (
                  <div key={lot.bordereau_url} className="border border-gray-100 rounded-2xl overflow-hidden">
                    {/* En-tête lot */}
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-600">Lot {idx + 1}</span>
                        <span className="text-xs text-gray-400">{lot.items.length} article{lot.items.length > 1 ? 's' : ''}</span>
                        <a href={lot.bordereau_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded-full transition-colors">
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          PDF
                        </a>
                      </div>
                      <button
                        onClick={() => setConfirmSentIds(lot.items.map(i => i.id))}
                        className="flex items-center gap-1 text-xs font-semibold bg-orange-500 text-white px-2.5 py-1 rounded-full hover:bg-orange-600 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                        Envoyer
                      </button>
                    </div>
                    {/* Articles du lot */}
                    {lot.items.map(item => (
                      <div key={item.id} className="flex items-center gap-3 px-3 py-2 border-t border-gray-50">
                        {item.photo_url
                          ? <img src={item.photo_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                          : <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0" />
                        }
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-700 truncate">{item.category}</p>
                          <p className="text-xs text-gray-400">Taille {item.size}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {/* VUE : Nouveau lot */}
          {vue === 'nouveau' && (
            <div className="pt-2">
              {itemsSansBordereau.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-10">Tous les articles ont déjà un bordereau</p>
              ) : (
                <>
                  <div className="px-5 py-2 flex items-center justify-between">
                    <p className="text-xs text-gray-400">Sélectionne les articles de ce lot</p>
                    <button onClick={toggleAllNew} className="text-xs font-semibold text-teal-600">
                      {selected.size === itemsSansBordereau.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                    </button>
                  </div>
                  {itemsSansBordereau.map(item => (
                    <button
                      key={item.id}
                      onClick={() => toggleNew(item.id)}
                      className={`w-full flex items-center gap-3 px-5 py-3 border-b border-gray-50 transition-colors text-left ${
                        selected.has(item.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        selected.has(item.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                      }`}>
                        {selected.has(item.id) && (
                          <svg className="w-3 h-3 text-white pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      {item.photo_url
                        ? <img src={item.photo_url} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                        : <div className="w-12 h-12 rounded-xl bg-gray-100 flex-shrink-0" />
                      }
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{item.category}</p>
                        <p className="text-xs text-gray-400">Taille {item.size}</p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer : attacher bordereau */}
        {vue === 'nouveau' && selected.size > 0 && (
          <div className="flex-shrink-0 border-t border-gray-100 px-5 py-4">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {uploading ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              )}
              Attacher le bordereau ({selected.size} article{selected.size > 1 ? 's' : ''})
            </button>
            <input ref={inputRef} type="file" accept="application/pdf" onChange={handleFile} className="hidden" />
          </div>
        )}
      </div>
    </div>
  )
}
