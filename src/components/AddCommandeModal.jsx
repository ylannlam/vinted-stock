import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
let _uid = 0
function newArticle() { return { _id: _uid++, photo: null, preview: null, size: 'M' } }

export default function AddCommandeModal({ onClose, onCreated }) {
  const [trackingNumber, setTrackingNumber] = useState('')
  const [articles, setArticles] = useState([newArticle()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draggingId, setDraggingId] = useState(null)
  const fileRefs = useRef({})

  function addArticle() {
    setArticles(prev => [...prev, newArticle()])
  }

  function removeArticle(id) {
    setArticles(prev => prev.filter(a => a._id !== id))
  }

  function setPhoto(id, file) {
    if (!file || !file.type.startsWith('image/')) return
    setArticles(prev => prev.map(a =>
      a._id === id ? { ...a, photo: file, preview: URL.createObjectURL(file) } : a
    ))
  }

  function setSize(id, size) {
    setArticles(prev => prev.map(a => a._id === id ? { ...a, size } : a))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!trackingNumber.trim()) { setError('Numéro de suivi requis'); return }
    if (articles.length === 0) { setError('Ajoute au moins un article'); return }
    setSaving(true)
    setError('')

    try {
      const { data: commande, error: cmdErr } = await supabase
        .from('commandes')
        .insert({ tracking_number: trackingNumber.trim(), status: 'en_attente' })
        .select()
        .single()
      if (cmdErr) throw cmdErr

      const rows = await Promise.all(articles.map(async a => {
        let photoUrl = null
        if (a.photo) {
          const ext = a.photo.name.split('.').pop().toLowerCase()
          const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const { error: upErr } = await supabase.storage.from('photos').upload(fileName, a.photo)
          if (upErr) throw upErr
          const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(fileName)
          photoUrl = publicUrl
        }
        return { photo_url: photoUrl, size: a.size, status: 'a_recevoir', commande_id: commande.id }
      }))

      const { data: insertedItems, error: itemsErr } = await supabase.from('items').insert(rows).select()
      if (itemsErr) throw itemsErr

      onCreated(commande, insertedItems)
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
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-gray-900 text-base">Nouvelle commande</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">N° de suivi Shein</label>
            <input
              type="text"
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
              placeholder="ex: SGCNA12345678"
              autoFocus
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Articles
                <span className="ml-1.5 text-xs font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">{articles.length}</span>
              </label>
            </div>

            <div className="space-y-2.5">
              {articles.map(art => (
                <div
                key={art._id}
                onDragEnter={e => { e.preventDefault(); if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) setDraggingId(art._id) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDraggingId(null) }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
                onDrop={e => { e.preventDefault(); setDraggingId(null); setPhoto(art._id, e.dataTransfer.files[0]) }}
                className={`flex gap-3 p-3 rounded-xl border items-center transition-all ${
                  draggingId === art._id
                    ? 'border-teal-400 bg-teal-50 scale-[1.01]'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                  <div
                    onClick={() => fileRefs.current[art._id]?.click()}
                    className="w-16 h-16 rounded-xl overflow-hidden border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer flex-shrink-0 hover:border-purple-400 transition-colors bg-white"
                  >
                    {art.preview ? (
                      <img src={art.preview} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                    <input
                      ref={el => { fileRefs.current[art._id] = el }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => setPhoto(art._id, e.target.files[0])}
                    />
                  </div>

                  <div className="flex-1">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1.5">Taille</p>
                    <div className="flex gap-1 flex-wrap">
                      {SIZES.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSize(art._id, s)}
                          className={`w-9 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                            art.size === s
                              ? 'bg-purple-500 text-white border-purple-500'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {articles.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeArticle(art._id)}
                      className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addArticle}
              className="mt-3 w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-purple-300 hover:text-purple-500 transition-colors font-medium"
            >
              + Ajouter un article
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>
          )}

          <div className="flex gap-3 pt-1 pb-2">
            <button type="button" onClick={onClose}
              className="flex-1 border-2 border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-purple-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-purple-600 disabled:opacity-50 transition-colors">
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Création…
                </span>
              ) : 'Créer la commande'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
