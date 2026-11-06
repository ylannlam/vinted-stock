// Planification des annonces sur plusieurs jours (onglet Publication).
// Tout est calculé à l'heure de Paris ; le serveur ne fait que réserver les créneaux choisis
// et revérifie les règles (écart du compte, même SKU à 30 minutes) au moment de l'envoi.

export const SKU_GAP_MINUTES = 30
export const PLAN_DEFAULTS = {perDay: 4, from: '10:00', to: '22:00', days: 7, start: 'today', spacing: 35, mode: 'live', firstIn: 15}
const MINUTE = 60000, DAY = 86400000

const partsFormat = new Intl.DateTimeFormat('en-US', {timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'})
function parisParts(ms) {
  const get = type => Number(partsFormat.formatToParts(new Date(ms)).find(p => p.type === type).value)
  return {year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second')}
}
export function parisOffset(ms) {
  const p = parisParts(ms)
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / MINUTE)
}
// « 2026-11-07 » + 14 h 30 (en minutes) → instant UTC correspondant à Paris (heure d'été comprise).
export function parisToUtc(date, minutes) {
  const [y, m, d] = date.split('-').map(Number)
  const local = Date.UTC(y, m - 1, d, 0, minutes)
  let utc = local - parisOffset(local) * MINUTE
  const corrected = local - parisOffset(utc) * MINUTE
  if (corrected !== utc) utc = corrected
  return utc
}
export function parisDate(ms) {
  const p = parisParts(ms)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10)
}
export function clockMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
export function dayLabel(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', {weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC'})
}
export function timeLabel(ms) {
  return new Date(ms).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'})
}

export function validatePlanSettings(raw) {
  const s = {...PLAN_DEFAULTS, ...(raw || {})}
  const from = clockMinutes(s.from), to = clockMinutes(s.to)
  const int = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null
  const perDay = int(s.perDay, 1, 60), days = int(s.days, 1, 30), spacing = int(s.spacing, 5, 720), firstIn = int(s.firstIn, 5, 720)
  if (perDay == null) throw new Error('Choisis entre 1 et 60 articles par jour et par compte.')
  if (days == null) throw new Error('Planifie sur 1 à 30 jours.')
  if (spacing == null) throw new Error('L’écart entre deux articles d’un même compte va de 5 à 720 minutes.')
  if (firstIn == null) throw new Error('La première annonce part dans 5 à 720 minutes (12 heures).')
  if (from == null || to == null || to - from < 30) throw new Error('La plage horaire doit durer au moins 30 minutes, dans la même journée.')
  if (!['today', 'tomorrow'].includes(s.start)) throw new Error('Choisis de commencer aujourd’hui ou demain.')
  if (!['live', 'draft'].includes(s.mode)) throw new Error('Choisis « en ligne » ou « brouillon Vinted ».')
  return {perDay, days, spacing, from, to, start: s.start, mode: s.mode, firstIn}
}

// Petit décalage stable (0…max minutes) pour éviter des heures trop rondes et identiques d'un compte à l'autre.
function jitter(key, max) {
  if (max <= 0) return 0
  let h = 2166136261
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) % (max + 1)
}
const skuKey = sku => (typeof sku === 'string' && sku.trim() ? sku.trim().toLowerCase() : null)

/**
 * drafts   : fiches prêtes [{id, version, account_id, sku, title, created_at}] (les plus anciennes partent en premier)
 * occupied : annonces déjà prévues ou publiées [{account_id, sku, at}] (at en ms)
 * spacingByAccount : écart minimal propre à un compte (réglages des annonces), au moins celui du planning
 */
