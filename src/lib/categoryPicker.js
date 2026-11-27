const collator = new Intl.Collator('fr', {sensitivity: 'base', numeric: true})
const departmentOrder = ['Femmes', 'Hommes', 'Enfants', 'Maison']

function departmentRank(node) {
  const position = departmentOrder.indexOf(node.title)
  return position < 0 ? departmentOrder.length : position
}

function searchable(text) {
  return text.toLocaleLowerCase('fr').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/œ/g, 'oe').replace(/\b(?:bodys?|bodysuits?)\b/g, 'bodies')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

export function categoryIndex(rows = []) {
  const nodes = new Map(rows.map(row => [row.id, {...row, children: []}]))
  const roots = [], leaves = []
  for (const node of nodes.values()) {
    const parent = nodes.get(node.parent_id)
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  const byTitle = (a, b) => Number(/^Autres?\b/i.test(a.title)) - Number(/^Autres?\b/i.test(b.title)) || collator.compare(a.title, b.title)
  roots.sort((a, b) => departmentRank(a) - departmentRank(b) || byTitle(a, b))
  function visit(node, ancestors) {
    node.path = [...ancestors, node]
    node.label = node.path.map(p => p.title).join(' › ')
    if (node.children.length) {
      node.children.sort(byTitle).forEach(child => visit(child, node.path))
    } else {
      node.term = searchable(node.title)
      node.keywords = searchable(node.label)
      leaves.push(node)
    }
  }
  roots.forEach(node => visit(node, []))
  return {roots, nodes, leaves}
}

export function searchCategories(index, query) {
  const text = searchable(query)
  if (!text) return []
  const words = text.split(' ')
  const rank = node => node.term === text ? 0 : node.term.startsWith(text) ? 1 : words.every(w => node.term.includes(w)) ? 2 : 3
  return index.leaves.filter(node => words.every(w => node.keywords.includes(w)))
    .sort((a, b) => rank(a) - rank(b) || departmentRank(a.path[0]) - departmentRank(b.path[0]) || collator.compare(a.label, b.label))
}
