import {readFile,writeFile,mkdir,rename} from 'node:fs/promises'
import path from 'node:path'

export const randomInt=(min,max,random=Math.random)=>min+Math.floor(Math.max(0,Math.min(0.999999,random()))*(max-min+1))
export const varied=(value,enabled,random=Math.random)=>enabled?Math.round(value*(0.8+Math.max(0,Math.min(1,random()))*0.4)):value
export const parisDay=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)

// Store only deadlines, counters and item IDs. An uncertain click consumes its slot.
export async function routineMemory(dir,{now=Date.now,random=Math.random}={}){
 const file=path.join(dir,'routine.json')
 let state={version:1,next_browse_at:0,next_pause_at:0,break_until:0,close_for_break:false,tasks:0,target:3,likes:[]}
 try{
  const saved=JSON.parse(await readFile(file,'utf8'))
  if(saved.version!==1||!Array.isArray(saved.likes)||['next_browse_at','next_pause_at','break_until','tasks','target'].some(k=>!Number.isFinite(saved[k])||saved[k]<0)||typeof saved.close_for_break!=='boolean')throw Error('invalid routine')
  if(saved.likes.some(l=>!/^\d{1,18}$/.test(l.id)||!Number.isFinite(l.at)||!['attempted','confirmed'].includes(l.state)))throw Error('invalid favourites')
  state=saved
 }catch(e){if(e.code!=='ENOENT')throw Error('La mémoire des pauses et favoris est illisible. Vérifie le connecteur avant de reprendre.')}
 const save=async()=>{await mkdir(dir,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(state),{mode:0o600});await rename(file+'.tmp',file)}
 const interval=pace=>varied(pace.browse_every_minutes*60000,pace.browse_variety,random)
 const session=pace=>varied(pace.session_minutes*60000,pace.browse_variety,random)
 return {state,
  async initialize(pace){
   if(!state.next_browse_at){state.next_browse_at=now()+interval(pace);state.target=randomInt(pace.browse_after_actions_min,pace.browse_after_actions_max,random)}
   // Time spent offline is already a rest; do not queue an obsolete pause.
   if(!state.next_pause_at||state.next_pause_at<now()-2*pace.session_minutes*60000)state.next_pause_at=now()+session(pace)
   await save()
  },
  due(pace,{idle=false}={}){return pace.browse_enabled&&now()>=state.next_browse_at&&(idle||pace.browse_between_actions&&state.tasks>=state.target)},
  async browsed(pace){state.next_browse_at=now()+interval(pace);state.tasks=0;state.target=randomInt(pace.browse_after_actions_min,pace.browse_after_actions_max,random);await save()},
  async completed(){state.tasks=Math.min(10000,state.tasks+1);await save()},
  async beginBreak(pace){state.break_until=now()+pace.pause_minutes*60000;state.close_for_break=random()*100<pace.pause_close_percent;await save()},
  async finishBreak(pace){state.break_until=0;state.close_for_break=false;state.next_pause_at=now()+session(pace);await save()},
  countLikes(at=now()){return state.likes.filter(l=>parisDay(l.at)===parisDay(at)).length},
  canLike(id,cap,at=now()){return cap>0&&!state.likes.some(l=>l.id===id)&&this.countLikes(at)<cap&&!state.likes.some(l=>l.at>at-10*60000)},
  async reserveLike(id,cap){
   if(!/^\d{1,18}$/.test(id)||!this.canLike(id,cap))return false
   state.likes=state.likes.filter(l=>l.at>now()-31*86400000).slice(-999)
   state.likes.push({id,at:now(),state:'attempted'});await save();return true
  },
  async confirmLike(id){const entry=state.likes.find(l=>l.id===id);if(!entry)throw Error('Favourite has no reservation');entry.state='confirmed';await save()},
 }
}
