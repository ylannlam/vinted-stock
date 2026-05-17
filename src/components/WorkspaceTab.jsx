import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const STATUTS = ['en_cours', 'image_faite', 'importe_dotb']
const STATUT_LABELS = {
  en_cours:     'En cours',
  image_faite:  'Images faites',
  importe_dotb: 'Posté sur Vinted',
}
const STATUT_NEXT = {
  en_cours:     'image_faite',
  image_faite:  'importe_dotb',
  importe_dotb: 'en_cours',
}

function statutBadgeCls(statut) {
  if (statut === 'en_cours')    return 'bg-gray-100 text-gray-600'
  if (statut === 'image_faite') return 'bg-blue-100 text-blue-600'
  return 'bg-green-100 text-green-600'
}

function adminBadge(s) {
  if (s === 'valide') return { cls: 'bg-green-100 text-green-700', label: '✓ Validé' }
  if (s === 'refuse') return { cls: 'bg-red-100 text-red-700',     label: '✗ Refusé' }
  return { cls: 'bg-gray-100 text-gray-500', label: '· En attente' }
}

function taskStatutBadge(s) {
  if (s === 'assignee') return { cls: 'bg-orange-100 text-orange-600', label: 'Assignée' }
  if (s === 'en_cours') return { cls: 'bg-blue-100 text-blue-600',     label: 'En cours' }
  return { cls: 'bg-green-100 text-green-700', label: 'Terminée' }
}

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function WorkspaceTab({ profile }) {
  const userId = profile.id
  const note   = profile.note_admin ?? null

  const [items, setItems]         = useState([])
  const [tasks, setTasks]         = useState([])
  const [fonds, setFonds]         = useState([])
  const [fondsFiltrés, setFondsFiltrés] = useState([])
  const [loading, setLoading]     = useState(false)
  const [noteDismissed, setNoteDismissed] = useState(
    () => note ? sessionStorage.getItem('note_dismissed') === note : true
  )

  // Inline add form
  const [lienShein, setLienShein]       = useState('')
  const [fondId, setFondId]             = useState('')
  const [taille, setTaille]             = useState('')
  const [prixShein, setPrixShein]       = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [previewUrls, setPreviewUrls]   = useState([])
  const [statut, setStatut]             = useState('en_cours')
  const [adding, setAdding]             = useState(false)
  const [addError, setAddError]         = useState('')

  // Edit / delete
  const [editItem, setEditItem]           = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => { fetchAll() }, [userId])

  async function fetchAll() {
    setLoading(true)
    const [
      { data: itemsData },
      { data: tasksData },
      { data: fondsData },
      { data: comptesData },
    ] = await Promise.all([
      supabase.from('work_items').select('*').eq('employe_id', userId).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('employe_id', userId).order('created_at', { ascending: false }),
      supabase.from('fonds').select('*').order('nom', { ascending: true }),
      supabase.from('employe_comptes').select('compte_vinted_id').eq('employe_id', userId),
    ])
    if (itemsData) setItems(itemsData)
    if (tasksData) setTasks(tasksData)
    if (fondsData) {
      setFonds(fondsData)
      const assignedIds = new Set(comptesData?.map(ec => ec.compte_vinted_id) ?? [])
      setFondsFiltrés(
        assignedIds.size > 0
          ? fondsData.filter(f => f.compte_vinted_id && assignedIds.has(f.compte_vinted_id))
          : []
      )
    }
    setLoading(false)
  }

  async function handleDownloadFond(fond) {
    try {
      const res  = await fetch(fond.image_url)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${fond.nom}.${blob.type.split('/')[1] || 'jpg'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      window.open(fond.image_url, '_blank')
    }
  }

  function handleFilesChange(e) {
    const files = Array.from(e.target.files)
    setSelectedFiles(files)
    setPreviewUrls(files.map(f => URL.createObjectURL(f)))
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!lienShein.trim()) return
    setAdding(true)
    setAddError('')

    try {
      // Upload images
      const uploadedUrls = []
      for (let i = 0; i < selectedFiles.length; i++) {
        const file     = selectedFiles[i]
        const fileName = `${userId}/${Date.now()}-${i}-${file.name.replace(/\s/g, '_')}`
        const { error } = await supabase.storage.from('work_images').upload(fileName, file)
        if (!error) {
          const { data: { publicUrl } } = supabase.storage.from('work_images').getPublicUrl(fileName)
          uploadedUrls.push(publicUrl)
        }
      }

      const { data, error } = await supabase
        .from('work_items')
        .insert({
          employe_id:  userId,
          lien_shein:  lienShein.trim(),
          fond_id:     fondId || null,
          taille:      taille || null,
          prix_shein:  prixShein ? parseFloat(prixShein) : null,
          images_urls: uploadedUrls,
          statut,
        })
        .select()
        .single()

      if (error) { setAddError(error.message); setAdding(false); return }
      setItems(prev => [data, ...prev])
      setLienShein('')
      setFondId('')
      setTaille('')
      setPrixShein('')
      setSelectedFiles([])
      setPreviewUrls([])
      setStatut('en_cours')
      const fi = document.getElementById('ws-file-input')
      if (fi) fi.value = ''
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleCycleStatus(item) {
    const next = STATUT_NEXT[item.statut]
    const { data, error } = await supabase
      .from('work_items').update({ statut: next }).eq('id', item.id).select().single()
    if (!error && data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleDelete(itemId) {
    const { error } = await supabase.from('work_items').delete().eq('id', itemId)
    if (!error) { setItems(prev => prev.filter(i => i.id !== itemId)); setDeleteConfirm(null) }
  }

  async function handleTaskAction(task, newStatut) {
    const { data, error } = await supabase
      .from('tasks').update({ statut: newStatut }).eq('id', task.id).select().single()
    if (!error && data) setTasks(prev => prev.map(t => t.id === data.id ? data : t))
  }

  function dismissNote() {
    sessionStorage.setItem('note_dismissed', note)
    setNoteDismissed(true)
  }

  const todayStr    = new Date().toISOString().slice(0, 10)
  const todayItems  = items.filter(i => i.created_at.slice(0, 10) === todayStr)
  const olderItems  = items.filter(i => i.created_at.slice(0, 10) !== todayStr)
  const weekCount   = items.filter(i => i.created_at >= startOfWeek()).length
  const validCount  = items.filter(i => i.admin_status === 'valide').length
  const refuseCount = items.filter(i => i.admin_status === 'refuse').length

  const activeTasks = tasks.filter(t => t.statut !== 'termine')

  return (
    <div className="p-4 max-w-2xl mx-auto pb-10">

      {/* Message admin */}
      {note && !noteDismissed && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <div className="flex-1">
            <div className="text-xs font-bold text-amber-700 mb-0.5">Message de l'admin</div>
            <p className="text-sm text-amber-800 whitespace-pre-wrap">{note}</p>
          </div>
          <button onClick={dismissNote} className="text-amber-400 hover:text-amber-600 transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[
          { value: todayItems.length, label: "Aujourd'hui", color: 'text-teal-600' },
          { value: weekCount,         label: 'Cette semaine', color: 'text-teal-600' },
          { value: validCount,        label: 'Validés',       color: 'text-green-600' },
          { value: refuseCount,       label: 'Refusés',       color: 'text-red-500' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tâches assignées */}
      {activeTasks.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-gray-900">Tâches assignées</h3>
            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">{activeTasks.length}</span>
          </div>
          <div className="space-y-2">
            {activeTasks.map(task => {
              const fond = fonds.find(f => f.id === task.fond_id)
              const badge = taskStatutBadge(task.statut)
              return (
                <div key={task.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-start gap-3">
                    {fond && (
                      <img
                        src={fond.image_url}
                        alt={fond.nom}
                        className="w-12 h-12 rounded-xl object-cover border border-gray-200 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {fond && (
                        <div className="text-xs font-semibold text-gray-700">{fond.nom}</div>
                      )}
                      {fond && (
                        <div className="text-xs text-gray-400 mb-1">Compte : {fond.compte_vinted_pseudo}</div>
                      )}
                      <a
                        href={task.lien_shein}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-teal-600 hover:underline block truncate"
                      >
                        {task.lien_shein}
                      </a>
                      {task.message && (
                        <p className="text-xs text-gray-400 italic mt-1">{task.message}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                        {task.statut === 'assignee' && (
                          <button
                            onClick={() => handleTaskAction(task, 'en_cours')}
                            className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                          >
                            Prendre en charge
                          </button>
                        )}
                        {task.statut === 'en_cours' && (
                          <button
                            onClick={() => handleTaskAction(task, 'termine')}
                            className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500 text-white hover:bg-green-600 transition-colors"
                          >
                            Marquer terminée
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Mes fonds */}
      {fondsFiltrés.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-gray-900">Mes fonds</h3>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{fondsFiltrés.length}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {fondsFiltrés.map(fond => (
              <div key={fond.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="relative">
                  <img src={fond.image_url} alt={fond.nom} className="w-full h-24 object-cover" />
                  <button
                    onClick={() => handleDownloadFond(fond)}
                    className="absolute bottom-2 right-2 w-7 h-7 bg-white/90 hover:bg-white text-gray-700 rounded-full flex items-center justify-center shadow transition-colors"
                    title="Télécharger"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                </div>
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-gray-900 truncate">{fond.nom}</div>
                  <div className="text-[10px] text-gray-500 truncate">Compte : {fond.compte_vinted_pseudo}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulaire d'ajout */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Ajouter un article</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <input
            type="url"
            value={lienShein}
            onChange={e => setLienShein(e.target.value)}
            required
            placeholder="Lien Shein (https://...)"
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
          />

          <select
            value={fondId}
            onChange={e => setFondId(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
          >
            <option value="">— Aucun fond —</option>
            {fondsFiltrés.map(f => (
              <option key={f.id} value={f.id}>
                {f.nom} — Compte : {f.compte_vinted_pseudo}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <select
              value={taille}
              onChange={e => setTaille(e.target.value)}
              className="w-24 border border-gray-300 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              <option value="">Taille</option>
              {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="number"
              value={prixShein}
              onChange={e => setPrixShein(e.target.value)}
              step="0.01"
              min="0"
              placeholder="0.00 €"
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
            <select
              value={statut}
              onChange={e => setStatut(e.target.value)}
              className="w-36 border border-gray-300 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              {STATUTS.map(s => <option key={s} value={s}>{STATUT_LABELS[s]}</option>)}
            </select>
          </div>

          {/* Upload images */}
          <div>
            <label className="cursor-pointer block">
              <div className="border border-dashed border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-500 hover:border-teal-400 hover:text-teal-600 transition text-center">
                {selectedFiles.length > 0 ? `${selectedFiles.length} image(s) sélectionnée(s)` : 'Ajouter des images (optionnel)'}
              </div>
              <input
                id="ws-file-input"
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleFilesChange}
              />
            </label>
            {previewUrls.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {previewUrls.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`aperçu ${i + 1}`}
                    className="w-14 h-14 rounded-xl object-cover border border-gray-200"
                  />
                ))}
              </div>
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

      {loading && (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <svg className="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Chargement...
        </div>
      )}

      {!loading && (
        <>
          {/* Articles du jour */}
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-bold text-gray-900">Mes articles du jour</h3>
            <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">{todayItems.length}</span>
          </div>
          {todayItems.length === 0 ? (
            <p className="text-sm text-gray-400 italic mb-6">Aucun article ajouté aujourd'hui.</p>
          ) : (
            <div className="space-y-2 mb-6">
              {todayItems.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  fonds={fonds}
                  onCycle={handleCycleStatus}
                  onEdit={setEditItem}
                  onDelete={setDeleteConfirm}
                />
              ))}
            </div>
          )}

          {/* Articles précédents */}
          {olderItems.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold text-gray-900">Articles précédents</h3>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{olderItems.length}</span>
              </div>
              <div className="space-y-2">
                {olderItems.map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    fonds={fonds}
                    onCycle={handleCycleStatus}
                    onEdit={setEditItem}
                    onDelete={setDeleteConfirm}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Confirm suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer l'article ?</h3>
            <p className="text-sm text-gray-500 mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Annuler
              </button>
              <button onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-red-600">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal édition */}
      {editItem && (
        <WorkItemModal
          item={editItem}
          userId={userId}
          fonds={fonds}
          onClose={() => setEditItem(null)}
          onSaved={saved => {
            setItems(prev => prev.map(i => i.id === saved.id ? saved : i))
            setEditItem(null)
          }}
        />
      )}
    </div>
  )
}

function ItemRow({ item, fonds, onCycle, onEdit, onDelete }) {
  const ab   = adminBadge(item.admin_status ?? 'en_attente')
  const fond = fonds.find(f => f.id === item.fond_id)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start gap-3">
        {fond && (
          <img
            src={fond.image_url}
            alt={fond.nom}
            className="w-12 h-12 rounded-xl object-cover border border-gray-200 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          {fond && (
            <div className="text-xs text-gray-500 mb-0.5">Compte : <span className="font-medium">{fond.compte_vinted_pseudo}</span></div>
          )}
          <a
            href={item.lien_shein}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-teal-600 hover:underline block truncate"
          >
            {item.lien_shein}
          </a>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {item.taille && (
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{item.taille}</span>
            )}
            {item.prix_shein != null && (
              <span className="text-xs text-gray-600 font-medium">{parseFloat(item.prix_shein).toFixed(2)} €</span>
            )}
            <span className="text-xs text-gray-400">
              {new Date(item.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Miniatures images */}
          {Array.isArray(item.images_urls) && item.images_urls.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {item.images_urls.slice(0, 4).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={url}
                    alt={`image ${i + 1}`}
                    className="w-10 h-10 rounded-lg object-cover border border-gray-200 hover:opacity-80 transition-opacity"
                  />
                </a>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ab.cls}`}>{ab.label}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button
            onClick={() => onCycle(item)}
            className={`text-xs font-semibold px-2 py-1 rounded-full transition-colors ${statutBadgeCls(item.statut)}`}
          >
            {STATUT_LABELS[item.statut]}
          </button>
          <div className="flex items-center gap-0.5">
            <button onClick={() => onEdit(item)} className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button onClick={() => onDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function WorkItemModal({ item, userId, fonds, onClose, onSaved }) {
  const [lienShein, setLienShein]   = useState(item?.lien_shein ?? '')
  const [fondId, setFondId]         = useState(item?.fond_id ?? '')
  const [taille, setTaille]         = useState(item?.taille ?? '')
  const [prixShein, setPrixShein]   = useState(item?.prix_shein != null ? String(item.prix_shein) : '')
  const [statut, setStatut]         = useState(item?.statut ?? 'en_cours')
  const [newFiles, setNewFiles]     = useState([])
  const [previewUrls, setPreviewUrls] = useState([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')

  function handleFilesChange(e) {
    const files = Array.from(e.target.files)
    setNewFiles(files)
    setPreviewUrls(files.map(f => URL.createObjectURL(f)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Upload new images if any, concat with existing
      const existingUrls = Array.isArray(item?.images_urls) ? item.images_urls : []
      const uploadedUrls = []
      for (let i = 0; i < newFiles.length; i++) {
        const file     = newFiles[i]
        const fileName = `${userId}/${Date.now()}-${i}-${file.name.replace(/\s/g, '_')}`
        const { error: upErr } = await supabase.storage.from('work_images').upload(fileName, file)
        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage.from('work_images').getPublicUrl(fileName)
          uploadedUrls.push(publicUrl)
        }
      }

      const payload = {
        lien_shein:  lienShein,
        fond_id:     fondId || null,
        taille:      taille || null,
        prix_shein:  prixShein ? parseFloat(prixShein) : null,
        statut,
        images_urls: [...existingUrls, ...uploadedUrls],
      }

      const { data, error: err } = item
        ? await supabase.from('work_items').update(payload).eq('id', item.id).select().single()
        : await supabase.from('work_items').insert({ ...payload, employe_id: userId }).select().single()

      if (err) throw err
      onSaved(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Modifier l'article</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Lien Shein</label>
            <input type="url" value={lienShein} onChange={e => setLienShein(e.target.value)} required
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fond</label>
            <select value={fondId} onChange={e => setFondId(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
              <option value="">— Aucun fond —</option>
              {fonds.map(f => (
                <option key={f.id} value={f.id}>{f.nom} — Compte : {f.compte_vinted_pseudo}</option>
              ))}
            </select>
          </div>
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Statut</label>
            <select value={statut} onChange={e => setStatut(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
              {STATUTS.map(s => <option key={s} value={s}>{STATUT_LABELS[s]}</option>)}
            </select>
          </div>

          {/* Images existantes */}
          {Array.isArray(item?.images_urls) && item.images_urls.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Images existantes</label>
              <div className="flex gap-2 flex-wrap">
                {item.images_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt={`img ${i + 1}`} className="w-14 h-14 rounded-xl object-cover border border-gray-200" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Nouvelles images */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Ajouter des images</label>
            <label className="cursor-pointer block">
              <div className="border border-dashed border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-500 hover:border-teal-400 hover:text-teal-600 transition text-center">
                {newFiles.length > 0 ? `${newFiles.length} image(s) sélectionnée(s)` : 'Choisir des images…'}
              </div>
              <input type="file" multiple accept="image/*" className="hidden" onChange={handleFilesChange} />
            </label>
            {previewUrls.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {previewUrls.map((url, i) => (
                  <img key={i} src={url} alt={`aperçu ${i + 1}`} className="w-14 h-14 rounded-xl object-cover border border-gray-200" />
                ))}
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
              {loading ? 'Enregistrement...' : 'Modifier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
