import test from 'node:test'
import assert from 'node:assert/strict'
import {accountReminder,accountGroup,isAccountDue,selectAccounts} from '../src/lib/accountOverview.js'
const start='2026-11-02T14:00:00.000Z',now=Date.parse(start)
test('five days for blocked accounts, two days for ready accounts, no inferred unblock',()=>{
 const blocked={statut:'suspendu',blocked_at:start},ready={statut:'actif',creation_stage:'ready',ready_at:start}
 assert.equal(accountReminder(blocked,now).label,'5j 0h 0min')
 assert.equal(accountReminder(ready,now).label,'2j 0h 0min')
 assert.equal(accountReminder(blocked,now+5*86400000).label,'Réponse à vérifier')
 assert.equal(accountGroup(blocked),'blocked')
 assert.equal(accountReminder(ready,now+2*86400000).label,'Mot de passe à changer')
 assert.ok(isAccountDue(ready,now+2*86400000))
 assert.equal(accountReminder({...ready,password_changed_at:start},now+3*86400000).done,true)
 assert.equal(isAccountDue({...ready,password_changed_at:start},now+3*86400000),false)
})
test('legacy dates are not invented; archived/deleted accounts have no reminder',()=>{
 assert.ok(accountReminder({statut:'suspendu'},now).missing)
 assert.equal(accountReminder({statut:'suspendu',is_shadowbanned:true},now),null)
 assert.equal(accountReminder({creation_stage:'ready',deleted_at:start},now),null)
 const rows=selectAccounts([{pseudo:'New',statut:'suspendu',blocked_at:start},{pseudo:'Old',statut:'suspendu',blocked_at:new Date(now-6*86400000).toISOString()}],{view:'blocked',now})
 assert.equal(rows[0].pseudo,'Old')
})
