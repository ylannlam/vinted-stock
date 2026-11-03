import {useState} from 'react'

export default function FallbackImage({urls,empty=null,...props}) {
  const [failed,setFailed]=useState([])
  const src=urls.find(url=>!failed.includes(url))
  return src?<img {...props} src={src} onError={()=>setFailed(previous=>[...previous,src])}/>:empty
}
