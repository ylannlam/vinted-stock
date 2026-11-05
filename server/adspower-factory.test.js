import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {parseProxyLines,proxyUsage,creatableAccounts,proxyChoices,profileName,hardwareLabel,latestFingerprints,recentChange,accountForProfile} from '../src/lib/adspowerFactory.js'

test('pasted proxies accept Decodo, Oxylabs and URL formats, with passwords containing @ or :',()=>{
  const {proxies,errors}=parseProxyLines([
    'isp.decodo.com:10011:spuser:pa@ss:word',
    ' DISP.oxylabs.io:8001:disp_38bc6771:6d3E=Ou~u ',
    'http://user-disp_ed5d4e1e:1~bHyu@disp.oxylabs.io:8001',
    '# commentaire','',
    'isp.decodo.com:10011:spuser:autre',
    'localhost:80',
    'bad_host:80:u:p',
    'isp.decodo.com:99999:u:p',
    'isp.decodo.com:10012:u:',
  ].join('\n'))
  assert.deepEqual(proxies,[
    {adresse:'isp.decodo.com',port:10011,username:'spuser',password:'pa@ss:word',fournisseur:'Decodo'},
    {adresse:'disp.oxylabs.io',port:8001,username:'user-disp_38bc6771',password:'6d3E=Ou~u',fournisseur:'Oxylabs'},
    {adresse:'disp.oxylabs.io',port:8001,username:'user-disp_ed5d4e1e',password:'1~bHyu',fournisseur:'Oxylabs'},
  ])
  assert.deepEqual(errors.map(e=>e.line),[6,7,8,9,10])
  assert.match(errors[0].message,/déjà présent/)
})

test('pasted Oxylabs curl commands are reduced to the proxy and its credentials',()=>{
  const oxy=(user,password)=>({adresse:'disp.oxylabs.io',port:8001,username:user,password,fournisseur:'Oxylabs'})
  const {proxies,errors}=parseProxyLines([
    'curl -x disp.oxylabs.io:8001 -U "user-disp_1111aaaa:Zz+9=qf+B" https://ip.oxylabs.io/location',
    "$ curl --proxy http://disp.oxylabs.io:8001/ --proxy-user 'disp_2222bbbb:p@ss:word' https://ip.oxylabs.io/location",
    'curl -x disp.oxylabs.io:8001 \\',
    '  -U "user-disp_3333cccc:zz" \\',
    '  https://ip.oxylabs.io/location',
    'curl -x "http://user-disp_4444dddd:pw@disp.oxylabs.io:8001" https://ip.oxylabs.io/location',
    'disp.oxylabs.io:8001 -U "user-disp_5555eeee:cut" https://ip.oxylabs.io/location',
    'curl -x disp.oxylabs.io:8001 -U "user-disp_1111aaaa:Zz+9=qf+B" https://ip.oxylabs.io/location',
    'curl -x disp.oxylabs.io:8001 https://ip.oxylabs.io/location',
    'curl -U "user-disp_x:y" https://ip.oxylabs.io/location',
    'curl -x disp.oxylabs.io:8001 -U "user-disp_f:oops https://ip.oxylabs.io/location',
    'isp.decodo.com:10011:spuser:autre',
  ].join('\n'))
  assert.deepEqual(proxies,[
    oxy('user-disp_1111aaaa','Zz+9=qf+B'),
    oxy('user-disp_2222bbbb','p@ss:word'),
    oxy('user-disp_3333cccc','zz'),
    oxy('user-disp_4444dddd','pw'),
    oxy('user-disp_5555eeee','cut'),
    {adresse:'isp.decodo.com',port:10011,username:'spuser',password:'autre',fournisseur:'Decodo'},
  ])
  // La commande écrite sur 3 lignes compte pour la ligne où elle commence : le doublon est ligne 8.
  assert.deepEqual(errors.map(e=>e.line),[8,9,10,11])
  assert.match(errors[0].message,/déjà présent/)
  assert.match(errors[1].message,/-U/)
  assert.match(errors[2].message,/-x/)
  assert.match(errors[3].message,/guillemets/)
})

test('Windows curl prompts and continuations preserve proxy credentials without executing commands',()=>{
  const {proxies,errors}=parseProxyLines('PS C:\\Users\\test> curl.exe -x disp.oxylabs.io:8001 ^\n -U "disp_test:a+b=:@z" ^\n https://ip.oxylabs.io/location\ncurl -x "http://disp_other:pw@disp.oxylabs.io:8001/" https://ip.oxylabs.io/location')
  assert.deepEqual(errors,[])
  assert.deepEqual(proxies.map(p=>[p.username,p.password]),[['user-disp_test','a+b=:@z'],['user-disp_other','pw']])
})

