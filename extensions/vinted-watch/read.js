// Lecture de la page Vinted ouverte : état du compte connecté (restriction, bannissement) et son identité.
// Rien d'autre n'est lu ni envoyé : ni messages, ni annonces, ni données d'acheteurs.
globalThis.readVintedAccount = function readVintedAccount(doc = document, href = location.href) {
  let url
  try { url = new URL(href) } catch { return null }
  if (url.protocol !== 'https:' || url.hostname !== 'www.vinted.fr') return null
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim()
  const fold = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'")

  // 1. Données de la page (Next.js) : l'utilisateur connecté, avec action_restriction et is_account_banned.
  let user = null
  try {
    let data = ''
    for (const script of doc.querySelectorAll('script')) {
      const t = script.textContent || ''
      if (!t.startsWith('self.__next_f.push(')) continue
      const m = t.match(/^self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/s)
      if (m) { try { data += JSON.parse(m[1]) } catch {} }
    }
    const marker = '"initialUserState":{"user":', at = data.indexOf(marker)
    if (at >= 0) {
      const start = at + marker.length
      let depth = 0, str = false, esc = false
      for (let i = start; i < data.length && i < start + 200000; i++) {
        const c = data[i]
        if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue }
        if (c === '"') str = true
        else if (c === '{') depth++
        else if (c === '}' && --depth === 0) { const u = JSON.parse(data.slice(start, i + 1)); if (u && /^\d{1,15}$/.test(String(u.id))) user = u; break }
      }
    }
  } catch { user = null }

  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Paris'}).format(new Date())
  let status = 'ok', until = null, message = '', source = user ? 'page_data' : null
  if (user) {
    const r = user.action_restriction, end = typeof r?.expiration_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.expiration_date) ? r.expiration_date : null
    if (user.is_account_banned === true) { status = 'blocked'; message = 'Compte bloqué par Vinted.' }
    else if (r && (end ? end >= today : true)) { status = 'restricted'; until = end; message = `Compte restreint${end ? ` jusqu’au ${end.split('-').reverse().join('/')}` : ''}.` }
  }

  // 2. Bandeau affiché (page du profil) : titre « Compte restreint jusqu'au … » ou « Compte bloqué ».
  for (const title of doc.querySelectorAll('[class*="InfoBanner__title"],h1,h2,h3,h4')) {
    const t = fold(title.textContent)
    if (!/^(compte (restreint|bloque|suspendu|banni|desactive)|(ton|votre) compte (est|a ete) (restreint|bloque|suspendu|banni|desactive))\b/.test(t)) continue
    const box = title.closest('[class*="InfoBanner__inner_content"]') || title.parentElement || title
    const text = clean(box.textContent).slice(0, 500), all = fold(text), date = all.match(/jusqu'au (\d{2})\/(\d{2})\/(\d{4})/)
    const found = /definitiv|permanent/.test(all) ? 'permanent' : /restreint|restriction/.test(all) ? 'restricted' : 'blocked'
    const rank = {ok: 0, restricted: 1, blocked: 2, permanent: 3}
    if (rank[found] >= rank[status]) { status = found; until = date ? `${date[3]}-${date[2]}-${date[1]}` : until; message = text; source = source || 'banner' }
  }
  return {status, until_date: until, message, member_id: user ? String(user.id) : null, login: user ? clean(user.login).slice(0, 80) : '', source}
}
