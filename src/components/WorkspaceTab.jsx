import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ─── Constantes ───────────────────────────────────────────────────────────────
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const STATUTS = ['en_cours', 'image_faite', 'importe_dotb']
const STATUT_LABELS = { en_cours: 'En cours', image_faite: 'Images faites', importe_dotb: 'Posté sur Vinted' }
const STATUT_DOT = { en_cours: 'bg-gray-400', image_faite: 'bg-blue-400', importe_dotb: 'bg-green-500' }

function startOfWeek() {
  const d = new Date(); const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); d.setHours(0,0,0,0); return d.toISOString()
}

// ─── ArticleCard ───────────────────────────────────────────────────────────────
function ArticleCard({ item, fond, onEdit, onDelete, onOpenImages }) {
  const firstImage = Array.isArray(item.images_urls) && item.images_urls.length > 0 ? item.images_urls[0] : null
  const imageCount = Array.isArray(item.images_urls) ? item.images_urls.length : 0

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden group relative">
      {/* Zone image */}
      <div className="relative">
        {firstImage ? (
          <img src={firstImage} alt="" className="w-full h-40 object-cover" />
        ) : (
          <div className="w-full h-40 bg-gray-100 flex items-center justify-center">
            <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        <button onClick={() => onOpenImages(item)}
          className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors">
          {imageCount > 0 ? `${imageCount} 🖼` : '+ images'}
        </button>
      </div>

      {/* Corps */}
      <div className="p-3 space-y-1.5">
        {fond && (
          <div className="flex items-center gap-1.5">
            <img src={fond.image_url} alt={fond.nom} className="w-5 h-5 rounded object-cover shrink-0" />
            <span className="text-[10px] text-gray-500 truncate">{fond.nom}</span>
          </div>
        )}
        <a href={item.lien_shein} target="_blank" rel="noopener noreferrer"
          title={item.lien_shein}
          className="text-xs text-teal-600 hover:underline block truncate">
          {item.lien_shein ? item.lien_shein.replace(/^https?:\/\//, '').slice(0, 40) : '—'}
        </a>
        <div className="flex items-center gap-2">
          {item.taille && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{item.taille}</span>}
          {item.prix_shein != null && <span className="text-xs font-medium text-gray-700">{parseFloat(item.prix_shein).toFixed(2)} €</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUT_DOT[item.statut] ?? 'bg-gray-400'}`} />
          <span className="text-[10px] text-gray-600">{STATUT_LABELS[item.statut] ?? item.statut}</span>
        </div>
      </div>

      {/* Overlay edit/delete au survol */}
      <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEdit(item)}
          className="w-7 h-7 bg-white rounded-lg shadow-sm flex items-center justify-center text-gray-500 hover:text-teal-600 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button onClick={() => onDelete(item.id)}
          className="w-7 h-7 bg-white rounded-lg shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── ArticleModal ──────────────────────────────────────────────────────────────
function ArticleModal({ item, defaultCompteId, fondsFiltrés, assignedAccounts, userId, onClose, onSaved }) {
  const isEdit = !!item
  const [lienShein, setLienShein] = useState(item?.lien_shein ?? '')
  const [compteId, setCompteId]   = useState(item?.compte_vinted_id ?? defaultCompteId ?? '')
  const [fondId, setFondId]       = useState(item?.fond_id ?? '')
  const [taille, setTaille]       = useState(item?.taille ?? '')
  const [prixShein, setPrixShein] = useState(item?.prix_shein != null ? String(item.prix_shein) : '')
  const [statut, setStatut]       = useState(item?.statut ?? 'en_cours')
  const [newFiles, setNewFiles]   = useState([])
  const [previews, setPreviews]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const selectedFond = fondsFiltrés.find(f => f.id === fondId)

  function handleFilesChange(e) {
    const files = Array.from(e.target.files)
    setNewFiles(files)
    setPreviews(files.map(f => URL.createObjectURL(f)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!lienShein.trim()) { setError('Le lien Shein est requis.'); return }
    setLoading(true); setError('')
    try {
      const existingUrls = Array.isArray(item?.images_urls) ? item.images_urls : []
      const uploadedUrls = []
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i]
        const fileName = `${userId}/${Date.now()}-${i}-${file.name.replace(/\s/g, '_')}`
        const { error: upErr } = await supabase.storage.from('work_images').upload(fileName, file)
        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage.from('work_images').getPublicUrl(fileName)
          uploadedUrls.push(publicUrl)
        }
      }
      const payload = {
        lien_shein: lienShein.trim(),
        compte_vinted_id: compteId || null,
        fond_id: fondId || null,
        taille: taille || null,
        prix_shein: prixShein ? parseFloat(prixShein) : null,
        statut,
        images_urls: [...existingUrls, ...uploadedUrls],
        categorie: null,
      }
      let data, err
      if (isEdit) {
        ;({ data, error: err } = await supabase.from('work_items').update(payload).eq('id', item.id).select().single())
      } else {
        ;({ data, error: err } = await supabase.from('work_items').insert({ ...payload, employe_id: userId }).select().single())
      }
      if (err) throw err
      onSaved(data)
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{isEdit ? "Modifier l'article" : 'Nouvel article'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Lien Shein */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Lien Shein <span className="text-red-400">*</span></label>
            <input type="url" value={lienShein} onChange={e => setLienShein(e.target.value)} required
              placeholder="https://..."
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
          </div>

          {/* Compte Vinted */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Compte Vinted</label>
            <select value={compteId} onChange={e => setCompteId(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
              <option value="">— Sans compte —</option>
              {assignedAccounts.map(a => <option key={a.id} value={a.id}>{a.pseudo}</option>)}
            </select>
          </div>

          {/* Fond avec thumbnail */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fond</label>
            <div className="flex items-center gap-2">
              {selectedFond ? (
                <img src={selectedFond.image_url} alt={selectedFond.nom} className="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gray-100 shrink-0" />
              )}
              <select value={fondId} onChange={e => setFondId(e.target.value)}
                className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
                <option value="">— Aucun fond —</option>
                {fondsFiltrés.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </div>
          </div>

          {/* Taille + Prix */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Taille</label>
              <select value={taille} onChange={e => setTaille(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
                <option value="">— Aucune —</option>
                {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Prix Shein</label>
              <input type="number" value={prixShein} onChange={e => setPrixShein(e.target.value)}
                step="0.01" min="0" placeholder="0.00 €"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
            </div>
          </div>

          {/* Statut */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Statut</label>
            <select value={statut} onChange={e => setStatut(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
              {STATUTS.map(s => <option key={s} value={s}>{STATUT_LABELS[s]}</option>)}
            </select>
          </div>

          {/* Images */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Images {isEdit && item?.images_urls?.length > 0 ? `(${item.images_urls.length} existante${item.images_urls.length > 1 ? 's' : ''})` : ''}
            </label>
            {isEdit && Array.isArray(item?.images_urls) && item.images_urls.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-2">
                {item.images_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt="" className="w-14 h-14 rounded-xl object-cover border border-gray-200" />
                  </a>
                ))}
              </div>
            )}
            <label className="cursor-pointer block">
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center text-sm text-gray-400 hover:border-teal-300 hover:text-teal-500 transition-colors">
                {newFiles.length > 0 ? `${newFiles.length} image(s) sélectionnée(s)` : '+ Ajouter des images'}
              </div>
              <input type="file" multiple accept="image/*" className="hidden" onChange={handleFilesChange} />
            </label>
            {previews.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {previews.map((url, i) => <img key={i} src={url} alt="" className="w-14 h-14 rounded-xl object-cover border border-gray-200" />)}
              </div>
            )}
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Annuler
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50">
              {loading ? 'Enregistrement...' : (isEdit ? 'Modifier' : 'Créer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── FondsModal ────────────────────────────────────────────────────────────────
function FondsModal({ fondsFiltrés, fondComptes, vintedAccounts, onClose }) {
  async function handleDownload(fond) {
    try {
      const parts = fond.image_url.split('/')
      const fileName = parts[parts.length - 1]
      const { data, error } = await supabase.storage.from('fonds').download(fileName)
      if (error) throw error
      const ext = fileName.split('.').pop() || 'jpg'
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url; a.download = `${fond.nom}.${ext}`
      document.body.appendChild(a); a.click()
      document.body.removeChild(a); URL.revokeObjectURL(url)
    } catch { window.open(fond.image_url, '_blank') }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
          <h3 className="font-semibold text-gray-900">Mes fonds ({fondsFiltrés.length})</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          {fondsFiltrés.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-8">Aucun fond assigné.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {fondsFiltrés.map(fond => {
                const cIds = fondComptes.filter(fc => fc.fond_id === fond.id).map(fc => fc.compte_vinted_id)
                const pseudos = vintedAccounts.filter(v => cIds.includes(v.id)).map(v => v.pseudo)
                return (
                  <div key={fond.id} className="bg-gray-50 rounded-xl overflow-hidden border border-gray-100">
                    <div className="relative">
                      <img src={fond.image_url} alt={fond.nom} className="w-full h-28 object-cover" />
                      <button
                        onClick={() => handleDownload(fond)}
                        className="absolute bottom-2 right-2 w-8 h-8 bg-white/90 hover:bg-white rounded-full shadow flex items-center justify-center text-gray-600 hover:text-teal-600 transition-colors"
                        title="Télécharger"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    </div>
                    <div className="p-2.5">
                      <div className="text-xs font-semibold text-gray-800">{fond.nom}</div>
                      {pseudos.length > 0 && <div className="text-[10px] text-gray-500 mt-0.5">{pseudos.join(' · ')}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ImagesModal ───────────────────────────────────────────────────────────────
function ImagesModal({ item, onClose, onAddImages, onRemoveImage, adding }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Images ({(item.images_urls || []).length})</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <div className="p-4">
          {(item.images_urls || []).length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-4">
              {item.images_urls.map((url, i) => (
                <div key={i} className="relative group">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt="" className="w-full h-20 object-cover rounded-lg border border-gray-200" />
                  </a>
                  <button
                    onClick={() => onRemoveImage(item, url)}
                    className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          <label className="cursor-pointer block">
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center text-sm text-gray-400 hover:border-teal-300 hover:text-teal-500 transition-colors">
              {adding ? 'Upload en cours...' : '+ Ajouter des images'}
            </div>
            <input type="file" multiple accept="image/*" className="hidden"
              onChange={e => onAddImages(item, Array.from(e.target.files))}
              disabled={adding} />
          </label>
        </div>
      </div>
    </div>
  )
}

// ─── Composant principal ───────────────────────────────────────────────────────
export default function WorkspaceTab({ profile }) {
  const userId = profile.id
  const note   = profile.note_admin ?? null

  const [items, setItems]                   = useState([])
  const [stockItems, setStockItems]         = useState([])
  const [stockSearch, setStockSearch]       = useState('')
  const [tasks, setTasks]                   = useState([])
  const [fondsFiltrés, setFondsFiltrés]     = useState([])
  const [fondComptes, setFondComptes]       = useState([])
  const [vintedAccounts, setVintedAccounts] = useState([])
  const [assignedAccounts, setAssignedAccounts] = useState([])
  const [loading, setLoading]               = useState(false)
  const [noteDismissed, setNoteDismissed]   = useState(
    () => note ? sessionStorage.getItem('note_dismissed') === note : true
  )
  const [activeTab, setActiveTab]           = useState('__none__')
  const [tasksCollapsed, setTasksCollapsed] = useState(false)
  const [showAddModal, setShowAddModal]     = useState(false)
  const [editItem, setEditItem]             = useState(null)
  const [deleteConfirm, setDeleteConfirm]   = useState(null)
  const [imagesModal, setImagesModal]       = useState(null)
  const [addingImages, setAddingImages]     = useState(false)
  const [showFondsModal, setShowFondsModal] = useState(false)

  useEffect(() => { fetchAll() }, [userId])

  useEffect(() => {
    if (assignedAccounts.length > 0) setActiveTab(assignedAccounts[0].id)
  }, [assignedAccounts])

  async function fetchAll() {
    setLoading(true)
    const [
      { data: itemsData },
      { data: tasksData },
      { data: fondsData },
      { data: employeComptesData },
      { data: fcData },
      { data: vaData },
      { data: stockData },
    ] = await Promise.all([
      supabase.from('work_items').select('*').eq('employe_id', userId).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('employe_id', userId).order('created_at', { ascending: false }),
      supabase.from('fonds').select('*').order('nom', { ascending: true }),
      supabase.from('employe_comptes').select('compte_vinted_id').eq('employe_id', userId),
      supabase.from('fond_comptes').select('*'),
      supabase.from('vinted_accounts').select('id, pseudo'),
      supabase.from('items').select('id, photo_url, size, shein_url, emplacement').eq('status', 'en_stock').order('created_at', { ascending: false }),
    ])
    if (itemsData) setItems(itemsData)
    if (tasksData) setTasks(tasksData)
    if (fcData)    setFondComptes(fcData)
    if (vaData)    setVintedAccounts(vaData)
    if (stockData) setStockItems(stockData)
    if (vaData && employeComptesData) {
      const assignedIds = new Set(employeComptesData.map(ec => ec.compte_vinted_id))
      setAssignedAccounts(vaData.filter(v => assignedIds.has(v.id)))
      if (fondsData) {
        setFondsFiltrés(
          assignedIds.size > 0
            ? fondsData.filter(fond => {
                const fondCIds = fcData?.filter(fc => fc.fond_id === fond.id).map(fc => fc.compte_vinted_id) ?? []
                return fondCIds.some(cId => assignedIds.has(cId))
              })
            : []
        )
      }
    }
    setLoading(false)
  }

  const fondById = Object.fromEntries(fondsFiltrés.map(f => [f.id, f]))

  async function handleDelete(itemId) {
    const { error } = await supabase.from('work_items').delete().eq('id', itemId)
    if (!error) { setItems(prev => prev.filter(i => i.id !== itemId)); setDeleteConfirm(null) }
  }

  async function handleSaved(savedItem) {
    setItems(prev => {
      const exists = prev.find(i => i.id === savedItem.id)
      return exists ? prev.map(i => i.id === savedItem.id ? savedItem : i) : [savedItem, ...prev]
    })
    setShowAddModal(false)
    setEditItem(null)
  }

  async function handleTaskAction(task, newStatut) {
    const { data, error } = await supabase.from('tasks').update({ statut: newStatut }).eq('id', task.id).select().single()
    if (!error && data) setTasks(prev => prev.map(t => t.id === data.id ? data : t))
  }

  async function handleAddImages(item, files) {
    setAddingImages(true)
    const uploadedUrls = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const fileName = `${item.employe_id}/${Date.now()}-${i}-${file.name.replace(/\s/g, '_')}`
      const { error } = await supabase.storage.from('work_images').upload(fileName, file)
      if (!error) {
        const { data: { publicUrl } } = supabase.storage.from('work_images').getPublicUrl(fileName)
        uploadedUrls.push(publicUrl)
      }
    }
    const newUrls = [...(item.images_urls || []), ...uploadedUrls]
    const { data } = await supabase.from('work_items').update({ images_urls: newUrls }).eq('id', item.id).select().single()
    if (data) {
      setItems(prev => prev.map(i => i.id === data.id ? data : i))
      setImagesModal(prev => prev?.id === data.id ? data : prev)
    }
    setAddingImages(false)
  }

  async function handleRemoveImage(item, urlToRemove) {
    const newUrls = (item.images_urls || []).filter(u => u !== urlToRemove)
    const { data } = await supabase.from('work_items').update({ images_urls: newUrls }).eq('id', item.id).select().single()
    if (data) {
      setItems(prev => prev.map(i => i.id === data.id ? data : i))
      setImagesModal(prev => prev?.id === data.id ? data : prev)
    }
  }

  function dismissNote() {
    sessionStorage.setItem('note_dismissed', note)
    setNoteDismissed(true)
  }

  // Stats
  const todayStr   = new Date().toISOString().slice(0, 10)
  const todayCount = items.filter(i => i.created_at.slice(0, 10) === todayStr).length
  const weekCount  = items.filter(i => i.created_at >= startOfWeek()).length
  const activeTasks = tasks.filter(t => t.statut !== 'termine')

  // Items de l'onglet actif
  const tabItems = activeTab === '__none__'
    ? items.filter(i => !i.compte_vinted_id)
    : items.filter(i => i.compte_vinted_id === activeTab)

  return (
    <div className="flex flex-col bg-gray-50" style={{ minHeight: 'calc(100vh - 56px)' }}>

      {/* Note admin */}
      {note && !noteDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-start gap-3 shrink-0">
          <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <div className="flex-1 text-xs">
            <span className="font-bold text-amber-700">Message de l'admin : </span>
            <span className="text-amber-800 whitespace-pre-wrap">{note}</span>
          </div>
          <button onClick={dismissNote} className="text-amber-400 hover:text-amber-600 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Stats bar */}
      <div className="px-4 py-1.5 bg-white border-b border-gray-100 shrink-0 text-xs text-gray-400">
        Aujourd'hui&nbsp;:&nbsp;<span className="font-medium text-gray-600">{todayCount}</span>
        &nbsp;·&nbsp;Cette semaine&nbsp;:&nbsp;<span className="font-medium text-gray-600">{weekCount}</span>
      </div>

      {/* Barre d'onglets par compte */}
      <div className="bg-white border-b border-gray-200 px-4 overflow-x-auto shrink-0">
        <div className="flex gap-0 min-w-max">
          {assignedAccounts.map(compte => {
            const count = items.filter(i => i.compte_vinted_id === compte.id).length
            const isActive = activeTab === compte.id
            return (
              <button key={compte.id} onClick={() => setActiveTab(compte.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${isActive ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                {compte.pseudo}
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-teal-100 text-teal-600' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
              </button>
            )
          })}
          {/* Onglet "Sans compte" */}
          {(() => {
            const count = items.filter(i => !i.compte_vinted_id).length
            const isActive = activeTab === '__none__'
            return (
              <button onClick={() => setActiveTab('__none__')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${isActive ? 'border-gray-500 text-gray-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                Sans compte
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-400'}`}>{count}</span>
              </button>
            )
          })()}
          {/* Onglet Stock visuel */}
          <button onClick={() => setActiveTab('__stock__')}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === '__stock__' ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            📦 Stock
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${activeTab === '__stock__' ? 'bg-teal-100 text-teal-600' : 'bg-gray-100 text-gray-400'}`}>{stockItems.length}</span>
          </button>
        </div>
      </div>

      {/* Contenu principal */}
      <div className="flex-1 px-4 py-4 max-w-6xl mx-auto w-full">

        {/* Onglet Stock visuel */}
        {activeTab === '__stock__' && (() => {
          const q = stockSearch.toLowerCase()
          const filtered = stockSearch
            ? stockItems.filter(i =>
                (i.size ?? '').toLowerCase().includes(q) ||
                (i.shein_url ?? '').toLowerCase().includes(q)
              )
            : stockItems
          return (
            <div>
              <div className="mb-4 relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
                </svg>
                <input
                  type="text"
                  value={stockSearch}
                  onChange={e => setStockSearch(e.target.value)}
                  placeholder="Rechercher par taille ou lien Shein…"
                  className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-teal-400 bg-white"
                />
                {stockSearch && (
                  <button onClick={() => setStockSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <p className="font-medium">{stockSearch ? 'Aucun résultat' : 'Aucun article en stock'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {filtered.map(item => (
                    <div key={item.id} className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                      <div className="aspect-square relative bg-gray-100">
                        {item.photo_url
                          ? <img src={item.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          : <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                        }
                        <span className="absolute top-1.5 right-1.5 text-[9px] font-bold bg-white/90 px-1.5 py-0.5 rounded-full text-gray-700 leading-none shadow-sm">
                          {item.size}
                        </span>
                      </div>
                      <div className="px-2 py-1.5">
                        {item.shein_url
                          ? <a href={item.shein_url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] text-pink-400 hover:text-pink-600 transition-colors">
                              <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              <span className="truncate">Shein</span>
                            </a>
                          : <span className="text-[10px] text-gray-300">—</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* Section tâches + work items (masqué sur l'onglet stock) */}
        {activeTab !== '__stock__' && activeTasks.length > 0 && (
          <div className="mb-4 bg-orange-50 rounded-2xl border border-orange-100 overflow-hidden">
            <button
              onClick={() => setTasksCollapsed(c => !c)}
              className="w-full px-4 py-2.5 text-xs font-semibold text-orange-700 text-left flex items-center gap-1.5 hover:bg-orange-100/50 transition-colors"
            >
              <span className={`transition-transform ${tasksCollapsed ? '' : 'rotate-90'}`}>▶</span>
              Tâches assignées ({activeTasks.length})
            </button>
            {!tasksCollapsed && (
              <div className="px-4 pb-3 space-y-1.5">
                {activeTasks.map(task => {
                  const fond = fondsFiltrés.find(f => f.id === task.fond_id)
                  const badge = task.statut === 'assignee'
                    ? { cls: 'bg-orange-100 text-orange-600', label: 'Assignée' }
                    : task.statut === 'en_cours'
                    ? { cls: 'bg-blue-100 text-blue-600', label: 'En cours' }
                    : { cls: 'bg-green-100 text-green-700', label: 'Terminée' }
                  return (
                    <div key={task.id} className="flex items-center gap-2 py-0.5">
                      {fond?.image_url && <img src={fond.image_url} alt={fond.nom} className="w-8 h-8 rounded object-cover border border-orange-200 shrink-0" />}
                      <span className="text-xs font-medium text-orange-800 shrink-0 max-w-[80px] truncate">{fond?.nom ?? '—'}</span>
                      <a href={task.lien_shein} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-teal-600 hover:underline truncate flex-1">{task.lien_shein?.replace(/^https?:\/\//, '').slice(0, 40)}</a>
                      {task.message && <span className="text-xs text-gray-500 italic truncate max-w-[100px] shrink-0">{task.message}</span>}
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badge.cls}`}>{badge.label}</span>
                      {task.statut === 'assignee' && (
                        <button onClick={() => handleTaskAction(task, 'en_cours')}
                          className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 shrink-0">Prendre en charge</button>
                      )}
                      {task.statut === 'en_cours' && (
                        <button onClick={() => handleTaskAction(task, 'termine')}
                          className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500 text-white hover:bg-green-600 shrink-0">Terminée</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* En-tête zone + actions + grille work items */}
        {activeTab !== '__stock__' && (
          <>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  {activeTab === '__none__' ? 'Sans compte' : assignedAccounts.find(a => a.id === activeTab)?.pseudo ?? ''}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">{tabItems.length} article{tabItems.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowFondsModal(true)}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 bg-white rounded-xl px-3 py-1.5 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Mes fonds
                </button>
                <button onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-white bg-teal-500 hover:bg-teal-600 rounded-xl px-4 py-1.5 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  Nouvel article
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Chargement…
              </div>
            ) : tabItems.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-400 mb-4">Aucun article pour ce compte.</p>
                <button onClick={() => setShowAddModal(true)}
                  className="text-sm font-semibold text-white bg-teal-500 hover:bg-teal-600 rounded-xl px-4 py-2 transition-colors">
                  + Ajouter un article
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {tabItems.map(item => (
                  <ArticleCard
                    key={item.id}
                    item={item}
                    fond={fondById[item.fond_id]}
                    onEdit={setEditItem}
                    onDelete={setDeleteConfirm}
                    onOpenImages={setImagesModal}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal ajout */}
      {showAddModal && (
        <ArticleModal
          defaultCompteId={activeTab !== '__none__' ? activeTab : ''}
          fondsFiltrés={fondsFiltrés}
          assignedAccounts={assignedAccounts}
          userId={userId}
          onClose={() => setShowAddModal(false)}
          onSaved={handleSaved}
        />
      )}

      {/* Modal modification */}
      {editItem && (
        <ArticleModal
          item={editItem}
          defaultCompteId={editItem.compte_vinted_id ?? ''}
          fondsFiltrés={fondsFiltrés}
          assignedAccounts={assignedAccounts}
          userId={userId}
          onClose={() => setEditItem(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Confirm suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer l'article ?</h3>
            <p className="text-sm text-gray-500 mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Annuler</button>
              <button onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-red-600">Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal images */}
      {imagesModal && (
        <ImagesModal
          item={imagesModal}
          onClose={() => setImagesModal(null)}
          onAddImages={handleAddImages}
          onRemoveImage={handleRemoveImage}
          adding={addingImages}
        />
      )}

      {/* Modal fonds */}
      {showFondsModal && (
        <FondsModal
          fondsFiltrés={fondsFiltrés}
          fondComptes={fondComptes}
          vintedAccounts={vintedAccounts}
          onClose={() => setShowFondsModal(false)}
        />
      )}
    </div>
  )
}
