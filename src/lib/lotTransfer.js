export const scalencyQueueUrl='https://app.scalencyai.com/annonces/file/api?statut=file'

export async function transferConfirmedLot(lot,request,onUpdate){
  let progress
  do{
    progress=await request('transmit-lot',{lot})
    onUpdate?.(progress)
  }while(progress.more)
  return progress
}

export function transferMessage({received,total,more}){
  const count=received+' / '+total
  if(received===total&&total>0)return count+' en file chez Scalency.'
  if(more)return count+' reçue(s) par Scalency. Transmission en cours…'
  return count+' reçue(s) par Scalency. Consulte le suivi du lot pour les autres annonces.'
}