test('proxy usage flags shared IPs from the database and from AdsPower profiles',()=>{
  const proxies=[{id:'free',adresse:'disp.oxylabs.io',port:8001,username:'user-disp_a'},{id:'one',adresse:'disp.oxylabs.io',port:8001,username:'user-disp_b'},{id:'two',adresse:'isp.decodo.com',port:10001,username:'sp'},{id:'ads',adresse:'isp.decodo.com',port:10002,username:'sp'},{id:'mismatch',adresse:'isp.decodo.com',port:10003,username:'sp'}]
  const accounts=[{id:'a',pseudo:'A',proxy_id:'one',ads_power_num:'1'},{id:'b',pseudo:'B',proxy_id:'two'},{id:'c',pseudo:'C',proxy_id:'two'},{id:'d',pseudo:'D',proxy_id:'mismatch',ads_power_num:'4'}]
  const live=[{id:'p1',number:'1',proxy:{host:'disp.oxylabs.io',port:8001,user:'user-disp_b'}},{id:'p2',number:'2',proxy:{host:'ISP.decodo.com',port:10002,user:'sp'}},{id:'p3',number:'3',proxy:{host:'isp.decodo.com',port:10002,user:'sp'}},{id:'p5',number:'5',proxy:{host:'isp.decodo.com',port:10003,user:'sp'}},{id:'p6',number:'6',proxy:null}]
  const usage=proxyUsage(proxies,accounts,live)
  assert.deepEqual(Object.fromEntries([...usage].map(([id,u])=>[id,u.state])),{free:'free',one:'used',two:'shared',ads:'shared',mismatch:'shared'})
  assert.deepEqual(usage.get('ads').profiles.map(p=>p.number),['2','3'])
  // A different Oxylabs username on the same host and port is another IP: still free.
  assert.equal(proxyUsage(proxies,[],[{id:'x',number:'9',proxy:{host:'disp.oxylabs.io',port:8001,user:'user-disp_zzz'}}]).get('free').state,'free')
})

test('only active accounts without a profile can be equipped; an existing proxy is kept',()=>{
  const accounts=[{id:'z',pseudo:'Zoé',creation_stage:'post1'},{id:'r',pseudo:'Rose',creation_stage:'ready'},{id:'n',pseudo:'Nina',ads_power_num:'4'},{id:'s',pseudo:'Sam',is_shadowbanned:true},{id:'g',pseudo:'Gone',deleted_at:'2026-01-01'},{id:'k',pseudo:'Kim',creation_stage:'ready',proxy_id:'p2'}]
  assert.deepEqual(creatableAccounts(accounts).map(a=>a.id),['k','r','z'])
  const proxies=[{id:'p1'},{id:'p2'},{id:'p3'}],usage=new Map([['p1',{state:'free',profiles:[]}],['p2',{state:'used',profiles:[]}],['p3',{state:'shared',profiles:[]}]])
  assert.deepEqual(proxyChoices(accounts[5],proxies,usage).map(p=>p.id),['p2'])
  assert.deepEqual(proxyChoices(accounts[1],proxies,usage).map(p=>p.id),['p1'])
  assert.deepEqual(proxyChoices(null,proxies,usage),[])
  usage.set('p2',{state:'shared',profiles:[]});assert.deepEqual(proxyChoices(accounts[5],proxies,usage),[])
  usage.set('p2',{state:'used',profiles:[{id:'existing'}]});assert.deepEqual(proxyChoices(accounts[5],proxies,usage),[])
  assert.equal(profileName(' @@dressing_lea\u0007 '),'dressing_lea');assert.equal(profileName('x'.repeat(150)).length,100)
})

test('fingerprint history shows the latest change and recent replacements',()=>{
  const now=Date.parse('2026-11-05T12:00:00Z')
  const log=[{profile_id:'a',action:'create',created_at:'2026-10-01T10:00:00Z',resolution:'1920_1080',gpu:'NVIDIA GeForce RTX 3060',threads:8},{profile_id:'a',action:'update',created_at:'2026-11-03T10:00:00Z',resolution:'2560_1440',gpu:'NVIDIA GeForce RTX 4070',threads:16,chrome_major:141}]
  const latest=latestFingerprints(log).get('a')
  assert.equal(latest.action,'update');assert.equal(hardwareLabel(latest),'2560×1440 · RTX 4070 · 16 threads · Chrome 141')
  assert.equal(recentChange(latest,now),true);assert.equal(recentChange(log[0],now),false);assert.equal(recentChange(null,now),false)
  assert.equal(accountForProfile({number:'07'},[{id:'x',ads_power_num:'07'},{id:'y',ads_power_num:'07',deleted_at:'x'}]).id,'x')
})

