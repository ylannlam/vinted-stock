import { useState, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { getCapacities, getOccupied, firstFreeSlot } from '../lib/emplacements'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

function ArticleThumb({ item, onDelete, onReceive }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
      {item.photo_url
        ? <img src={item.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
        : <div className="w-full h-full flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
      }
      <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-white/90 px-1.5 py-0.5 rounded-full text-gray-700 leading-none">
        {item.size}
      </span>
      {confirm ? (
        <div className="absolute inset-0 bg-red-500/90 flex flex-col items-center justify-center gap-1 rounded-xl">
          <p className="text-white text-[9px] font-bold">Supprimer ?</p>
          <div className="flex gap-1">
            <button onClick={() => onDelete()} className="bg-white text-red-500 text-[9px] font-bold px-1.5 py-0.5 rounded-full">Oui</button>
            <button onClick={() => setConfirm(false)} className="bg-red-400 text-white text-[9px] px-1.5 py-0.5 rounded-full">Non</button>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={() => onReceive()}
            className="absolute top-1 left-1 w-5 h-5 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center text-gray-400 hover:text-teal-500 hover:bg-white transition-colors shadow-sm"
            title="Réceptionner cet article"
          >
            <svg className="w-2.5 h-2.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            onClick={() => setConfirm(true)}
            className="absolute top-1 right-1 w-5 h-5 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-white transition-colors shadow-sm"
          >
            <svg className="w-2.5 h-2.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}

function AddArticleModal({ commandeId, onClose, onAdded }) {
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [size, setSize] = useState('M')
  const [sheinUrl, setSheinUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)
  const modalRef = useRef(null)

  function applyFile(file) {
    if (!file || !file.type.startsWith('image/')) return
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  function handleDragEnter(e) {
    e.preventDefault()
    if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) setIsDragging(true)
  }
  function handleDragLeave(e) {
    e.preventDefault()
    if (!modalRef.current?.contains(e.relatedTarget)) setIsDragging(false)
  }
  function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  function handleDrop(e) { e.preventDefault(); setIsDragging(false); applyFile(e.dataTransfer.files[0]) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      let photoUrl = null
      if (photo) {
        const ext = photo.name.split('.').pop().toLowerCase()
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error: upErr } = await supabase.storage.from('photos').upload(fileName, photo)
        if (upErr) throw upErr
        const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(fileName)
        photoUrl = publicUrl
      }
      const { data, error: insertErr } = await supabase
        .from('items')
        .insert({ photo_url: photoUrl, size, shein_url: sheinUrl.trim() || null, status: 'a_recevoir', commande_id: commandeId })
        .select()
        .single()
      if (insertErr) throw insertErr
      onAdded(data)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
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
        className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm relative"
      >
        {isDragging && (
          <div className="absolute inset-0 z-30 bg-teal-500/10 border-2 border-teal-400 border-dashed rounded-t-3xl sm:rounded-2xl flex flex-col items-center justify-center pointer-events-none">
            <svg className="w-10 h-10 text-teal-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="text-teal-700 font-bold">Déposer la photo</span>
          </div>
        )}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base">Ajouter un article</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div
            onClick={() => inputRef.current?.click()}
            className={`relative w-full h-40 rounded-xl overflow-hidden cursor-pointer border-2 border-dashed transition-all ${
              preview ? 'border-transparent' : 'border-gray-200 bg-gray-50 hover:border-teal-400 hover:bg-teal-50/40'
            }`}
          >
            {preview
              ? <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
              : <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 pointer-events-none select-none">
                  <svg className="w-8 h-8 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm font-medium">Photo (optionnelle)</span>
                  <span className="text-xs text-gray-300 mt-0.5">Glisser ou cliquer</span>
                </div>
            }
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => applyFile(e.target.files[0])} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Taille</label>
            <div className="flex gap-2 flex-wrap">
              {SIZES.map(s => (
                <button key={s} type="button" onClick={() => setSize(s)}
                  className={`w-12 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                    size === s ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Lien Shein <span className="font-normal normal-case text-gray-400">(optionnel)</span>
            </label>
            <input
              type="url"
              value={sheinUrl}
              onChange={e => setSheinUrl(e.target.value)}
              placeholder="https://www.shein.com/..."
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>}

          <div className="flex gap-3 pb-2">
            <button type="button" onClick={onClose}
              className="flex-1 border-2 border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-purple-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-purple-600 disabled:opacity-50 transition-colors">
              {saving ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ReceiveArticleModal({ item, stockItems, onClose, onConfirm }) {
  const suggestion = useMemo(() => {
    return firstFreeSlot(getCapacities(stockItems), getOccupied(stockItems))
  }, [])
  const [emplacement, setEmplacement] = useState(suggestion)
  const [saving, setSaving] = useState(false)

  const occupied = new Set(stockItems.filter(i => i.emplacement).map(i => i.emplacement.trim().toUpperCase()))
  const conflict = emplacement.trim() && occupied.has(emplacement.trim().toUpperCase())

  async function handleConfirm() {
    setSaving(true)
    await onConfirm(item.id, emplacement.trim() || null)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {item.photo_url
              ? <img src={item.photo_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
              : <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0" />
            }
            <div>
              <p className="text-sm font-semibold text-gray-900">Réceptionner l'article</p>
              <p className="text-xs text-gray-400">Taille {item.size}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Emplacement</label>
            <div className="relative">
              <input
                type="text"
                value={emplacement}
                onChange={e => setEmplacement(e.target.value)}
                placeholder="ex : A1"
                maxLength={10}
                autoFocus
                className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition-colors ${
                  conflict ? 'border-red-300 focus:ring-red-300' : 'border-gray-300 focus:ring-teal-500'
                }`}
              />
              {emplacement && emplacement === suggestion && !conflict && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-teal-500 bg-teal-50 px-1.5 py-0.5 rounded-full pointer-events-none">
                  💡 auto
                </span>
              )}
            </div>
            {conflict && <p className="text-xs text-red-500 mt-1">⚠ Emplacement déjà occupé</p>}
          </div>
          <div className="flex gap-3 pb-2">
            <button type="button" onClick={onClose}
              className="flex-1 border-2 border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || !!conflict}
              className="flex-1 bg-teal-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-teal-600 disabled:opacity-40 transition-colors">
              {saving ? 'Rangement…' : 'Mettre en stock'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CommandeDetailView({ commande, items, stockItems, onBack, onArticleAdded, onDeleteArticle, onReceiveArticle, onReception, onDelete }) {
  const [showAddArticle, setShowAddArticle] = useState(false)
  const [receivingArticle, setReceivingArticle] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="p-3 pb-28">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Retour
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-gray-400">{new Date(commande.created_at).toLocaleDateString('fr-FR')}</p>
          <p className="text-sm font-bold text-gray-900 font-mono truncate">{commande.tracking_number}</p>
        </div>
        <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-1 rounded-full flex-shrink-0">
          En attente
        </span>
      </div>

      {/* Grille articles */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-5">
        {items.map(item => (
          <ArticleThumb
            key={item.id}
            item={item}
            onDelete={() => onDeleteArticle(item.id)}
            onReceive={() => setReceivingArticle(item)}
          />
        ))}
        <button
          onClick={() => setShowAddArticle(true)}
          className="aspect-square rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 hover:border-purple-300 hover:text-purple-400 transition-colors"
        >
          <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-[10px] font-medium">Ajouter</span>
        </button>
      </div>

      {items.length === 0 && (
        <p className="text-center text-xs text-gray-400 mb-5">Aucun article — ajoutez-en avant de réceptionner.</p>
      )}

      {/* Actions */}
      <div className="space-y-2 max-w-sm">
        <button
          onClick={() => onReception(commande, items)}
          disabled={items.length === 0}
          className="w-full py-3 bg-purple-500 text-white rounded-xl text-sm font-semibold hover:bg-purple-600 disabled:opacity-40 transition-colors"
        >
          Réceptionner le colis
          {items.length > 0 && ` (${items.length} article${items.length > 1 ? 's' : ''})`}
        </button>

        {confirmDelete ? (
          <div className="flex gap-2">
            <button onClick={() => { setConfirmDelete(false); onDelete(commande.id) }}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold">
              Confirmer la suppression
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="flex-1 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-semibold">
              Annuler
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full py-2 text-sm text-gray-400 hover:text-red-400 transition-colors"
          >
            Supprimer la commande
          </button>
        )}
      </div>

      {showAddArticle && (
        <AddArticleModal
          commandeId={commande.id}
          onClose={() => setShowAddArticle(false)}
          onAdded={item => { onArticleAdded(item); setShowAddArticle(false) }}
        />
      )}

      {receivingArticle && (
        <ReceiveArticleModal
          item={receivingArticle}
          stockItems={stockItems}
          onClose={() => setReceivingArticle(null)}
          onConfirm={async (itemId, emplacement) => {
            await onReceiveArticle(commande.id, itemId, emplacement)
            setReceivingArticle(null)
          }}
        />
      )}
    </div>
  )
}
