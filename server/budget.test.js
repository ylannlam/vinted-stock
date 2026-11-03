import test from 'node:test'
import assert from 'node:assert/strict'
import {combinedBudgetRows,budgetPeriodRows,budgetTotals} from '../src/lib/budget.js'
const sale=(id,date,amount)=>({id:'vinted-'+id,line_id:id,date,amount,type:'in',cat:'Ventes Vinted',source:'vinted',label:'Même article'})
test('all periods includes every sale, even repeated sales of the same article',()=>{
 const income=[sale('a','2026-10-31',38.9),sale('b','2026-11-01',28),sale('c','2026-11-02',35.9)]
 const expense={id:'shein-GTEST00001',order_ref:'GTEST00001',type:'out',amount:23.04,date:'2026-11-02',cat:'Stock Shein'}
 const rows=combinedBudgetRows([], [expense,expense], [...income,income[0]]).rows
 assert.equal(rows.length,4)
 assert.deepEqual(budgetTotals(budgetPeriodRows(rows,'')),{income:102.8,expenses:23.04,balance:79.76,categories:[{name:'Stock Shein',amount:23.04}]})
 assert.equal(budgetTotals(budgetPeriodRows(rows,'2026-11')).income,63.9)
 assert.equal(budgetTotals(budgetPeriodRows(rows,'2026-10')).income,38.9)
 assert.equal(budgetPeriodRows(rows,'2026-09').length,0)
})
test('manual references prevent double-counting, unrelated income stays separate',()=>{
 const income=[sale('order-a:item-a','2026-11-01',30),sale('order-b:item-b','2026-11-01',30)]
 const manual=[{id:'m1',type:'in',label:'Vente order-a:item-a',amount:29,date:'2026-11-01',cat:'Ventes'},
 {id:'m2',type:'in',label:'Autre revenu',amount:5,date:'2026-11-01',cat:'Divers'}]
 const result=combinedBudgetRows(manual,[],income)
 assert.equal(result.incomeDuplicates.length,1)
 assert.equal(budgetTotals(result.rows).income,64)
})
