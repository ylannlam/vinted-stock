import { useState } from 'react'

const EMPTY = {
  nom: '',
  adresse: '',
  port: '',
  username: '',
  password: '',
  fournisseur: '',
  notes: '',
}

export default function ProxyFormModal({ proxy, onClose, onSave }) {
  const [form, setForm] = useState(proxy ? { ...EMPTY, ...proxy, port: proxy.port ?? '' } : { ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.adresse.trim() || !form.port || !form.username.trim() || !form.password) return
    setSaving(true)
    await onSave({ ...form, port: parseInt(form.port, 10) })
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-semibold text-gray-900">{proxy ? 'Modifier le proxy' : 'Ajouter un proxy'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Nom</label>
              <input value={form.nom ?? ''} onChange={e => set('nom', e.target.value)}
                placeholder="ISP Decodo Lyon"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Fournisseur</label>
              <input value={form.fournisseur ?? ''} onChange={e => set('fournisseur', e.target.value)}
                placeholder="Decodo"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Adresse *</label>
              <input value={form.adresse} onChange={e => set('adresse', e.target.value)}
                placeholder="isp.decodo.com" required
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-teal-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Port *</label>
              <input value={form.port} onChange={e => set('port', e.target.value.replace(/\D/g, ''))}
                placeholder="10001" inputMode="numeric" required
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-teal-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Username *</label>
              <input value={form.username} onChange={e => set('username', e.target.value)}
                placeholder="user" required
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-teal-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Password *</label>
              <div className="relative">
                <input value={form.password} onChange={e => set('password', e.target.value)}
                  type={showPassword ? 'text' : 'password'} placeholder="••••••••" required
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-teal-400 pr-9" />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword
                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Notes</label>
            <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)}
              placeholder="Informations supplémentaires…" rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
          </div>

          <button type="submit"
            disabled={saving || !form.adresse.trim() || !form.port || !form.username.trim() || !form.password}
            className="w-full py-3 bg-teal-500 text-white rounded-xl font-semibold text-sm hover:bg-teal-600 disabled:opacity-50 transition-colors">
            {saving ? 'Enregistrement…' : proxy ? 'Enregistrer' : 'Ajouter le proxy'}
          </button>
        </form>
      </div>
    </div>
  )
}
