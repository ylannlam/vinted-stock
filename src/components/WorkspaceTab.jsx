import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ─── Constantes ───────────────────────────────────────────────────────────────
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const STATUT_LABELS = {
  en_cours:     'En cours',
  image_faite:  'Images faites',
  importe_dotb: 'Posté sur Vinted',
}
const STATUT_DOT = {
  en_cours:     'bg-gray-400',
  image_faite:  'bg-blue-400',
  importe_dotb: 'bg-green-500',
}

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function taskStatutBadge(s) {
  if (s === 'assignee') return { cls: 'bg-orange-100 text-orange-600', label: 'Assignée' }
  if (s === 'en_cours') return { cls: 'bg-blue-100 text-blue-600',     label: 'En cours' }
  return { cls: 'bg-green-100 text-green-700', label: 'Terminée' }
}

// ─── Spinner SVG ───────────────────────────────────────────────────────────────
function Spinner({ className = 'w-3 h-3' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
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

// ─── DraftImagesCell ────────────────────────────────────────────────────────────
function DraftImagesCell({ files, onChange }) {
  const ref = useRef(null)
  return (
    <label className="cursor-pointer">
      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500 whitespace-nowrap">
        {files.length > 0 ? `${files.length} 🖼` : '+ images'}
      </span>
      <input
        ref={ref}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={e => onChange(Array.from(e.target.files))}
      />
    </label>
  )
}

// ─── GhostRow ──────────────────────────────────────────────────────────────────
function GhostRow({ draft, setDraft, fondsFiltrés, onSave, saving }) {
  return (
    <tr className="border-t border-dashed border-gray-300 bg-teal-50/20">
      <td className="px-3 py-1.5">
        <input
          type="url"
          value={draft.lien_shein}
          onChange={e => setDraft(d => ({ ...d, lien_shein: e.target.value }))}
          onBlur={onSave}
          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
          placeholder="+ Coller un lien Shein…"
          className="w-full bg-transparent text-xs text-gray-500 placeholder-gray-300 focus:outline-none"
        />
      </td>
      <td className="px-3 py-1.5">
        <select
          value={draft.fond_id}
          onChange={e => setDraft(d => ({ ...d, fond_id: e.target.value }))}
          className="w-full bg-transparent text-xs focus:outline-none text-gray-500"
        >
          <option value="">—</option>
          {fondsFiltrés.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <select
          value={draft.taille}
          onChange={e => setDraft(d => ({ ...d, taille: e.target.value }))}
          className="w-full bg-transparent text-xs focus:outline-none text-gray-500"
        >
          <option value="">—</option>
          {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <input
          type="number"
          value={draft.prix_shein}
          step="0.01"
          min="0"
          onChange={e => setDraft(d => ({ ...d, prix_shein: e.target.value }))}
          placeholder="€"
          className="w-full bg-transparent text-xs focus:outline-none text-gray-500"
        />
      </td>
      <td className="px-3 py-1.5">
        <DraftImagesCell files={draft.files ?? []} onChange={files => setDraft(d => ({ ...d, files }))} />
      </td>
      <td className="px-3 py-1.5">
        <select
          value={draft.statut}
          onChange={e => setDraft(d => ({ ...d, statut: e.target.value }))}
          className="w-full bg-transparent text-xs focus:outline-none text-gray-500"
        >
          <option value="en_cours">En cours</option>
          <option value="image_faite">Images faites</option>
          <option value="importe_dotb">Posté sur Vinted</option>
        </select>
      </td>
      <td colSpan="3" className="px-3 py-1.5 text-gray-300 text-xs italic">
        {saving ? (
          <Spinner className="w-3 h-3 text-teal-400 inline" />
        ) : '← remplir et Tab pour ajouter'}
      </td>
    </tr>
  )
}

// ─── ItemRow ───────────────────────────────────────────────────────────────────
function ItemRow({ item, idx, fondsFiltrés, fondById, saveField, savingMap, onOpenImages, onDelete }) {
  const [editingLien, setEditingLien] = useState(false)
  const [lienDraft, setLienDraft]     = useState(item.lien_shein ?? '')
  const lienInputRef = useRef(null)

  useEffect(() => {
    if (editingLien && lienInputRef.current) lienInputRef.current.focus()
  }, [editingLien])

  function startEditLien() {
    setLienDraft(item.lien_shein ?? '')
    setEditingLien(true)
  }

  function commitLien() {
    setEditingLien(false)
    if (lienDraft !== item.lien_shein) saveField(item.id, 'lien_shein', lienDraft)
  }

  const fond = fondById[item.fond_id]
  const savingState = savingMap[item.id]
  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'

  // Colonne validation
  let validationNode
  if (item.admin_status === 'valide') {
    validationNode = <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ Validé</span>
  } else if (item.admin_status === 'refuse') {
    validationNode = <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">✗ Refusé</span>
  } else {
    validationNode = <span className="text-gray-300">·</span>
  }

  const imageCount = (item.images_urls || []).length

  return (
    <tr className={`${rowBg} border-b border-gray-100 hover:bg-blue-50/20 transition-colors`}>
      {/* Lien Shein */}
      <td className="px-3 py-1.5 w-56">
        {editingLien ? (
          <input
            ref={lienInputRef}
            type="url"
            value={lienDraft}
            onChange={e => setLienDraft(e.target.value)}
            onBlur={commitLien}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setEditingLien(false) } }}
            className="w-full text-xs border border-teal-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        ) : (
          <div className="flex items-center gap-1 group">
            <a
              href={item.lien_shein}
              target="_blank"
              rel="noopener noreferrer"
              title={item.lien_shein}
              className="text-xs text-teal-600 hover:underline truncate max-w-[160px] block"
            >
              {item.lien_shein ? item.lien_shein.replace(/^https?:\/\//, '').slice(0, 35) : '—'}
            </a>
            <button
              onClick={startEditLien}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-gray-600 shrink-0"
              title="Modifier le lien"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        )}
      </td>

      {/* Fond */}
      <td className="px-3 py-1.5 w-44">
        <div className="flex items-center gap-1">
          {fond?.image_url ? (
            <img src={fond.image_url} alt={fond.nom} className="w-7 h-7 rounded object-cover border border-gray-200 shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded bg-gray-100 shrink-0" />
          )}
          <select
            value={item.fond_id ?? ''}
            onChange={e => saveField(item.id, 'fond_id', e.target.value)}
            className="flex-1 bg-transparent text-xs focus:outline-none text-gray-700 min-w-0"
          >
            <option value="">—</option>
            {fondsFiltrés.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </div>
      </td>

      {/* Taille */}
      <td className="px-3 py-1.5 w-16">
        <select
          value={item.taille ?? ''}
          onChange={e => saveField(item.id, 'taille', e.target.value)}
          className="w-full bg-transparent text-xs focus:outline-none text-gray-700"
        >
          <option value="">—</option>
          {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>

      {/* Prix */}
      <td className="px-3 py-1.5 w-20">
        <input
          type="number"
          step="0.01"
          min="0"
          defaultValue={item.prix_shein ?? ''}
          key={`prix-${item.id}-${item.prix_shein}`}
          onBlur={e => saveField(item.id, 'prix_shein', e.target.value)}
          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
          placeholder="€"
          className="w-full bg-transparent text-xs focus:outline-none text-gray-700"
        />
      </td>

      {/* Images */}
      <td className="px-3 py-1.5 w-20">
        <button
          onClick={() => onOpenImages(item)}
          className="text-xs px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
          title="Voir/ajouter des images"
        >
          {imageCount > 0 ? `${imageCount} 🖼` : '+ images'}
        </button>
      </td>

      {/* Statut */}
      <td className="px-3 py-1.5 w-32">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUT_DOT[item.statut] ?? 'bg-gray-400'}`} />
          <select
            value={item.statut}
            onChange={e => saveField(item.id, 'statut', e.target.value)}
            className="flex-1 bg-transparent text-xs focus:outline-none text-gray-700 min-w-0"
          >
            <option value="en_cours">En cours</option>
            <option value="image_faite">Images faites</option>
            <option value="importe_dotb">Posté sur Vinted</option>
          </select>
        </div>
      </td>

      {/* Validation (read-only) */}
      <td className="px-3 py-1.5 w-24">
        {validationNode}
      </td>

      {/* Date */}
      <td className="px-3 py-1.5 w-24 text-gray-400 text-xs whitespace-nowrap">
        {new Date(item.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </td>

      {/* Action + indicateur sauvegarde */}
      <td className="px-2 py-1.5 w-8 text-center">
        {savingState === 'saving' ? (
          <Spinner className="w-3 h-3 text-gray-400 inline" />
        ) : savingState === 'saved' ? (
          <span className="text-green-500 text-xs">✓</span>
        ) : (
          <button
            onClick={() => onDelete(item.id)}
            className="text-gray-300 hover:text-red-400 transition-colors"
            title="Supprimer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </td>
    </tr>
  )
}

// ─── Composant principal ───────────────────────────────────────────────────────
export default function WorkspaceTab({ profile }) {
  const userId = profile.id
  const note   = profile.note_admin ?? null

  const [items, setItems]               = useState([])
  const [tasks, setTasks]               = useState([])
  const [fondComptes, setFondComptes]   = useState([])
  const [vintedAccounts, setVintedAccounts] = useState([])
  const [fondsFiltrés, setFondsFiltrés] = useState([])
  const [loading, setLoading]           = useState(false)
  const [noteDismissed, setNoteDismissed] = useState(
    () => note ? sessionStorage.getItem('note_dismissed') === note : true
  )
  const [savingMap, setSavingMap]       = useState({})
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [imagesModal, setImagesModal]   = useState(null)
  const [addingImages, setAddingImages] = useState(false)
  const [panelOpen, setPanelOpen]       = useState(true)
  const [tasksCollapsed, setTasksCollapsed] = useState(false)

  // Ghost row draft
  const [draft, setDraft] = useState({
    lien_shein: '', fond_id: '', taille: '', prix_shein: '', statut: 'en_cours', files: []
  })
  const [draftSaving, setDraftSaving] = useState(false)

  useEffect(() => { fetchAll() }, [userId])

  async function fetchAll() {
    setLoading(true)
    const [
      { data: itemsData },
      { data: tasksData },
      { data: fondsData },
      { data: employeComptesData },
      { data: fcData },
      { data: vaData },
    ] = await Promise.all([
      supabase.from('work_items').select('*').eq('employe_id', userId).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('employe_id', userId).order('created_at', { ascending: false }),
      supabase.from('fonds').select('*').order('nom', { ascending: true }),
      supabase.from('employe_comptes').select('compte_vinted_id').eq('employe_id', userId),
      supabase.from('fond_comptes').select('*'),
      supabase.from('vinted_accounts').select('id, pseudo'),
    ])
    if (itemsData) setItems(itemsData)
    if (tasksData) setTasks(tasksData)
    if (fcData)    setFondComptes(fcData)
    if (vaData)    setVintedAccounts(vaData)
    if (fondsData) {
      const assignedIds = new Set(employeComptesData?.map(ec => ec.compte_vinted_id) ?? [])
      setFondsFiltrés(
        assignedIds.size > 0
          ? fondsData.filter(fond => {
              const fondCIds = fcData?.filter(fc => fc.fond_id === fond.id).map(fc => fc.compte_vinted_id) ?? []
              return fondCIds.some(cId => assignedIds.has(cId))
            })
          : []
      )
    }
    setLoading(false)
  }

  // Map fond id → fond object pour accès O(1)
  const fondById = Object.fromEntries(fondsFiltrés.map(f => [f.id, f]))

  async function saveField(itemId, field, value) {
    setSavingMap(prev => ({ ...prev, [itemId]: 'saving' }))
    const update = field === 'prix_shein'
      ? { [field]: value === '' || value === null ? null : parseFloat(value) }
      : { [field]: value === '' ? null : value }
    const { data, error } = await supabase
      .from('work_items').update(update).eq('id', itemId).select().single()
    if (!error && data) {
      setItems(prev => prev.map(i => i.id === data.id ? data : i))
      setSavingMap(prev => ({ ...prev, [itemId]: 'saved' }))
      setTimeout(() => setSavingMap(prev => { const n = { ...prev }; delete n[itemId]; return n }), 1500)
    } else {
      setSavingMap(prev => { const n = { ...prev }; delete n[itemId]; return n })
    }
  }

  async function saveDraft() {
    if (!draft.lien_shein.trim()) return
    setDraftSaving(true)
    try {
      const uploadedUrls = []
      for (let i = 0; i < (draft.files ?? []).length; i++) {
        const file = draft.files[i]
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
          lien_shein:  draft.lien_shein.trim(),
          fond_id:     draft.fond_id || null,
          taille:      draft.taille || null,
          prix_shein:  draft.prix_shein ? parseFloat(draft.prix_shein) : null,
          statut:      draft.statut,
          images_urls: uploadedUrls,
          categorie:   null,
        })
        .select()
        .single()
      if (!error && data) {
        setItems(prev => [data, ...prev])
        setDraft({ lien_shein: '', fond_id: '', taille: '', prix_shein: '', statut: 'en_cours', files: [] })
      }
    } finally {
      setDraftSaving(false)
    }
  }

  async function handleDelete(itemId) {
    const { error } = await supabase.from('work_items').delete().eq('id', itemId)
    if (!error) { setItems(prev => prev.filter(i => i.id !== itemId)); setDeleteConfirm(null) }
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

  async function handleDownloadFond(fond) {
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
      document.body.appendChild(a); a.click()
      document.body.removeChild(a); URL.revokeObjectURL(url)
    } catch {
      window.open(fond.image_url, '_blank')
    }
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

  // Stats
  const todayStr    = new Date().toISOString().slice(0, 10)
  const todayCount  = items.filter(i => i.created_at.slice(0, 10) === todayStr).length
  const weekCount   = items.filter(i => i.created_at >= startOfWeek()).length
  const validCount  = items.filter(i => i.admin_status === 'valide').length
  const refuseCount = items.filter(i => i.admin_status === 'refuse').length

  const activeTasks = tasks.filter(t => t.statut !== 'termine')

  return (
    <div style={{ height: 'calc(100vh - 56px)' }} className="flex flex-col bg-white">

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
        &nbsp;·&nbsp;✓ Validés&nbsp;:&nbsp;<span className="font-medium text-green-600">{validCount}</span>
        &nbsp;·&nbsp;✗ Refusés&nbsp;:&nbsp;<span className="font-medium text-red-500">{refuseCount}</span>
      </div>

      {/* Tasks section */}
      {activeTasks.length > 0 && (
        <div className="bg-orange-50 border-b border-orange-100 shrink-0">
          <button
            onClick={() => setTasksCollapsed(c => !c)}
            className="w-full px-4 py-1.5 text-xs font-semibold text-orange-700 text-left flex items-center gap-1.5 hover:bg-orange-100/50 transition-colors"
          >
            <span className={`transition-transform ${tasksCollapsed ? '' : 'rotate-90'}`}>▶</span>
            Tâches assignées ({activeTasks.length})
          </button>
          {!tasksCollapsed && (
            <div className="px-4 pb-2 space-y-1">
              {activeTasks.map(task => {
                const fond  = fondsFiltrés.find(f => f.id === task.fond_id)
                const badge = taskStatutBadge(task.statut)
                return (
                  <div key={task.id} className="flex items-center gap-2 py-0.5">
                    {fond?.image_url ? (
                      <img src={fond.image_url} alt={fond.nom} className="w-8 h-8 rounded object-cover border border-orange-200 shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-orange-100 shrink-0" />
                    )}
                    <span className="text-xs font-medium text-orange-800 shrink-0 max-w-[80px] truncate">{fond?.nom ?? '—'}</span>
                    <a
                      href={task.lien_shein}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-teal-600 hover:underline truncate flex-1 min-w-0"
                    >
                      {task.lien_shein?.replace(/^https?:\/\//, '').slice(0, 40)}
                    </a>
                    {task.message && (
                      <span className="text-xs text-gray-500 italic truncate max-w-[120px] shrink-0">{task.message}</span>
                    )}
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badge.cls}`}>{badge.label}</span>
                    {task.statut === 'assignee' && (
                      <button
                        onClick={() => handleTaskAction(task, 'en_cours')}
                        className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition-colors shrink-0"
                      >Prendre en charge</button>
                    )}
                    {task.statut === 'en_cours' && (
                      <button
                        onClick={() => handleTaskAction(task, 'termine')}
                        className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500 text-white hover:bg-green-600 transition-colors shrink-0"
                      >Terminée</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Zone principale */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Spinner className="w-4 h-4" /> Chargement…
            </div>
          ) : (
            <table className="w-full text-xs border-collapse" style={{ minWidth: '900px' }}>
              <thead className="bg-gray-50 sticky top-0 z-10 border-b-2 border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 w-56">Lien Shein</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 w-44">Fond</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 w-16">Taille</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 w-20">Prix</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 w-20">Images</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 w-32">Statut</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 w-24">Validation</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 w-24">Date</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    idx={idx}
                    fondsFiltrés={fondsFiltrés}
                    fondById={fondById}
                    saveField={saveField}
                    savingMap={savingMap}
                    onOpenImages={setImagesModal}
                    onDelete={setDeleteConfirm}
                  />
                ))}
                <GhostRow
                  draft={draft}
                  setDraft={setDraft}
                  fondsFiltrés={fondsFiltrés}
                  onSave={saveDraft}
                  saving={draftSaving}
                />
              </tbody>
            </table>
          )}
        </div>

        {/* Bouton toggle panneau */}
        <button
          onClick={() => setPanelOpen(o => !o)}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-14 bg-white border border-r-0 border-gray-200 rounded-l-lg flex items-center justify-center text-gray-400 hover:text-gray-700 shadow-sm z-20"
          title={panelOpen ? 'Fermer le panneau' : 'Voir mes fonds'}
        >
          <svg
            className={`w-3 h-3 transition-transform ${panelOpen ? 'rotate-0' : 'rotate-180'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Panneau fonds */}
        {panelOpen && (
          <div className="w-64 border-l border-gray-200 bg-white overflow-y-auto shrink-0">
            <div className="px-3 py-2 border-b border-gray-100 text-xs font-semibold text-gray-600">
              Mes fonds ({fondsFiltrés.length})
            </div>
            <div className="p-2 space-y-2">
              {fondsFiltrés.map(fond => {
                const cIds   = fondComptes.filter(fc => fc.fond_id === fond.id).map(fc => fc.compte_vinted_id)
                const pseudos = vintedAccounts.filter(v => cIds.includes(v.id)).map(v => v.pseudo)
                return (
                  <div key={fond.id} className="flex items-start gap-2 p-2 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                    <img
                      src={fond.image_url}
                      alt={fond.nom}
                      className="w-12 h-12 rounded-lg object-cover border border-gray-200 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-800 truncate">{fond.nom}</div>
                      {pseudos.length > 0 && (
                        <div className="text-[10px] text-gray-500 truncate mt-0.5">{pseudos.join(' · ')}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDownloadFond(fond)}
                      className="p-1 text-gray-400 hover:text-teal-600 transition-colors shrink-0 mt-1"
                      title="Télécharger"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                  </div>
                )
              })}
              {fondsFiltrés.length === 0 && (
                <p className="text-xs text-gray-400 italic text-center py-4">Aucun fond assigné.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirm suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer l'article ?</h3>
            <p className="text-sm text-gray-500 mb-5">Cette action est irréversible.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >Annuler</button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-red-600"
              >Supprimer</button>
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
    </div>
  )
}
