export const euro = n => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n)
export function budgetTotals(rows) {
  const totals = {in:0,out:0}
  const categories = new Map()
  for (const row of rows) {
    const cents = Math.round(row.amount*100)
    totals[row.type] += cents
    if(row.type==='out') categories.set(row.cat,(categories.get(row.cat)||0)+cents)
  }
  return {income:totals.in/100,expenses:totals.out/100,balance:(totals.in-totals.out)/100,
    categories:[...categories].sort((a,b)=>b[1]-a[1]).map(([name,cents])=>({name,amount:cents/100}))}
}
export function mergeExpenses(existing, incoming) {
  const merged = new Map(existing.map(row=>[row.id,row]))
  for(const row of incoming) {
    const old=merged.get(row.id)
    if(old && ['date','type','cat','label','amount'].some(key=>old[key]!==row[key])) throw new Error('Une opération importée existe déjà avec des valeurs différentes.')
    merged.set(row.id,row)
  }
  return [...merged.values()]
}
