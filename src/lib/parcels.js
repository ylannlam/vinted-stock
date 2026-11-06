// Suivi des colis Shein : état lisible, ancienneté de la dernière nouvelle.
const TZ = 'Europe/Paris'
const dayKey = at => new Intl.DateTimeFormat('en-CA', {timeZone: TZ}).format(new Date(at))
const hour = at => new Intl.DateTimeFormat('fr-FR', {timeZone: TZ, hour: '2-digit', minute: '2-digit'}).format(new Date(at))

export function since(at, now = Date.now()) {
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return ''
  const minutes = Math.round((now - t) / 60000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  if (dayKey(t) === dayKey(now)) return `aujourd’hui ${hour(t)}`
  if (dayKey(t) === dayKey(now - 86400000)) return `hier ${hour(t)}`
  return `le ${new Intl.DateTimeFormat('fr-FR', {timeZone: TZ, day: 'numeric', month: 'short'}).format(new Date(t))} ${hour(t)}`
}

export function parcelState(p) {
  if (!p) return null
  if (p.delivered) return {key: 'delivered', label: 'Livré', tone: 'done'}
  if (/livraison/i.test(p.status_text || '')) return {key: 'today', label: p.status_text, tone: 'today'}
  if (p.last_event || p.status_text) return {key: 'transit', label: p.status_text || 'En transit', tone: 'transit'}
  return {key: 'waiting', label: 'Numéro reçu, en attente du transporteur', tone: 'waiting'}
}

export const toneClass = {
  done: 'bg-emerald-100 text-emerald-900',
  today: 'bg-amber-100 text-amber-900',
  transit: 'bg-sky-100 text-sky-900',
  waiting: 'bg-slate-100 text-slate-700',
}

export const STAGE_TEXT = {to_order: 'À commander', ordered: 'Commandé', in_transit: 'En transit', received: 'Reçu', prepared: 'À expédier', shipped: 'Expédié'}
