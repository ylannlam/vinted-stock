import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import UserManagementModal from './UserManagementModal'
import TaskAssignModal from './TaskAssignModal'

const ROLE_CONFIG = {
  employe: { label: 'Employé', color: 'text-purple-600 bg-purple-100' },
  stock:   { label: 'Stock',   color: 'text-orange-600 bg-orange-100' },
  admin:   { label: 'Admin',   color: 'text-teal-600 bg-teal-100' },
}

const STATUT_LABELS = {
  en_cours:     'En cours',
  image_faite:  'Images faites',
  importe_dotb: 'Posté sur Vinted',
}

const TASK_STATUT_LABELS = {
  assignee: 'Assignée',
  en_cours: 'En cours',
  termine:  'Terminée',
}

function taskBadgeCls(s) {
  if (s === 'assignee') return 'bg-orange-100 text-orange-600'
  if (s === 'en_cours') return 'bg-blue-100 text-blue-600'
  return 'bg-green-100 text-green-700'
}

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function EmployeesTab() {
  const [profiles, setProfiles]           = useState([])
  const [workItems, setWorkItems]         = useState([])
  const [tasks, setTasks]                 = useState([])
  const [fonds, setFonds]                 = useState([])
  const [fondComptes, setFondComptes]     = useState([])
  const [vintedAccounts, setVintedAccounts] = useState([])
  const [employeComptes, setEmployeComptes] = useState([])
  const [loading, setLoading]             = useState(false)
  const [showModal, setShowModal]         = useState(false)
  const [editUser, setEditUser]           = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting]           = useState(false)
  const [deleteError, setDeleteError]     = useState('')
  const [selected, setSelected]           = useState(null)
  const [noteInputs, setNoteInputs]       = useState({})
  const [savingNote, setSavingNote]       = useState({})
  const [showTaskModal, setShowTaskModal] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [
      { data: p },
      { data: w },
      { data: t },
      { data: f },
      { data: va },
      { data: ec },
      { data: fc },
    ] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: true }),
      supabase.from('work_items').select('*').order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('fonds').select('*').order('nom', { ascending: true }),
      supabase.from('vinted_accounts').select('id, pseudo, statut').order('pseudo', { ascending: true }),
      supabase.from('employe_comptes').select('*'),
      supabase.from('fond_comptes').select('*'),
    ])
    if (p) {
      setProfiles(p)
      const notes = {}
      p.forEach(x => { notes[x.id] = x.note_admin ?? '' })
      setNoteInputs(notes)
    }
    if (w) setWorkItems(w)
    if (t) setTasks(t)
    if (f) setFonds(f)
    if (va) setVintedAccounts(va)
    if (ec) setEmployeComptes(ec)
    if (fc) setFondComptes(fc)
    setLoading(false)
  }

  async function toggleCompte(employeId, compteId, isAssigned) {
    if (isAssigned) {
      await supabase.from('employe_comptes')
        .delete()
        .eq('employe_id', employeId)
        .eq('compte_vinted_id', compteId)
      setEmployeComptes(prev => prev.filter(ec => !(ec.employe_id === employeId && ec.compte_vinted_id === compteId)))
    } else {
      const { data } = await supabase.from('employe_comptes')
        .insert({ employe_id: employeId, compte_vinted_id: compteId })
        .select().single()
      if (data) setEmployeComptes(prev => [...prev, data])
    }
  }

  function statsFor(userId) {
    const list = workItems.filter(i => i.employe_id === userId)
    const todayStr = new Date().toISOString().slice(0, 10)
    return {
      today:     list.filter(i => i.created_at.slice(0, 10) === todayStr).length,
      week:      list.filter(i => i.created_at >= startOfWeek()).length,
      validated: list.filter(i => i.admin_status === 'valide').length,
      refused:   list.filter(i => i.admin_status === 'refuse').length,
      all:       list,
    }
  }

  async function handleDelete(userId) {
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch('/api/delete-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Erreur') }
      setProfiles(prev => prev.filter(p => p.id !== userId))
      setWorkItems(prev => prev.filter(i => i.employe_id !== userId))
      setTasks(prev => prev.filter(t => t.employe_id !== userId))
      setDeleteConfirm(null)
      if (selected?.id === userId) setSelected(null)
    } catch (err) { setDeleteError(err.message) }
    finally { setDeleting(false) }
  }

  function handleSaved(updated) {
    setProfiles(prev => {
      const exists = prev.find(p => p.id === updated.id)
      if (exists) return prev.map(p => p.id === updated.id ? { ...p, ...updated } : p)
      return [...prev, updated]
    })
    if (selected?.id === updated.id) setSelected(prev => ({ ...prev, ...updated }))
    setShowModal(false)
    setEditUser(null)
  }

  async function handleSetAdminStatus(itemId, status) {
    const { data, error } = await supabase
      .from('work_items').update({ admin_status: status }).eq('id', itemId).select().single()
    if (!error && data) setWorkItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleSaveNote(userId) {
    setSavingNote(prev => ({ ...prev, [userId]: true }))
    const note = noteInputs[userId] ?? ''
    const { error } = await supabase
      .from('profiles').update({ note_admin: note || null }).eq('id', userId)
    if (!error) {
      setProfiles(prev => prev.map(p => p.id === userId ? { ...p, note_admin: note || null } : p))
      if (selected?.id === userId) setSelected(prev => ({ ...prev, note_admin: note || null }))
    }
    setSavingNote(prev => ({ ...prev, [userId]: false }))
  }

  // ── Vue détail employé ───────────────────────────────────────
  if (selected) {
    const stats        = statsFor(selected.id)
    const employeTasks = tasks.filter(t => t.employe_id === selected.id)

    return (
      <div className="p-4 max-w-2xl mx-auto">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Retour
        </button>

        {/* Carte employé */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 text-base">{selected.pseudo}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_CONFIG[selected.role]?.color}`}>
                  {ROLE_CONFIG[selected.role]?.label}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{selected.email}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTaskModal(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-orange-500 text-white hover:bg-orange-600 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Assigner une tâche
              </button>
              <button
                onClick={() => { setEditUser(selected); setShowModal(true) }}
                className="p-1.5 text-gray-400 hover:text-teal-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              { v: stats.today,     l: "Aujourd'hui", c: 'text-teal-600' },
              { v: stats.week,      l: 'Cette semaine', c: 'text-teal-600' },
              { v: stats.validated, l: 'Validés',   c: 'text-green-600' },
              { v: stats.refused,   l: 'Refusés',   c: 'text-red-500' },
            ].map(s => (
              <div key={s.l} className="bg-gray-50 rounded-xl p-2 text-center">
                <div className={`text-lg font-bold ${s.c}`}>{s.v}</div>
                <div className="text-[10px] text-gray-500 leading-tight">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Message pour l'employé */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <h3 className="text-sm font-bold text-gray-900 mb-2">Message pour {selected.pseudo}</h3>
          <textarea
            value={noteInputs[selected.id] ?? ''}
            onChange={e => setNoteInputs(prev => ({ ...prev, [selected.id]: e.target.value }))}
            placeholder="Écris un message visible par l'employé à sa prochaine connexion..."
            rows={3}
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition resize-none"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={() => handleSaveNote(selected.id)}
              disabled={savingNote[selected.id]}
              className="px-4 py-1.5 bg-teal-500 text-white rounded-xl text-sm font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors"
            >
              {savingNote[selected.id] ? 'Envoi...' : 'Envoyer'}
            </button>
          </div>
        </div>

        {/* Comptes autorisés */}
        {selected.role === 'employe' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Comptes Vinted autorisés</h3>
            {vintedAccounts.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Aucun compte Vinted enregistré.</p>
            ) : (
              <div className="space-y-2">
                {vintedAccounts.map(compte => {
                  const isAssigned = employeComptes.some(
                    ec => ec.employe_id === selected.id && ec.compte_vinted_id === compte.id
                  )
                  return (
                    <label key={compte.id} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isAssigned}
                        onChange={() => toggleCompte(selected.id, compte.id, isAssigned)}
                        className="w-4 h-4 accent-teal-500 rounded"
                      />
                      <span className="text-sm text-gray-800 font-medium">{compte.pseudo}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        compte.statut === 'actif' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>{compte.statut}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Section Tâches */}
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-bold text-gray-900">Tâches</h3>
          <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">{employeTasks.length}</span>
        </div>

        {employeTasks.length === 0 ? (
          <p className="text-sm text-gray-400 italic mb-5">Aucune tâche assignée.</p>
        ) : (
          <div className="space-y-2 mb-5">
            {employeTasks.map(task => {
              const fond = fonds.find(f => f.id === task.fond_id)
              return (
                <div key={task.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
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
                        <>
                          <div className="text-xs font-semibold text-gray-700">{fond.nom}</div>
                          {(() => {
                            const ps = fondComptes.filter(fc => fc.fond_id === fond.id)
                              .map(fc => vintedAccounts.find(v => v.id === fc.compte_vinted_id)?.pseudo).filter(Boolean)
                            return ps.length > 0
                              ? <div className="text-xs text-gray-400 mb-0.5">{ps.join(' · ')}</div>
                              : null
                          })()}
                        </>
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
                      <div className="mt-1.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${taskBadgeCls(task.statut)}`}>
                          {TASK_STATUT_LABELS[task.statut]}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Section Articles soumis — groupés par compte Vinted */}
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-bold text-gray-900">Articles soumis</h3>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{stats.all.length}</span>
        </div>

        {stats.all.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Aucun article soumis.</p>
        ) : (() => {
          // Grouper par compte_vinted_id
          const grouped = {}
          stats.all.forEach(item => {
            const key = item.compte_vinted_id ?? '__none__'
            if (!grouped[key]) grouped[key] = []
            grouped[key].push(item)
          })
          const usedAccountIds = [...new Set(stats.all.map(i => i.compte_vinted_id).filter(Boolean))]
          const orderedAccounts = vintedAccounts.filter(v => usedAccountIds.includes(v.id))
          const noneItems = grouped['__none__'] ?? []

          const renderItem = (item) => {
            const fond = fonds.find(f => f.id === item.fond_id)
            return (
              <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
                <div className="flex items-start gap-3">
                  {fond && (
                    <img src={fond.image_url} alt={fond.nom}
                      className="w-12 h-12 rounded-xl object-cover border border-gray-200 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    {fond && (
                      <div className="text-xs text-gray-500 mb-0.5 font-medium">{fond.nom}</div>
                    )}
                    <a href={item.lien_shein} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-teal-600 hover:underline block truncate">
                      {item.lien_shein}
                    </a>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {item.taille && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{item.taille}</span>
                      )}
                      {item.prix_shein != null && (
                        <span className="text-xs text-gray-600 font-medium">{parseFloat(item.prix_shein).toFixed(2)} €</span>
                      )}
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        item.statut === 'en_cours'    ? 'bg-gray-100 text-gray-600' :
                        item.statut === 'image_faite' ? 'bg-blue-100 text-blue-600' :
                                                        'bg-green-100 text-green-600'
                      }`}>{STATUT_LABELS[item.statut]}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(item.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {Array.isArray(item.images_urls) && item.images_urls.length > 0 && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {item.images_urls.slice(0, 4).map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200 hover:opacity-80" />
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="mt-1.5">
                      {item.admin_status === 'valide' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ Validé</span>}
                      {item.admin_status === 'refuse' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">✗ Refusé</span>}
                      {(!item.admin_status || item.admin_status === 'en_attente') && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">· En attente</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleSetAdminStatus(item.id, item.admin_status === 'valide' ? 'en_attente' : 'valide')}
                      title="Valider"
                      className={`p-1.5 rounded-lg transition-colors ${item.admin_status === 'valide' ? 'bg-green-100 text-green-600' : 'text-gray-400 hover:bg-green-50 hover:text-green-600'}`}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button onClick={() => handleSetAdminStatus(item.id, item.admin_status === 'refuse' ? 'en_attente' : 'refuse')}
                      title="Refuser"
                      className={`p-1.5 rounded-lg transition-colors ${item.admin_status === 'refuse' ? 'bg-red-100 text-red-500' : 'text-gray-400 hover:bg-red-50 hover:text-red-500'}`}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div className="space-y-4">
              {orderedAccounts.map(compte => (
                <div key={compte.id}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-xs font-bold text-gray-700">{compte.pseudo}</span>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{grouped[compte.id]?.length ?? 0}</span>
                  </div>
                  <div className="space-y-2">{(grouped[compte.id] ?? []).map(renderItem)}</div>
                </div>
              ))}
              {noneItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-xs font-bold text-gray-400 italic">Sans compte assigné</span>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{noneItems.length}</span>
                  </div>
                  <div className="space-y-2">{noneItems.map(renderItem)}</div>
                </div>
              )}
            </div>
          )
        })()}

        {showModal && (
          <UserManagementModal
            user={editUser}
            onClose={() => { setShowModal(false); setEditUser(null) }}
            onSaved={handleSaved}
          />
        )}

        {showTaskModal && (
          <TaskAssignModal
            employe={selected}
            fonds={fonds}
            onClose={() => setShowTaskModal(false)}
            onCreated={task => {
              setTasks(prev => [task, ...prev])
              setShowTaskModal(false)
            }}
          />
        )}
      </div>
    )
  }

  // ── Vue liste ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <svg className="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Chargement...
      </div>
    )
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-bold text-gray-900">Employés</h2>
        <button
          onClick={() => { setEditUser(null); setShowModal(true) }}
          className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl bg-teal-500 text-white hover:bg-teal-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Ajouter un compte
        </button>
      </div>

      {profiles.length === 0 && (
        <p className="text-center py-12 text-gray-400 text-sm">Aucun utilisateur trouvé.</p>
      )}

      <div className="space-y-3">
        {profiles.map(profile => {
          const roleCfg   = ROLE_CONFIG[profile.role] ?? { label: profile.role, color: 'bg-gray-100 text-gray-600' }
          const isEmploye = profile.role === 'employe'
          const stats     = isEmploye ? statsFor(profile.id) : null

          return (
            <div key={profile.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`flex-1 min-w-0 ${isEmploye ? 'cursor-pointer' : ''}`}
                    onClick={() => isEmploye && setSelected(profile)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{profile.pseudo}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${roleCfg.color}`}>{roleCfg.label}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{profile.email}</div>
                    {isEmploye && stats && (
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="text-xs text-gray-500">Aujourd'hui : <b className="text-gray-700">{stats.today}</b></span>
                        <span className="text-xs text-gray-500">Semaine : <b className="text-gray-700">{stats.week}</b></span>
                        <span className="text-xs text-green-600 font-semibold">{stats.validated} ✓</span>
                        {stats.refused > 0 && <span className="text-xs text-red-500 font-semibold">{stats.refused} ✗</span>}
                      </div>
                    )}
                    {isEmploye && (
                      <div className="text-xs text-teal-500 mt-1.5">Voir les articles →</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditUser(profile); setShowModal(true) }}
                      className="p-1.5 text-gray-400 hover:text-teal-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { setDeleteConfirm(profile.id); setDeleteError('') }}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
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
        })}
      </div>

      {/* Confirm suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer ce compte ?</h3>
            <p className="text-sm text-gray-500 mb-2">Cette action supprimera définitivement le compte et tous ses articles.</p>
            {deleteError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5 mb-3">{deleteError}</div>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setDeleteConfirm(null); setDeleteError('') }} disabled={deleting}
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

      {showModal && (
        <UserManagementModal
          user={editUser}
          onClose={() => { setShowModal(false); setEditUser(null) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
