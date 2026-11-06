// Réception du jour : un article sorti d'un colis Shein retrouve la vente à servir en premier.
const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const codeKey = v => fold(v).replace(/[^a-z0-9]/g, '')
export const skuOfLine = l => String(l.sku_override ?? l.resolved_sku ?? l.source?.sku ?? '').trim()
const time = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : Infinity }
export const deadlineOf = l => l.deadline_at || l.order?.deadline || null
export const WAITING = ['ordered', 'in_transit']

// Taille et couleur comparables : « 36(S) » et « S » désignent la même taille.
export function sizeKey(v) {
  const s = fold(v).trim(), inner = s.match(/\(([a-z0-9]+)\)/)
  return (inner ? inner[1] : s).replace(/\s+/g, '')
}
export function variantOf(l) {
  const size = l.supplier_size || l.source?.size || '', color = l.supplier_color || l.source?.color || ''
  return {size, color, key: `${sizeKey(size)}|${fold(color).trim()}`, label: [size, color].filter(Boolean).join(' · ') || 'Variante non précisée'}
}

// Un code scanné ou tapé → les SKU attendus qui lui correspondent, du plus sûr au moins sûr.
export function matchCode(code, skus, aliases = {}) {
  const c = codeKey(code)
  if (c.length < 3) return []
  const known = aliases[c]
  const scored = []
  for (const sku of new Set(skus)) {
    const k = codeKey(sku)
    if (!k) continue
    let score = 0
    if (known && codeKey(known) === k) score = 5
    else if (k === c) score = 4
    else if (c.length >= 8 && (c.includes(k) || k.includes(c))) score = 3
    else if (/^\d{4,}$/.test(c) && k.endsWith(c)) score = 2
    else if (c.length >= 4 && k.includes(c)) score = 1
    if (score) scored.push({sku, score})
  }
  const best = Math.max(0, ...scored.map(s => s.score))
  return scored.filter(s => s.score === best || best < 3).sort((a, b) => b.score - a.score || a.sku.localeCompare(b.sku)).map(s => s.sku)
}

// Lignes d'une même commande Vinted (un lot) et leur état de réception.
export function orderLines(lines, line) { return lines.filter(l => l.order_id === line.order_id) }
export function lotState(lines, line) {
  const all = orderLines(lines, line)
  const missing = all.filter(l => WAITING.includes(l.effective_stage))
  return {size: all.length, missing: missing.length, lot: all.length > 1}
}

// Ventes qui attendent ce SKU, la première à servir en tête :
// d'abord celles qui peuvent partir tout de suite (pas un lot incomplet), puis la date limite, puis l'ancienneté.
export function candidatesFor(lines, sku, variantKey = null) {
  const key = codeKey(sku)
  return lines
    .filter(l => WAITING.includes(l.effective_stage) && codeKey(skuOfLine(l)) === key && (!variantKey || variantOf(l).key === variantKey))
    .map(l => {
      const lot = lotState(lines, l)
      return {line: l, lot, ready: !lot.lot || lot.missing === 1}
    })
    .sort((a, b) => Number(b.ready) - Number(a.ready) || time(deadlineOf(a.line)) - time(deadlineOf(b.line)) || time(a.line.sale_date) - time(b.line.sale_date) || a.line.id.localeCompare(b.line.id))
}

// Variantes encore attendues pour un SKU (pour choisir la taille quand le sachet ne la donne pas clairement).
export function variantsFor(lines, sku) {
  const groups = new Map()
  for (const {line} of candidatesFor(lines, sku)) {
    const v = variantOf(line), g = groups.get(v.key) || {...v, count: 0, first: line}
    g.count++; groups.set(v.key, g)
  }
  return [...groups.values()]
}

// Grille du mode visuel : un article attendu par SKU et variante, les plus urgents d'abord.
export function expectedItems(lines) {
  const groups = new Map()
  for (const l of lines) {
    if (!WAITING.includes(l.effective_stage)) continue
    const sku = skuOfLine(l), v = variantOf(l), key = `${codeKey(sku)}|${v.key}`
    const g = groups.get(key) || {key, sku, variant: v, lines: [], title: l.source?.title || sku}
    g.lines.push(l); groups.set(key, g)
  }
  return [...groups.values()].map(g => ({...g, deadline: Math.min(...g.lines.map(l => time(deadlineOf(l))))}))
    .sort((a, b) => a.deadline - b.deadline || a.title.localeCompare(b.title, 'fr'))
}

// Place libre dans le bac « En attente » pour un lot incomplet : A1, A2…
export function nextSlot(lines) {
  const used = new Set(lines.filter(l => !['shipped'].includes(l.effective_stage)).map(l => String(l.location || '').trim().toUpperCase()).filter(v => /^A\d+$/.test(v)))
  for (let n = 1; n < 1000; n++) if (!used.has(`A${n}`)) return `A${n}`
  return 'A?'
}

// Tableau de bord de la journée.
export function daySummary(lines, now = Date.now()) {
  const day = at => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Paris'}).format(new Date(at))
  const today = day(now), isToday = v => v && Number.isFinite(Date.parse(v)) && day(v) === today
  const waiting = lines.filter(l => WAITING.includes(l.effective_stage))
  return {
    arriving: waiting.filter(l => l.parcel && (l.parcel.delivered || /livraison/i.test(l.parcel.status_text || ''))).length,
    waiting: waiting.length,
    received: lines.filter(l => l.effective_stage === 'received').length,
    toDeposit: lines.filter(l => l.effective_stage === 'prepared').length,
    shippedToday: lines.filter(l => l.effective_stage === 'shipped' && isToday(l.shipped_at)).length,
    late: waiting.filter(l => time(deadlineOf(l)) - now < 24 * 3600000).length,
  }
}
