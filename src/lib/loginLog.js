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

async function fetchGeo() {
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal })
    clearTimeout(timeout)
    if (!res.ok) return {}
    const data = await res.json()
    return {
      ip:    data.ip   ?? null,
      ville: data.city ?? null,
      pays:  data.country_name ?? data.country ?? null,
    }
  } catch {
    return {}
  }
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
