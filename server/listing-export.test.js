import test from 'node:test'
import assert from 'node:assert/strict'
import {crc32} from 'node:zlib'
import {listingZip,listingMemo,exportListing} from '../src/lib/listingExport.js'

// Minimal reader for stored (uncompressed) ZIP archives, following the central directory.
async function readZip(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),decoder=new TextDecoder()
 const end=bytes.length-22;assert.equal(view.getUint32(end,true),0x06054b50,'end of central directory')
 const count=view.getUint16(end+10,true),files=[];let at=view.getUint32(end+16,true)
 for(let i=0;i<count;i++){
  assert.equal(view.getUint32(at,true),0x02014b50,'central entry');assert.equal(view.getUint16(at+10,true),0,'stored without recompression')
  const crc=view.getUint32(at+16,true),size=view.getUint32(at+20,true),nameLength=view.getUint16(at+28,true),local=view.getUint32(at+42,true)
  const name=decoder.decode(bytes.subarray(at+46,at+46+nameLength))
  assert.equal(view.getUint32(local,true),0x04034b50,'local header');assert.equal(view.getUint32(local+14,true),crc)
  const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true),data=bytes.slice(start,start+size)
  assert.equal(crc32(data)>>>0,crc,`checksum of ${name}`)
  files.push({name,data});at+=46+nameLength
 }
 return files
}
const jpeg=()=>{const b=new Uint8Array(4096).map((_,i)=>i%251);b.set([0xff,0xd8,0xff,0xe0]);return b}
const row=(patch={})=>({id:'0123456789abcdef',state:'draft',dotb_item_id:null,photos:[{url:'https://example.test/1'},{url:'https://example.test/2'}],fields:{sku:'SKU-1',title:'Body noir côtelé',description:'Neuf, jamais porté.',price:'12.50',size_id:4,size_text:'M',catalog_id:10,brand_id:1,brand_title:'',status_id:2,package_size_id:1,color_ids:[1],item_attributes:[]},...patch})
const meta={catalogs:[{id:10,title:'Bodys'}],colors:[{id:1,title:'Noir'}]}
const options={conditions:[{id:2,title:'Neuf avec étiquette'}],size_groups:[{sizes:[{id:4,title:'M / 38'}]}],package_sizes:[{id:1,title:'Petit'}],attributes:[]}
const account={profile_number:'12',login:'compte-test'}
const fetcher=calls=>async url=>{calls.push(url);return {ok:true,blob:async()=>new Blob([jpeg()],{type:'image/jpeg'})}}

test('the export is a valid archive: original photo bytes in order, then the private memo',async()=>{
 const calls=[],result=await exportListing(row(),account,meta,options,{fetcher:fetcher(calls)})
 assert.equal(result.filename,'annonce-12-01234567.zip');assert.deepEqual(calls,['https://example.test/1','https://example.test/2'])
 const files=await readZip(result.blob)
 assert.deepEqual(files.map(f=>f.name),['photo-01.jpg','photo-02.jpg','fiche-privee.txt'])
 assert.deepEqual(files[0].data,jpeg())
 const memo=new TextDecoder().decode(files[2].data)
 for(const text of ['Body noir côtelé','Neuf, jamais porté.','Prix : 12.50 EUR','Taille : M / 38 (M)','Catégorie : Bodys','Marque : Sans marque','État : Neuf avec étiquette','Couleurs : Noir','#12 · compte-test','ne publie rien'])assert.ok(memo.includes(text),text)
})
test('the export refuses listings already sent to Dotb, empty listings and failed photo downloads',async()=>{
 for(const bad of [row({state:'preparing'}),row({dotb_item_id:'remote'}),row({photos:[]}),row({photos:[{url:null}]})])await assert.rejects(exportListing(bad,account,meta,options,{fetcher:fetcher([])}))
 await assert.rejects(exportListing(row(),account,meta,options,{fetcher:async()=>({ok:false})}),/photo 1/)
 await assert.rejects(exportListing(row(),account,meta,options,{fetcher:async()=>({ok:true,blob:async()=>new Blob(['x'],{type:'text/html'})})}))
})
test('archive names cannot escape the folder',()=>{
 assert.throws(()=>listingZip([{name:'../evil.txt',bytes:new Uint8Array(1)}]),/invalide/)
 assert.ok(listingMemo(row(),null,{},null).includes('Compte choisi : #— · À vérifier'))
})
