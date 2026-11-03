import {AppError} from './dotb.js'
import {buildDailyPurchases,purchaseDay} from '../src/lib/dailyPurchases.js'

export async function readDailyPurchases(db,query={},now=Date.now()) {
  const day=query.day||purchaseDay(now)
  if(typeof day!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day>purchaseDay(now))throw new AppError('Choisis une date valide, au plus tard aujourd’hui.')
  const {data,error}=await db.rpc('daily_purchase_context_v2',{p_day:day,p_include_earlier:query.include_earlier==='true'||query.include_earlier===true})
  if(error)throw error
  return buildDailyPurchases(data,now)
}
