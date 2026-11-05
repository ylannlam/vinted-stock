import {mkdir,readFile,writeFile,rename} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {LocalError} from './adspower.mjs'

// Persist only request hashes and non-secret results. An interrupted write operation
// must be checked in AdsPower rather than sent a second time after a restart.
export async function createFactoryJournal(dir){
  const file=dir?path.join(dir,'profile-operations.json'):null
  let entries={}
  if(file)try{entries=JSON.parse(await readFile(file,'utf8'));if(!entries||Array.isArray(entries)||typeof entries!=='object')throw Error('Invalid journal')}
  catch(e){if(e.code!=='ENOENT')throw Error('L’historique des opérations AdsPower est illisible. Conserve le dossier .data et contacte ton administrateur.')}
  async function persist(){
    if(!file)return
    await mkdir(dir,{recursive:true,mode:0o700})
    await writeFile(file+'.tmp',JSON.stringify(entries),{mode:0o600});await rename(file+'.tmp',file)
  }
  return async(requestId,operation,work)=>{
    const digest=createHash('sha256').update(JSON.stringify([requestId,operation])).digest('hex'),previous=entries[requestId]
    if(previous){
      if(previous.digest!==digest)throw new LocalError('Cette demande correspond à une autre opération. Actualise la page.',409)
      if(previous.state==='done')return previous.result
      throw new LocalError('Le résultat de cette opération est incertain. Vérifie le profil dans AdsPower avant toute nouvelle création ou modification.',409,'factory_uncertain')
    }
    let sent=false
    const dispatch=async()=>{entries[requestId]={digest,state:'pending'};await persist();sent=true}
    let result
    try{result=await work(dispatch)}catch(error){if(!sent&&error instanceof LocalError)error.code='factory_not_started';throw error}
    if(sent){entries[requestId]={digest,state:'done',result};await persist()}
    return result
  }
}
