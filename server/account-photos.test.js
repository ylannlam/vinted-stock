import test from 'node:test'
import assert from 'node:assert/strict'
import {photoAccounts,readPhotos,savePhotos,downloadPhoto,addPhotoBackground} from './account-photos.js'

const id=n=>'ae000000-0000-4000-8000-'+String(n).padStart(12,'0')
function fixture(){
  const dbRows={
    scalency_records:[{kind:'accounts',remote_id:id(1),payload:{login:'robe-a',linked:true}},{kind:'accounts',remote_id:id(2),payload:{login:'robe-b',linked:true}}],
    vinted_accounts:[{id:id(7),pseudo:'Robe-A',deleted_at:null}],
    account_photo_profiles:[{id:id(1),login:'robe-a',background_id:id(4),version:3,prompt_front:'face A',prompt_back:'dos A',photo_label:null}],
    account_photo_backgrounds:[{id:id(4),title:'Parquet foncé',image_path:'account-photos/image.png'}],
    creative_accounts:[{id:id(2),login:'robe-b',background_id:id(8),prompt_front:'Ancien prompt'}],
    creative_resources:[{id:id(8),kind:'background',title:'Ancien fond',image_path:'ancienne.png'}]
  }
  const db={storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'https://test/'+path}))}),createSignedUrl:async(path,ttl,o)=>({data:{signedUrl:'https://test/'+o.download}})})},
    from(name){
      const rows=dbRows[name];let result=rows,patch,newRow
      const b={select(){return b},order(){return b},eq(key,v){result=result.filter(x=>x[key]===v);return b},is(key,v){return b.eq(key,v)},in(key,vs){result=result.filter(x=>vs.includes(x[key]));return b},
        range:async(a,z)=>({data:result.slice(a,z+1)}),update(data){patch=data;return b},insert(data){newRow={version:1,...data};return b},
        async maybeSingle(){if(newRow){rows.push(newRow);return {data:newRow}}if(patch&&result[0])Object.assign(result[0],patch);return {data:result[0]||null}}};return b
    }}
  return db
}
test('les nouvelles associations suivent le compte et les anciennes associations sont ignorées',async()=>{
  const db=fixture(),reg=(await readPhotos(db,id(7))).account,remote=(await readPhotos(db,id(1))).account
  assert.deepEqual(reg,remote);assert.equal(remote.front,'face A');assert.equal(remote.back,'dos A')
  const b=(await readPhotos(db,id(2))).account
  assert.equal(b.front,'');assert.equal(b.hasImage,false);assert.equal(b.version,0)
  assert.deepEqual((await readPhotos(db,null,true)).backgrounds.map(b=>b.id),[id(4)])
  assert.equal((await readPhotos(db)).accounts.length,2)
})
test('nouveau profil, nom du fichier, conservation du texte exact et conflit de versions',async()=>{
  const db=fixture(),body={account:id(2),version:0,label:' Parquet clair ',background_id:id(4),prompt_front:'  Ligne 1\nLigne 2  ',prompt_back:null}
  const {account}=await savePhotos(db,body)
  assert.equal(account.front,body.prompt_front);assert.equal(account.name,'Parquet clair')
  assert.equal((await downloadPhoto(db,{...body,version:1})).name,'robe-b-parquet-clair.png')
  await assert.rejects(savePhotos(db,body),e=>e.status===409)
  await assert.rejects(downloadPhoto(db,{...body,background_id:id(8),version:1}),e=>e.status===409)
  const a=(await readPhotos(db,id(1))).account;assert.equal(a.front,'face A');assert.equal(a.version,3)
})
test('des pseudos ambigus restent distincts et un identifiant Scalency texte reste stable',()=>{
  const remote=[{remote_id:'external-1',payload:{login:'Même'}},{remote_id:id(3),payload:{login:'Même'}}]
  const reg=[{id:id(5),pseudo:'même'}]
  const a=photoAccounts(remote,reg,[]);assert.equal(a.length,3);assert.equal(new Set(a.map(g=>g.id)).size,3)
  assert.equal(a.find(g=>g.remote==='external-1').id,photoAccounts(remote,reg,[]).find(g=>g.remote==='external-1').id)
})

test('les fichiers de l’ancienne bibliothèque ne peuvent pas être ajoutés par leur chemin',async()=>{
  await assert.rejects(addPhotoBackground(fixture(),{id:id(5)},{id:id(8),title:'Ancien',path:id(5)+'/'+id(6)+'.png'}),/nouveau fond/)
  await assert.rejects(savePhotos(fixture(),{account:id(2),version:0,label:'',background_id:id(8),prompt_front:null,prompt_back:null}),/indisponible/)
})
