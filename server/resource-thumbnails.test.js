import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {attachImages,thumbPath} from './resources.js'
import {generateThumbnails,makeThumbnail} from './resource-thumbnails.js'
import {resourcesHandler} from '../api/resources.js'
import {stableThumbs,missingThumbs,thumbOf,resetThumbCache,resourceImageKey,mergeThumbnails} from '../src/lib/resourceThumbs.js'
import {clearViewCache} from '../src/lib/viewCache.js'

const user='11111111-1111-4111-8111-111111111111'
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',c='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const original=`${user}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png`
function storage(){
 const files=new Map([[`creative-assets/${original}`,new Blob([new Uint8Array(2000)],{type:'image/png'})],['fonds/legacy.jpg',new Blob([new Uint8Array(1500)],{type:'image/jpeg'})]])
 const calls=[]
 return {files,calls,getBucket:async()=>({data:{public:false}}),from(bucket){return {
  createSignedUrls:async paths=>{calls.push(['sign',bucket,paths]);return {data:paths.map(path=>({path,signedUrl:files.has(`${bucket}/${path}`)?`https://example.test/${bucket}/${path}?token=${calls.length}`:null}))}},
  download:async path=>{calls.push(['download',bucket,path]);return files.has(`${bucket}/${path}`)?{data:files.get(`${bucket}/${path}`)}:{error:Error('missing')}},
  upload:async(path,body,options)=>{calls.push(['upload',bucket,path,options]);if(files.has(`${bucket}/${path}`))return {error:{statusCode:'409',message:'The resource already exists'}};files.set(`${bucket}/${path}`,new Blob([body],{type:options.contentType}));return {data:{path}}}
 }}}
}
function database(rows){
 const store=storage()
 return {store,rows,from(table){assert.equal(table,'creative_resources');let ids=null
  const q={select(){return q},in(k,v){assert.equal(k,'id');ids=v;return q},then(resolve){return Promise.resolve({data:structuredClone(rows.filter(r=>ids.includes(r.id))),error:null}).then(resolve)}};return q},storage:store}
}
const rows=()=>[{id:a,kind:'background',title:'A',image_bucket:'creative-assets',image_path:original},{id:b,kind:'background',title:'B',image_bucket:'fonds',image_path:'legacy.jpg'},{id:c,kind:'prompt',title:'C',image_bucket:null,image_path:null}]

