import Logo from './Logo'

export default function SpaceChooser({onChoose}){
  return <main className="min-h-screen workspace-shell grid place-items-center px-5">
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-2 text-sm font-semibold text-teal-800"><Logo size={30}/>Stock Vinted</div>
      <h1 className="mt-5 mb-7 text-3xl font-bold tracking-tight text-slate-900">Choisis ton espace</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <button className="rounded-2xl bg-teal-800 p-7 text-left text-white hover:bg-teal-900" onClick={()=>onChoose('ylann')}>
          <strong className="block text-2xl">YLANN</strong><span className="mt-2 block">Tableau de bord complet</span>
        </button>
        <button className="rounded-2xl border border-teal-300 bg-white p-7 text-left text-teal-900 hover:bg-teal-50" onClick={()=>onChoose('alicia')}>
          <strong className="block text-2xl">ALICIA</strong><span className="mt-2 block">Annonces, fonds et prompts</span>
        </button>
      </div>
    </div>
  </main>
}
