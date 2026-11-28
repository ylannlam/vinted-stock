import test from 'node:test'
import assert from 'node:assert/strict'
import {readBackgroundFile} from '../src/lib/backgroundDownload.js'

const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13])
test('le fond téléchargé conserve ses octets, même servi en binaire générique',async()=>{
  const file=await readBackgroundFile('download','original',async url=>{
    assert.equal(url,'download')
    return new Response(png,{headers:{'Content-Type':'application/octet-stream'}})
  })
  assert.equal(file.type,'image/png')
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()),png)
})
test('une erreur 500 sur le téléchargement utilise le lien de l’original',async()=>{
  const calls=[]
  const file=await readBackgroundFile('download','original',async (url,options)=>{
    calls.push(url)
    assert.equal(options.credentials,'omit')
    return url==='original'?new Response(png):Response.json({error:'InternalError'},{status:500})
  })
  assert.deepEqual(calls,['download','original'])
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()),png)
})
test('un fichier absent, une page d’erreur ou une coupure réseau laisse la fiche ouverte',async()=>{
  for(const read of [()=>Response.json({error:'InternalError'},{status:500}),()=>new Response('error',{headers:{'Content-Type':'image/png'}}),()=>{throw Error('network')}]) {
    let count=0
    await assert.rejects(readBackgroundFile('same','same',async()=>{count++;return read()}),/fond photo est indisponible/)
    assert.equal(count,1)
  }
})
