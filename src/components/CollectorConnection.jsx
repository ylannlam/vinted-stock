const button='rounded-lg border px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
const primary='rounded-lg px-4 py-2 text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40'
export default function CollectorConnection({browser,busy,isAdmin,onCommand,onConnect}) {
  const blocked=browser?.phase==='blocked',connected=browser?.connected
  const label=!browser?'Connexion au navigateur indisponible':!connected?'Connecter ce navigateur':blocked?'Intervention nécessaire sur Shein':browser.enabled?'Import automatique actif':'Import en pause'
  return <div className={`rounded-xl border p-4 space-y-3 ${blocked?'border-amber-300 bg-amber-50':'bg-white'}`}>
    <div className="flex flex-wrap justify-between gap-3 items-center"><div><p className="font-medium text-sm"><span className={`inline-block w-2 h-2 rounded-full mr-2 ${connected&&!blocked&&browser.enabled?'bg-teal-600':'bg-amber-500'}`}/>{label}</p>
      <p className="text-xs text-gray-500 mt-1">{!browser?'L’extension 0.4.0 doit être active dans ce navigateur. Recharge cette page après sa mise à jour.':!connected?'Une seule connexion, puis tout se pilote ici. Aucun code à copier.':browser.message}</p></div>
      {isAdmin&&browser&&<div className="flex gap-2 flex-wrap">{!connected?<button className={primary} disabled={busy} onClick={onConnect}>Connecter et démarrer</button>:blocked?<><button className={button} disabled={busy} onClick={()=>onCommand('open')}>Ouvrir Shein</button><button className={primary} disabled={busy} onClick={()=>onCommand('resume')}>J’ai vérifié · reprendre</button></>:<button className={button} disabled={busy} onClick={()=>onCommand(browser.enabled?'pause':'start')}>{browser.enabled?'Mettre en pause':'Reprendre les imports'}</button>}</div>}
    </div>
    {connected&&browser.job&&<p className="text-xs break-all text-gray-600">En cours : {browser.job.expected_sku||browser.job.input}</p>}
    {!browser&&<details className="text-sm"><summary className="cursor-pointer text-teal-800">Installer ou mettre à jour la connexion</summary><div className="pt-3 space-y-3"><a className={`${primary} inline-block`} href="/downloads/shein-catalogue.zip?v=0.4.0" download>Télécharger l’extension</a><p>Décompresse le dossier. Dans <strong>edge://extensions</strong> ou <strong>chrome://extensions</strong>, charge-le comme extension non empaquetée. Si elle est déjà installée, remplace ses fichiers et clique sur son bouton de rechargement.</p><p>Reviens ici et actualise la page. Pas de run.bat ni de nouveau code d’association.</p></div></details>}
    {blocked&&<p className="text-xs text-amber-900">Termine la vérification dans l’onglet Shein, puis reprends ici. L’extension ne résout pas cette vérification.</p>}
  </div>
}
