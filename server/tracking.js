export async function readTrackingPeriod(db) {
  const {data,error}=await db.from('dotb_tracking_period').select('starts_at,time_zone').single()
  if(error)throw error
  if(!data||!Number.isFinite(Date.parse(data.starts_at)))throw Error('tracking_period_missing')
  return data
}
