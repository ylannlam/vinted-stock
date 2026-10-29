import { createClient } from '@supabase/supabase-js'

export async function authorize(req, res, roles = ['admin']) {
  res.setHeader('Cache-Control', 'no-store')
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) { res.status(401).json({ error: 'Connectez-vous pour continuer.' }); return null }
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { res.status(503).json({ error: 'La connexion au serveur reste à configurer.' }); return null }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) { res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' }); return null }
  const { data: profile, error: profileError } = await db.from('profiles').select('role').eq('id', data.user.id).single()
  if (profileError || !roles.includes(profile?.role)) {
    res.status(403).json({ error: 'Votre rôle ne permet pas cette action.' }); return null
  }
  return { db, user: data.user, role: profile.role }
}
