export function saleDateOf(line) {
  const value=line.sale_date||line.order?.order_date
  return value&&Number.isFinite(Date.parse(value))?value:null
}

export function newestSalesFirst(a,b) {
  const left=saleDateOf(a),right=saleDateOf(b)
  if(!left||!right)return left?-1:right?1:String(b.id).localeCompare(String(a.id))
  return Date.parse(right)-Date.parse(left)||String(b.id).localeCompare(String(a.id))
}

export function saleDateLabel(value) {
  return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date(value))
}
