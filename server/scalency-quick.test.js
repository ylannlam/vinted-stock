import test from 'node:test'
import assert from 'node:assert/strict'
import {quickIssues} from '../src/lib/scalencyQuick.js'
import {draftPayload} from './scalency-api.js'
const options={catalog:{id:10},conditions:[{id:2}],size_groups:[{sizes:[{id:3,title:'S'}]}],package_sizes:[{id:1,title:'Petit'}]}
const fields={account_id:'account1',sku:'piece',price:'25',title:'Robe rouge',description:'Robe rouge cintrée.',status_id:2,catalog_id:10,size_id:3,color_ids:[7],package_size_id:1,brand_id:null,brand_title:'Marque du compte'}
test('Une annonce complète transmet la marque du vendeur, les couleurs, le SKU et le petit colis',()=>{
  assert.deepEqual(quickIssues(fields,options),[])
  const payload=draftPayload({fields},['https://example.org/image.jpg'],fields.account_id)
  assert.equal(payload.brand,'Marque du compte')
  assert.equal(payload.package_size_id,1)
  assert.equal(payload.sku,'piece')
  assert.deepEqual(payload.color_ids,[7])
})
test('Une taille incertaine, une palette invalide et un colis indisponible interrompent le parcours automatique',()=>{
  assert.deepEqual(quickIssues({...fields,size_id:null,color_ids:[999],package_size_id:2},options),['Taille sur l’étiquette','Couleur','Petit colis indisponible pour cette catégorie'])
})
test('La taille facultative ne bloque pas une catégorie sans tailles',()=>{
  assert.deepEqual(quickIssues({...fields,size_id:null},{...options,size_groups:[]}),[])
})
test('Une catégorie hors ligne ou une caractéristique obligatoire manquante doit être corrigée',()=>{
  assert.ok(quickIssues(fields,{...options,offline:true}).includes('Catégorie Vinted'))
  const attr={code:'type',title:'Type',required:true,options:[{id:8}]}
  assert.ok(quickIssues(fields,{...options,attributes:[attr]}).includes('Type'))
})
