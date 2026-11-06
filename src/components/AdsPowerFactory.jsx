import {useEffect,useRef,useState} from 'react'
import {FACTORY_GROUP,parseProxyLines,proxyUsage,creatableAccounts,proxyChoices,profileName,proxyLabel,hardwareLabel,latestFingerprints,recentChange,accountForProfile,unlinkedProfilesNamed,serviceAccounts,ownerLabel,linkedProfile,liveProxyOf,savedProxyFor,profileChoices,proxyForLink} from '../lib/adspowerFactory'

const secondary='rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40'
const primary='rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40'
const field='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm'
const small='rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs'
const states={free:['Libre','bg-teal-50 text-teal-800'],used:['Utilisé','bg-slate-100 text-slate-600'],shared:['Partagé','bg-amber-100 text-amber-800']}
const day=value=>new Date(value).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})
const message=e=>e?.message||'L’opération n’a pas abouti. Réessaie.'
const plural=(n,word)=>`${n} ${word}${n>1?'s':''}`
const liveLabel=proxy=>`${proxy.host}:${proxy.port} · ${proxy.user}`

// Section de l'onglet AdsPower, organisée par compte : chaque compte en service est relié à son
// profil AdsPower, et le proxy suit le profil. Le connecteur du PC agit dans AdsPower ; la base
// garde le lien compte ↔ proxy ↔ profil. Les profils des comptes bannis restent à part.
export default function AdsPowerFactory({request,store,profiles,owner='preview',recoveryStorage=globalThis.sessionStorage,openedIds=null,launchingIds=new Set(),shownIds=null,onUseProfiles=null,onChanged=()=>{}}){
  const recoveryKey=`adspower-create:${owner}`
  const [saved]=useState(()=>{try{return JSON.parse(recoveryStorage?.getItem(recoveryKey)||'null')}catch{return null}})
  function remember(value){if(recoveryStorage){if(value)recoveryStorage.setItem(recoveryKey,JSON.stringify(value));else recoveryStorage.removeItem(recoveryKey)}}
  const [data,setData]=useState(null),[adsProxies,setAdsProxies]=useState([]),[adsError,setAdsError]=useState('')
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [accountId,setAccountId]=useState(saved?.accountId||''),[proxyId,setProxyId]=useState(saved?.proxyId||''),[group,setGroup]=useState(saved?.group||FACTORY_GROUP)
  const [orphan,setOrphan]=useState(saved?.profile?saved:null),[adding,setAdding]=useState(false),[paste,setPaste]=useState(''),[confirmId,setConfirmId]=useState(null),[search,setSearch]=useState(''),[confirmedId,setConfirmedId]=useState('')
  const [editing,setEditing]=useState(''),[picks,setPicks]=useState({}),[removeId,setRemoveId]=useState(null)
  const alive=useRef(true),submission=useRef(saved?.requestId?saved:null),createForm=useRef(null)
  async function load(){
    setLoading(true);setConfirmedId('')
    try{
      const [base,live]=await Promise.all([store.load(),request('/profiles/proxies').then(r=>({rows:r.profiles||[]}),e=>({error:e}))])
      if(!alive.current)return
      setData(base);setError('')
      if(live.error){setAdsError(`Proxys des profils AdsPower illisibles : ${message(live.error)}`)}else{setAdsProxies(live.rows);setAdsError('')}
    }catch(e){if(alive.current)setError(message(e))}
    finally{if(alive.current)setLoading(false)}
  }
  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false}},[store,request])
  if(!data)return <div className="p-5 text-sm text-slate-500">{loading?'Chargement des comptes, profils et proxys…':<span role="alert" className="text-amber-800">{error}</span>}</div>

  const usage=proxyUsage(data.proxies,data.accounts,adsProxies)
  const service=serviceAccounts(data.accounts)
  const serviceRows=service.map(a=>({account:a,profile:linkedProfile(a,profiles)}))
  const serviceProfileIds=new Set(serviceRows.map(r=>r.profile?.id).filter(Boolean))
  const others=profiles.filter(p=>!serviceProfileIds.has(p.id))
  const creatable=creatableAccounts(data.accounts),account=creatable.find(a=>a.id===accountId)||null
  const choices=proxyChoices(account,data.proxies,usage),proxy=choices.find(p=>p.id===proxyId)||choices[0]||null
  const twins=unlinkedProfilesNamed(account,profiles,data.accounts)
  const twinConsentKey=JSON.stringify([account?.id,account?.pseudo,twins.map(p=>[p.id,p.number]).sort()])
  const twinBlocked=twins.length>0&&confirmedId!==twinConsentKey
  const groups=[...new Set([FACTORY_GROUP,...profiles.map(p=>p.group).filter(Boolean)])]
  const latest=latestFingerprints(data.log),shared=data.proxies.filter(p=>usage.get(p.id).state==='shared').length,free=data.proxies.filter(p=>usage.get(p.id).state==='free').length
  const parsed=parseProxyLines(paste)
  const pending=submission.current&&!orphan?submission.current:null
  const shownOthers=others.filter(p=>[p.number,p.name,p.group,ownerLabel(accountForProfile(p,data.accounts))].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const linkedIds=serviceRows.map(r=>r.profile?.id).filter(Boolean)
  const listDiffers=onUseProfiles&&linkedIds.length>0&&(!shownIds||shownIds.length!==linkedIds.length||linkedIds.some(id=>!shownIds.includes(id)))

  async function run(kind,work){
    if(busy)return
    setBusy(kind);setError('');setNotice('')
    try{await work()}catch(e){if(e.code==='factory_not_started'){remember(null);submission.current=null}if(alive.current)setError(message(e))}finally{if(alive.current)setBusy(null)}
  }
  const link=(target,created)=>run('link',async()=>{
    const linked=await store.link(target.accountId,target.proxyId,created)
    remember(null);submission.current=null;setOrphan(null);setNotice(`Profil #${created.profile_no} créé et relié à ${linked.pseudo} · ${hardwareLabel(created)}.`);await load();onChanged()
  })
  // Relier un compte à un profil qui existe déjà (ou le délier) : rien n'est modifié dans AdsPower.
  const attach=(target,profile)=>run(`attach:${target.id}`,async()=>{
    if(adsError)throw Error('Actualise les proxys AdsPower avant de relier un profil.')
    if(profile&&!/^\d{1,12}$/.test(String(profile.number)))throw Error('Ce profil n’a pas de numéro AdsPower lisible.')
    const holder=profile&&accountForProfile(profile,data.accounts)
    if(holder&&holder.id!==target.id)throw Error(`Le profil #${profile.number} est déjà relié à ${holder.pseudo}.`)
    const proxyIdForLink=profile?proxyForLink(target,profile,data.accounts,data.proxies,adsProxies):null
    const row=await store.linkExisting(target.id,profile?String(profile.number):null,proxyIdForLink)
    setEditing('');setPicks(old=>({...old,[target.id]:undefined}))
    const savedProxy=data.proxies.find(p=>p.id===proxyIdForLink)
    setNotice(profile?`Profil #${profile.number} relié à ${row.pseudo}${savedProxy?` · proxy ${proxyLabel(savedProxy)}`:''}.`:`${row.pseudo} n’a plus de profil AdsPower relié.`)
    await load();onChanged()
  })
  const create=()=>run('create',async()=>{
    if(loading||adsError)throw Error('Actualise les proxys AdsPower avant de créer un profil.')
    if(!account||!proxy)throw Error('Choisis un compte et un proxy libre.')
    if(twinBlocked)throw Error(`Un profil AdsPower au nom de ${account.pseudo} existe déjà (${twins.map(p=>`#${p.number}`).join(', ')}). Relie-le au compte au lieu d’en créer un autre.`)
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
    if(!profile.profile_no){setOrphan({...target,profile});throw Error('Le profil est créé dans AdsPower, mais son numéro n’a pas été renvoyé. Actualise la liste AdsPower puis relie ce profil au compte.')}
    try{const linked=await store.link(target.accountId,target.proxyId,profile);setNotice(`Profil #${profile.profile_no} créé pour ${linked.pseudo} · ${hardwareLabel(profile)}. Connecte le compte Vinted dans ce profil.`)}
    catch(e){setOrphan({...target,profile});throw Error(`Profil #${profile.profile_no} créé dans AdsPower, mais pas encore relié au compte : ${message(e)}`)}
    remember(null);submission.current=null;setOrphan(null);setAccountId('');setProxyId('');await load();onChanged()
  }
  const addProxies=()=>run('add',async()=>{
    if(!parsed.proxies.length)throw Error('Colle au moins un proxy (hôte:port:identifiant:motdepasse ou commande curl).')
    const added=await store.addProxies(parsed.proxies),skipped=parsed.proxies.length-added
    setPaste('');setAdding(false);setNotice(`${added} proxy${added>1?'s':''} ajouté${added>1?'s':''}${skipped?` · ${skipped} déjà enregistré${skipped>1?'s':''}`:''}.`);await load()
  })
  const removeProxy=target=>run(`remove:${target.id}`,async()=>{
    if(adsError)throw Error('Actualise les proxys AdsPower avant de supprimer un proxy.')
    if(usage.get(target.id)?.state!=='free')throw Error('Ce proxy est encore utilisé par un compte ou un profil AdsPower.')
    await store.deleteProxy(target.id)
    setRemoveId(null);setNotice(`Proxy ${proxyLabel(target)} supprimé du site. Il n’est pas résilié chez ${target.fournisseur||'le fournisseur'}.`);await load()
  })
  const replace=profile=>run(profile.id,async()=>{
    const {profile:result}=await request('/profiles/fingerprint',{requestId:crypto.randomUUID(),id:profile.id})
    setConfirmId(null)
    const holder=accountForProfile(profile,data.accounts)
    try{await store.logFingerprint({profile_id:profile.id,profile_no:/^\d{1,12}$/.test(profile.number)?profile.number:null,account_id:holder?.id??null,proxy_id:holder?.proxy_id??null,action:'update',resolution:result.resolution,threads:result.threads,gpu:result.gpu,chrome_major:result.chrome})}
    catch{setNotice(`Empreinte de #${profile.number} remplacée (${hardwareLabel(result)}), mais l’historique n’a pas été enregistré.`);return}
    setNotice(`Nouvelle empreinte pour #${profile.number} · ${hardwareLabel(result)}. Si le compte Vinted est déconnecté, reconnecte-le dans ce profil.`);await load()
  })
  const useProfiles=()=>run('show',async()=>{
    if(await onUseProfiles(linkedIds))setNotice(`« Mes comptes » affiche maintenant les ${plural(linkedIds.length,'profil')} de tes comptes en service.`)
  })
  function prepareCreation(target){
    setAccountId(target.id);setProxyId('');setConfirmedId('');setError('');setNotice('')
    createForm.current?.scrollIntoView?.({behavior:'smooth',block:'center'})
  }

  function fingerprintCell(p){
    const entry=latest.get(p.id),open=openedIds?.has(p.id)||p.opened,launching=launchingIds.has(p.id),recent=recentChange(entry)
    const summary=entry?`${entry.action==='create'?'Créée':'Modifiée'} le ${day(entry.created_at)} · ${hardwareLabel(entry)}`:'Empreinte d’origine'
    return <div className="flex flex-wrap items-center gap-2">
      <span className="text-slate-400">{summary}</span>
      {confirmId===p.id?<span role="group" aria-label={`Confirmer la nouvelle empreinte de ${p.number}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900"><span>{recent?'Déjà modifiée cette semaine. ':''}Remplacer l’empreinte ? Irréversible : le compte sera probablement déconnecté de Vinted.</span><button className={secondary} disabled={!!busy} onClick={()=>setConfirmId(null)}>Annuler</button><button className="rounded-lg bg-amber-700 px-3 py-2 font-semibold text-white disabled:opacity-40" disabled={!!busy} onClick={()=>replace(p)}>{busy===p.id?'Remplacement…':'Remplacer'}</button></span>
        :<button className={secondary} disabled={!!busy||open||launching} title={open?'Ferme ce profil dans AdsPower d’abord':launching?'Profil en cours de lancement':''} onClick={()=>{setConfirmId(p.id);setError('');setNotice('')}}>{open?'Profil ouvert':launching?'En lancement':'Nouvelle empreinte'}</button>}
    </div>
  }
  function proxyCell(target,profile){
    if(!profile){const planned=data.proxies.find(p=>p.id===target.proxy_id);return <span className="text-slate-400">{planned?`Prévu : ${proxyLabel(planned)}`:'—'}</span>}
    if(adsError)return <span className="text-slate-400">Proxy illisible</span>
    const live=liveProxyOf(profile,adsProxies)
    if(!live)return <span className="font-semibold text-amber-800">Aucun proxy dans AdsPower</span>
    const known=savedProxyFor(live,data.proxies),u=known&&usage.get(known.id)
    const takenBy=known&&data.accounts.find(a=>!a.deleted_at&&a.id!==target.id&&a.proxy_id===known.id)
    return <span className="block">
      <span className="block font-mono text-slate-700">{liveLabel(live)}</span>
      {!known&&<span className="block text-slate-400">Pas enregistré sur le site</span>}
      {u?.state==='shared'&&<span className="block font-semibold text-amber-800">Partagé{takenBy?` avec ${takenBy.pseudo}`:''} : donne-lui son propre proxy dans AdsPower</span>}
      {known&&!takenBy&&known.id!==target.proxy_id&&<button className="mt-1 text-teal-700 underline disabled:opacity-40" disabled={!!busy} onClick={()=>attach(target,profile)}>Enregistrer ce proxy sur le compte</button>}
    </span>
  }
  function profileCell(target,profile){
    const number=String(target.ads_power_num??'').trim(),options=profileChoices(target,profiles,data.accounts,adsProxies,data.proxies)
    const editingThis=editing===target.id||!number
    const suggested=options.find(p=>p.match>0&&p.id!==profile?.id)
    const picked=picks[target.id]??(number?'':suggested?.id||'')
    const chosen=options.find(p=>p.id===picked)||null
    return <div className="space-y-1.5">
      {profile&&<span className="block"><b className="text-teal-800">#{profile.number}</b> <span className="text-slate-600">{profile.name}</span></span>}
      {number&&!profile&&<span className="block font-semibold text-amber-800">Profil #{number} introuvable dans AdsPower</span>}
      {!number&&<span className="block text-slate-400">Aucun profil relié</span>}
      {editingThis?<span className="flex flex-wrap items-center gap-2">
        <select aria-label={`Profil à relier à ${target.pseudo}`} className={`${small} max-w-[15rem]`} value={picked} onChange={e=>setPicks(old=>({...old,[target.id]:e.target.value}))}>
          <option value="">{options.length?'Choisir un profil…':'Aucun profil libre'}</option>
          {options.map(p=><option key={p.id} value={p.id}>#{p.number} · {p.name}{p.match===2?' · utilise son proxy':p.match===1?' · même nom':''}</option>)}
        </select>
        <button className={secondary} disabled={!!busy||!chosen||chosen.id===profile?.id||!!adsError} onClick={()=>attach(target,chosen)}>{busy===`attach:${target.id}`?'Liaison…':'Relier'}</button>
        {number&&<button className="text-slate-500 underline disabled:opacity-40" disabled={!!busy} onClick={()=>attach(target,null)}>Délier</button>}
        {number&&<button className="text-slate-500 underline" onClick={()=>setEditing('')}>Fermer</button>}
        {!number&&creatable.some(a=>a.id===target.id)&&<button className="text-teal-700 underline" onClick={()=>prepareCreation(target)}>ou créer un profil</button>}
      </span>:<button className="text-teal-700 underline" onClick={()=>{setEditing(target.id);setPicks(old=>({...old,[target.id]:undefined}))}}>Changer de profil</button>}
    </div>
  }

  return <div className="divide-y divide-slate-100">
    <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500">{plural(service.length,'compte')} en service · {serviceRows.filter(r=>r.profile).length} relié{serviceRows.filter(r=>r.profile).length>1?'s':''} à un profil · {data.proxies.length} proxy{data.proxies.length>1?'s':''} · {free} libre{free>1?'s':''}{shared?<span className="text-amber-800 font-semibold"> · {shared} partagé{shared>1?'s':''}</span>:''}</p>
      <button className={secondary} disabled={loading||!!busy} onClick={load}>{loading?'Actualisation…':'Actualiser'}</button>
    </div>
    {(error||adsError)&&<p role="alert" className="px-5 py-3 bg-amber-50 text-sm text-amber-900">{error||adsError}</p>}
    {notice&&<p role="status" className="px-5 py-3 bg-teal-50 text-sm text-teal-900">{notice}</p>}
    {pending&&!busy&&<div role="alert" className="px-5 py-3 bg-amber-50 text-sm text-amber-900 flex flex-wrap items-center gap-3"><span className="flex-1">La création pour {pending.pseudo} attend une confirmation. Vérifie son résultat avant de créer un autre profil.</span><button className={secondary} onClick={recover}>Vérifier la création</button></div>}
    {orphan&&<div role="alert" className="px-5 py-3 bg-amber-50 text-sm text-amber-900 flex flex-wrap items-center gap-3"><span className="flex-1">Le profil {orphan.profile.profile_no?`#${orphan.profile.profile_no}`:''} existe dans AdsPower mais n’est pas relié à {orphan.pseudo}. Ne le recrée pas.</span>{orphan.profile.profile_no&&<button className={secondary} disabled={!!busy} onClick={()=>link(orphan,orphan.profile)}>{busy==='link'?'Liaison…':'Relier maintenant'}</button>}</div>}

    <section aria-labelledby="factory-accounts" className="px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="factory-accounts" className="text-sm font-semibold">Mes comptes en service</h3>{listDiffers&&<button className={secondary} disabled={!!busy} onClick={useProfiles}>{busy==='show'?'Enregistrement…':`Utiliser ces ${plural(linkedIds.length,'profil')} dans « Mes comptes »`}</button>}</div>
      <p className="text-xs text-slate-500">Un compte = un profil AdsPower = un proxy. Relie chaque compte à son profil : le proxy est lu dans le profil. Les comptes en Shadowban, bannis ou dans la corbeille n’apparaissent pas ici.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs align-top"><thead className="text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="py-2 pr-3 font-semibold w-[16%]">Compte</th><th className="py-2 pr-3 font-semibold w-[30%]">Profil AdsPower</th><th className="py-2 pr-3 font-semibold w-[24%]">Proxy du profil</th><th className="py-2 font-semibold">Empreinte</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{serviceRows.map(({account:a,profile:p})=><tr key={a.id} className="align-top">
          <td className="py-3 pr-3"><span className="block font-semibold text-slate-700">{a.pseudo}</span><span className="block text-slate-400">{a.statut==='actif'?'Actif':a.statut==='en_preparation'?'En préparation':'Statut non renseigné'}</span></td>
          <td className="py-3 pr-3">{profileCell(a,p)}</td>
          <td className="py-3 pr-3">{proxyCell(a,p)}</td>
          <td className="py-3">{p?fingerprintCell(p):<span className="text-slate-400">—</span>}</td>
        </tr>)}
        {!serviceRows.length&&<tr><td colSpan={4} className="py-6 text-center text-slate-500">Aucun compte en service. Ajoute tes comptes dans « Comptes ».</td></tr>}</tbody></table></div>
      <p className="text-xs text-slate-500">Changer une empreinte garde le proxy, mais AdsPower peut effacer la session du profil : le compte Vinted est alors déconnecté et l’historique vidé (constaté sur un profil). Ne le fais que sur un profil dont la session n’est pas à garder, un profil à la fois.</p>
    </section>

    <section ref={createForm} aria-labelledby="factory-create" className="px-5 py-4 space-y-3">
      <h3 id="factory-create" className="text-sm font-semibold">Créer un profil pour un compte</h3>
      <div className="grid gap-3 md:grid-cols-[1.2fr_1.5fr_1fr_auto] items-end">
        <label className="text-xs text-slate-500">Compte Vinted<select aria-label="Compte à équiper" className={`${field} mt-1`} value={account?.id||''} onChange={e=>{setAccountId(e.target.value);setProxyId('');setConfirmedId('')}}><option value="">{creatable.length?'Choisir un compte…':'Aucun compte sans profil'}</option>{creatable.map(a=><option key={a.id} value={a.id}>{a.pseudo}{a.creation_stage==='ready'?' · prêt':''}</option>)}</select></label>
        <label className="text-xs text-slate-500">Proxy<select aria-label="Proxy du profil" className={`${field} mt-1`} disabled={!account||choices.length<2} value={proxy?.id||''} onChange={e=>setProxyId(e.target.value)}>{!proxy&&<option value="">{account?'Aucun proxy libre':'—'}</option>}{choices.map(p=><option key={p.id} value={p.id}>{proxyLabel(p)}</option>)}</select></label>
        <label className="text-xs text-slate-500">Groupe AdsPower<select aria-label="Groupe AdsPower" className={`${field} mt-1`} value={group} onChange={e=>setGroup(e.target.value)}>{groups.map(g=><option key={g}>{g}</option>)}</select></label>
        <button className={primary} disabled={loading||!!adsError||!account||!proxy||!!busy||!!orphan||!!pending||twinBlocked} onClick={create}>{busy==='create'?'Création…':'Créer le profil'}</button>
      </div>
      {twins.length>0&&<div role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 flex flex-wrap items-center gap-3"><span className="flex-1">Un profil AdsPower au nom de <b>{account.pseudo}</b> existe déjà sans être relié à un compte : {twins.map(p=>`#${p.number}`).join(', ')}. Ne crée pas un deuxième profil : relie celui-ci au compte. Il garde son proxy, ses cookies et sa session.</span>{twins.length===1&&<button className={secondary} disabled={!!busy||!!adsError} onClick={()=>attach(account,twins[0])}>{`Relier #${twins[0].number}`}</button>}<button className={secondary} onClick={()=>setConfirmedId(confirmedId===twinConsentKey?'':twinConsentKey)}>{confirmedId===twinConsentKey?'Création autorisée · annuler':'Créer quand même un nouveau profil'}</button></div>}
      <p className="text-xs text-slate-400">{account?.proxy_id?'Ce compte garde son proxy actuel. ':''}Seulement pour un compte qui n’a encore aucun profil. Le profil porte le pseudo du compte, reçoit une empreinte cohérente avec ce PC et son numéro est enregistré sur le compte.</p>
    </section>

    <section aria-labelledby="factory-proxies" className="px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="factory-proxies" className="text-sm font-semibold">Proxys</h3><button className={secondary} disabled={!!busy} onClick={()=>setAdding(!adding)}>{adding?'Fermer':'+ Ajouter des proxys'}</button></div>
      {adding&&<div className="rounded-xl border border-slate-200 p-3 space-y-2">
        <textarea aria-label="Proxys à ajouter" rows={4} spellCheck={false} autoComplete="off" className={`${field} font-mono text-xs`} placeholder={'curl -x disp.oxylabs.io:8001 -U "user-disp_xxxxxxxx:motdepasse" https://ip.oxylabs.io/location\ndisp.oxylabs.io:8001:disp_xxxxxxxx:motdepasse\nisp.decodo.com:10011:identifiant:motdepasse'} value={paste} onChange={e=>setPaste(e.target.value)}/>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-500">Un proxy par ligne : <code>hôte:port:identifiant:motdepasse</code>, ou la commande <code>curl</code> d’Oxylabs collée telle quelle. Oxylabs : le préfixe « user- » est ajouté tout seul.{parsed.errors.length>0&&<span className="block text-amber-800 mt-1">{parsed.errors.slice(0,3).map(e=>`Ligne ${e.line} : ${e.message}`).join(' · ')}{parsed.errors.length>3?' …':''}</span>}</span><button className={primary} disabled={!parsed.proxies.length||!!busy} onClick={addProxies}>{busy==='add'?'Enregistrement…':`Enregistrer ${parsed.proxies.length} proxy${parsed.proxies.length>1?'s':''}`}</button></div>
      </div>}
      {shared>0&&<p className="text-xs text-amber-800">Un proxy partagé relie entre eux les comptes qui l’utilisent. Donne à chacun son propre proxy.</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="py-2 pr-3 font-semibold">Proxy</th><th className="py-2 pr-3 font-semibold">Fournisseur</th><th className="py-2 pr-3 font-semibold">Utilisé par</th><th className="py-2 pr-3 font-semibold">État</th><th className="py-2 font-semibold"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.proxies.map(p=>{const u=usage.get(p.id),[label,tone]=states[u.state],removable=u.state==='free'&&!adsError;return <tr key={p.id}><td className="py-2 pr-3 font-mono text-slate-700">{proxyLabel(p)}{p.nom&&<span className="block font-sans text-[11px] text-slate-400">{p.nom}</span>}</td><td className="py-2 pr-3 text-slate-500">{p.fournisseur||'—'}</td><td className="py-2 pr-3 text-slate-600">{[...u.accounts.map(a=>a.pseudo),...u.profiles.filter(x=>!u.accounts.some(a=>String(a.number)===String(x.number))).map(x=>`Profil #${x.number}`)].join(', ')||'—'}</td><td className="py-2 pr-3"><span className={`rounded-full px-2 py-1 font-semibold ${tone}`}>{label}</span></td>
          <td className="py-2 text-right">{removeId===p.id?<span role="group" aria-label={`Confirmer la suppression de ${proxyLabel(p)}`} className="inline-flex flex-wrap items-center justify-end gap-2"><span className="text-amber-900">Supprimer du site ?</span><button className={secondary} disabled={!!busy} onClick={()=>setRemoveId(null)}>Non</button><button className="rounded-lg bg-rose-700 px-3 py-2 font-semibold text-white disabled:opacity-40" disabled={!!busy} onClick={()=>removeProxy(p)}>{busy===`remove:${p.id}`?'Suppression…':'Supprimer'}</button></span>
            :<button className={secondary} disabled={!!busy||!removable} title={removable?'':adsError?'Proxys AdsPower illisibles : actualise d’abord':'Utilisé par un compte ou un profil : libère-le d’abord'} onClick={()=>{setRemoveId(p.id);setError('');setNotice('')}}>Supprimer</button>}</td></tr>})}
          {!data.proxies.length&&<tr><td colSpan={5} className="py-6 text-center text-slate-500">Aucun proxy enregistré. Ajoute tes proxys pour créer des profils.</td></tr>}</tbody></table></div>
      <p className="text-xs text-slate-400">Seul un proxy libre (aucun compte, aucun profil AdsPower) peut être supprimé. La suppression le retire du site, sans le résilier chez le fournisseur.</p>
    </section>

    <details className="px-5 py-4">
      <summary className="cursor-pointer text-sm font-semibold">Autres profils AdsPower <span className="font-normal text-slate-400">({others.length} · comptes bannis, en Shadowban ou sans compte)</span></summary>
      <div className="mt-3 space-y-3">
        <input aria-label="Rechercher un profil à modifier" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" placeholder="Numéro, nom ou compte…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <div className="divide-y divide-slate-100">{shownOthers.map(p=><div key={p.id} className="py-2.5 flex flex-wrap items-center gap-3 text-xs">
          <span className="w-12 font-bold text-teal-800">#{p.number}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-700">{p.name}</span><span className="block text-slate-400">{ownerLabel(accountForProfile(p,data.accounts))}</span></span>
          {fingerprintCell(p)}
        </div>)}
        {!shownOthers.length&&<p className="py-6 text-center text-xs text-slate-500">{others.length?'Aucun profil ne correspond.':profiles.length?'Tous les profils sont reliés à un compte en service.':'Aucun profil AdsPower lu sur ce PC.'}</p>}</div>
      </div>
    </details>
  </div>
}
