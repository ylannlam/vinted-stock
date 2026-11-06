// Calcul des dépenses IA (partagé entre le serveur et la démo).
export function aiCost(row,prices){
 const p=prices.get(row.model)
 return p?(row.input_tokens*Number(p.input_per_million)+row.output_tokens*Number(p.output_per_million))/1e6:null
}

export function summarizeAiUsage(rows,priceRows,{days,now=Date.now(),logins=new Map()}){
 const prices=new Map(priceRows.map(p=>[p.model,p])),dayKey=v=>new Date(v).toLocaleDateString('fr-CA',{timeZone:'Europe/Paris'})
 const total={generations:0,input_tokens:0,output_tokens:0,cost:0,unpriced:0}
 const byDay=new Map(),byModel=new Map(),byAccount=new Map()
 for(const r of rows){
  const cost=aiCost(r,prices)
  total.generations++;total.input_tokens+=r.input_tokens;total.output_tokens+=r.output_tokens
  if(cost==null)total.unpriced++;else total.cost+=cost
  for(const [map,key,label] of [[byDay,dayKey(r.created_at),null],[byModel,r.model,r.model],[byAccount,r.account_id||'',logins.get(r.account_id)||(r.account_id?'Compte retiré':'Sans compte')]]){
   const e=map.get(key)||{key,label,generations:0,cost:0}
   e.generations++;e.cost+=cost||0;map.set(key,e)
  }
 }
 const start=new Date(now-(days-1)*86400000)
 const series=Array.from({length:days},(_,i)=>{const key=dayKey(start.getTime()+i*86400000);return byDay.get(key)||{key,generations:0,cost:0}})
 return {days,total,series,models:[...byModel.values()].sort((a,b)=>b.cost-a.cost),accounts:[...byAccount.values()].sort((a,b)=>b.generations-a.generations).slice(0,20),
  prices:priceRows.map(p=>({model:p.model,input_per_million:Number(p.input_per_million),output_per_million:Number(p.output_per_million),updated_at:p.updated_at})),
  unknown_models:[...byModel.keys()].filter(m=>!prices.has(m))}
}

