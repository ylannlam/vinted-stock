import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import UserManagementModal from './UserManagementModal'

const ROLE_CONFIG = {
  employe: { label: 'Employé', color: 'text-purple-600 bg-purple-100' },
  stock:   { label: 'Stock',   color: 'text-orange-600 bg-orange-100' },
  admin:   { label: 'Admin',   color: 'text-teal-600 bg-teal-100' },
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function EmployeesTab() {
  const [profiles, setProfiles] = useState([])
  const [workItems, setWorkItems] = useState([]) // all work_items for stats
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [expanded, setExpanded] = useState({}) // userId -> bool

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const [{ data: profilesData }, { data: workData }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: true }),
      supabase.from('work_items').select('*').order('created_at', { ascending: false }),
    ])
    if (profilesData) setProfiles(profilesData)
    if (workData) setWorkItems(workData)
    setLoading(false)
  }

  function statsForUser(userId) {
    const userItems = workItems.filter(i => i.employe_id === userId)
    const today = userItems.filter(i => i.created_at >= startOfToday()).length
    const week  = userItems.filter(i => i.created_at >= startOfWeek()).length
    return { today, week, all: userItems }
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
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Erreur lors de la suppression')
      }
      setProfiles(prev => prev.filter(p => p.id !== userId))
      setWorkItems(prev => prev.filter(i => i.employe_id !== userId))
      setDeleteConfirm(null)
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  function handleSaved(updatedProfile) {
    setProfiles(prev => {
      const exists = prev.find(p => p.id === updatedProfile.id)
      if (exists) return prev.map(p => p.id === updatedProfile.id ? { ...p, ...updatedProfile } : p)
      return [...prev, updatedProfile]
    })
    setShowModal(false)
    setEditUser(null)
  }

  function toggleExpand(userId) {
    setExpanded(prev => ({ ...prev, [userId]: !prev[userId] }))
  }

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
      {/* Header row */}
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
        <div className="text-center py-12 text-gray-400 text-sm">Aucun utilisateur trouvé.</div>
      )}

      <div className="space-y-3">
        {profiles.map(profile => {
          const roleCfg = ROLE_CONFIG[profile.role] ?? { label: profile.role, color: 'bg-gray-100 text-gray-600' }
          const isEmploye = profile.role === 'employe'
          const stats = isEmploye ? statsForUser(profile.id) : null
          const isExp = expanded[profile.id] ?? false

          return (
            <div key={profile.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{profile.pseudo}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${roleCfg.color}`}>
                        {roleCfg.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{profile.email}</div>
                    {isEmploye && stats && (
                      <div className="text-xs text-gray-500 mt-1">
                        Aujourd'hui: <span className="font-semibold text-gray-700">{stats.today}</span> articles
                        {' | '}
                        Cette semaine: <span className="font-semibold text-gray-700">{stats.week}</span> articles
                      </div>
                    )}
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Créé le {new Date(profile.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isEmploye && (
                      <button
                        onClick={() => toggleExpand(profile.id)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
                        aria-label={isExp ? 'Réduire' : 'Voir les articles'}
                      >
                        <svg className={`w-4 h-4 transition-transform ${isExp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => { setEditUser(profile); setShowModal(true) }}
                      className="p-1.5 text-gray-400 hover:text-teal-600 transition-colors"
                      aria-label="Modifier"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { setDeleteConfirm(profile.id); setDeleteError('') }}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      aria-label="Supprimer"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Expandable work items */}
              {isEmploye && isExp && stats && (
                <div className="border-t border-gray-100 px-4 pb-3 pt-3">
                  {stats.all.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Aucun article enregistré.</p>
                  ) : (
                    <div className="space-y-2">
                      {stats.all.slice(0, 20).map(wi => (
                        <div key={wi.id} className="flex items-center gap-2 text-xs">
                          <a
                            href={wi.lien_shein}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-600 hover:underline truncate max-w-[160px]"
                          >
                            {wi.lien_shein}
                          </a>
                          <span className="text-gray-400 shrink-0">{wi.categorie}</span>
                          {wi.taille && <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full shrink-0">{wi.taille}</span>}
                          <span className={`px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${
                            wi.statut === 'en_cours' ? 'bg-gray-100 text-gray-600' :
                            wi.statut === 'image_faite' ? 'bg-blue-100 text-blue-600' :
                            'bg-green-100 text-green-600'
                          }`}>
                            {wi.statut === 'en_cours' ? 'En cours' : wi.statut === 'image_faite' ? 'Image faite' : 'Importé DOTB'}
                          </span>
                        </div>
                      ))}
                      {stats.all.length > 20 && (
                        <p className="text-xs text-gray-400 italic">+ {stats.all.length - 20} articles supplémentaires</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">Supprimer ce compte ?</h3>
            <p className="text-sm text-gray-500 mb-2">Cette action supprimera définitivement le compte et tous ses articles.</p>
            {deleteError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5 mb-3">{deleteError}</div>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setDeleteConfirm(null); setDeleteError('') }}
                disabled={deleting}
                className="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
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
