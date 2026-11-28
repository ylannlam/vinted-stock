import test from 'node:test'
import assert from 'node:assert/strict'
import {publicationProgress,publicationDate} from '../src/lib/publicationTracking.js'
import {activePublicationCounts} from './scalency-publications.js'

test('la file Scalency compte les publications actives sur toutes les pages et tous les comptes',async()=>{
  const first={id:21,account_id:'a',type:'publish',status:'queued'}
  const pages=[
    {data:[first,{...first,type:'backup',id:22},{...first,status:'done',id:23}],next_cursor:'suite'},
    {data:[first,{...first,id:24,account_id:'b',status:'provider_active_status'}]}
  ]
  const counts=await activePublicationCounts(async(path,{query})=>{
    assert.equal(path,'jobs')
    assert.equal(query.scope,'active')
    return pages[query.cursor==='suite'?1:0]
  })
  assert.deepEqual([...counts],[['a',1],['b',1]])
  assert.equal((await activePublicationCounts(async()=>({data:[]}))).size,0)
})

test('une lecture échouée ou incomplète ne peut pas donner une file vide',async()=>{
  for(const result of [{},{data:[],has_more:true},{data:[],next_cursor:'bloqué'}]){
    assert.equal(await activePublicationCounts(async()=>result),null)
  }
  assert.equal(await activePublicationCounts(async()=>{throw Error('indisponible')}),null)
})

test('un créneau devient une attente, jamais une confirmation de publication',()=>{
  const job={status:'queued',not_before:'2026-11-28T14:00:00Z'}
  const before=publicationProgress(job,Date.parse('2026-11-28T13:59:00Z'))
  assert.equal(before.label,'Planifiée')
  assert.match(before.detail,/au plus tôt.*15:00/)
  assert.equal(publicationProgress(job,Date.parse(job.not_before)).label,'En file')
  assert.equal(publicationProgress({status:'queued'}).label,'En file')
  assert.match(publicationDate('2026-06-12T14:00:00Z'),/16:00/)
})

test('une confirmation exige un article créé et un test annulé reste annulé',()=>{
  assert.equal(publicationProgress({status:'done'}).label,'À vérifier')
  assert.equal(publicationProgress({status:'done',new_item_id:123}).label,'Publiée')
  assert.equal(publicationProgress({status:'sent'}).label,'Publication en cours')
  assert.equal(publicationProgress({status:'cancelled',not_before:'2099-01-01'}).label,'Annulée')
  assert.equal(publicationProgress({status:'failed',reason:'Photo manquante'}).detail,'Photo manquante')
})
