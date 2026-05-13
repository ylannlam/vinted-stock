import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

export default function AddItemModal({ categories, onClose, onAdded }) {
  const [category, setCategory] = useState(categories[0])
  const [size, setSize] = useState('M')
  const [sheinUrl, setSheinUrl] = useState('')
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)
  const dropZoneRef = useRef(null)

  function applyFile(file) {
    if (!file || !file.type.startsWith('image/')) return
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  function handlePhotoChange(e) {
    applyFile(e.target.files[0])
  }

  function handleDragEnter(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!dropZoneRef.current?.contains(e.relatedTarget)) {
      setIsDragging(false)
    }
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDragging) setIsDragging(true)
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    applyFile(e.dataTransfer.files[0])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!photo) { setError('Veuillez sélectionner une photo'); return }

    setUploading(true)
    setError('')

    try {
      const ext = photo.name.split('.').pop().toLowerCase()
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('photos')
        .upload(fileName, photo)
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage
        .from('photos')
        .getPublicUrl(fileName)

      const { data, error: insertErr } = await supabase
        .from('items')
        .insert({ category, size, photo_url: publicUrl, status: 'en_stock', shein_url: sheinUrl.trim() || null })
        .select()
        .single()
      if (insertErr) throw insertErr

      onAdded(data)
    } catch (err) {
      setError(err.message)
      setUploading(false)
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
          <h2 className="font-semibold text-gray-900 text-base">Ajouter un article</h2>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Photo de l'article</label>

            {/*
              Tous les enfants ont pointer-events-none.
              Ainsi les événements drag atterrissent TOUJOURS sur ce div,
              même quand React re-rend les enfants pendant le drag.
            */}
            <div
              ref={dropZoneRef}
              onClick={() => inputRef.current?.click()}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`relative w-full h-52 rounded-xl overflow-hidden cursor-pointer border-2 border-dashed transition-all ${
                isDragging
                  ? 'border-teal-500 bg-teal-50 scale-[1.01]'
                  : preview
                    ? 'border-transparent hover:border-gray-300'
                    : 'border-gray-200 bg-gray-50 hover:border-teal-400 hover:bg-teal-50/40'
              }`}
            >
              {/* Image aperçu — pointer-events-none obligatoire */}
              {preview && (
                <img
                  src={preview}
                  alt="Aperçu"
                  className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity ${isDragging ? 'opacity-30' : 'opacity-100'}`}
                />
              )}

              {/* État vide (aucune photo) */}
              {!preview && !isDragging && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 pointer-events-none select-none">
                  <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm font-medium">Glisser une photo ici</span>
                  <span className="text-xs mt-1 text-gray-300">ou cliquer pour choisir</span>
                </div>
              )}

              {/* Overlay pendant le drag */}
              {isDragging && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                  <svg className="w-12 h-12 text-teal-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="text-sm font-bold text-teal-600">Relâcher pour ajouter</span>
                </div>
              )}

              {/* Overlay survol quand photo présente */}
              {preview && !isDragging && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/25 transition-colors pointer-events-none">
                  <span className="text-white text-sm font-medium bg-black/50 px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100">
                    Changer la photo
                  </span>
                </div>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="hidden"
            />
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

          {/* Taille */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Taille</label>
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
              disabled={uploading}
              className="flex-1 bg-teal-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-teal-600 active:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Ajout en cours...
                </span>
              ) : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
