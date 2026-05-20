const STORAGE_KEY = 'vinted_cartons'

export function getCustomCapacities() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  catch { return {} }
}

export function saveCustomCapacity(letter, capacity) {
  const caps = getCustomCapacities()
  caps[letter.toUpperCase()] = capacity
  localStorage.setItem(STORAGE_KEY, JSON.stringify(caps))
}

export function removeCustomCapacity(letter) {
  const caps = getCustomCapacities()
  delete caps[letter.toUpperCase()]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(caps))
}

const DELETED_KEY = 'vinted_cartons_deleted'

export function getDeletedCartons() {
  try { return JSON.parse(localStorage.getItem(DELETED_KEY) || '[]') }
  catch { return [] }
}

export function softDeleteCarton(letter, capacity) {
  const l = letter.toUpperCase()
  const deleted = getDeletedCartons().filter(d => d.letter !== l)
  deleted.unshift({ letter: l, capacity, deletedAt: new Date().toISOString() })
  localStorage.setItem(DELETED_KEY, JSON.stringify(deleted))
  removeCustomCapacity(l)
}

export function restoreCarton(letter) {
  const l = letter.toUpperCase()
  const deleted = getDeletedCartons()
  const entry = deleted.find(d => d.letter === l)
  if (entry) {
    saveCustomCapacity(l, entry.capacity)
    localStorage.setItem(DELETED_KEY, JSON.stringify(deleted.filter(d => d.letter !== l)))
  }
}

// Capacités depuis la base + cartons personnalisés (localStorage)
// Carton J : toujours au moins 16 ; autres : max observé
export function getCapacities(items) {
  const caps = {}
  for (const item of (items || [])) {
    const m = (item.emplacement || '').trim().toUpperCase().match(/^([A-Z])(\d+)$/)
    if (!m) continue
    const [, letter, num] = m
    caps[letter] = Math.max(caps[letter] || 0, parseInt(num))
  }
  caps['J'] = Math.max(caps['J'] || 0, 16)
  const custom = getCustomCapacities()
  for (const [letter, cap] of Object.entries(custom)) {
    caps[letter] = Math.max(caps[letter] || 0, cap)
  }
  return caps
}

export function getOccupied(items) {
  return new Set(
    (items || [])
      .filter(i => i.emplacement)
      .map(i => i.emplacement.trim().toUpperCase())
  )
}

// Premier emplacement libre dans l'ordre alphabétique des cartons connus
export function firstFreeSlot(caps, occupied, alsoExclude = new Set()) {
  const all = new Set([
    ...occupied,
    ...[...alsoExclude].map(s => s.toUpperCase()),
  ])
  for (const letter of Object.keys(caps).sort()) {
    const cap = caps[letter] || 0
    for (let n = 1; n <= cap; n++) {
      const slot = `${letter}${n}`
      if (!all.has(slot)) return slot
    }
  }
  return ''
}

export function computeSuggestions(items, stockItems) {
  const caps = getCapacities(stockItems)
  const occupied = getOccupied(stockItems)
  const assigned = new Set()
  return Object.fromEntries((items || []).map(item => {
    const slot = firstFreeSlot(caps, occupied, assigned)
    if (slot) assigned.add(slot)
    return [item.id, slot]
  }))
}
