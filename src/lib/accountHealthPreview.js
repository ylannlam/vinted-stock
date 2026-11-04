import {healthView} from './accountHealth'
const ago=h=>new Date(Date.now()-h*3600000).toISOString()
let accounts=[
  {id:'a1',login:'camille.dressing',report:{status:'ok',version:1,checked_at:ago(2),reason:'Accès vérifié dans Vinted.'},alerts:[]},
  {id:'a2',login:'lea.vintage',report:{status:'temporary',version:1,checked_at:ago(1),until_at:ago(-23),reason:'Blocage de 24 h indiqué par Vinted.'},alerts:[]},
  {id:'a3',login:'jade.mode',report:null,alerts:[{id:'alert-demo',status:'verification',title:'Vérification demandée',body:'Un captcha est à résoudre dans Vinted.',created_at:ago(1),resolved:false}]},
  ...['nina.closet','sarah.style','emma.shop'].map((login,i)=>({id:`a${i+4}`,login,report:null,alerts:[]}))
]
export async function accountHealthPreview(method='GET',body){
  if(body?.action==='report'){
    const a=accounts.find(a=>a.id===body.account_id)
    if(!a)throw Error('Compte introuvable')
    if((a.report?.version||0)!==body.version)throw Error('Le statut a changé. Actualise.')
    a.report={...body,checked_at:new Date().toISOString(),version:body.version+1}
  }
  return {accounts:structuredClone(accounts.map(a=>({...a,source_present:true,health:healthView(a)}))),sync:{last_completed_at:new Date().toISOString(),partial:false,error:null}}
}
export async function accountHealthAdsPreview(method='GET',body){
  const names=['Dressing Camille','Atelier Léa','Dressing Emma','Sélection Jade','Studio Louise','Dressing Alice']
  const result=await accountHealthPreview(method,body?{...body,account_id:body.account_id?.replace(/^publication-demo-(\d+)$/,(_,i)=>`a${Number(i)+1}`)}:body)
  return {...result,accounts:result.accounts.map((a,i)=>({...a,id:`publication-demo-${i}`,login:names[i]}))}
}
