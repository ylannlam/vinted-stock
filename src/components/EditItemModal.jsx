import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const initQty = () => Object.fromEntries(SIZES.map(s => [s, 0]))

export default function EditItemModal({ item, categories, onClose, onUpdated }) {
  const [category, setCategory] = useState(item.category)
  const [size, setSize] = useState(item.size)
  const [status, setStatus] = useState(item.status === 'a_recevoir' ? 'a_recevoir' : 'en_stock')
  const [sheinUrl, setSheinUrl] = useState(item.shein_url ?? '')
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(item.photo_url)
  const [quantities, setQuantities] = useState(initQty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)
  const dropZoneRef = useRef(null)

  const extraTotal = Object.values(quantities).reduce((a, b) => a + b, 0)

  function setQty(s, delta) {
    setQuantities(prev => ({ ...prev, [s]: Math.max(0, prev[s] + delta) }))
  }

  function applyFile(file) {
    if (!file || !file.type.startsWith('image/')) return
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  function handleDragEnter(e) { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }
  function handleDragLeave(e) {
    e.preventDefault(); e.stopPropagation()
    if (!dropZoneRef.current?.contains(e.relatedTarget)) setIsDragging(false)
  }
  function handleDragOver(e) {
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDragging) setIsDragging(true)
  }
  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation()
    setIsDragging(false)
    applyFile(e.dataTransfer.files[0])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      let photoUrl = item.photo_url

      if (photo) {
        const ext = photo.name.split('.').pop().toLowerCase()
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('photos').upload(fileName, photo)
        if (uploadErr) throw uploadErr
        const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(fileName)
        photoUrl = publicUrl
      }

      // Mise à jour de l'article existant
      const { data: updatedItem, error: updateErr } = await supabase
        .from('items')
        .update({ category, size, status, photo_url: photoUrl, shein_url: sheinUrl.trim() || null })
        .eq('id', item.id)
        .select()
        .single()
      if (updateErr) throw updateErr

      // Insertion des exemplaires supplémentaires
      let newItems = []
      if (extraTotal > 0) {
        const rows = SIZES.flatMap(s =>
          Array.from({ length: quantities[s] }, () => ({
            category,
            size: s,
            photo_url: photoUrl,
            status: 'en_stock',
            shein_url: sheinUrl.trim() || null,
          }))
        )
        const { data: inserted, error: insertErr } = await supabase.from('items').insert(rows).select()
        if (insertErr) throw insertErr
        newItems = inserted
      }

      onUpdated(updatedItem, newItems)
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
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base">Modifier l'article</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-5">
          {/* Zone photo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Photo <span className="text-gray-400 font-normal">(glisser pour changer)</span>
            </label>
            <div
              ref={dropZoneRef}
              onClick={() => inputRef.current?.click()}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`relative w-full h-44 rounded-xl overflow-hidden cursor-pointer border-2 border-dashed transition-all ${
                isDragging ? 'border-teal-500 bg-teal-50 scale-[1.01]' : 'border-gray-200 hover:border-teal-400'
              }`}
            >
              <img
                src={preview}
                alt="Aperçu"
                className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity ${isDragging ? 'opacity-30' : 'opacity-100'}`}
              />
              {photo && (
                <span className="absolute bottom-2 right-2 bg-teal-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full pointer-events-none">
                  Nouvelle photo
                </span>
              )}
              {isDragging && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                  <svg className="w-10 h-10 text-teal-500 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="text-sm font-bold text-teal-600">Relâcher</span>
                </div>
              )}
            </div>
            <input ref={inputRef} type="file" accept="image/*" onChange={e => applyFile(e.target.files[0])} className="hidden" />
          </div>

          {/* Catégorie */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Catégorie</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Taille de cet article */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Taille de cet article</label>
            <div className="flex gap-2 flex-wrap">
              {SIZES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={`w-12 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                    size === s
                      ? 'bg-teal-500 text-white border-teal-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Statut */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Statut</label>
            <div className="flex rounded-xl border-2 border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setStatus('en_stock')}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                  status === 'en_stock'
                    ? 'bg-teal-500 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                En stock
              </button>
              <button
                type="button"
                onClick={() => setStatus('a_recevoir')}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                  status === 'a_recevoir'
                    ? 'bg-purple-500 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                À recevoir
              </button>
            </div>
          </div>

          {/* Lien Shein */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Lien Shein <span className="text-gray-400 font-normal">(optionnel)</span>
            </label>
            <input
              type="url"
              value={sheinUrl}
              onChange={e => setSheinUrl(e.target.value)}
              placeholder="https://www.shein.com/..."
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          {/* Séparateur */}
          <div className="border-t border-gray-100 pt-1">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Ajouter des exemplaires</label>
              {extraTotal > 0 && (
                <span className="text-xs font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">
                  +{extraTotal} article{extraTotal > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-3">Même robe, tailles différentes — partagent la même photo et catégorie.</p>
            <div className="grid grid-cols-3 gap-2">
              {SIZES.map(s => (
                <div key={s} className={`flex items-center justify-between gap-1 rounded-xl border-2 px-2 py-1.5 transition-colors ${
                  quantities[s] > 0 ? 'border-teal-400 bg-teal-50' : 'border-gray-200 bg-white'
                }`}>
                  <span className={`text-sm font-bold w-7 text-center ${quantities[s] > 0 ? 'text-teal-700' : 'text-gray-500'}`}>
                    {s}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setQty(s, -1)}
                      disabled={quantities[s] === 0}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 transition-colors"
                    >
                      <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                      </svg>
                    </button>
                    <span className={`text-sm font-semibold w-4 text-center tabular-nums ${quantities[s] > 0 ? 'text-teal-700' : 'text-gray-300'}`}>
                      {quantities[s]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQty(s, +1)}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <svg className="w-3 h-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          {/* Boutons */}
          <div className="flex gap-3 pt-1 pb-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border-2 border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-teal-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-teal-600 active:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Enregistrement...
                </span>
              ) : extraTotal > 0
                  ? `Enregistrer (+${extraTotal} ajouté${extraTotal > 1 ? 's' : ''})`
                  : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
