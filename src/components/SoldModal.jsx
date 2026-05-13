import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SoldModal({ item, onClose, onSold }) {
  const [pdf, setPdf] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  function handlePdfChange(e) {
    const file = e.target.files[0]
    if (file) setPdf(file)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!pdf) { setError('Veuillez sélectionner le bordereau PDF'); return }

    setUploading(true)
    setError('')

    try {
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`

      const { error: uploadErr } = await supabase.storage
        .from('bordereaux')
        .upload(fileName, pdf)
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage
        .from('bordereaux')
        .getPublicUrl(fileName)

      const { data, error: updateErr } = await supabase
        .from('items')
        .update({ status: 'vendu', bordereau_url: publicUrl })
        .eq('id', item.id)
        .select()
        .single()
      if (updateErr) throw updateErr

      onSold(data)
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
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base">Marquer comme vendu</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Aperçu de l'article */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <img
              src={item.photo_url}
              alt=""
              className="w-16 h-16 object-cover rounded-xl flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="font-medium text-gray-900 text-sm truncate">{item.category}</p>
              <p className="text-gray-500 text-sm">Taille {item.size}</p>
            </div>
          </div>

          {/* Upload bordereau */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Bordereau d'expédition (PDF)
            </label>
            <label className={`block cursor-pointer w-full border-2 border-dashed rounded-xl px-4 py-4 text-center text-sm transition-colors ${
              pdf
                ? 'border-green-400 bg-green-50 text-green-700'
                : 'border-gray-200 text-gray-400 hover:border-teal-400 hover:bg-teal-50/50'
            }`}>
              <div className="flex flex-col items-center gap-2">
                <svg className={`w-8 h-8 ${pdf ? 'text-green-500' : 'text-gray-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                {pdf ? (
                  <span className="font-medium">{pdf.name}</span>
                ) : (
                  <span>Appuyer pour choisir le bordereau PDF</span>
                )}
              </div>
              <input
                type="file"
                accept="application/pdf"
                onChange={handlePdfChange}
                className="hidden"
              />
            </label>
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
              className="flex-1 bg-green-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-green-600 active:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Traitement...
                </span>
              ) : 'Confirmer la vente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
