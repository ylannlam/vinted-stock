import test from 'node:test'
import assert from 'node:assert/strict'
import {publicationProgress,publicationDate} from '../src/lib/publicationTracking.js'

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
