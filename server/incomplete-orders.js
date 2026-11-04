import {AppError} from './dotb.js'
export async function readIncompleteOrders(db,page=0){
  const index=Number(page)
  if(!Number.isSafeInteger(index)||index<0||index>100000)throw new AppError('Page invalide.')
  const {data,count,error}=await db.from('sales_orders_without_items').select('id,account_login,transaction_id,status,order_date,deadline,synced_at',{count:'exact'}).order('order_date',{ascending:false,nullsFirst:false}).order('id',{ascending:false}).range(index*10,index*10+9)
  if(error)throw error
  return {orders:data,count,page:index,page_size:10}
}
