import { authorize } from '../server/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).end()
  const auth = await authorize(req, res)
  if (!auth) return
  const supabase = auth.db
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
