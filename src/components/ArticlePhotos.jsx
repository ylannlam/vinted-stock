import {useState} from 'react'
import {safeUrl} from '../lib/fulfillment'

function ArticleImage({src,title,label}) {
  const [failed,setFailed]=useState(false)
  return <div className="article-photo">{!failed?<img src={src} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<span className="article-photo-empty">Photo indisponible</span>}{label&&<span className="article-photo-label">{label}</span>}</div>
}

export default function ArticlePhotos({photos=[],title='',onOpen,label,badge}) {
  const urls=[...new Set(photos.filter(safeUrl))].slice(0,2)
  return <div className={`article-photos ${urls.length>1?'article-photos-pair':''}`}>
    <button type="button" className="article-photos-open" onClick={onOpen} aria-label={`Voir les détails de ${title||'cet article'}`}>
      {urls.length?urls.map((src,i)=><ArticleImage key={src} src={src} title={title} label={urls.length>1?`Photo ${i+1}`:label}/>):<span className="article-photo-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8h.01"/></svg><span>Photo à récupérer</span></span>}
    </button>
    {badge&&<span className="article-photo-badge">{badge}</span>}
  </div>
}
