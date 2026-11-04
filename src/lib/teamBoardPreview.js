// Données fictives de l'onglet « Alicia » pour la page de démonstration.
const hours=h=>new Date(Date.now()-h*3600000).toISOString()
const account=(id,login,number,patch={})=>({account_id:id,login,profile:{id:`demo-${number-1}`,number:String(number),name:login},can_create:number<=2,vinted:{creation_stage:'ready',is_ready:true},style:{ready:true,background:true,front:true,back:true},today:0,week:0,last_at:null,drafts:0,recent:[],mine:[],...patch})
let board={day:new Date().toISOString().slice(0,10),me:'Alicia',accounts:[
  account('a1','camille.dressing',1,{today:2,week:9,last_at:hours(2),recent:[{id:'r1',title:'Robe noire côtelée',url:'https://www.vinted.fr/items/1',published_at:hours(2),author:'Alicia',mine:true}]}),
  account('a2','lea.vintage',2,{week:3,last_at:hours(70),drafts:1,mine:[{id:'d1',version:2,title:'Body noir manches longues'}]}),
  account('a3','jade.mode',3,{style:{ready:false,background:true,front:false,back:false}}),
  account('a4','nina.closet',4,{vinted:{creation_stage:'post1',creation_next_at:hours(1)}}),
  account('a5','sarah.style',5,{vinted:{creation_stage:'wait',creation_next_at:hours(-20)},week:2,last_at:hours(30)}),
  account('a6','emma.shop',6,{vinted:{statut:'banni_temp',blocked_at:hours(30)},week:4,last_at:hours(50)})
]}
export async function teamBoardPreview(method='GET',body) {
  if(method==='POST'&&body?.action==='mark_published'){
    board=structuredClone(board)
    const row=board.accounts.find(a=>a.mine.some(d=>d.id===body.id))
    if(row){const d=row.mine.find(x=>x.id===body.id);row.mine=row.mine.filter(x=>x.id!==body.id);row.today++;row.week++;row.last_at=new Date().toISOString();row.drafts=Math.max(0,row.drafts-1);row.recent=[{id:d.id,title:d.title,url:body.url,published_at:row.last_at,author:'Alicia',mine:true},...row.recent]}
    return {draft:{id:body.id,state:'published'}}
  }
  return structuredClone(board)
}
