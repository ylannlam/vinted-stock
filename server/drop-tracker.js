const stages = new Set(['post1', 'post2', 'wait', 'ready', 'blocked'])
const text = (value, max = 500) => {
  if (typeof value !== 'string' || value.length > max) throw new Error('Texte invalide ou trop long.')
  return value
}
const amount = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9) throw new Error('Montant invalide.')
  return Math.round(value * 100) / 100
}
const date = value => {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0 || value > 4102444800000) throw new Error('Date invalide.')
  return value
}
export function validateTracker(input) {
  if (!input || !Array.isArray(input.accounts) || !Array.isArray(input.expenses) || !input.settings) throw new Error('Sauvegarde invalide.')
  function rows(list, convert) {
    if (list.length > 5000) throw new Error('La sauvegarde dépasse 5 000 lignes.')
    const ids = new Set()
    return list.map(row => {
      if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) || ids.has(row.id)) throw new Error('Identifiant invalide ou en double.')
      ids.add(row.id)
      return { id: row.id, ...convert(row) }
    })
  }
  return {
    accounts: rows(input.accounts, a => {
      if (!stages.has(a.stage)) throw new Error('Étape de compte invalide.')
      return { pseudo: text(a.pseudo), email: text(a.email), phone: text(a.phone), browser: text(a.browser),
        createdAt: date(a.createdAt), stage: a.stage, nextAt: date(a.nextAt), notes: text(a.notes, 5000) }
    }),
    expenses: rows(input.expenses, e => {
      if (!['in', 'out'].includes(e.type) || typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date)) || new Date(e.date).toISOString().slice(0, 10) !== e.date) throw new Error('Opération invalide.')
      return { date: e.date, type: e.type, cat: text(e.cat), label: text(e.label, 2000), amount: amount(e.amount) }
    }),
    settings: { budget: amount(input.settings.budget ?? 0) },
  }
}
