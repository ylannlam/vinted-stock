export const CARTONS = ['A','B','C','D','E','F','G','H','I','J']

// Détecte la capacité de chaque carton depuis les emplacements en base
// Cartons A-I : max case observée ; carton J : toujours 16
export function getCapacities(items) {
  const caps = {}
  for (const item of (items || [])) {
    const m = (item.emplacement || '').trim().toUpperCase().match(/^([A-J])(\d+)$/)
    if (!m) continue
    const [, letter, num] = m
    caps[letter] = Math.max(caps[letter] || 0, parseInt(num))
  }
  caps['J'] = Math.max(caps['J'] || 0, 16)
  return caps
}

// Set des emplacements occupés (majuscules)
export function getOccupied(items) {
  return new Set(
    (items || [])
      .filter(i => i.emplacement)
      .map(i => i.emplacement.trim().toUpperCase())
  )
}

// Premier emplacement libre dans les cartons dans l'ordre A→J, 1→cap
export function firstFreeSlot(caps, occupied, alsoExclude = new Set()) {
  const all = new Set([
    ...occupied,
    ...[...alsoExclude].map(s => s.toUpperCase()),
  ])
  for (const letter of CARTONS) {
    const cap = caps[letter] || 0
    for (let n = 1; n <= cap; n++) {
      const slot = `${letter}${n}`
      if (!all.has(slot)) return slot
    }
  }
  return ''
}

// Calcule une suggestion par article, en évitant les conflits entre eux
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
