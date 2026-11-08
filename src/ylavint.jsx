// YlaVint, interface à part (vinted-stock.vercel.app/ylavint) : même connexion que Stock Vinted, réservée aux admins.
import React,{useEffect,useState} from 'react'
import ReactDOM from 'react-dom/client'
import {supabase} from './lib/supabase'
import YlaVintTab from './components/YlaVintTab'
import {fieldClass,primaryClass} from './components/YlaVintUI'
import './index.css'
import './workspace.css'

const pseudoToEmail=p=>`${p.toLowerCase().trim().replace(/[^a-z0-9_-]/g,'_')}@vinted-stock.app`
const Logo=({size='h-12 w-12 text-2xl'})=><span className={`relative inline-grid place-items-center rounded-xl bg-zinc-100 font-black text-zinc-900 ${size}`}>Y<span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-blue-500"/></span>

function Login(){
 const [pseudo,setPseudo]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function submit(e){e.preventDefault();setBusy(true);setError('');const {error}=await supabase.auth.signInWithPassword({email:pseudoToEmail(pseudo),password});if(error)setError('Pseudo ou mot de passe incorrect.');setBusy(false)}
 return <div className="grid min-h-screen place-items-center bg-[#0a0a0b] p-4 text-zinc-100">
  <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-[#141416] p-6">
   <div className="text-center"><Logo/><h1 className="mt-3 text-xl font-bold text-white">YlaVint</h1><p className="text-sm text-zinc-400">Connecte-toi avec ton compte Stock Vinted</p></div>
   <label className="block text-sm text-zinc-300">Pseudo<input className={fieldClass+' mt-1'} value={pseudo} onChange={e=>setPseudo(e.target.value)} autoComplete="username" autoFocus required/></label>
   <label className="block text-sm text-zinc-300">Mot de passe<input type="password" className={fieldClass+' mt-1'} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>
   {error&&<p role="alert" className="text-sm text-rose-400">{error}</p>}
   <button className={primaryClass+' w-full'} disabled={busy}>{busy?'Connexion…':'Se connecter'}</button>
  </form>
 </div>
}

function App(){
 const [session,setSession]=useState(undefined),[role,setRole]=useState(undefined)
 useEffect(()=>{
  supabase.auth.getSession().then(({data})=>setSession(data.session))
  const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
  return()=>data.subscription.unsubscribe()
 },[])
 useEffect(()=>{
  if(!session){setRole(undefined);return}
  supabase.from('profiles').select('role').eq('id',session.user.id).single().then(({data})=>setRole(data?.role||null))
 },[session?.user?.id])
 if(session===undefined||(session&&role===undefined))return <div className="grid min-h-screen place-items-center bg-[#0a0a0b] text-zinc-400"><Logo/></div>
 if(!session)return <Login/>
 if(role!=='admin')return <div className="grid min-h-screen place-items-center bg-[#0a0a0b] p-6 text-center text-zinc-300"><div><Logo/><p className="mt-4">YlaVint est réservé aux administrateurs.</p><button className="mt-3 text-sm text-blue-400 underline" onClick={()=>supabase.auth.signOut()}>Se déconnecter</button></div></div>
 return <YlaVintTab standalone onLogout={()=>supabase.auth.signOut()}/>
}

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
