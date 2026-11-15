import test from 'node:test'
import assert from 'node:assert/strict'
import {priorityResponses,responseTiming,responseWait} from '../src/lib/responsePriority.js'
import {normalizeSettings,dueScans} from './vinted-agent.js'

test('priority reads inbox and favourites after a minute, only for enabled features',()=>{
 const now=Date.parse('2026-11-15T12:00:00Z'),last=Object.fromEntries(['sync_inbox','scan_likes','scan_wardrobe'].map(k=>[k,new Date(now-61000).toISOString()]))
 const s=normalizeSettings({messaging:{executor:'desktop'},features:{likes:true,inbox:true}})
 assert.equal(priorityResponses(s),true)
 assert.deepEqual(dueScans(s,last,now).sort(),['scan_likes','sync_inbox'])
 s.features.likes=false;assert.deepEqual(dueScans(s,last,now),['sync_inbox'])
 s.messaging.desktop.response_priority=false;assert.deepEqual(dueScans(s,last,now),[])
 assert.throws(()=>normalizeSettings({messaging:{desktop:{response_priority:'false'}}}))
})
test('response deadline starts at event time or detection, ignores followups and completed work',()=>{
 const now=Date.parse('2026-11-15T12:00:00Z'),timing=responseTiming(new Date(now-180000).toISOString(),now)
 assert.equal(Date.parse(timing.response_deadline_at),now+60000)
 assert.equal(Date.parse(responseTiming(null,now).response_deadline_at),now+240000)
 assert.equal(Date.parse(responseTiming(new Date(now+60000).toISOString(),now).response_received_at),now)
 const row={account_id:'42',kind:'like_message',state:'queued',...timing}
 assert.equal(responseWait([row],'42',now).label,'3 min 00 s')
 assert.equal(responseWait([row],'42',now+61000).overdue,true)
 assert.equal(responseWait([{...row,payload:{followup:true}},{...row,state:'done'},{...row,account_id:'76'}],'42',now),null)
})
