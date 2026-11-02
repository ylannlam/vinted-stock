// Share concurrent reads only; never cache HTTP responses after they complete.
export function createReadPool() {
  const pending=new Map()
  return {
    clear(){pending.clear()},
    read(key,work){
      let task=pending.get(key)
      if(!task){
        task=Promise.resolve().then(work).finally(()=>{if(pending.get(key)===task)pending.delete(key)})
        pending.set(key,task)
      }
      return task.then(response=>response.clone())
    },
  }
}
