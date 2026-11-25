import { CREATION_STAGES, localDateInput, initialCreation } from '../lib/accountTracking'
import { useState } from 'react'

const EMPTY = {
  ads_power_num: '',
  pseudo: '',
  email: '',
  methode_connexion: 'google',
  telephone: '',
  telephone_type: 'lyca',
  telephone_email: '',
  statut: 'en_preparation',
  deban_at: '',
  notes: '',
  creation_stage: 'post1',
  creation_next_at: '',
  browser: '',
}

export default function AccountFormModal({ account, onClose, onSave, error }) {
  const [form, setForm] = useState(() => {
    if (!account) return { ...EMPTY, ...initialCreation(), is_shadowbanned: false }
    const keys = [...Object.keys(EMPTY), 'id', 'created_at', 'is_ready', 'is_shadowbanned']
    return Object.fromEntries(keys.map(key => [key, account[key]]))
  })
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.pseudo.trim()) return
    setSaving(true)
    try {
      const fields = { ...form }
      if (form.telephone_type === 'onoff') {
        fields.telephone_email = (form.telephone_email || '').trim()
      } else if (!account || form.telephone_type !== account.telephone_type) {
        fields.telephone_email = null
      }
      if (!account || form.creation_stage !== account.creation_stage || form.is_shadowbanned !== account.is_shadowbanned) {
        fields.is_ready = !form.is_shadowbanned && (form.creation_stage ? form.creation_stage === 'ready' : !!form.is_ready)
      }
      await onSave(fields)
    } finally {
      setSaving(false)
    }
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
          {error && <p role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</p>}

          {/* Pseudo — toujours visible */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="account-scalency-number" className="text-xs font-semibold text-gray-500 mb-1 block">N° Scalency</label>
              <input
                id="account-scalency-number"
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

          <section className="border border-gray-200 rounded-xl p-3 space-y-3">
            <h3 className="text-xs font-semibold text-gray-600">{account ? 'Création et isolement sur téléphone' : 'En préparation · Jour 1'}</h3>
            <p className="text-xs text-gray-500">Jour 1 : 1re annonce après 2 h. Jour 2 : 2e annonce. Jour 3 : prêt à passer sur proxy.</p>
            {account && <>
              <label className="flex gap-2 items-center text-sm text-gray-700"><input type="checkbox" checked={!!form.is_shadowbanned} onChange={e=>set('is_shadowbanned',e.target.checked)}/>Shadowban · compte abandonné</label>
              <label className="block text-xs text-gray-500">Étape
                <select aria-label="Étape de création" className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" value={form.creation_stage || ''} onChange={e=>setForm(prev=>({...prev,creation_stage:e.target.value,statut:e.target.value==='blocked'?prev.statut:e.target.value==='ready'?'actif':'en_preparation',creation_next_at:['post1','post2','wait'].includes(e.target.value)?new Date(Date.now()+(e.target.value==='post1'?7200000:86400000)).toISOString():null}))}>
                  <option value="">Sans suivi d’annonces</option>{CREATION_STAGES.filter(stage => stage.value !== 'blocked' || form.creation_stage === 'blocked').map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
            </>}
            {['post1','post2','wait'].includes(form.creation_stage)&&<label className="block text-xs text-gray-500">Prochaine échéance
              <input aria-label="Prochaine échéance" type="datetime-local" className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" value={localDateInput(form.creation_next_at)} onChange={e=>set('creation_next_at',e.target.value?new Date(e.target.value).toISOString():null)}/>
            </label>}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-500">Navigateur<input aria-label="Navigateur" className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Chrome, Safari…" value={form.browser || ''} onChange={e=>set('browser',e.target.value)}/></label>
              <label className="text-xs text-gray-500">Compte créé le<input aria-label="Compte créé le" type="datetime-local" className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" value={localDateInput(form.created_at)} onChange={e=>{const value=e.target.value?new Date(e.target.value).toISOString():null;setForm(prev=>({...prev,created_at:value,...(prev.creation_stage==='post1'&&value?{creation_next_at:new Date(Date.parse(value)+7200000).toISOString()}:{} )}))}}/></label>
            </div>
          </section>

          <div>
            <label htmlFor="account-email" className="text-xs font-semibold text-gray-500 mb-1 block">
              {form.methode_connexion === 'google' ? 'Adresse e-mail Google' : 'Adresse e-mail du compte'}
            </label>
            <input id="account-email" value={form.email || ''} onChange={e => set('email', e.target.value)} type="email"
              placeholder="email@example.com"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="account-phone" className="text-xs font-semibold text-gray-500 mb-1 block">Téléphone</label>
              <input id="account-phone" type="tel" value={form.telephone || ''} onChange={e => set('telephone', e.target.value)}
                placeholder="+33 6 00 00 00 00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Opérateur</label>
              <div className="flex gap-2 h-[42px]">
                {['lyca', 'onoff'].map(t => (
                  <button key={t} type="button" aria-pressed={form.telephone_type === t} onClick={() => set('telephone_type', t)}
                    className={`flex-1 rounded-xl text-sm font-medium border transition-colors capitalize ${form.telephone_type === t ? 'bg-teal-500 text-white border-teal-500' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                    {t === 'lyca' ? 'Lyca' : 'Onoff'}
                  </button>
                ))}
              </div>
              {form.telephone_type === 'autre' && <p className="mt-1 text-xs text-gray-500">Opérateur enregistré · Autre</p>}
            </div>
          </div>

          {form.telephone_type === 'onoff' && (
            <div>
              <label htmlFor="onoff-email" className="text-xs font-semibold text-gray-500 mb-1 block">Adresse e-mail du compte Onoff *</label>
              <input id="onoff-email" required value={form.telephone_email || ''} onChange={e => set('telephone_email', e.target.value)}
                type="email" placeholder="email@example.com"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
            </div>
          )}

          {account && <>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Statut</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'en_preparation', label: 'En préparation', color: 'bg-purple-50 text-purple-700 border-purple-200', active: 'bg-purple-500 text-white border-purple-500' },
                  { value: 'actif',          label: 'Actif',          color: 'bg-green-50 text-green-700 border-green-200',    active: 'bg-green-500 text-white border-green-500' },
                  { value: 'banni_temp',     label: 'Banni temp.',    color: 'bg-orange-50 text-orange-700 border-orange-200', active: 'bg-orange-500 text-white border-orange-500' },
                  { value: 'banni_def',      label: 'Banni déf.',     color: 'bg-red-50 text-red-700 border-red-200',          active: 'bg-red-500 text-white border-red-500' },
                ].map(s => (
                  <button key={s.value} type="button" onClick={() => setForm(prev=>({...prev,statut:s.value,...(['banni_temp','banni_def'].includes(s.value)?{creation_stage:'blocked',creation_next_at:null}:s.value==='actif'?{creation_stage:'ready',creation_next_at:null}:prev.creation_stage==='blocked'||prev.creation_stage==='ready'?{creation_stage:'post1',creation_next_at:new Date(Date.now()+7200000).toISOString()}:{} )}))}
                    className={`py-2 rounded-xl text-sm font-medium border transition-colors ${form.statut === s.value ? s.active : s.color}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              {form.statut === 'en_preparation' && (
                <p className="text-[11px] text-purple-600 mt-1.5 leading-snug">
                  Compte en cours de préparation. Le suivi des annonces est renseigné ci-dessus.
                </p>
              )}
            </div>

            <p className="text-xs text-slate-500">Passer le compte dans Bloqués démarre 5 jours d’attente. Le passer dans Prêts démarre 2 jours avant le rappel de changement de mot de passe.</p>
          </>}

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Informations supplémentaires..." rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
          </div>

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
