import {attachImages} from './resources.js'
import {readHealth} from './account-health.js'
import {readBoardRows} from './team-board.js'
import {parisDay} from '../src/lib/publications.js'

const check=result=>{if(result.error)throw result.error;return result.data}

// Choix du compte : le fond de chaque compte (celui des photos de ses annonces), ses publications
// du jour, les articles en cours et son état connu. Aucune lecture de Dotb ni d'AdsPower.
export async function readListingPicker(db,user,{now=new Date(),health=readHealth}={}){
 const [styles,counts,known,mine]=await Promise.all([
  readBoardRows(()=>db.from('creative_accounts').select('id,background_id',{count:'exact'}).order('id')),
  db.rpc('team_board_counts',{p_day:parisDay(now)}),
  health(db,{ownerId:user.id}).catch(()=>({accounts:[],unavailable:true})),
  readBoardRows(()=>db.from('listing_drafts').select('id,state,fields',{count:'exact'}).eq('owner_id',user.id).neq('state','published').order('id'))
 ])
 const backgroundIds=[...new Set(styles.map(s=>s.background_id).filter(Boolean))]
 const rows=backgroundIds.length?(check(await db.from('creative_resources').select('id,title,image_bucket,image_path,archived_at').in('id',backgroundIds))||[]).filter(r=>!r.archived_at):[]
 const images=new Map((await attachImages(db,rows)).map(r=>[r.id,r]))
 const stats=new Map((check(counts)?.stats||[]).map(s=>[s.account_id,s]))
 const states=new Map((known.accounts||[]).map(a=>[a.id,a.health]))
 const accounts={}
 const entry=id=>accounts[id]||={background:null,today:0,week:0,last_at:null,in_progress:0,health:null}
 for(const style of styles){
  const image=images.get(style.background_id)
  if(image&&(image.thumb_url||image.image_url))entry(style.id).background={title:image.title,url:image.thumb_url||image.image_url,original_url:image.image_url}
 }
 for(const [id,s] of stats)Object.assign(entry(id),{today:Number(s.today||0),week:Number(s.week||0),last_at:s.last_at||null})
 for(const d of mine)if(d.fields?.account_id)entry(d.fields.account_id).in_progress++
 for(const [id,h] of states)if(h)entry(id).health={status:h.status,label:h.label,attention:!!h.attention}
 return {accounts,health_unavailable:!!known.unavailable}
}
