import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end()
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { userId } = req.body
  if (!userId) return res.status(400).json({ error: 'userId manquant' })
  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) return res.status(400).json({ error: error.message })
  return res.status(200).json({ success: true })
}
