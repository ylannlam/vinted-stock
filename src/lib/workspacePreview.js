export async function workspacePreview(view='overview',query={},body){
 if(body)return {restored:true}
 if(view==='overview')return {sales:{to_order:4,to_ship:2,urgent:2,missing_sku:1,review:0},stock:{available:36,to_ship:2,receiving:1},collector:{pending:2,review:0},directions:{selected:5,incomplete:2},urgent_lines:[{id:'demo',title:'Robe fleurie · taille M',account_login:'Compte démo',deadline_at:new Date(Date.now()+86400000).toISOString(),effective_stage:'ordered'}]}
 if(view==='finance')return {totals:[{currency:'EUR',quantity:6,net_revenue:149.4,missing_revenue:0,purchase_cost:64,cost_count:6,estimated_margin:75.4,estimated_count:6,confirmed_margin:37.2,confirmed_count:3,fees:10,refunds:0,returns:0,coef_revenue:139.4,coef_cost:64,coef_count:6}],rows:[{id:'demo-1',title:'Robe côtelée',account_login:'Compte démo 1',actual_cost:12,currency:'EUR',finance_confirmed:true}],count:1,page:0,page_size:50}
 if(view==='activity')return {rows:[{id:1,label:'Robe fleurie',action:'updated',actor_name:'Utilisateur démo',created_at:new Date().toISOString(),changes:{stage:{before:'ordered',after:'in_transit'}}}],count:1}
 return {rows:[],count:0,page:0,page_size:50}
}
