import {readFile,writeFile,mkdir,rename} from 'node:fs/promises'
import path from 'node:path'

// Only article identifiers and visit dates are retained, separately for each linked account.
export async function browseMemory(dir,now=Date.now()){
 const file=path.join(dir,'navigation.json');let rows=[]
 try{const data=JSON.parse(await readFile(file,'utf8'));if(Array.isArray(data))rows=data}catch(e){if(e.code!=='ENOENT')throw Error('La mémoire de consultation est illisible. Vérifie le connecteur.')}
 const visited=new Map(rows.filter(r=>Array.isArray(r)&&/^\d{1,18}$/.test(r[0])&&Number.isFinite(r[1])&&r[1]>now-8*86400000))
 return {visited,async record(id,at=Date.now()){
  visited.delete(id);visited.set(id,at);while(visited.size>300)visited.delete(visited.keys().next().value)
  await mkdir(dir,{recursive:true});await writeFile(file+'.tmp',JSON.stringify([...visited]),{mode:0o600});await rename(file+'.tmp',file)
 }}
}
