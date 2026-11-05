import {useEffect,useRef,useState} from 'react'
import {FACTORY_GROUP,parseProxyLines,proxyUsage,creatableAccounts,proxyChoices,profileName,proxyLabel,hardwareLabel,latestFingerprints,recentChange,accountForProfile} from '../lib/adspowerFactory'

const secondary='rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40'
const primary='rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40'
const field='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm'
const states={free:['Libre','bg-teal-50 text-teal-800'],used:['Utilisé','bg-slate-100 text-slate-600'],shared:['Partagé','bg-amber-100 text-amber-800']}
const day=value=>new Date(value).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})
const message=e=>e?.message||'L’opération n’a pas abouti. Réessaie.'

// Section de l'onglet AdsPower : proxys, création de profils et remplacement d'empreintes.
// Le connecteur du PC agit dans AdsPower ; la base garde le lien compte ↔ proxy ↔ profil.
export default function AdsPowerFactory({request,store,profiles,owner='preview',recoveryStorage=globalThis.sessionStorage,openedIds=null,launchingIds=new Set(),onChanged=()=>{}}){
  const recoveryKey=`adspower-create:${owner}`
  const [saved]=useState(()=>{try{return JSON.parse(recoveryStorage?.getItem(recoveryKey)||'null')}catch{return null}})
  function remember(value){if(recoveryStorage){if(value)recoveryStorage.setItem(recoveryKey,JSON.stringify(value));else recoveryStorage.removeItem(recoveryKey)}}
  const [data,setData]=useState(null),[adsProxies,setAdsProxies]=useState([]),[adsError,setAdsError]=useState('')
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [accountId,setAccountId]=useState(saved?.accountId||''),[proxyId,setProxyId]=useState(saved?.proxyId||''),[group,setGroup]=useState(saved?.group||FACTORY_GROUP)
  const [orphan,setOrphan]=useState(saved?.profile?saved:null),[adding,setAdding]=useState(false),[paste,setPaste]=useState(''),[confirmId,setConfirmId]=useState(null),[search,setSearch]=useState('')
  const alive=useRef(true),submission=useRef(saved?.requestId?saved:null)
  async function load(){
    setLoading(true)
    try{
      const [base,live]=await Promise.all([store.load(),request('/profiles/proxies').then(r=>({rows:r.profiles||[]}),e=>({error:e}))])
      if(!alive.current)return
      setData(base);setError('')
      if(live.error){setAdsError(`Proxys des profils AdsPower illisibles : ${message(live.error)}`)}else{setAdsProxies(live.rows);setAdsError('')}
    }catch(e){if(alive.current)setError(message(e))}
    finally{if(alive.current)setLoading(false)}
  }
  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false}},[store,request])
  if(!data)return <div className="p-5 text-sm text-slate-500">{loading?'Chargement des proxys et des comptes…':<span role="alert" className="text-amber-800">{error}</span>}</div>

  const usage=proxyUsage(data.proxies,data.accounts,adsProxies)
  const creatable=creatableAccounts(data.accounts),account=creatable.find(a=>a.id===accountId)||null
  const choices=proxyChoices(account,data.proxies,usage),proxy=choices.find(p=>p.id===proxyId)||choices[0]||null
  const groups=[...new Set([FACTORY_GROUP,...profiles.map(p=>p.group).filter(Boolean)])]
  const latest=latestFingerprints(data.log),shared=data.proxies.filter(p=>usage.get(p.id).state==='shared').length,free=data.proxies.filter(p=>usage.get(p.id).state==='free').length
  const parsed=parseProxyLines(paste)
  const pending=submission.current&&!orphan?submission.current:null
  const shown=profiles.filter(p=>[p.number,p.name,p.group].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  async function run(kind,work){
    if(busy)return
    setBusy(kind);setError('');setNotice('')
    try{await work()}catch(e){if(e.code==='factory_not_started'){remember(null);submission.current=null}if(alive.current)setError(message(e))}finally{if(alive.current)setBusy(null)}
  }
  const link=(target,created)=>run('link',async()=>{
    const linked=await store.link(target.accountId,target.proxyId,created)
    remember(null);submission.current=null;setOrphan(null);setNotice(`Profil #${created.profile_no} créé et relié à ${linked.pseudo} · ${hardwareLabel(created)}.`);await load();onChanged()
  })
  const create=()=>run('create',async()=>{
    if(loading||adsError)throw Error('Actualise les proxys AdsPower avant de créer un profil.')
    if(!account||!proxy)throw Error('Choisis un compte et un proxy libre.')
    if(submission.current)throw Error('Vérifie d’abord la création en attente.')
    await store.precheck(account.id,proxy.id)
    const secret=await store.secret(proxy.id)
    submission.current={requestId:crypto.randomUUID(),accountId:account.id,proxyId:proxy.id,group,name:profileName(account.pseudo),pseudo:account.pseudo}
    remember(submission.current)
    const {profile}=await request('/profiles/create',{requestId:submission.current.requestId,name:profileName(account.pseudo),group,proxy:secret})
    await finishCreation(submission.current,profile)
  })
  const recover=()=>run('recover',async()=>{
    const target=submission.current
    const {profile}=await request('/profiles/create',{requestId:target.requestId,name:target.name,group:target.group,proxy:await store.secret(target.proxyId)})
    await finishCreation(target,profile)
  })
  async function finishCreation(target,profile){
    remember({...target,profile});setOrphan({...target,profile});submission.current=null
    if(!profile.profile_no){setOrphan({...target,profile});throw Error('Le profil est créé dans AdsPower, mais son numéro n’a pas été renvoyé. Actualise la liste AdsPower puis saisis ce numéro dans la fiche du compte.')}
    try{const linked=await store.link(target.accountId,target.proxyId,profile);setNotice(`Profil #${profile.profile_no} créé pour ${linked.pseudo} · ${hardwareLabel(profile)}. Connecte le compte Vinted dans ce profil.`)}
    catch(e){setOrphan({...target,profile});throw Error(`Profil #${profile.profile_no} créé dans AdsPower, mais pas encore relié au compte : ${message(e)}`)}
    remember(null);submission.current=null;setOrphan(null);setAccountId('');setProxyId('');await load();onChanged()
  }
  const addProxies=()=>run('add',async()=>{
    if(!parsed.proxies.length)throw Error('Colle au moins un proxy (hôte:port:identifiant:motdepasse ou commande curl).')
    const added=await store.addProxies(parsed.proxies),skipped=parsed.proxies.length-added
    setPaste('');setAdding(false);setNotice(`${added} proxy${added>1?'s':''} ajouté${added>1?'s':''}${skipped?` · ${skipped} déjà enregistré${skipped>1?'s':''}`:''}.`);await load()
  })
  const replace=profile=>run(profile.id,async()=>{
    const {profile:result}=await request('/profiles/fingerprint',{requestId:crypto.randomUUID(),id:profile.id})
    setConfirmId(null)
    const owner=accountForProfile(profile,data.accounts)
    try{await store.logFingerprint({profile_id:profile.id,profile_no:/^\d{1,12}$/.test(profile.number)?profile.number:null,account_id:owner?.id??null,proxy_id:owner?.proxy_id??null,action:'update',resolution:result.resolution,threads:result.threads,gpu:result.gpu,chrome_major:result.chrome})}
    catch{setNotice(`Empreinte de #${profile.number} remplacée (${hardwareLabel(result)}), mais l’historique n’a pas été enregistré.`);return}
    setNotice(`Nouvelle empreinte pour #${profile.number} · ${hardwareLabel(result)}. Vinted peut demander une vérification à la prochaine connexion.`);await load()
  })

  return <div className="divide-y divide-slate-100">
    <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500">{data.proxies.length} proxy{data.proxies.length>1?'s':''} · {free} libre{free>1?'s':''}{shared?<span className="text-amber-800 font-semibold"> · {shared} partagé{shared>1?'s':''}</span>:''} · empreintes Windows 11 / NVIDIA prévues pour ce PC</p>
      <button className={secondary} disabled={loading||!!busy} onClick={load}>{loading?'Actualisation…':'Actualiser'}</button>
    </div>
    {(error||adsError)&&<p role="alert" className="px-5 py-3 bg-amber-50 text-sm text-amber-900">{error||adsError}</p>}
    {notice&&<p role="status" className="px-5 py-3 bg-teal-50 text-sm text-teal-900">{notice}</p>}
    {pending&&!busy&&<div role="alert" className="px-5 py-3 bg-amber-50 text-sm text-amber-900 flex flex-wrap items-center gap-3"><span className="flex-1">La création pour {pending.pseudo} attend une confirmation. Vérifie son résultat avant de créer un autre profil.</span><button className={secondary} onClick={recover}>Vérifier la création</button></div>}
    {orphan&&<div role="alert" className="px-5 py-3 bg-amber-50 text-sm text-amber-900 flex flex-wrap items-center gap-3"><span className="flex-1">Le profil {orphan.profile.profile_no?`#${orphan.profile.profile_no}`:''} existe dans AdsPower mais n’est pas relié à {orphan.pseudo}. Ne le recrée pas.</span>{orphan.profile.profile_no&&<button className={secondary} disabled={!!busy} onClick={()=>link(orphan,orphan.profile)}>{busy==='link'?'Liaison…':'Relier maintenant'}</button>}</div>}

    <section aria-labelledby="factory-create" className="px-5 py-4 space-y-3">
      <h3 id="factory-create" className="text-sm font-semibold">Créer un profil pour un compte</h3>
      <div className="grid gap-3 md:grid-cols-[1.2fr_1.5fr_1fr_auto] items-end">
        <label className="text-xs text-slate-500">Compte Vinted<select aria-label="Compte à équiper" className={`${field} mt-1`} value={account?.id||''} onChange={e=>{setAccountId(e.target.value);setProxyId('')}}><option value="">{creatable.length?'Choisir un compte…':'Aucun compte sans profil'}</option>{creatable.map(a=><option key={a.id} value={a.id}>{a.pseudo}{a.creation_stage==='ready'?' · prêt':''}</option>)}</select></label>
        <label className="text-xs text-slate-500">Proxy<select aria-label="Proxy du profil" className={`${field} mt-1`} disabled={!account||choices.length<2} value={proxy?.id||''} onChange={e=>setProxyId(e.target.value)}>{!proxy&&<option value="">{account?'Aucun proxy libre':'—'}</option>}{choices.map(p=><option key={p.id} value={p.id}>{proxyLabel(p)}</option>)}</select></label>
        <label className="text-xs text-slate-500">Groupe AdsPower<select aria-label="Groupe AdsPower" className={`${field} mt-1`} value={group} onChange={e=>setGroup(e.target.value)}>{groups.map(g=><option key={g}>{g}</option>)}</select></label>
        <button className={primary} disabled={loading||!!adsError||!account||!proxy||!!busy||!!orphan||!!pending} onClick={create}>{busy==='create'?'Création…':'Créer le profil'}</button>
      </div>
      <p className="text-xs text-slate-400">{account?.proxy_id?'Ce compte garde son proxy actuel. ':''}Le profil porte le pseudo du compte, reçoit une empreinte cohérente avec ce PC et son numéro est enregistré sur le compte.</p>
    </section>

    <section aria-labelledby="factory-proxies" className="px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="factory-proxies" className="text-sm font-semibold">Proxys</h3><button className={secondary} disabled={!!busy} onClick={()=>setAdding(!adding)}>{adding?'Fermer':'+ Ajouter des proxys'}</button></div>
      {adding&&<div className="rounded-xl border border-slate-200 p-3 space-y-2">
        <textarea aria-label="Proxys à ajouter" rows={4} spellCheck={false} autoComplete="off" className={`${field} font-mono text-xs`} placeholder={'curl -x disp.oxylabs.io:8001 -U "user-disp_xxxxxxxx:motdepasse" https://ip.oxylabs.io/location\ndisp.oxylabs.io:8001:disp_xxxxxxxx:motdepasse\nisp.decodo.com:10011:identifiant:motdepasse'} value={paste} onChange={e=>setPaste(e.target.value)}/>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-500">Un proxy par ligne : <code>hôte:port:identifiant:motdepasse</code>, ou la commande <code>curl</code> d’Oxylabs collée telle quelle. Oxylabs : le préfixe « user- » est ajouté tout seul.{parsed.errors.length>0&&<span className="block text-amber-800 mt-1">{parsed.errors.slice(0,3).map(e=>`Ligne ${e.line} : ${e.message}`).join(' · ')}{parsed.errors.length>3?' …':''}</span>}</span><button className={primary} disabled={!parsed.proxies.length||!!busy} onClick={addProxies}>{busy==='add'?'Enregistrement…':`Enregistrer ${parsed.proxies.length} proxy${parsed.proxies.length>1?'s':''}`}</button></div>
      </div>}
      {shared>0&&<p className="text-xs text-amber-800">Un proxy partagé relie entre eux les comptes qui l’utilisent. Donne à chacun son propre proxy.</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="py-2 pr-3 font-semibold">Proxy</th><th className="py-2 pr-3 font-semibold">Fournisseur</th><th className="py-2 pr-3 font-semibold">Utilisé par</th><th className="py-2 font-semibold">État</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.proxies.map(p=>{const u=usage.get(p.id),[label,tone]=states[u.state];return <tr key={p.id}><td className="py-2 pr-3 font-mono text-slate-700">{proxyLabel(p)}{p.nom&&<span className="block font-sans text-[11px] text-slate-400">{p.nom}</span>}</td><td className="py-2 pr-3 text-slate-500">{p.fournisseur||'—'}</td><td className="py-2 pr-3 text-slate-600">{[...u.accounts.map(a=>a.pseudo),...u.profiles.filter(x=>!u.accounts.some(a=>String(a.number)===String(x.number))).map(x=>`Profil #${x.number}`)].join(', ')||'—'}</td><td className="py-2"><span className={`rounded-full px-2 py-1 font-semibold ${tone}`}>{label}</span></td></tr>})}
          {!data.proxies.length&&<tr><td colSpan={4} className="py-6 text-center text-slate-500">Aucun proxy enregistré. Ajoute tes proxys pour créer des profils.</td></tr>}</tbody></table></div>
    </section>

    <section aria-labelledby="factory-fingerprints" className="px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="factory-fingerprints" className="text-sm font-semibold">Empreintes des profils</h3><input aria-label="Rechercher un profil à modifier" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" placeholder="Numéro ou nom…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <p className="text-xs text-slate-500">Remplacer une empreinte garde le proxy, les cookies et la session, mais Vinted voit un nouvel appareil. Fais-le un profil à la fois, et pas tous le même jour.</p>
      <div className="divide-y divide-slate-100">{shown.map(p=>{
        const entry=latest.get(p.id),owner=accountForProfile(p,data.accounts),open=openedIds?.has(p.id)||p.opened,launching=launchingIds.has(p.id),recent=recentChange(entry)
        return <div key={p.id} className="py-2.5 flex flex-wrap items-center gap-3 text-xs">
          <span className="w-12 font-bold text-teal-800">#{p.number}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-700">{p.name}</span><span className="block text-slate-400">{owner?owner.pseudo:'Aucun compte relié'} · {entry?`${entry.action==='create'?'Créé':'Modifié'} le ${day(entry.created_at)} · ${hardwareLabel(entry)}`:'Empreinte d’origine'}</span></span>
          {confirmId===p.id?<span role="group" aria-label={`Confirmer la nouvelle empreinte de ${p.number}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900"><span>{recent?'Déjà modifié cette semaine. ':''}Remplacer l’empreinte ? Irréversible.</span><button className={secondary} disabled={!!busy} onClick={()=>setConfirmId(null)}>Annuler</button><button className="rounded-lg bg-amber-700 px-3 py-2 font-semibold text-white disabled:opacity-40" disabled={!!busy} onClick={()=>replace(p)}>{busy===p.id?'Remplacement…':'Remplacer'}</button></span>
            :<button className={secondary} disabled={!!busy||open||launching} title={open?'Ferme ce profil dans AdsPower d’abord':launching?'Profil en cours de lancement':''} onClick={()=>{setConfirmId(p.id);setError('');setNotice('')}}>{open?'Profil ouvert':launching?'En lancement':'Nouvelle empreinte'}</button>}
        </div>})}
        {!shown.length&&<p className="py-6 text-center text-xs text-slate-500">{profiles.length?'Aucun profil ne correspond.':'Aucun profil AdsPower lu sur ce PC.'}</p>}</div>
    </section>
  </div>
}
