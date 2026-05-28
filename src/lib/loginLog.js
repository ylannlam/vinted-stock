import { supabase } from './supabase'

function parseUserAgent(ua) {
  if (!ua) return 'Inconnu'
  let browser = 'Navigateur'
  if (/Edg\//.test(ua))            browser = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua))    browser = 'Chrome'
  else if (/Firefox\//.test(ua))   browser = 'Firefox'
  else if (/Safari\//.test(ua))    browser = 'Safari'

  let os = 'Appareil'
  if (/iPhone/.test(ua))           os = 'iPhone'
  else if (/iPad/.test(ua))        os = 'iPad'
  else if (/Android/.test(ua))     os = 'Android'
  else if (/Windows/.test(ua))     os = 'Windows'
  else if (/Mac OS X/.test(ua))    os = 'Mac'
  else if (/Linux/.test(ua))       os = 'Linux'

  return `${browser} sur ${os}`
}

async function fetchWithTimeout(url, ms = 3000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function fetchGeo() {
  const a = await fetchWithTimeout('https://ipapi.co/json/')
  if (a && (a.ip || a.city || a.country_name)) {
    return {
      ip:    a.ip           ?? null,
      ville: a.city         ?? null,
      pays:  a.country_name ?? a.country ?? null,
    }
  }
  const b = await fetchWithTimeout('https://ip-api.com/json')
  if (b && (b.query || b.city || b.country)) {
    return {
      ip:    b.query   ?? null,
      ville: b.city    ?? null,
      pays:  b.country ?? null,
    }
  }
  const c = await fetchWithTimeout('https://api.ipify.org?format=json')
  if (c?.ip) return { ip: c.ip, ville: null, pays: null }
  return {}
}

export async function recordLogin(userId) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('pseudo, email, role')
      .eq('id', userId)
      .single()

    const geo = await fetchGeo()
    const appareil = parseUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : '')

    await supabase.from('login_logs').insert({
      user_id:    userId,
      pseudo:     profile?.pseudo ?? null,
      email:      profile?.email  ?? null,
      role:       profile?.role   ?? null,
      ip_address: geo.ip          ?? null,
      ville:      geo.ville       ?? null,
      pays:       geo.pays        ?? null,
      appareil,
    })
  } catch (err) {
    console.warn('login_log insert failed:', err?.message)
  }
}
