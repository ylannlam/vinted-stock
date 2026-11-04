// Coefficient = ce que la vente rapporte (prix de vente − remboursement − frais) ÷ coût payé réel.
// Règle du projet : aucun montant inventé. Sans coût payé réel (> 0) ou sans prix de vente,
// il n'y a pas de coefficient ; le prix catalogue Shein n'est jamais utilisé à la place.
// La livraison Shein reste dans le total de la commande : elle n'est pas répartie par article.
const number=value=>{
  if(typeof value==='string') {
    value=value.trim()
    if(!/^-?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/.test(value))return null
    value=Number(value.replace(/[ \u00a0\u202f]/g,'').replace(',','.'))
  }
  return typeof value==='number'&&Number.isFinite(value)?value:null
}
const amount=value=>{const n=number(value);return n!=null&&n>=0?n:null}
export const parseAmount=amount
export function coefficient(revenue,cost) {
  const r=number(revenue),c=amount(cost)
  const result=r==null||c==null||c<=0?null:r/c
  return Number.isFinite(result)?result:null
}
export function saleCoefficient(line) {
  const status=line?.order?.status??line?.order_status
  if(!status||['returning','cancelled','suspended'].includes(status))return null
  // Match the stored revenue format used by workspace_finance, not free-form input.
  if(!['number','string'].includes(typeof line.source?.selling_price)||!/^\d+(\.\d+)?$/.test(String(line.source.selling_price)))return null
  const price=amount(line.source?.selling_price),cost=amount(line.actual_cost),fees=amount(line.fees_amount??0),refund=amount(line.refund_amount??0)
  if(price==null||cost==null||fees==null||refund==null)return null
  return coefficient(price-fees-refund,cost)
}
// Moyenne pondérée : total rapporté ÷ total payé (pas la moyenne des coefficients).
export const totalCoefficient=row=>row&&Number(row.coef_count)>0?coefficient(row.coef_revenue,row.coef_cost):null
export function formatCoefficient(value) {
  if(value==null||!Number.isFinite(value))return null
  const digits=Math.abs(value)<9.95?1:0
  return '×'+value.toLocaleString('fr-FR',{minimumFractionDigits:digits,maximumFractionDigits:digits})
}
const cents=value=>Math.round(value*100)/100
const integerCents=value=>{
  const n=amount(value),rounded=n==null?null:Math.round(n*100)
  return rounded!=null&&Number.isSafeInteger(rounded)&&Math.abs(n*100-rounded)<1e-7?rounded:null
}
// Simulateur avant achat. Le prix conseillé pour ×k est arrondi au centime supérieur.
export function simulateCoefficient({cost,price,fees=0},targets=[2,2.5,3]) {
  const c=integerCents(cost),p=integerCents(price)
  const f=fees==null||(typeof fees==='string'&&!fees.trim())?0:integerCents(fees)
  if(c==null||c<=0)return {ready:false,reason:'cost'}
  if(f==null)return {ready:false,reason:'fees'}
  const suggestions=targets.filter(k=>Number.isFinite(k)&&k>0&&Number.isSafeInteger(Math.ceil(k*c+f))).map(k=>({k,price:Math.ceil(k*c+f)/100}))
  if(p==null)return {ready:false,reason:'price',suggestions}
  const net=p-f
  return {ready:true,coefficient:net/c,margin:cents((net-c)/100),suggestions}
}
