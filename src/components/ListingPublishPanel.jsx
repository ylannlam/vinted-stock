import ListingPublisher,{YlavintTransfer} from './ListingPublisher'
import {listingStateLabels} from '../lib/listingStudio'

const button='rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50'
const primary='rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50'

export function ListingChecklist({issues,onFix,busy}){
 return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
  <p className="font-semibold text-amber-950">{issues.length} point{issues.length>1?'s':''} à compléter</p>
  <p className="mt-1 text-sm text-amber-900">Clique sur un point pour accéder au champ.</p>
  <ul className="mt-3 space-y-1">{issues.map(issue=><li key={issue.key}><button type="button" disabled={busy} onClick={()=>onFix(issue)} className="w-full rounded-lg px-2 py-2 text-left text-sm text-amber-950 hover:bg-amber-100 underline underline-offset-4 disabled:opacity-50">{issue.label} →</button></li>)}</ul>
 </div>
}

export default function ListingPublishPanel({account,issues,busy,dirty,error,notice,onFix,onPublish,onSave,onConnection,onAccounts,provider='dotb',mode='live',dotb=true}){
 const ylavint=provider==='ylavint',available=ylavint?account?.ylavint?.ready:dotb
 return <section aria-label="Vérification avant publication" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5">
  <div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Dernière vérification</p><h2 className="mt-2 text-xl font-bold">Prêt à mettre ton article en vente ?</h2><p className="mt-2 text-sm text-slate-600">La fiche reste privée sur Stock Vinted jusqu’à l’envoi. L’outil et le mode se changent dans les Réglages des annonces (tous les comptes).</p></div>
  <div className="rounded-xl bg-teal-50 p-4"><p className="text-xs text-teal-800">Compte de destination</p><p className="mt-1 text-lg font-bold text-teal-950">{account?`#${account.profile_number||'—'} · ${account.login}`:'Compte à choisir'}</p></div>
  <ListingPublisher value={provider} mode={mode} disabled={!!busy} ylavint={account?.ylavint} dotb={dotb} accountId={account?.id} onEnabled={onConnection}/>
  {!!issues.length&&<ListingChecklist issues={issues} onFix={onFix} busy={!!busy}/>}
  {!issues.length&&<p className="rounded-xl bg-teal-50 p-4 font-medium text-teal-900">✓ Les informations obligatoires sont complètes.</p>}
  {ylavint?<p className="text-sm text-slate-600">Les photos et la fiche seront envoyées par le profil AdsPower ciblé. Le suivi restera accessible ici. <button type="button" className="underline" disabled={!!busy} onClick={onConnection}>Vérifier la connexion</button></p>:<div className="rounded-xl border p-4 space-y-3">
   <p className="text-sm font-semibold">{account?.connected?'✓ Bridge Dotb connecté':'Connexion du compte à vérifier'}</p>
   {!account?.connected&&<p className="text-sm text-slate-600">Ouvre ce profil dans AdsPower et active son Bridge Dotb. Reviens ensuite vérifier la connexion.</p>}
   <div className="flex flex-wrap gap-3"><button type="button" className="text-sm font-semibold text-teal-800 underline" disabled={!!busy} onClick={onConnection}>Vérifier la connexion</button>{onAccounts&&<button type="button" className="text-sm text-teal-800 underline" disabled={!!busy} onClick={onAccounts}>Ouvrir AdsPower</button>}</div>
  </div>}
  {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{notice}</p>}
  <button type="button" className={`${primary} w-full`} disabled={!!busy||(!available&&!issues.length)} onClick={issues.length?()=>onFix(issues[0]):()=>onPublish(mode)}>{busy||(issues.length?'Compléter la fiche →':`${mode==='draft'?'Brouillon':'Publier'} avec ${ylavint?'YlaVint':'Dotb'} sur ${account?.login||'le compte choisi'}`)}</button>
  <button type="button" className={`${button} w-full`} disabled={!!busy} onClick={onSave}>Enregistrer le brouillon</button>
  <p className="text-xs leading-relaxed text-slate-500">{dirty?'Modifications à enregistrer.':'Brouillon enregistré sur Stock Vinted.'} L’enregistrement ne publie rien sur Vinted.</p>
 </section>
}