test('the store reads proxies without passwords and links profiles through one database call',async()=>{
  const calls=[]
  // Lists resolve to no rows; .single() returns the one proxy whose password is requested.
  const secretRow={adresse:'disp.oxylabs.io',port:8001,username:'user-disp_a',password:'secret'}
  const query=table=>{const q={};for(const m of ['select','order','is','eq','limit','range','upsert','insert'])q[m]=(...args)=>{calls.push([table,m,...args]);return q};q.single=async()=>({data:secretRow,error:null});q.then=(resolve,reject)=>Promise.resolve({data:[],error:null,count:0}).then(resolve,reject);return q}
  const client={from:query,rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:{pseudo:'A'},error:null}}}
  // The real Supabase client is replaced: only the fake client above is ever used.
  const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/lib/adspowerFactoryStore.js',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'no-supabase',setup(b){b.onLoad({filter:/src[\\/]lib[\\/]supabase\.js$/},()=>({contents:'export const supabase=null'}))}}]})
  const store=(await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))).createFactoryStore(client)
  await store.load()
  const proxySelect=calls.find(c=>c[0]==='proxies'&&c[1]==='select')[2]
  assert.equal(proxySelect.includes('password'),false,'the list never loads proxy passwords')
  assert.deepEqual(await store.secret('px'),{host:'disp.oxylabs.io',port:8001,user:'user-disp_a',password:'secret'})
  await store.link('acc','px',{profile_id:'k1',profile_no:'41',resolution:'1920_1080',threads:16,gpu:'NVIDIA GeForce RTX 4060',chrome:141})
  assert.deepEqual(calls.at(-1),['rpc','link_adspower_profile',{p_account:'acc',p_proxy:'px',p_profile_id:'k1',p_profile_no:'41',p_resolution:'1920_1080',p_threads:16,p_gpu:'NVIDIA GeForce RTX 4060',p_chrome:141}])
  await store.precheck('acc','px');assert.deepEqual(calls.at(-1),['rpc','link_adspower_profile',{p_account:'acc',p_proxy:'px'}])
  await store.addProxies([{adresse:'a.io',port:1,username:'u',password:'p'}])
  assert.deepEqual(calls.find(c=>c[1]==='upsert').slice(3),[{onConflict:'adresse,port,username',ignoreDuplicates:true}])
})

