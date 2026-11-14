// Two local calendar slots, rather than a drifting twelve-hour timer.
export function walletSlot(now=Date.now(),hours=[9,18]){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]))
 const hour=[...hours].sort((a,b)=>a-b).filter(h=>h<=Number(parts.hour)).at(-1)
 return hour==null?null:`${parts.year}-${parts.month}-${parts.day}:${String(hour).padStart(2,'0')}`
}
export function walletDue(last,now,hours){
 const slot=walletSlot(now,hours)
 return !!slot&&(!last||!Number.isFinite(Date.parse(last))||walletSlot(Date.parse(last),hours)!==slot)
}
