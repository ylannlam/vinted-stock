import {mkdir,readFile,readdir,open,rename} from 'node:fs/promises'
import path from 'node:path'
const id=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v)

// A crash after clicking Send must never cause another click on the next launch.
export function taskJournal(dir){
  const file=task=>{if(!id(task))throw Error('Tâche invalide.');return path.join(dir,task+'.json')}
  const read=async task=>{try{return JSON.parse(await readFile(file(task),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
  async function write(task,row,exclusive=false){
    await mkdir(dir,{recursive:true,mode:0o700})
    const target=file(task),temp=target+'.tmp'
    const handle=await open(exclusive?target:temp,exclusive?'wx':'w',0o600)
    try{await handle.writeFile(JSON.stringify(row));await handle.sync()}finally{await handle.close()}
    if(!exclusive)await rename(temp,target)
  }
  return {read,async pending(){
    const names=await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})
    const rows=await Promise.all(names.filter(n=>n.endsWith('.json')&&id(n.slice(0,-5))).map(n=>read(n.slice(0,-5))))
    return rows.filter(r=>r&&r.state!=='acknowledged')
  },async begin(task,member){
    const before=await read(task.id)
    if(before){if(before.member!==member)throw Error('Compte différent dans le suivi local.');return before}
    const row={task_id:task.id,lease:task.lease,member,kind:task.kind,state:'started',steps:{},at:new Date().toISOString()}
    await write(task.id,row,true);return row
  },async step(task,name,state){
    const row=await read(task);if(!row)throw Error('Suivi local indisponible.')
    await write(task,{...row,steps:{...row.steps,[name]:state}})
  },async complete(task,payload){
    const row=await read(task);await write(task,{...row,state:'result',payload})
  },async acknowledge(task){const row=await read(task);await write(task,{...row,state:'acknowledged'})}}
}