test('the section creates, links and replaces fingerprints, and never recreates an unlinked profile',async()=>{
  const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
  const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/AdsPowerFactory.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external'})
  const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
  const AdsPowerFactory=mod.exports.default
  const data={proxies:[{id:'px1',adresse:'disp.oxylabs.io',port:8001,username:'user-disp_a',fournisseur:'Oxylabs'},{id:'px2',adresse:'disp.oxylabs.io',port:8001,username:'user-disp_b',fournisseur:'Oxylabs'}],accounts:[{id:'acc',pseudo:'dressing_lea',creation_stage:'ready'},{id:'old',pseudo:'ancien',ads_power_num:'7',proxy_id:'px2'}],log:[]}
  let linkFails=true,proxyReadFails=false,loseCreateResponse=false
  const persisted=new Map(),recoveryStorage={getItem:k=>persisted.get(k),setItem:(k,v)=>persisted.set(k,v),removeItem:k=>persisted.delete(k)}
  const calls=[]
  const store={load:async()=>structuredClone(data),secret:async id=>{calls.push(['secret',id]);return {host:'disp.oxylabs.io',port:8001,user:'user-disp_a',password:'pw'}},addProxies:async rows=>rows.length,precheck:async(a,p)=>calls.push(['precheck',a,p]),
    link:async(a,p,profile)=>{calls.push(['link',a,p,profile.profile_no]);if(linkFails)throw Error('réseau coupé');return {pseudo:'dressing_lea'}},logFingerprint:async entry=>calls.push(['log',entry.profile_id,entry.account_id,entry.action])}
  const request=async(path,body)=>{calls.push([path,body?.id||body?.name||null,body?.requestId||null]);if(path==='/profiles/proxies')return {profiles:[{id:'p7',number:'7',proxy:{host:'disp.oxylabs.io',port:8001,user:'user-disp_b'}}]};if(path==='/profiles/create')return {profile:{profile_id:'k1',profile_no:'41',resolution:'1920_1080',threads:16,gpu:'NVIDIA GeForce RTX 4060',chrome:141}};if(path==='/profiles/fingerprint')return {profile:{profile_id:body.id,resolution:'2560_1440',threads:16,gpu:'NVIDIA GeForce RTX 4070',chrome:141}}}
  const profiles=[{id:'p7',number:'7',name:'ancien',group:'Vinted'},{id:'p8',number:'8',name:'ouvert',group:'Vinted'}]
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
  // linkedom has no value setter on <select>: choose the option, then notify React.
  const select=(label,value)=>{const el=document.querySelector(`select[aria-label="${label}"]`);for(const o of el.querySelectorAll('option'))o.toggleAttribute('selected',o.value===value);el.dispatchEvent(new window.Event('change',{bubbles:true}))}
  const guardedRequest=(path,body)=>{if(path==='/profiles/proxies'&&proxyReadFails)return Promise.reject(Error('lecture interrompue'));if(path==='/profiles/create'&&loseCreateResponse){loseCreateResponse=false;request(path,body);return Promise.reject(Error('réponse perdue'))}return request(path,body)}
  let root=createRoot(document.getElementById('app'))
  const render=()=>act(async()=>root.render(React.createElement(AdsPowerFactory,{request:guardedRequest,store,profiles,recoveryStorage,openedIds:new Set(['p8'])})))
  try{
    await render()
    assert.match(document.body.textContent,/2 proxys · 1 libre/)
    assert.equal(button('Profil ouvert').disabled,true,'an open profile cannot get a new fingerprint')
    await act(async()=>select('Compte à équiper','acc'))
    assert.equal(document.querySelector('select[aria-label="Proxy du profil"]').value,'px1','the free proxy is proposed, not the one used by #7')
    await act(async()=>button('Créer le profil').click())
    assert.match(document.body.textContent,/#41 créé dans AdsPower, mais pas encore relié au compte : réseau coupé/)
    assert.match(document.body.textContent,/Ne le recrée pas/)
    assert.equal(button('Créer le profil').disabled,true,'a profile awaiting its link cannot be created twice')
    assert.equal([...persisted.values()].some(s=>s.includes('"password"')),false)
    await act(async()=>root.unmount());root=createRoot(document.getElementById('app'));await render()
    assert.ok(button('Relier maintenant'),'reopening the section restores the pending link')
    assert.equal(button('Créer le profil').disabled,true)
    linkFails=false
    await act(async()=>button('Relier maintenant').click())
    assert.match(document.body.textContent,/Profil #41 créé et relié à dressing_lea · 1920×1080 · RTX 4060 · 16 threads · Chrome 141/)
    assert.deepEqual(calls.filter(c=>c[0]==='/profiles/create').length,1)
    assert.deepEqual(calls.filter(c=>c[0]==='link').map(c=>c.slice(1)),[['acc','px1','41'],['acc','px1','41']])
    assert.ok(calls.findIndex(c=>c[0]==='precheck')<calls.findIndex(c=>c[0]==='/profiles/create'),'the database check runs before AdsPower is touched')
    await act(async()=>button('Nouvelle empreinte').click())
    assert.match(document.body.textContent,/Remplacer l’empreinte \? Irréversible/)
    await act(async()=>button('Remplacer').click())
    assert.match(document.body.textContent,/Nouvelle empreinte pour #7 · 2560×1440 · RTX 4070/)
    assert.deepEqual(calls.find(c=>c[0]==='log').slice(1),['p7','old','update'])
    assert.equal(persisted.size,0)
    proxyReadFails=true;await act(async()=>button('Actualiser').click());await act(async()=>select('Compte à équiper','acc'))
    assert.equal(button('Créer le profil').disabled,true,'unreadable live proxy usage blocks creation')
    proxyReadFails=false;await act(async()=>button('Actualiser').click());loseCreateResponse=true
    await act(async()=>button('Créer le profil').click())
    assert.ok(button('Vérifier la création'));assert.equal(button('Créer le profil').disabled,true)
    const lost=calls.filter(c=>c[0]==='/profiles/create').at(-1)[2]
    await act(async()=>root.unmount());root=createRoot(document.getElementById('app'));await render()
    await act(async()=>button('Vérifier la création').click())
    assert.equal(calls.filter(c=>c[0]==='/profiles/create').at(-1)[2],lost,'recovery must reuse the original request id')
    assert.equal(persisted.size,0)
  }finally{await act(async()=>root.unmount())}
})
