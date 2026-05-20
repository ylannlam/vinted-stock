import { useState } from 'react'

const ROLE_OPTIONS = [
  { value: 'employe', label: 'Employé' },
  { value: 'stock',   label: 'Stock' },
  { value: 'admin',   label: 'Admin' },
]

function generateEmail(pseudo) {
  const slug = pseudo.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'
  const rand = Math.random().toString(36).slice(2, 6)
  return `${slug}_${rand}@vinted-stock.app`
}

function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function UserManagementModal({ user, onClose, onSaved }) {
  const isEdit = !!user
  const [pseudo, setPseudo]   = useState(user?.pseudo ?? '')
  const [email, setEmail]     = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole]       = useState(user?.role ?? 'employe')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [createdCredentials, setCreatedCredentials] = useState(null)
  const [copied, setCopied]   = useState(false)

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
        const autoEmail    = generateEmail(pseudo)
        const autoPassword = generatePassword()
        const res = await fetch('/api/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: autoEmail, password: autoPassword, pseudo, role }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Erreur lors de la création')
        setCreatedCredentials({ email: autoEmail, password: autoPassword, saved: data })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    const text = `Identifiants de connexion :\nEmail : ${createdCredentials.email}\nMot de passe : ${createdCredentials.password}`
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  if (createdCredentials) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
        <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Compte créé !</p>
              <p className="text-xs text-gray-500">Communique ces identifiants à <strong>{pseudo}</strong></p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Email</p>
              <p className="text-sm font-mono text-gray-800 break-all">{createdCredentials.email}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Mot de passe</p>
              <p className="text-lg font-mono font-bold text-gray-900 tracking-widest">{createdCredentials.password}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCopy}
              className={`flex-1 border rounded-xl py-2.5 text-sm font-medium transition-colors ${
                copied ? 'bg-teal-50 border-teal-200 text-teal-600' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {copied ? '✓ Copié !' : 'Copier les identifiants'}
            </button>
            <button
              onClick={() => { onSaved(createdCredentials.saved) }}
              className="flex-1 bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 transition-colors"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    )
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
              autoFocus
              placeholder="Prénom ou pseudo"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
            />
            {!isEdit && pseudo && (
              <p className="text-xs text-gray-400 mt-1">
                Email généré automatiquement — l'employé n'en a pas besoin
              </p>
            )}
          </div>

          {isEdit && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nouveau mot de passe</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Laisser vide pour ne pas changer"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Rôle</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition bg-white">
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors">
              {loading ? 'Création…' : (isEdit ? 'Modifier' : 'Créer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