export function ListingTransfer({draft,photos,busy,onResume,onRefresh,onCancel,manual=false}){
 if(draft.publish_provider==='ylavint')return <YlavintTransfer draft={draft} busy={busy} onRefresh={onRefresh} onCancel={onCancel}/>
 // Publiée à la main (sans Dotb) : pas d'étapes Dotb à afficher.
 if(draft.state==='published'&&!draft.dotb_item_id)return <section id="listing-progress" aria-label="Suivi de la publication" className="scroll-mt-40 rounded-2xl border border-teal-200 bg-white p-5 sm:p-6 space-y-4"><h2 className="text-xl font-bold">Publiée à la main</h2><p role="status" className="rounded-xl bg-teal-50 p-4 text-sm text-teal-950">{draft.message||'Annonce publiée sur Vinted.'}</p>{draft.url&&<a className={`${primary} inline-block`} href={draft.url} target="_blank" rel="noreferrer">Voir l’annonce sur Vinted ↗</a>}</section>
 const interrupted=draft.state==='preparing'&&draft.last_error
 const stages=[['Fiche créée dans Dotb',!!draft.dotb_item_id],['Photos transmises',!!draft.dotb_item_id&&draft.uploaded===photos.length],['Publication demandée',['scheduled','published'].includes(draft.state)],['En ligne sur Vinted',draft.state==='published']]
 return <section id="listing-progress" aria-label="Suivi de la publication" className="scroll-mt-40 rounded-2xl border border-teal-200 bg-white p-5 sm:p-6">
  <h2 className="text-xl font-bold">{interrupted?'Envoi interrompu':listingStateLabels[draft.state]}</h2>
  <p role="status" className={`mt-3 rounded-xl p-4 text-sm ${draft.last_error||draft.state==='attention'?'bg-amber-50 text-amber-950':'bg-teal-50 text-teal-950'}`}>{draft.last_error||draft.message||listingStateLabels[draft.state]}</p>
  <ol className="my-5 grid gap-3 sm:grid-cols-2">{stages.map(([label,done],i)=><li key={label} className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${done?'border-teal-200 text-teal-800':'border-slate-200 text-slate-500'}`}><span aria-hidden="true" className="font-bold">{done?'✓':i+1}</span>{label}</li>)}</ol>
  {draft.state==='preparing'&&<><progress aria-label="Photos transmises" className="w-full accent-teal-700" max={Math.max(1,photos.length)} value={draft.uploaded}/><p className="mt-2 text-sm text-slate-600">{draft.uploaded} / {photos.length} photos transmises. {manual?'Aucun nouvel envoi ne sera fait tant que Dotb est coupé.':'Garde cette page ouverte pendant l’envoi. Si tu la quittes, rouvre ce brouillon pour reprendre.'}</p><button className={`${primary} mt-4`} disabled={!!busy} onClick={onResume}>{busy||(manual?'Vérifier la fiche':'Reprendre / vérifier l’envoi')}</button></>}
  {['scheduled','attention'].includes(draft.state)&&<><p className="text-sm text-slate-600">{manual?'Une demande peut déjà exister dans Dotb. Vérifie son résultat avant toute publication manuelle.':'Garde le profil AdsPower et le Bridge ouverts. La mise en ligne sera confirmée ici par Dotb.'}</p><button className={`${button} mt-4`} disabled={!!busy} onClick={onRefresh}>{busy||'Vérifier la publication'}</button></>}
  {(draft.state==='attention'||manual&&draft.state==='preparing')&&<a className={`${button} inline-block mt-4 ml-2`} href="https://dotb.io" target="_blank" rel="noreferrer">Ouvrir Dotb ↗</a>}
  {draft.url&&<a className={`${primary} inline-block`} href={draft.url} target="_blank" rel="noreferrer">Voir l’annonce sur Vinted ↗</a>}
 </section>
}
