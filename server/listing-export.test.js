import test from 'node:test'
import assert from 'node:assert/strict'
import {readStoredZip} from '../tests/read-stored-zip.js'
import {listingZip,listingMemo,exportListing} from '../src/lib/listingExport.js'

const jpeg=()=>{const b=new Uint8Array(4096).map((_,i)=>i%251);b.set([0xff,0xd8,0xff,0xe0]);return b}
const row=(patch={})=>({id:'0123456789abcdef',state:'draft',dotb_item_id:null,photos:[{url:'https://example.test/1'},{url:'https://example.test/2'}],fields:{sku:'SKU-1',title:'Body noir côtelé',description:'Neuf, jamais porté.',price:'12.50',size_id:4,size_text:'M',catalog_id:10,brand_id:1,brand_title:'',status_id:2,package_size_id:1,color_ids:[1],item_attributes:[]},...patch})
const meta={catalogs:[{id:10,title:'Bodys'}],colors:[{id:1,title:'Noir'}]}
const options={conditions:[{id:2,title:'Neuf avec étiquette'}],size_groups:[{sizes:[{id:4,title:'M / 38'}]}],package_sizes:[{id:1,title:'Petit'}],attributes:[]}
const account={profile_number:'12',login:'compte-test'}
const fetcher=calls=>async url=>{calls.push(url);return {ok:true,blob:async()=>new Blob([jpeg()],{type:'image/jpeg'})}}

test('the export is a valid archive: original photo bytes in order, then the private memo',async()=>{
 const calls=[],result=await exportListing(row(),account,meta,options,{fetcher:fetcher(calls)})
 assert.equal(result.filename,'annonce-12-01234567.zip');assert.deepEqual(calls,['https://example.test/1','https://example.test/2'])
 const files=readStoredZip(await result.blob.arrayBuffer())
 assert.deepEqual(files.map(f=>f.name),['photo-01.jpg','photo-02.jpg','fiche-privee.txt'])
 assert.deepEqual(files[0].data,Buffer.from(jpeg()))
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
