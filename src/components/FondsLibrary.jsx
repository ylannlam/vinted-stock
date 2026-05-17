import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function FondsLibrary() {
  const [fonds, setFonds]       = useState([])
  const [loading, setLoading]   = useState(false)

  // Formulaire ajout
  const [nom, setNom]                     = useState('')
  const [compteVinted, setCompteVinted]   = useState('')
  const [imageFile, setImageFile]         = useState(null)
  const [adding, setAdding]               = useState(false)
  const [addError, setAddError]           = useState('')

  // Suppression
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting]           = useState(false)

  useEffect(() => { fetchFonds() }, [])

  async function fetchFonds() {
    setLoading(true)
    const { data, error } = await supabase
      .from('fonds')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setFonds(data)
    setLoading(false)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!nom.trim() || !compteVinted.trim() || !imageFile) {
      setAddError('Tous les champs sont requis.')
      return
    }
    setAdding(true)
    setAddError('')

    try {
      const ext      = imageFile.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('fonds')
        .upload(fileName, imageFile)
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage.from('fonds').getPublicUrl(fileName)

      const { data, error: insertErr } = await supabase
        .from('fonds')
        .insert({ nom: nom.trim(), image_url: publicUrl, compte_vinted_pseudo: compteVinted.trim() })
        .select()
        .single()
      if (insertErr) throw insertErr

      setFonds(prev => [data, ...prev])
      setNom('')
      setCompteVinted('')
      setImageFile(null)
      // reset file input
      const fi = document.getElementById('fonds-file-input')
      if (fi) fi.value = ''
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(fond) {
    setDeleting(true)
    try {
      // Extraire le filename de l'URL
      const urlParts  = fond.image_url.split('/')
      const fileName  = urlParts[urlParts.length - 1]
      await supabase.storage.from('fonds').remove([fileName])
      const { error } = await supabase.from('fonds').delete().eq('id', fond.id)
      if (error) throw error
      setFonds(prev => prev.filter(f => f.id !== fond.id))
      setDeleteConfirm(null)
    } catch (err) {
      alert('Erreur : ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto pb-10">
      <h2 className="text-base font-bold text-gray-900 mb-5">Bibliothèque de fonds</h2>

      {/* Formulaire ajout */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Ajouter un fond</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={nom}
              onChange={e => setNom(e.target.value)}
              placeholder="Nom du fond"
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
            <input
              type="text"
              value={compteVinted}
              onChange={e => setCompteVinted(e.target.value)}
              placeholder="Compte Vinted (pseudo)"
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex-1 cursor-pointer">
              <div className="border border-dashed border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-500 hover:border-teal-400 hover:text-teal-600 transition text-center">
                {imageFile ? imageFile.name : 'Choisir une image…'}
              </div>
              <input
                id="fonds-file-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => setImageFile(e.target.files[0] ?? null)}
              />
            </label>
            {imageFile && (
              <img
                src={URL.createObjectURL(imageFile)}
                alt="aperçu"
                className="w-12 h-12 rounded-xl object-cover border border-gray-200 shrink-0"
              />
            )}
          </div>
          {addError && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-3 py-2">{addError}</div>
          )}
          <button
            type="submit"
            disabled={adding}
            className="w-full bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors"
          >
            {adding ? 'Ajout en cours...' : '+ Ajouter'}
          </button>
        </form>
      </div>

      {/* Grille des fonds */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <svg className="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Chargement...
        </div>
      ) : fonds.length === 0 ? (
        <p className="text-center py-12 text-gray-400 text-sm italic">Aucun fond enregistré.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {fonds.map(fond => (
            <div key={fond.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="relative">
                <img
                  src={fond.image_url}
                  alt={fond.nom}
                  className="w-full h-32 object-cover"
                />
                <button
                  onClick={() => setDeleteConfirm(fond)}
                  className="absolute top-2 right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-colors shadow"
                  title="Supprimer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-gray-900 truncate">{fond.nom}</div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">Compte : {fond.compte_vinted_pseudo}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer ce fond ?</h3>
            <p className="text-sm text-gray-500 mb-1">
              <strong>{deleteConfirm.nom}</strong> — {deleteConfirm.compte_vinted_pseudo}
            </p>
            <p className="text-sm text-gray-400 mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
