import {MAX_IMAGE_BYTES} from './resources.js'

const unavailable='Le fond photo est indisponible. Actualise la fiche et réessaie.'

function imageType(bytes){
  if([137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value))return 'image/png'
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg'
  const marker=String.fromCharCode(...bytes)
  if(marker.startsWith('RIFF')&&marker.slice(8,12)==='WEBP')return 'image/webp'
  return ''
}

export async function readBackgroundFile(downloadUrl,originalUrl,fetcher=fetch){
  // Both signed links refer to the version checked by the download endpoint.
  for(const url of new Set([downloadUrl,originalUrl].filter(Boolean))){
    try{
      const response=await fetcher(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)})
      if(!response.ok||Number(response.headers.get('content-length'))>MAX_IMAGE_BYTES)continue
      const blob=await response.blob()
      if(!blob.size||blob.size>MAX_IMAGE_BYTES)continue
      const type=imageType(new Uint8Array(await blob.slice(0,12).arrayBuffer()))
      if(type)return blob.type===type?blob:blob.slice(0,blob.size,type)
    }catch{
      // Try the original image if the download link or its network request failed.
    }
  }
  throw Error(unavailable)
}
