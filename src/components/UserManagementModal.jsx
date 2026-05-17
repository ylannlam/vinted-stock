import { useState } from 'react'

const ROLE_OPTIONS = [
  { value: 'employe', label: 'Employé' },
  { value: 'stock',   label: 'Stock' },
  { value: 'admin',   label: 'Admin' },
]

export default function UserManagementModal({ user, onClose, onSaved }) {
  const isEdit = !!user
  const [pseudo, setPseudo]     = useState(user?.pseudo ?? '')
  const [email, setEmail]       = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole]         = useState(user?.role ?? 'employe')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (isEdit) {
        const body = { userId: user.id, pseudo, role, email }
        if (password) body.password = password
        const res = await fetch('/api/update-user', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? 'Erreur lors de la mise à jour')
        }
        onSaved({ ...user, pseudo, email, role })
      } else {
        if (!password) { setError('Le mot de passe est requis'); setLoading(false); return }
        const res = await fetch('/api/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, pseudo, role }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Erreur lors de la création')
        onSaved(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{isEdit ? 'Modifier le compte' : 'Créer un compte'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Pseudo</label>
            <input
              type="text"
              value={pseudo}
              onChange={e => setPseudo(e.target.value)}
              required
              placeholder="Nom d'affichage"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="email@exemple.com"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required={!isEdit}
              placeholder={isEdit ? 'Laisser vide pour ne pas changer' : 'Mot de passe'}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Rôle</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white"
            >
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>
          )}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Enregistrement...' : (isEdit ? 'Modifier' : 'Créer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
