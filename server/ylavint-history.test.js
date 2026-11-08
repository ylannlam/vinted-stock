import test from 'node:test'
import assert from 'node:assert/strict'
import {activationSettings,inHistory,eventTime} from './ylavint-history.js'
import {normalizeSettings} from './vinted-agent-config.js'
import {copiedSettings} from './ylavint-settings-copy.js'
import {dueScans} from './vinted-agent.js'
const now=Date.parse('2026-11-08T12:00:00Z')
test('20-second reads and unlimited default; existing explicit caps and intervals survive',()=>{
 const defaults=normalizeSettings()
 assert.equal(defaults.messaging.sync_seconds,20);assert.equal(defaults.messaging.reply_unlimited,true)
 const old=normalizeSettings({messaging:{sync_minutes:2,reply_per_day:80}})
 assert.equal(old.messaging.sync_seconds,120);assert.equal(old.messaging.reply_unlimited,false)
 assert.throws(()=>normalizeSettings({messaging:{sync_seconds:19}}))
 assert.throws(()=>normalizeSettings({messaging:{reply_unlimited:'true'}}))
 defaults.features.inbox=true
 assert.ok(!dueScans(defaults,{sync_inbox:new Date(now-19000).toISOString()},now).includes('sync_inbox'))
 assert.ok(dueScans(defaults,{sync_inbox:new Date(now-21000).toISOString()},now).includes('sync_inbox'))
})
test('activation fixes separate time windows and never trusts a client cutoff',()=>{
 const next=normalizeSettings({features:{likes:true,ai:true},likes:{history_hours:12},messaging:{history_hours:24,offers:{enabled:true,history_hours:6}}})
 assert.deepEqual(activationSettings(next,null,true,now),['likes','messages','offers'])
 assert.equal(next.likes.history_since,'2026-11-08T00:00:00.000Z')
 assert.equal(next.messaging.history_since,'2026-11-07T12:00:00.000Z')
 assert.equal(next.messaging.offers.history_since,'2026-11-08T06:00:00.000Z')
 const current={...structuredClone(next),enabled:true}
 next.likes.history_since='2000-01-01T00:00:00Z'
 assert.deepEqual(activationSettings(next,current,true,now+3600000),[])
 assert.equal(next.likes.history_since,current.likes.history_since,'window does not slide')
 next.likes.history_hours=0
 assert.deepEqual(activationSettings(next,current,true,now),['likes'])
 assert.equal(next.likes.history_since,new Date(now).toISOString())
 assert.equal(inHistory(now+3600000,next.likes.history_since),true,'future events stay eligible')
 assert.equal(inHistory(now-1,next.likes.history_since),false)
 assert.equal(inHistory(null,next.likes.history_since),false)
 assert.equal(inHistory('invalid',next.likes.history_since),false)
 assert.equal(eventTime(String(now/1000)),now)
})
test('copy all settings preserves target switches and dates and does not mutate source',()=>{
 const source={...normalizeSettings({features:{likes:true,ai:true},likes:{history_hours:12},messaging:{sync_seconds:20,reply_unlimited:true,offers:{enabled:true,single_discount:17}}}),enabled:true}
 const target={...normalizeSettings({features:{likes:false,ai:false},likes:{history_since:'2026-11-01T12:00:00Z'},messaging:{sync_seconds:60,reply_unlimited:false,offers:{enabled:false}}}),enabled:false}
 const copy=copiedSettings(source,target,'all')
 assert.equal(copy.messaging.sync_seconds,20);assert.equal(copy.messaging.reply_unlimited,true)
 assert.equal(copy.messaging.offers.single_discount,17);assert.equal(copy.messaging.offers.enabled,false)
 assert.equal(copy.features.ai,false);assert.equal(copy.features.likes,false)
 assert.equal(copy.likes.history_since,target.likes.history_since)
 assert.equal(source.messaging.offers.enabled,true)
 const only=copiedSettings(source,target,'likes')
 assert.equal(only.likes.history_hours,12);assert.equal(only.messaging.sync_seconds,60)
})
