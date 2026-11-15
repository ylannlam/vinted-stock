import test from 'node:test'
import assert from 'node:assert/strict'
import {assistantSettingsDraft} from '../src/lib/assistantSettings.js'
import {DEFAULTS,normalizeSettings} from './vinted-agent-config.js'
import {authorizeDesktop} from './ylavint-desktop.js'
import {handleWatch} from './vinted-watch.js'

test('independent PC settings retain templates, discounts, followups, pause and activation',()=>{
 const stored={enabled:false,paused:true,version:9,features:{likes:true,ai:false},messaging:{executor:'extension',reply_notes:'Réponses courtes',desktop:{typing_delay_ms:95}},likes:{messages:[{message:'Merci !',discount:{mode:'simple',amount:2,unit:'eur',rounding:'none'},followup:{enabled:true,delay_hours:48,message:'Toujours disponible',discount:{mode:'none'}}}]}}
 const before=structuredClone(stored),draft=assistantSettingsDraft(DEFAULTS,stored)
 assert.equal(draft.messaging.executor,'desktop');assert.equal(draft.messaging.desktop.typing_delay_ms,95)
 assert.equal(draft.enabled,false);assert.equal(draft.paused,true);assert.equal(draft.version,9)
 draft.messaging.reply_notes='Bonjour';draft.features.ai=true
 const saved=normalizeSettings(draft)
 assert.deepEqual(saved.likes.messages,normalizeSettings(assistantSettingsDraft(DEFAULTS,stored)).likes.messages)
 assert.equal(saved.features.likes,true);assert.equal(saved.features.ai,true)
 assert.equal(saved.messaging.reply_notes,'Bonjour');assert.deepEqual(stored,before)
})
test('new assistants stay disabled with all functions off until explicitly configured',()=>{
 const draft=assistantSettingsDraft(DEFAULTS,null)
 assert.equal(draft.enabled,false);assert.equal(draft.messaging.executor,'desktop')
 assert.ok(Object.values(draft.features).every(v=>v===false))
 assert.equal(normalizeSettings(draft).messaging.executor,'desktop')
})
test('legacy credentials cannot resume, learn, report or claim through the public collector gate',async()=>{
 const db={from(){throw new Error('Legacy request must stop before accessing accounts')}}
 for(const action of ['agent_poll','agent_self','agent_learn','agent_result','watch_report'])await assert.rejects(authorizeDesktop(db,{}, {action,driver:'desktop'}),e=>e.status===410||e.statusCode===410||/ancienne connexion/.test(e.message))
})
test('the retired extension download cannot create a new connection',async()=>{
 const db={from(){throw new Error('No new key should be created')}}
 await assert.rejects(handleWatch({method:'POST',body:{action:'download'}},{db,user:{id:'owner'}}),/Assistant PC/)
})
