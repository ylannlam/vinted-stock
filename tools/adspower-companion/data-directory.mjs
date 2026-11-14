import {mkdir,copyFile,readdir,stat} from 'node:fs/promises'
import {constants} from 'node:fs'
import {homedir} from 'node:os'
import path from 'node:path'

// Keep the connection and action journals together across extracted updates.
export function sharedDataDirectory({platform=process.platform,env=process.env,userHome=homedir()}={}){
 const base=platform==='win32'?(env.LOCALAPPDATA||path.join(userHome,'AppData','Local')):(env.XDG_STATE_HOME||path.join(userHome,'.local','state'))
 return path.join(base,'StockVinted','AdsPower')
}
const exists=async file=>{try{await stat(file);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
async function copyMissing(source,target){
 await mkdir(target,{recursive:true,mode:0o700})
 for(const entry of await readdir(source,{withFileTypes:true})){
  if(entry.name==='connection.json'||entry.name.endsWith('.tmp'))continue
  const from=path.join(source,entry.name),to=path.join(target,entry.name)
  if(entry.isSymbolicLink())throw Error('Le dossier de données contient un lien inattendu. Conserve ce dossier et contacte ton administrateur.')
  if(entry.isDirectory())await copyMissing(from,to)
  else if(entry.isFile())try{await copyFile(from,to,constants.COPYFILE_EXCL)}catch(e){if(e.code!=='EEXIST')throw e}
 }
}
export async function prepareDataDirectory(installDir,{target=sharedDataDirectory()}={}){
 const legacy=path.join(installDir,'.data'),connection=path.join(target,'connection.json')
 if(path.resolve(legacy)===path.resolve(target)||await exists(connection))return target
 if(await exists(path.join(legacy,'connection.json'))){
  // The connection is copied last: an interrupted migration is retried before use.
  await copyMissing(legacy,target)
  try{await copyFile(path.join(legacy,'connection.json'),connection,constants.COPYFILE_EXCL)}catch(e){if(e.code!=='EEXIST')throw e}
 }
 return target
}
