import {useEffect} from 'react'

// YlaVint a sa propre interface (/ylavint) : l'onglet du site y mène directement, en gardant la rubrique demandée.
export default function YlaVintLauncher(){
 const parts=window.location.hash.slice(1).split('?')[0].split('/')
 const target=`/ylavint${parts[0]==='ylavint'&&parts[1]?`#${parts[1]}`:''}`
 useEffect(()=>{window.location.assign(target)},[])
 return <div className="grid min-h-[60vh] place-items-center bg-[#0a0a0b] p-6 text-center text-zinc-300">
  <div><span className="inline-grid h-12 w-12 place-items-center rounded-xl bg-zinc-100 text-2xl font-black text-zinc-900">Y</span>
   <p className="mt-4">Ouverture de YlaVint…</p><a className="mt-2 inline-block text-sm text-blue-400 underline" href={target}>Ouvrir YlaVint</a></div>
 </div>
}
