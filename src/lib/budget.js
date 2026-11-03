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
// Automatic rows remain outside the editable payload and keep a stable identity.
export function combinedBudgetRows(manual=[],automatic=[],income=[]) {
  const refs=new Set(manual.filter(r=>r.type==='out').flatMap(r=>(r.label||'').toUpperCase().match(/\bG[A-Z0-9]{7,39}\b/g)||[]))
  const expenses=[...new Map(automatic.map(r=>[r.order_ref,r])).values()]
  const sales=[...new Map(income.map(r=>[r.line_id,r])).values()]
  const incomeDuplicates=sales.filter(r=>manual.some(m=>m.type===r.type&&(m.label||'').includes(r.line_id)))
  const duplicateIds=new Set(incomeDuplicates.map(r=>r.id))
  return {rows:[...manual,...expenses.filter(r=>!refs.has(r.order_ref)),...sales.filter(r=>!duplicateIds.has(r.id))],
    duplicates:expenses.filter(r=>refs.has(r.order_ref)),incomeDuplicates}
}
export const budgetPeriodRows=(rows,month='')=>rows.filter(row=>!month||row.date.startsWith(month))
