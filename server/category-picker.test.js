import test from 'node:test'
import assert from 'node:assert/strict'
import {categoryIndex, searchCategories} from '../src/lib/categoryPicker.js'

const index = categoryIndex([
  {id: 100, title: 'Enfants'}, {id: 1, title: 'Femmes'},
  {id: 4, parent_id: 1, title: 'Vêtements'}, {id: 12, parent_id: 4, title: 'Hauts et t-shirts'},
  {id: 1835, parent_id: 12, title: 'Bodies'}, {id: 150, parent_id: 100, title: 'Bodies'},
  {id: 155, parent_id: 12, title: 'Débardeurs'}, {id: 156, parent_id: 12, title: 'Autres hauts'}
])

test('le parcours conserve les identifiants et distingue les intitulés identiques', () => {
  assert.deepEqual(index.roots.map(n => n.title), ['Femmes','Enfants'])
  assert.deepEqual(index.nodes.get(1835).path.map(n => n.id), [1,4,12,1835])
  assert.deepEqual(index.nodes.get(12).children.map(n => n.title), ['Bodies','Débardeurs','Autres hauts'])
})

test('la recherche trouve les catégories finales par nom, département ou chemin, sans accents', () => {
  const ids = q => searchCategories(index, q).map(n => n.id)
  assert.deepEqual(ids('body'), [1835,150])
  assert.deepEqual(ids('enfant body'), [150])
  assert.deepEqual(ids('debardeur femme'), [155])
  assert.ok(ids('hauts').every(id => !index.nodes.get(id).children.length))
  assert.deepEqual(ids('inconnu'), [])
})
