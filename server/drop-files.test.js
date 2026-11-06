import test from 'node:test'
import assert from 'node:assert/strict'
import {readTransfer,hasTransferImage,filesFromTransfer,filesFromClipboard,fileName,BLOCKED_MESSAGE} from '../src/lib/dropFiles.js'

const png=name=>new File([new Uint8Array([1,2,3])],name,{type:'image/png'})
const transfer=(parts={})=>({files:parts.files||[],items:parts.items||[],types:parts.types||[],getData:type=>parts.data?.[type]||''})

test('files dragged from the computer are read as they are, other file types are ignored',()=>{
  const read=readTransfer(transfer({files:[png('a.png'),new File(['x'],'b.pdf',{type:'application/pdf'})]}))
  assert.deepEqual(read.files.map(f=>f.name),['a.png']);assert.deepEqual(read.urls,[])
})

test('an image dragged from another web page is found through its address',()=>{
  const read=readTransfer(transfer({data:{'text/uri-list':'https://img.example/robe.png\n','text/html':'<img src="https://img.example/robe.png?a=1&amp;b=2" alt="">'}}))
  assert.deepEqual(read.urls,['https://img.example/robe.png','https://img.example/robe.png?a=1&b=2'].slice(0,1))
  const html=readTransfer(transfer({data:{'text/html':'<div><img class="x" src=\'https://img.example/b.webp?a=1&amp;b=2\'></div>'}}))
  assert.deepEqual(html.urls,['https://img.example/b.webp?a=1&b=2'])
  assert.deepEqual(readTransfer(transfer({data:{'text/plain':'du texte'}})),{files:[],urls:[]})
})

test('the page reacts to file and image drags, not to selected text',()=>{
  assert.equal(hasTransferImage({types:['Files']}),true)
  assert.equal(hasTransferImage({types:['text/uri-list','text/html']}),true)
  assert.equal(hasTransferImage({types:['text/plain','text/html']}),false)
})

test('a dragged web image is fetched into a file; a site that refuses gives a clear way out',async()=>{
  const data={'text/uri-list':'https://img.example/dir/robe%20noire.jpg'}
  const ok=async()=>({ok:true,blob:async()=>new Blob([new Uint8Array([9])],{type:'image/webp'})})
  const [file]=await filesFromTransfer(transfer({data}),ok)
  assert.equal(file.type,'image/webp');assert.equal(file.name,'robe-noire.webp')
  await assert.rejects(filesFromTransfer(transfer({data}),async()=>{throw new TypeError('Failed to fetch')}),e=>e.message===BLOCKED_MESSAGE)
  await assert.rejects(filesFromTransfer(transfer({data}),async()=>({ok:true,blob:async()=>new Blob(['<html>'],{type:'text/html'})})),e=>e.message===BLOCKED_MESSAGE)
  await assert.rejects(filesFromTransfer(transfer()),/Aucune photo reconnue/)
  assert.equal((await filesFromTransfer(transfer({files:[png('x.png')]}))).length,1,'real files never need a fetch')
})

test('a pasted image gets a readable name and non-images are ignored',()=>{
  const files=filesFromClipboard({files:[png('image.png'),png('robe.png'),new File(['t'],'note.txt',{type:'text/plain'})]})
  assert.equal(files.length,2);assert.match(files[0].name,/^collage-\d+-1\.png$/);assert.equal(files[1].name,'robe.png')
  assert.deepEqual(filesFromClipboard({files:[],items:[]}),[])
  assert.equal(fileName('data:image/png;base64,AAAA','image/png'),'photo.png')
})
