// Share concurrent reads only; never cache HTTP responses after they complete.
export function createReadPool() {
  const pending=new Map()
  return {
    clear(){pending.clear()},
    read(key,work){
      let entry=pending.get(key)
      if(!entry){
        entry={readers:0}
        entry.task=Promise.resolve().then(work).finally(()=>{if(pending.get(key)===entry)pending.delete(key)})
        pending.set(key,entry)
      }
      entry.readers++
      // The last reader consumes the original stream, so there is no abandoned buffered copy.
      return entry.task.then(response=>--entry.readers===0?response:response.clone())
    },
  }
}
