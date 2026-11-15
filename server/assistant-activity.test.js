import test from 'node:test'
import assert from 'node:assert/strict'
import {taskOutcome,nextAccountAction} from '../src/lib/assistantActivity.js'
import {sessionActive} from '../src/lib/assistantHome.js'

test('home distinguishes a read, a preparation, a confirmed send and an unknown result',()=>{
 assert.equal(taskOutcome({kind:'sync_inbox',state:'done',result:{conversations:4}}).label,'Lecture terminée')
 assert.equal(taskOutcome({kind:'publish_item',state:'done',result:{prepared:true}}).label,'Formulaire préparé')
 assert.equal(taskOutcome({kind:'reply_message',state:'done',result:{message_sent:true}}).label,'Message confirmé')
 assert.equal(taskOutcome({kind:'like_message',state:'done',result:{message_sent:true,offer_sent:true}}).label,'Message et offre confirmés')
 assert.equal(taskOutcome({kind:'reply_message',state:'done',result:{}}).label,'Traitement terminé')
 assert.equal(taskOutcome({kind:'reply_message',state:'failed'}).label,'À vérifier')
 assert.equal(sessionActive({state:'confirming'}),true)
})
test('home previews its account only and does not put a future reply ahead of a ready offer',()=>{
 const now=Date.parse('2026-11-15T16:00:00Z'),base={account_id:'42',state:'queued',not_before:new Date(now-1000).toISOString(),created_at:new Date(now-2000).toISOString()}
 const tasks=[{...base,id:'like',kind:'like_message'},{...base,id:'offer',kind:'accept_offer'},{...base,id:'reply',kind:'reply_message',not_before:new Date(now+1000).toISOString()},{...base,account_id:'76',id:'other',kind:'reply_message'}]
 assert.equal(nextAccountAction(tasks,'42',now).id,'offer')
 assert.equal(nextAccountAction(tasks,'42',now+2000).id,'reply')
 assert.equal(nextAccountAction(tasks,'99',now),null)
})
