import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AddCommandeModal({ onClose, onCreated }) {
  const [trackingNumber, setTrackingNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!trackingNumber.trim()) { setError('Numéro de suivi requis'); return }
    setSaving(true)
    const { data: commande, error: cmdErr } = await supabase
      .from('commandes')
      .insert({ tracking_number: trackingNumber.trim(), status: 'en_attente' })
      .select()
      .single()
    if (cmdErr) { setError(cmdErr.message); setSaving(false); return }
    onCreated(commande)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base">Nouvelle commande</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">N° de suivi Shein</label>
            <input
              type="text"
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
              placeholder="ex: SGCNA12345678"
              autoFocus
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
            />
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>}

          <div className="flex gap-3 pb-2">
            <button type="button" onClick={onClose}
              className="flex-1 border-2 border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-purple-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-purple-600 disabled:opacity-50 transition-colors">
              {saving ? 'Création…' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