export function planPublications({drafts, occupied = [], settings, now = Date.now(), spacingByAccount = {}}) {
  const s = validatePlanSettings(settings)
  const today = parisDate(now)
  const first = s.start === 'tomorrow' ? addDays(today, 1) : today
  const taken = occupied.filter(o => Number.isFinite(o.at)).map(o => ({account_id: o.account_id, sku: skuKey(o.sku), at: o.at, existing: true}))
  const queues = new Map()
  for (const d of [...drafts].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))) {
    if (!queues.has(d.account_id)) queues.set(d.account_id, [])
    queues.get(d.account_id).push(d)
  }
  const accounts = [...queues.keys()].sort()
  const days = Array.from({length: s.days}, (_, i) => addDays(first, i))
  const items = []
  for (const date of days) {
    const end = parisToUtc(date, s.to)
    // Aujourd'hui : la première annonce part au plus tôt après le délai choisi (« première annonce dans »).
    const start = Math.max(parisToUtc(date, s.from), Math.ceil((now + s.firstIn * MINUTE) / (5 * MINUTE)) * 5 * MINUTE)
    if (end - start < 0) continue
    const span = end - start
    const dayStart = parisToUtc(date, 0), dayEnd = parisToUtc(addDays(date, 1), 0)
    const slots = []
    accounts.forEach((account, index) => {
      const spacing = Math.max(s.spacing, Number(spacingByAccount[account]) || 0) * MINUTE
      const already = taken.filter(t => t.account_id === account && t.at >= dayStart && t.at < dayEnd).length
      const quota = Math.min(s.perDay - already, Math.floor(span / spacing) + 1)
      if (quota <= 0) return
      // Créneaux répartis sur toute la plage ; chaque compte est légèrement décalé des autres.
      const step = quota > 1 ? Math.max(spacing, Math.floor(span / quota)) : span
      const slack = Math.max(0, step - spacing)
      const shift = Math.min((index * 7 * MINUTE) % Math.max(step, MINUTE), slack)
      for (let k = 0; k < quota; k++) {
        const at = start + shift + k * step + jitter(`${account}${date}${k}`, Math.min(8, Math.floor((slack - shift) / MINUTE))) * MINUTE
        if (at <= end) slots.push({account, at: Math.floor(at / MINUTE) * MINUTE, spacing, slack: Math.min(30 * MINUTE, end - at)})
      }
    })
    slots.sort((a, b) => a.at - b.at || a.account.localeCompare(b.account))
    for (const slot of slots) {
      const queue = queues.get(slot.account)
      if (!queue.length) continue
      const dayCount = taken.filter(t => t.account_id === slot.account && t.at >= dayStart && t.at < dayEnd).length
      if (dayCount >= s.perDay) continue
      // Un créneau occupé (même compte trop proche, ou même SKU à moins de 30 min) glisse de 5 en 5 minutes.
      for (let delay = 0; delay <= slot.slack; delay += 5 * MINUTE) {
        const at = slot.at + delay
        if (at < now + s.firstIn * MINUTE) continue
        if (taken.some(t => t.account_id === slot.account && Math.abs(t.at - at) < slot.spacing)) continue
        const index = queue.findIndex(d => {
          const key = skuKey(d.sku)
          return !key || !taken.some(t => t.sku === key && Math.abs(t.at - at) < SKU_GAP_MINUTES * MINUTE)
        })
        if (index < 0) continue
        const [draft] = queue.splice(index, 1)
        items.push({id: draft.id, version: draft.version, account_id: slot.account, sku: draft.sku || null, title: draft.title || '', at, date})
        taken.push({account_id: slot.account, sku: skuKey(draft.sku), at})
        break
      }
    }
  }
  items.sort((a, b) => a.at - b.at)
  const unplanned = [...queues.values()].flat()
  return {
    items, unplanned, settings: s,
    byDay: days.map(date => ({date, label: dayLabel(date), count: items.filter(i => i.date === date).length})),
    conflicts: planConflicts(items, occupied, s, spacingByAccount),
  }
}

// Revérification indépendante : un créneau trop proche du même compte ou du même SKU est signalé.
export function planConflicts(items, occupied = [], settings = PLAN_DEFAULTS, spacingByAccount = {}) {
  const all = [...occupied.map(o => ({...o, sku: skuKey(o.sku), existing: true})), ...items.map(i => ({...i, sku: skuKey(i.sku)}))]
  const issues = []
  items.forEach(item => {
    const spacing = Math.max(settings.spacing, Number(spacingByAccount[item.account_id]) || 0) * MINUTE
    for (const other of all) {
      if (other === item || other.id === item.id) continue
      if (other.account_id === item.account_id && Math.abs(other.at - item.at) < spacing) issues.push({id: item.id, kind: 'account'})
      if (item.sku && other.sku === skuKey(item.sku) && Math.abs(other.at - item.at) < SKU_GAP_MINUTES * MINUTE) issues.push({id: item.id, kind: 'sku'})
    }
  })
  return issues
}
