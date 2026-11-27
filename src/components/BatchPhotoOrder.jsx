import {useEffect,useRef,useState} from 'react'

let previewQueue=Promise.resolve()
function PhotoPreview({photo,index}){
  const canvas=useRef(null)
  const [fallback,setFallback]=useState(()=>typeof createImageBitmap!=='function')
  useEffect(()=>{
    if(fallback)return
    let live=true
    const element=canvas.current
    async function draw(){
      if(!live)return
      let bitmap
      try{
        bitmap=await createImageBitmap(photo.file,{resizeWidth:192,resizeQuality:'low'})
        if(!live)return
        const scale=Math.min(1,256/bitmap.height)
        element.width=Math.max(1,Math.round(bitmap.width*scale))
        element.height=Math.max(1,Math.round(bitmap.height*scale))
        element.getContext('2d').drawImage(bitmap,0,0,element.width,element.height)
      }catch{if(live)setFallback(true)}
      finally{bitmap?.close()}
    }
    previewQueue=previewQueue.then(draw,draw)
    return ()=>{live=false;element.width=0;element.height=0}
  },[photo.file,fallback])
  return fallback?<img src={photo.url} alt={photo.file.name} draggable={false} decoding="async" loading={index<2?'eager':'lazy'}/>:
    <canvas ref={canvas} width="1" height="1" role="img" aria-label={photo.file.name}/>
}

export default function BatchPhotoOrder({photos,busy,onMove,onRemove}){
  const grid=useRef(null),gesture=useRef(null),scrollFrame=useRef(0)
  const [drag,setDrag]=useState(null),[announcement,setAnnouncement]=useState('')
  useEffect(()=>()=>cancelAnimationFrame(scrollFrame.current),[])

  function targetAt(x,y){
    const tile=document.elementFromPoint(x,y)?.closest('[data-photo-url]')
    return tile&&grid.current?.contains(tile)?tile.dataset.photoUrl:null
  }
  function highlight(g){
    const target=targetAt(g.x,g.y)
    setDrag(old=>old?.from===g.from&&old.target===target?old:{from:g.from,target})
  }
  function scrollAtEdge(){
    scrollFrame.current=0
    const g=gesture.current
    if(!g?.moving)return
    const edge=56,spaceBelow=window.innerHeight-g.y
    const speed=g.y<edge?-Math.ceil((edge-g.y)/4):spaceBelow<edge?Math.ceil((edge-spaceBelow)/4):0
    if(!speed)return
    const before=window.scrollY
    window.scrollBy(0,Math.max(-18,Math.min(18,speed)))
    if(before!==window.scrollY){
      highlight(g)
      scrollFrame.current=requestAnimationFrame(scrollAtEdge)
    }
  }
  function stop(){
    cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current=0;gesture.current=null;setDrag(null)
  }
  function move(from,to){
    const destination=photos.findIndex(p=>p.url===to)
    if(busy||destination<0||from===to)return
    onMove(from,to)
    setAnnouncement(destination===0?'Photo placée en couverture.':'Photo déplacée en position '+(destination+1)+'.')
  }
  function start(event,url){
    if(busy||photos.length<2||!event.isPrimary||event.button!==0)return
    gesture.current={id:event.pointerId,from:url,startX:event.clientX,startY:event.clientY,moving:false}
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function track(event){
    const g=gesture.current
    if(!g||g.id!==event.pointerId)return
    g.x=event.clientX;g.y=event.clientY
    if(!g.moving&&Math.hypot(g.x-g.startX,g.y-g.startY)<5)return
    g.moving=true;highlight(g)
    if(!scrollFrame.current)scrollFrame.current=requestAnimationFrame(scrollAtEdge)
  }
  function drop(event){
    const g=gesture.current
    if(!g||g.id!==event.pointerId)return
    if(g.moving)move(g.from,targetAt(event.clientX,event.clientY))
    stop()
  }
  function byKey(event,index){
    const step={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key]
    if(!step)return
    event.preventDefault()
    if(photos[index+step])move(photos[index].url,photos[index+step].url)
  }

  return <>
    <ol className="bs-photos" data-sortable={photos.length>1||undefined} aria-label="Photos dans l’ordre de publication" ref={grid}>
      {photos.map((photo,index)=><li key={photo.url} data-photo-url={photo.url}
        className={'bs-photo'+(index===0?' is-cover':'')+(drag?.from===photo.url?' is-moving':'')+(drag?.target===photo.url&&drag.from!==photo.url?' is-target':'')}>
        <div className="bs-photo-preview" onPointerDown={e=>start(e,photo.url)} onPointerMove={track} onPointerUp={drop}
          onPointerCancel={stop} onLostPointerCapture={stop}>
          <PhotoPreview photo={photo} index={index}/>
          <span className="bs-photo-position" aria-hidden="true">{index+1}</span>
        </div>
        <button type="button" className="bs-photo-remove" aria-label={'Retirer la photo '+(index+1)} onClick={()=>onRemove(photo)}>×</button>
        <button type="button" className="bs-photo-cover" aria-pressed={index===0} aria-label={'Choisir la photo '+(index+1)+' en couverture'}
          title="Choisir la couverture. Utilise aussi les flèches du clavier pour déplacer la photo."
          onKeyDown={e=>byKey(e,index)} onClick={()=>move(photo.url,photos[0].url)}>
          {index===0?'Couverture':'Mettre en couverture'}
        </button>
      </li>)}
    </ol>
    <span className="bs-photo-status" role="status">{announcement}</span>
  </>
}
