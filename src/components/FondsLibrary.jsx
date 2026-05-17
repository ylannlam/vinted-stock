import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

async function downloadFond(fond) {
  try {
    const parts    = fond.image_url.split('/')
    const fileName = parts[parts.length - 1]
    const { data, error } = await supabase.storage.from('fonds').download(fileName)
    if (error) throw error
    const ext = fileName.split('.').pop() || 'jpg'
    const url = URL.createObjectURL(data)
    const a   = document.createElement('a')
    a.href     = url
    a.download = `${fond.nom}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch {
    window.open(fond.image_url, '_blank')
  }
}

export default function FondsLibrary() {
  const [fonds, setFonds]           = useState([])
  const [fondComptes, setFondComptes] = useState([])   // { fond_id, compte_vinted_id }
  const [comptes, setComptes]       = useState([])     // vinted_accounts
  const [loading, setLoading]       = useState(false)

  // Formulaire ajout
  const [nom, setNom]               = useState('')
  const [selectedIds, setSelectedIds] = useState([])   // compte_vinted_ids cochés
  const [imageFile, setImageFile]   = useState(null)
  const [adding, setAdding]         = useState(false)
  const [addError, setAddError]     = useState('')

  // Édition des comptes d'un fond
  const [editFond, setEditFond]     = useState(null)
  const [editIds, setEditIds]       = useState([])
  const [editSaving, setEditSaving] = useState(false)

  // Suppression
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting]     = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: f }, { data: fc }, { data: c }] = await Promise.all([
      supabase.from('fonds').select('*').order('created_at', { ascending: false }),
      supabase.from('fond_comptes').select('*'),
      supabase.from('vinted_accounts').select('id, pseudo, statut').order('pseudo', { ascending: true }),
    ])
    if (f)  setFonds(f)
    if (fc) setFondComptes(fc)
    if (c)  setComptes(c)
    setLoading(false)
  }

  async function handleSaveEditAccounts() {
    if (!editFond) return
    setEditSaving(true)
    try {
      await supabase.from('fond_comptes').delete().eq('fond_id', editFond.id)
      if (editIds.length > 0) {
        await supabase.from('fond_comptes').insert(
          editIds.map(cId => ({ fond_id: editFond.id, compte_vinted_id: cId }))
        )
      }
      setFondComptes(prev => [
        ...prev.filter(fc => fc.fond_id !== editFond.id),
        ...editIds.map(cId => ({ fond_id: editFond.id, compte_vinted_id: cId }))
      ])
      setEditFond(null)
    } catch (err) {
      alert('Erreur : ' + err.message)
    }
    setEditSaving(false)
  }

  function getComptesForFond(fondId) {
    return fondComptes
      .filter(fc => fc.fond_id === fondId)
      .map(fc => comptes.find(c => c.id === fc.compte_vinted_id))
      .filter(Boolean)
  }

  function toggleId(id) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!nom.trim() || !imageFile) { setAddError('Nom et image requis.'); return }
    setAdding(true)
    setAddError('')
    try {
      const ext      = imageFile.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      const { error: uploadErr } = await supabase.storage.from('fonds').upload(fileName, imageFile)
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage.from('fonds').getPublicUrl(fileName)

      const { data: fondData, error: insertErr } = await supabase
        .from('fonds')
        .insert({ nom: nom.trim(), image_url: publicUrl, compte_vinted_pseudo: null })
        .select().single()
      if (insertErr) throw insertErr

      // Associer les comptes sélectionnés
      if (selectedIds.length > 0) {
        await supabase.from('fond_comptes').insert(
          selectedIds.map(cId => ({ fond_id: fondData.id, compte_vinted_id: cId }))
        )
        const newFc = selectedIds.map(cId => ({ fond_id: fondData.id, compte_vinted_id: cId }))
        setFondComptes(prev => [...prev, ...newFc])
      }

      setFonds(prev => [fondData, ...prev])
      setNom('')
      setSelectedIds([])
      setImageFile(null)
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
      const parts    = fond.image_url.split('/')
      const fileName = parts[parts.length - 1]
      await supabase.storage.from('fonds').remove([fileName])
      const { error } = await supabase.from('fonds').delete().eq('id', fond.id)
      if (error) throw error
      // fond_comptes supprimé en cascade
      setFonds(prev => prev.filter(f => f.id !== fond.id))
      setFondComptes(prev => prev.filter(fc => fc.fond_id !== fond.id))
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
          <input
            type="text"
            value={nom}
            onChange={e => setNom(e.target.value)}
            placeholder="Nom du fond"
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
          />

          {/* Comptes associés — uniquement ceux sans fond */}
          {(() => {
            const usedIds = new Set(fondComptes.map(fc => fc.compte_vinted_id))
            const available = comptes.filter(c => !usedIds.has(c.id))
            return available.length > 0 ? (
              <div className="border border-gray-200 rounded-xl p-3">
                <div className="text-xs font-semibold text-gray-600 mb-2">Comptes Vinted associés</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {available.map(c => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(c.id)}
                        onChange={() => toggleId(c.id)}
                        className="w-4 h-4 accent-teal-500 rounded"
                      />
                      <span className="text-sm text-gray-700 truncate">{c.pseudo}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl p-3 text-xs text-gray-400 italic text-center">
                Tous les comptes sont déjà associés à un fond.
              </div>
            )
          })()}
          )}

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
          {fonds.map(fond => {
            const fondAccounts = getComptesForFond(fond.id)
            return (
              <div key={fond.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="relative">
                  <img src={fond.image_url} alt={fond.nom} className="w-full h-32 object-cover" />
                  <button
                    onClick={() => downloadFond(fond)}
                    className="absolute bottom-2 left-2 w-7 h-7 bg-white/90 hover:bg-white text-gray-700 rounded-full flex items-center justify-center shadow transition-colors"
                    title="Télécharger"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
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
                  <div className="flex items-start justify-between gap-1 mt-1">
                    {fondAccounts.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {fondAccounts.map(c => (
                          <span key={c.id} className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">
                            {c.pseudo}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 italic">Aucun compte</div>
                    )}
                    <button
                      onClick={() => { setEditFond(fond); setEditIds(fondAccounts.map(c => c.id)) }}
                      className="text-gray-300 hover:text-teal-500 transition-colors shrink-0 ml-1"
                      title="Modifier les comptes"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal édition des comptes d'un fond */}
      {editFond && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-1">Comptes de « {editFond.nom} »</h3>
            <p className="text-xs text-gray-400 mb-4">Coche les comptes Vinted liés à ce fond.</p>
            <div className="space-y-2 mb-5 max-h-60 overflow-y-auto">
              {comptes.filter(c => {
                // Comptes déjà sur ce fond (toujours visibles)
                if (editIds.includes(c.id)) return true
                // Comptes libres (pas sur un autre fond)
                const usedByOther = fondComptes.some(fc => fc.compte_vinted_id === c.id && fc.fond_id !== editFond.id)
                return !usedByOther
              }).map(c => (
                <label key={c.id} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIds.includes(c.id)}
                    onChange={() => setEditIds(prev =>
                      prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id]
                    )}
                    className="w-4 h-4 accent-teal-500 rounded"
                  />
                  <span className="text-sm text-gray-800">{c.pseudo}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto ${
                    c.statut === 'actif' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>{c.statut}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditFond(null)} disabled={editSaving}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Annuler
              </button>
              <button onClick={handleSaveEditAccounts} disabled={editSaving}
                className="flex-1 bg-teal-500 text-white rounded-xl py-2 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50">
                {editSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer ce fond ?</h3>
            <p className="text-sm text-gray-500 mb-1"><strong>{deleteConfirm.nom}</strong></p>
            <p className="text-sm text-gray-400 mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} disabled={deleting}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Annuler
              </button>
              <button onClick={() => handleDelete(deleteConfirm)} disabled={deleting}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                {deleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
