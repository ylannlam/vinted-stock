import { useState } from 'react'

const EMPTY = {
  ads_power_num: '',
  pseudo: '',
  email: '',
  password: '',
  methode_connexion: 'email',
  telephone: '',
  telephone_type: 'onoff',
  telephone_email: '',
  statut: 'actif',
  deban_at: '',
  notes: '',
  proxy_id: '',
}

export default function AccountFormModal({ account, proxies = [], onClose, onSave, onCreateProxy }) {
  const [form, setForm] = useState(account ? { ...account, proxy_id: account.proxy_id ?? '' } : { ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showDetails, setShowDetails] = useState(!!account)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.pseudo.trim()) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-semibold text-gray-900">{account ? 'Modifier le compte' : 'Ajouter un compte'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Pseudo — toujours visible */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">N° AdsPower</label>
              <input
                value={form.ads_power_num}
                onChange={e => set('ads_power_num', e.target.value.replace(/\D/g, ''))}
                placeholder="01"
                inputMode="numeric"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono text-center focus:outline-none focus:border-teal-400"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Pseudo *</label>
              <input
                autoFocus
                value={form.pseudo}
                onChange={e => set('pseudo', e.target.value)}
                placeholder="@pseudo_vinted"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400"
                required
              />
            </div>
          </div>

          {/* Accordéon détails */}
          {!showDetails && !account && (
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="w-full py-2 border border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-teal-500 hover:border-teal-300 transition-colors"
            >
              + Ajouter les détails (email, mot de passe, téléphone…)
            </button>
          )}

          {showDetails && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Email</label>
                  <input value={form.email} onChange={e => set('email', e.target.value)} type="email"
                    placeholder="email@example.com"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Mot de passe</label>
                  <div className="relative">
                    <input value={form.password} onChange={e => set('password', e.target.value)}
                      type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 pr-9" />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPassword
                        ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      }
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Méthode de connexion</label>
                <div className="flex gap-2">
                  {['email', 'google', 'apple'].map(m => (
                    <button key={m} type="button" onClick={() => set('methode_connexion', m)}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors capitalize ${form.methode_connexion === m ? 'bg-teal-500 text-white border-teal-500' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Téléphone</label>
                  <input value={form.telephone} onChange={e => set('telephone', e.target.value)}
                    placeholder="+33 6 00 00 00 00"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Type</label>
                  <div className="flex gap-2 h-[42px]">
                    {['onoff', 'autre'].map(t => (
                      <button key={t} type="button" onClick={() => set('telephone_type', t)}
                        className={`flex-1 rounded-xl text-sm font-medium border transition-colors capitalize ${form.telephone_type === t ? 'bg-teal-500 text-white border-teal-500' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {form.telephone_type === 'onoff' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Email du compte OnOff</label>
                  <input value={form.telephone_email} onChange={e => set('telephone_email', e.target.value)}
                    type="email" placeholder="email@onoff.app"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Statut</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'actif',      label: 'Actif',       color: 'bg-green-50 text-green-700 border-green-200',   active: 'bg-green-500 text-white border-green-500' },
                    { value: 'banni_temp', label: 'Banni temp.', color: 'bg-orange-50 text-orange-700 border-orange-200', active: 'bg-orange-500 text-white border-orange-500' },
                    { value: 'banni_def',  label: 'Banni déf.',  color: 'bg-red-50 text-red-700 border-red-200',         active: 'bg-red-500 text-white border-red-500' },
                    { value: 'suspendu',   label: 'Suspendu',    color: 'bg-gray-50 text-gray-600 border-gray-200',      active: 'bg-gray-500 text-white border-gray-500' },
                  ].map(s => (
                    <button key={s.value} type="button" onClick={() => set('statut', s.value)}
                      className={`py-2 rounded-xl text-sm font-medium border transition-colors ${form.statut === s.value ? s.active : s.color}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {form.statut === 'banni_temp' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Date de débannissement</label>
                  <input type="date" value={form.deban_at ? form.deban_at.slice(0, 10) : ''}
                    onChange={e => set('deban_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                    className="w-full border border-orange-200 bg-orange-50 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400" />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Proxy</label>
                <div className="flex gap-2">
                  <select
                    value={form.proxy_id ?? ''}
                    onChange={e => set('proxy_id', e.target.value)}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 bg-white"
                  >
                    <option value="">Sans proxy (téléphone)</option>
                    {proxies.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.adresse}:{p.port} — {p.username}{p.nom ? ` (${p.nom})` : ''}
                      </option>
                    ))}
                  </select>
                  {onCreateProxy && (
                    <button type="button" onClick={onCreateProxy}
                      className="px-3 py-2.5 text-xs font-semibold border border-dashed border-teal-300 text-teal-600 rounded-xl hover:bg-teal-50 transition-colors whitespace-nowrap">
                      + Nouveau
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Notes</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                  placeholder="Informations supplémentaires..." rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={saving || !form.pseudo.trim()}
            className="w-full py-3 bg-teal-500 text-white rounded-xl font-semibold text-sm hover:bg-teal-600 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Enregistrement...' : account ? 'Enregistrer' : 'Ajouter le compte'}
          </button>
        </form>
      </div>
    </div>
  )
}
