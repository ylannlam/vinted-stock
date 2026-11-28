import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'

test('le stock privilégie sa photo puis le fournisseur exact et récupère une photo remplacée',async t=>{
  const rootPath=fileURLToPath(new URL('..',import.meta.url))
  const bundle=await build({entryPoints:[rootPath+'/src/components/Gallery.jsx'],bundle:true,platform:'node',packages:'external',write:false,jsx:'automatic',
    plugins:[{name:'stock-db',setup(builder){
      builder.onResolve({filter:/^\.\.\/lib\/supabase$/},()=>({path:'db',namespace:'fixture'}))
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const supabase=globalThis.stockPhotoDb'}))
    }}]})
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  globalThis.window=window
  globalThis.document=window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const require=createRequire(import.meta.url),React=require('react'),{createRoot}=require('react-dom/client')
  const databaseCalls=[]
  const supplierUrl='https://img.ltwebstatic.com/card-22.webp'
  globalThis.stockPhotoDb={from(table){
    assert.equal(table,'catalog_products')
    return {select:()=>({in:async(column,ids)=>{
      assert.equal(column,'supplier_id')
      databaseCalls.push(ids)
      return {data:[{supplier_id:'22',photo_url:supplierUrl},{supplier_id:'11',photo_url:'https://old.supabase.co/missing'}]}
    }})}
  }}
  const mod=new Module(fileURLToPath(import.meta.url))
  mod.paths=Module._nodeModulePaths(rootPath)
  mod._compile(bundle.outputFiles[0].text,mod.id)
  const root=createRoot(document.getElementById('root'))
  t.after(async()=>{
    await React.act(async()=>root.unmount())
    delete globalThis.window
    delete globalThis.document
    delete globalThis.stockPhotoDb
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  const item=Object.freeze({id:'item-a',status:'en_stock',size:'XL',emplacement:'A4',shein_url:'https://fr.shein.com/robe-p-22.html',photo_url:'https://old.supabase.co/photo'})
  let edited
  const render=async items=>React.act(async()=>root.render(React.createElement(mod.exports.default,{items,onEdit:r=>{edited=r}})))
  const image=()=>document.querySelector('img')
  const fail=async()=>React.act(async()=>image().dispatchEvent(new window.Event('error')))
  const buttons=()=>[...document.querySelectorAll('button')]
  await render([item])
  assert.deepEqual(databaseCalls,[['22']])
  assert.equal(image().getAttribute('src'),item.photo_url)
  await fail()
  assert.equal(image().getAttribute('src'),supplierUrl)
  assert.match(image().getAttribute('alt'),/Photo fournisseur.*A4/)
  await fail()
  assert.equal(image(),null)
  assert.match(document.body.textContent,/Photo indisponible/)
  buttons().find(b=>b.textContent==='Ajouter une photo').click()
  assert.equal(edited,item)
  await render([{...item,photo_url:'https://new.example/stock-user-photo'}])
  assert.equal(image().getAttribute('src'),'https://new.example/stock-user-photo')
  for(const source of ['https://fr.shein.com/robe-p-11.html','https://example.test/robe-p-22.html']){
    await render([{...item,shein_url:source}])
    await fail()
    assert.equal(image(),null,'les autres produits et anciens liens de stockage ne servent jamais de secours')
  }
})
