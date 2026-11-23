import test from 'node:test'
import assert from 'node:assert/strict'
import {managePublication} from './scalency-publication-actions.js'
import {quickIssues} from '../src/lib/scalencyQuick.js'
import {draftPayload} from './scalency-api.js'
import {lotProgress} from '../src/lib/lotProgress.js'
const target={account:'a',id:'91'}
function scenario(job,item={},reply={}) {
  const calls=[],saved=[]
  const request=async(path,options={})=>{
    calls.push([path,options.method||'GET'])
    if(options.method)return reply
    return path.startsWith('jobs/')?{id:91,account_id:'a',type:'publish',...job}:{id:'350',account_id:'a',...item}
  }
  const db={from:()=>({upsert:async r=>{saved.push(r);return {data:[]}}})}
  const run=operation=>managePublication(db,{id:'owner'},{...target,operation},async(...args)=>saved.push(args),request)
  return {run,calls,saved}
}
test('absence de SKU dans une fiche complète et dans le corps envoyé à Scalency',()=>{
  const f={account_id:'a',price:'20',catalog_id:1,status_id:2,package_size_id:1,color_ids:[1],title:'Robe',description:'Robe de soirée'}
  const options={catalog:{id:1},conditions:[{id:2}],package_sizes:[{id:1,title:'Petit'}]}
  assert.deepEqual(quickIssues(f,options),[])
  assert.equal(Object.hasOwn(draftPayload({fields:f},['photo'],'a'),'sku'),false)
})
test('annulation confirmée par Scalency, y compris après transmission',async()=>{
  for(const status of ['queued','sent']){
    const s=scenario({status},{},{status:'cancelled'})
    assert.match((await s.run('cancel')).message,/arrêtée/)
    assert.deepEqual(s.calls,[['jobs/91','GET'],['jobs/91/cancel','POST']])
  }
})
test('refus de supprimer sur un autre compte ou après vente et aucune suppression implicite si trop tard',async()=>{
  for(const [job,item,op] of [[{status:'done',new_item_id:'350'},null,'cancel'],[{status:'queued',account_id:'b'},null,'cancel'],[{status:'done',new_item_id:'350'},{sold:true},'remove'],[{status:'done',new_item_id:'350'},{account_id:'b'},'remove']]){
    const s=scenario(job,item);await assert.rejects(s.run(op));assert.ok(s.calls.every(c=>c[1]==='GET'))
  }
})
test('un retrait reçu est enregistré comme en attente et une annonce déjà retirée reste idempotente',async()=>{
  for(const [item,reply,expected] of [[{status:'active'},{status:'queued',job:{id:92}},'removing'],[{status:'deleted'},{},'deleted']]){
    const s=scenario({status:'done',new_item_id:350},item,reply);await s.run('remove')
    assert.equal(s.saved[0].result.status,expected)
    assert.equal(s.calls.filter(c=>c[1]==='DELETE').length,expected==='removing'?1:0)
  }
  assert.equal(lotProgress({status:'stopped'}).group,'stopped')
})
