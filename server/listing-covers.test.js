import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {createCanvas, loadImage} from '@napi-rs/canvas'
import {listingCovers} from './listing-covers.js'

test('private draft covers use small previews, reuse signed URLs and isolate owners', async () => {
  const owner = randomUUID(), path = owner+'/'+randomUUID()+'.png'
  const canvas = createCanvas(800, 1000)
  const photo = await canvas.encode('png')
  let reads = 0, uploads = 0, signatures = 0
  const bucket = {
    async createSignedUrls(keys) {
      signatures++
      return {data:keys.map(key => ({path:key,signedUrl:key===path?'original':null}))}
    },
    async download(key) {
      assert.equal(key,path)
      reads++
      return {data:new Blob([photo])}
    },
    async upload(key,bytes,options) {
      assert.match(key,/^listing-thumbs\//)
      const image = await loadImage(bytes)
      assert.deepEqual([image.width,image.height],[307,384])
      assert.equal(options.contentType,'image/webp')
      uploads++
      return {}
    },
    async createSignedUrl() {return {data:{signedUrl:'preview'}}}
  }
  const db = {storage:{from:()=>bucket}}
  for(let visit=0;visit<2;visit++) {
    const cover=(await listingCovers(db,owner,[path,path])).get(path)
    assert.equal(cover.original,'original')
    assert.equal(cover.preview,'preview')
  }
  assert.equal((await listingCovers(db,randomUUID(),[path])).size,0)
  assert.deepEqual([reads,uploads,signatures],[1,1,1])
})
