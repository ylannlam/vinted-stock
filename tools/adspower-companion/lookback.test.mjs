import test from 'node:test'
import assert from 'node:assert/strict'
import {setTwelveHours} from './lookback.mjs'

test('waits for delayed options and retries a selection reset by late preferences',async()=>{
  let now=0,openedAt=null,selectedAt=null,selections=0,opens=0
  const read=async()=>{
    const reset=selections===1&&selectedAt!==null&&now-selectedAt>=400
    if(reset){selectedAt=null;openedAt=null}
    return {cards:[{id:'likes',state:'ready',rangeExpanded:openedAt!==null&&selectedAt===null,twelveHours:selectedAt!==null}],twelveOption:openedAt!==null&&now-openedAt>=450&&selectedAt===null}
  }
  const ui={read,click:async(root,action)=>{
    if(action==='range'){openedAt=now;opens++}
    else if(action==='twelveHours'){assert.equal((await read()).twelveOption,true);selectedAt=now;selections++}
    else assert.fail('No automation can start during range setup')
  }}
  await setTwelveHours(ui,{}, {id:'likes',label:'Messages aux likes'},{wait:async ms=>{now+=ms}})
  assert.equal(selections,2);assert.equal(opens,2);assert.equal((await read()).cards[0].twelveHours,true)
})

test('fails clearly when the select never opens and does not start anything',async()=>{
  const clicks=[],ui={read:async()=>({cards:[{id:'likes',state:'ready',rangeExpanded:false,twelveHours:false}],twelveOption:false}),click:async(root,action)=>{clicks.push(action)}}
  await assert.rejects(setTwelveHours(ui,{}, {id:'likes',label:'Likes'},{wait:async()=>{}}),/n’a pas conservé/)
  assert.deepEqual(clicks,['range','range','range','range'])
})

test('already running automations retain their existing range',async()=>{
  const ui={read:async()=>({cards:[{id:'agent',state:'running',twelveHours:false}]}),click:async()=>assert.fail('Must not alter an active automation')}
  await setTwelveHours(ui,{}, {id:'agent',label:'Smart Agent'},{wait:async()=>assert.fail('No wait needed')})
})
