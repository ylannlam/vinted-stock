import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {prepareDataDirectory,sharedDataDirectory} from './data-directory.mjs'

test('all extracted connector versions resolve to one per-user data directory',()=>{
 assert.equal(sharedDataDirectory({platform:'win32',env:{LOCALAPPDATA:'/local-user'},userHome:'/user'}),path.join('/local-user','StockVinted','AdsPower'))
 assert.equal(sharedDataDirectory({platform:'win32',env:{},userHome:'/user'}),path.join('/user','AppData','Local','StockVinted','AdsPower'))
 assert.equal(sharedDataDirectory({platform:'linux',env:{XDG_STATE_HOME:'/state'},userHome:'/user'}),path.join('/state','StockVinted','AdsPower'))
})

test('updates retain the encrypted connection and action journals, without overwriting existing shared data',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'stock-vinted-migrate-'))
 t.after(async()=>{const relative=path.relative(path.resolve(tmpdir()),path.resolve(dir));if(relative.startsWith('stock-vinted-migrate-')&&!relative.includes(path.sep))await rm(dir,{recursive:true,force:true})})
 const install=path.join(dir,'version-a'),legacy=path.join(install,'.data'),target=path.join(dir,'shared')
 await mkdir(path.join(legacy,'ylavint'),{recursive:true})
 await writeFile(path.join(legacy,'connection.json'),'encrypted-connection')
 await writeFile(path.join(legacy,'profile-operations.json'),'pending-profile-operation')
 await writeFile(path.join(legacy,'ylavint','listing.json'),'pending-publication')
 await writeFile(path.join(legacy,'connection.json.tmp'),'incomplete')
 assert.equal(await prepareDataDirectory(install,{target}),target)
 assert.equal(await readFile(path.join(target,'connection.json'),'utf8'),'encrypted-connection')
 assert.equal(await readFile(path.join(target,'ylavint','listing.json'),'utf8'),'pending-publication')
 assert.equal(await readFile(path.join(target,'profile-operations.json'),'utf8'),'pending-profile-operation')
 await assert.rejects(access(path.join(target,'connection.json.tmp')))
 assert.equal(await readFile(path.join(legacy,'connection.json'),'utf8'),'encrypted-connection','the original stays available')
 await writeFile(path.join(legacy,'connection.json'),'older-installation')
 await writeFile(path.join(target,'ylavint','listing.json'),'publication-confirmed')
 assert.equal(await prepareDataDirectory(path.join(dir,'version-b'),{target}),target)
 await prepareDataDirectory(install,{target})
 assert.equal(await readFile(path.join(target,'connection.json'),'utf8'),'encrypted-connection')
 assert.equal(await readFile(path.join(target,'ylavint','listing.json'),'utf8'),'publication-confirmed')
})
