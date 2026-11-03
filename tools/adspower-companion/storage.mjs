import {mkdir,readFile,writeFile,rename} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import path from 'node:path'

function windowsSecret(input,decrypt=false){
  // Secret material travels only on stdin/stdout, never in process arguments.
  const script=decrypt?"$v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}":"$v=[Console]::In.ReadToEnd(); [Console]::Out.Write((ConvertTo-SecureString $v -AsPlainText -Force | ConvertFrom-SecureString))"
  return new Promise((resolve,reject)=>{
    // PowerShell 7's inherited module path can break Windows PowerShell's DPAPI cmdlets.
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'))
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let output=''
    child.stdout.on('data',chunk=>{output+=chunk});child.stderr.resume()
    child.on('error',()=>reject(Error('Impossible de protéger la clé sur ce PC.')))
    child.on('exit',code=>code===0?resolve(output.trim()):reject(Error('Impossible de lire la clé protégée. Configure à nouveau ce PC.')))
    child.stdin.end(input)
  })
}
export async function saveConfig(dir,{apiKey,port}){
  await mkdir(dir,{recursive:true,mode:0o700})
  const protectedKey=process.platform==='win32'?await windowsSecret(apiKey):apiKey
  const data={version:1,port,protection:process.platform==='win32'?'dpapi':'owner-file',protectedKey}
  const file=path.join(dir,'connection.json');await writeFile(file+'.tmp',JSON.stringify(data),{mode:0o600});await rename(file+'.tmp',file)
}
export async function readConfig(dir){
  let data;try{data=JSON.parse(await readFile(path.join(dir,'connection.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw Error('Le fichier de connexion est illisible.')}
  if(data.version!==1||!['dpapi','owner-file'].includes(data.protection))throw Error('La connexion doit être configurée à nouveau.')
  return {port:data.port,apiKey:data.protection==='dpapi'?await windowsSecret(data.protectedKey,true):data.protectedKey}
}
