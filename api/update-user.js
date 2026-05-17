import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).end()
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { userId, email, password, pseudo, role } = req.body
  if (!userId) return res.status(400).json({ error: 'userId manquant' })
  if (email || password) {
    const updates = {}
    if (email) updates.email = email
    if (password) updates.password = password
    const { error } = await supabase.auth.admin.updateUserById(userId, updates)
    if (error) return res.status(400).json({ error: error.message })
  }
  const profileUpdates = {}
  if (pseudo) profileUpdates.pseudo = pseudo
  if (role) profileUpdates.role = role
  if (email) profileUpdates.email = email
  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await supabase.from('profiles').update(profileUpdates).eq('id', userId)
    if (error) return res.status(400).json({ error: error.message })
  }
  return res.status(200).json({ success: true })
}
