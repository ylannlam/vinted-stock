import { nextCreationStep, readyWithoutTracking } from '../lib/accountTracking'
import { accountGroup, nextAccountAction } from '../lib/accountOverview'

const steps=['1re annonce','2e annonce','Compte prêt']
const actions={post1:'Confirmer la 1re annonce postée',post2:'Confirmer la 2e annonce postée',wait:'Marquer le compte comme prêt'}

export default function AccountPreparation({account,busy,onAdvance,onMarkReady,onEdit}) {
  const position={post1:0,post2:1,wait:2,ready:3}[account.creation_stage]
  const action=nextCreationStep(account)
  const legacy=readyWithoutTracking(account)
  if(account.is_shadowbanned||['banni_temp','banni_def','suspendu'].includes(account.statut)||account.creation_stage==='blocked')return <p className="text-xs text-gray-600">{nextAccountAction(account)}</p>
  if(accountGroup(account)==='ready')return <span className="inline-block rounded-md bg-teal-50 text-teal-700 px-2 py-1 text-xs font-semibold">Prêt</span>
  return <div className="space-y-3 min-w-64">
    {position!==undefined&&<ol aria-label="Progression de la préparation" className="flex gap-3">{steps.map((label,index)=><li key={label} aria-current={index===position?'step':undefined} className={`text-[11px] flex items-center gap-1.5 ${index<position?'text-teal-700':index===position?'text-gray-900 font-semibold':'text-gray-400'}`}><span className={`w-5 h-5 shrink-0 rounded-full inline-flex items-center justify-center ${index<position?'bg-teal-100':index===position?'bg-amber-100 text-amber-800':'bg-gray-100'}`}>{index<position?'✓':index+1}</span>{label}</li>)}</ol>}
    {action&&<button disabled={busy} onClick={()=>onAdvance(account)} className="rounded-lg bg-teal-600 text-white px-3 py-2 text-xs font-semibold hover:bg-teal-700 disabled:opacity-50">{actions[account.creation_stage]}</button>}
    {legacy&&<><p className="text-xs text-gray-500">Ancien compte · préparation non renseignée</p><div className="flex flex-wrap gap-3"><button disabled={busy} onClick={()=>onMarkReady(account)} className="rounded-lg bg-teal-600 text-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Marquer comme prêt</button><button disabled={busy} onClick={()=>onEdit(account)} className="text-xs text-teal-700 underline">Renseigner les étapes</button></div></>}
  </div>
}
