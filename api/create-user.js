import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { email, password, pseudo, role } = req.body
  if (!email || !password || !pseudo || !role) {
    return res.status(400).json({ error: 'Champs manquants' })
  }
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true
  })
  if (authError) return res.status(400).json({ error: authError.message })
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({ id: authData.user.id, pseudo, email, role })
  if (profileError) {
    await supabase.auth.admin.deleteUser(authData.user.id)
    return res.status(400).json({ error: profileError.message })
  }
  return res.status(200).json({ id: authData.user.id, pseudo, email, role })
}