test('preview paths stay in the private bucket and never replace the original file',()=>{
 assert.equal(thumbPath('creative-assets',original),`thumbs/v1/creative-assets/${user}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png.webp`)
 assert.equal(thumbPath('fonds','legacy.jpg'),'thumbs/v1/fonds/legacy.jpg.webp')
 assert.notEqual(thumbPath('fonds','legacy.jpg'),thumbPath('fonds','legacy.png'))
})
test('a missing preview falls back to the full image; an existing one is signed in a single batch',async()=>{
 const db=database(rows())
 let [first,second,prompt]=await attachImages(db,rows())
 assert.equal(first.thumb_url,null);assert.match(first.image_url,/creative-assets/);assert.equal(thumbOf(first),first.image_url)
 assert.equal(prompt.thumb_url,null);assert.equal(prompt.image_url,null)
 db.store.files.set(`creative-assets/${thumbPath('creative-assets',original)}`,new Blob(['x']))
 ;[first,second]=await attachImages(db,rows())
 assert.match(first.thumb_url,/thumbs\/v1\/creative-assets/);assert.equal(first.thumb_path,thumbPath('creative-assets',original));assert.equal(thumbOf(first),first.thumb_url)
 assert.equal(second.thumb_url,null)
 assert.equal(db.store.calls.filter(([k,bucket,paths])=>k==='sign'&&bucket==='creative-assets'&&paths.some(p=>p.startsWith('thumbs/'))).length,2,'one batch per response')
})
test('missing previews are made from the originals, which are only read; repeated runs are harmless',async()=>{
 const db=database(rows()),made=[]
 const make=async bytes=>{made.push(bytes.length);return Buffer.from('webp')}
 const result=await generateThumbnails(db,[a,b,c],{make})
 assert.deepEqual(made,[2000,1500]);assert.deepEqual(result.failed,[])
 assert.ok(result.thumbnails.find(t=>t.id===a).thumb_url);assert.ok(result.thumbnails.find(t=>t.id===b).thumb_url)
 const uploads=db.store.calls.filter(c=>c[0]==='upload')
 assert.ok(uploads.every(([,bucket,path,o])=>bucket==='creative-assets'&&path.startsWith('thumbs/')&&o.contentType==='image/webp'&&o.upsert===false))
 assert.equal(db.store.files.get(`creative-assets/${original}`).size,2000,'original untouched')
 const again=await generateThumbnails(db,[a],{make});assert.deepEqual(again.failed,[]);assert.ok(again.thumbnails[0].thumb_url);assert.equal(made.length,2,'existing previews are not decoded again');assert.equal(db.store.calls.filter(c=>c[0]==='download').length,2,'existing previews do not download originals again')
})
test('a broken image is reported without stopping the others; invalid selections are refused',async()=>{
 const db=database(rows())
 const result=await generateThumbnails(db,[a,b],{make:async bytes=>{if(bytes.length===2000)throw Error('corrupt');return Buffer.from('webp')}})
 assert.deepEqual(result.failed,[a]);assert.equal(result.thumbnails.find(t=>t.id===a).thumb_url,null);assert.ok(result.thumbnails.find(t=>t.id===b).thumb_url)
 for(const ids of [[],[a,a],['x'],[a,b,c,user,original],null])await assert.rejects(generateThumbnails(db,ids,{make:async()=>Buffer.from('')}))
})
test('real conversion: a large image becomes a small WebP within 720 pixels, small images are not enlarged',async()=>{
 const {createCanvas,loadImage}=await import('@napi-rs/canvas')
 const big=createCanvas(1792,2342),ctx=big.getContext('2d');ctx.fillStyle='#c9a';ctx.fillRect(0,0,1792,2342);ctx.fillStyle='#123';ctx.fillRect(200,300,900,1200)
 const png=await big.encode('png'),out=await makeThumbnail(png),image=await loadImage(out)
 assert.equal(out.subarray(8,12).toString(),'WEBP');assert.equal(Math.max(image.width,image.height),720);assert.ok(out.length<png.length)
 const small=await loadImage(await makeThumbnail(await createCanvas(300,200).encode('jpeg')));assert.deepEqual([small.width,small.height],[300,200])
})
test('the Atelier API exposes thumbnail creation to administrators only, inside the existing function',async()=>{
 const db=database(rows()),res=()=>{const r={code:200,headers:{},setHeader(k,v){r.headers[k]=v},status(c){r.code=c;return r},json(b){r.body=b;return r},end(){return r}};return r}
 let out=res();await resourcesHandler(async(req,r,roles)=>{assert.deepEqual(roles,['admin']);return {db,user:{id:user},role:'admin'}})({method:'POST',body:{action:'thumbnails',ids:[c]},query:{},headers:{}},out)
 assert.equal(out.code,200);assert.deepEqual(out.body.failed,[])
 out=res();await resourcesHandler(async(req,r)=>{r.status(401).json({error:'Connectez-vous'});return null})({method:'POST',body:{action:'thumbnails',ids:[a]},query:{},headers:{}},out)
 assert.equal(out.code,401);assert.equal(db.store.calls.some(c=>c[0]==='upload'),false)
})
test('PNG provenance with an embedded SVG does not break the preview or change the original',async()=>{
 const {createCanvas,loadImage}=await import('@napi-rs/canvas')
 const png=await createCanvas(80,60).encode('png')
 const metadata=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>Provenance test</text></svg>')
 const chunk=Buffer.alloc(metadata.length+12);chunk.writeUInt32BE(metadata.length);chunk.write('caBX',4);metadata.copy(chunk,8)
 let crc=0xffffffff
 for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1}
 chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4)
 const source=Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]),original=Buffer.from(source)
 const image=await loadImage(await makeThumbnail(source))
 assert.deepEqual([image.width,image.height],[80,60]);assert.deepEqual(source,original)
})
test('preview links are reused for 50 minutes so the browser cache works, and each resource is asked once',()=>{
 resetThumbCache()
 const row={id:a,image_path:original,thumb_path:'thumbs/x.webp',thumb_url:'https://example.test/x?token=1'}
 assert.equal(stableThumbs([row],0)[0].thumb_url,'https://example.test/x?token=1')
 assert.equal(stableThumbs([{...row,thumb_url:'https://example.test/x?token=2'}],10*60000)[0].thumb_url,'https://example.test/x?token=1')
 assert.equal(stableThumbs([{...row,thumb_url:'https://example.test/x?token=3'}],51*60000)[0].thumb_url,'https://example.test/x?token=3')
 const missing=[{id:a,image_path:'p'},{id:b,image_path:'p'},{id:c,image_path:null}]
 assert.deepEqual(missingThumbs(missing),[a,b]);assert.deepEqual(missingThumbs(missing),[])
})
test('replacing an image schedules a new preview and ignores a late response for the old image',()=>{
 resetThumbCache()
 const before={id:a,image_bucket:'creative-assets',image_path:'old.png',thumb_url:null}
 assert.deepEqual(missingThumbs([before]),[a])
 const after={...before,image_path:'new.png'}
 assert.deepEqual(missingThumbs([after]),[a])
 const requested=new Map([[a,resourceImageKey(before)]])
 const late={id:a,thumb_path:'thumbs/old.png.webp',thumb_url:'https://example.test/old.webp'}
 assert.equal(mergeThumbnails([after],[late],requested)[0].thumb_url,null)
 assert.equal(mergeThumbnails([before],[late],requested)[0].thumb_url,late.thumb_url)
})
test('sign-out or an account scope change clears cached signed links and failed attempts',()=>{
 resetThumbCache()
 const row={id:a,image_path:original,thumb_path:'thumbs/test.webp',thumb_url:'https://example.test/old'}
 stableThumbs([row],0);missingThumbs([{id:b,image_path:'broken.png'}])
 clearViewCache()
 assert.equal(stableThumbs([{...row,thumb_url:'https://example.test/new'}],100)[0].thumb_url,'https://example.test/new')
 assert.deepEqual(missingThumbs([{id:b,image_path:'broken.png'}]),[b])
})
test('the Atelier shows previews in the list, the full image in the detail view, and fills in missing previews once',async()=>{
 resetThumbCache()
 const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
 globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/ResourcesTab.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['../lib/api','./ListingStudio']})
 const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
 const ResourcesTab=mod.exports.default,root=createRoot(document.getElementById('app')),calls=[]
 const now=new Date().toISOString(),base={kind:'background',category:'',content:'',content_back:'',notes:'',favorite:false,archived_at:null,version:1,updated_at:now,created_at:now}
 const list=[{...base,id:a,title:'Fond lourd',image_path:original,image_bucket:'creative-assets',image_url:'https://example.test/full-a.png',thumb_url:null,thumb_path:null},
  {...base,id:b,title:'Fond prêt',image_path:'legacy.jpg',image_bucket:'fonds',image_url:'https://example.test/full-b.jpg',thumb_url:'https://example.test/thumb-b.webp',thumb_path:'thumbs/v1/fonds/legacy.jpg.webp'}]
 const request=async(method='GET',body)=>{calls.push(body?.action||method)
  if(method==='GET')return {resources:structuredClone(list),count:2,page_size:50}
  if(body.action==='thumbnails')return {thumbnails:[{id:a,thumb_url:'https://example.test/thumb-a.webp',thumb_path:'thumbs/a.webp'}],failed:[]}
  throw Error('unexpected '+body.action)}
 const srcs=()=>[...document.querySelectorAll('img')].map(i=>i.getAttribute('src'))
 try{
  await act(async()=>root.render(React.createElement(ResourcesTab,{request,accountsRequest:async()=>({accounts:[]}),initialSection:'library'})))
  await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  assert.deepEqual(calls.filter(c=>c==='thumbnails').length,1,'missing preview requested once')
  assert.ok(srcs().includes('https://example.test/thumb-a.webp'),'new preview displayed');assert.ok(srcs().includes('https://example.test/thumb-b.webp'))
  assert.equal(srcs().some(s=>/full-/.test(s)),false,'no full image in the list')
  await act(async()=>[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Ouvrir Fond prêt').click())
  assert.ok(srcs().includes('https://example.test/full-b.jpg'),'full image in the detail view')
 }finally{await act(async()=>root.unmount());delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT}
})
