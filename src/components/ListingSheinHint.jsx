import {useEffect,useRef,useState} from 'react'
import {withMeasures} from '../lib/library'

// Sous le SKU d'une annonce : la fiche Shein de la bibliothèque (mesures de la taille, prix conseillé),
// sinon une recherche automatique par le PC avec l'extension Shein.
const LONG_ENOUGH=/^[A-Za-z0-9_-]{10,200}$/
export default function ListingSheinHint({request,sku,size,price,description='',onPrice,onDescription}) {
  const [state,setState]=useState(null),[busy,setBusy]=useState(false)
  const polls=useRef(0),key=`${sku}|${size}`
  async function look(queue) {
    setBusy(true)
    try{setState({...await request('POST',{action:'shein',sku:sku.trim(),size,queue}),key})}
    catch(e){setState({status:'error',message:e.message,key})}
    finally{setBusy(false)}
  }
  // Saisie terminée (1,5 s sans frappe) : recherche, et mise en file si le SKU est inconnu.
  useEffect(()=>{
    polls.current=0
    if(!LONG_ENOUGH.test(sku.trim())){setState(null);return}
    const timer=setTimeout(()=>look('auto'),1500)
    return()=>clearTimeout(timer)
  },[key])
  // Recherche en cours sur le PC : nouvelle vérification toutes les 8 s pendant 4 minutes.
  useEffect(()=>{
    if(state?.status!=='pending'||state.key!==key||polls.current>=30)return
    const timer=setTimeout(()=>{polls.current++;look(false)},8000)
    return()=>clearTimeout(timer)
  },[state])
  if(!state||state.key!==key)return busy?<p className="mt-2 text-xs text-[#79756f]">Recherche de la fiche Shein…</p>:null
  const box='mt-2 rounded-xl border px-3 py-2 text-xs leading-relaxed '
  if(state.status==='found') {
    const sale=state.sale_price,differs=sale!=null&&Number(String(price||'').replace(',','.'))!==Number(sale)
    return <div className={box+'border-[#c9dccf] bg-[#f6faf7] text-[#2f4a3a]'}>
      <p><strong>Fiche Shein trouvée</strong> · {state.product.price!=null?`${Number(state.product.price).toLocaleString('fr-FR')} € sur Shein`:'prix à relever'}{sale!=null&&<> · conseillé <strong>{sale} €</strong></>}
        {sale!=null&&differs&&<button type="button" className="ml-2 underline" onClick={()=>onPrice(String(sale))}>{price?'Mettre':'Utiliser'} {sale} €</button>}</p>
      {state.measures.length?<p className="mt-1">Mesures taille {size} : {state.measures.map(m=>`${m.name} ${m.value}`).join(' · ')}
        {!description.trim()?' (ajoutées à la description lors de la rédaction)':/^mesures\b/im.test(description)?' (dans la description)':onDescription&&<button type="button" className="ml-2 underline" onClick={()=>onDescription(withMeasures(description,{measures:state.measures,size}))}>Ajouter à la description</button>}</p>
        :<p className="mt-1 text-[#79756f]">{size?`Pas de mesure Shein trouvée pour la taille « ${size} ».${state.product.sizes?.length?` Tailles Shein : ${state.product.sizes.map(s=>s.size).join(', ')}.`:''}`:'Indique la taille pour reprendre ses mesures.'}</p>}
      {state.details>0&&<p className="mt-1 text-[#79756f]">{state.details} caractéristiques (matière, coupe…) seront utilisées pour rédiger le texte.</p>}
    </div>
  }
  if(state.status==='pending')return <div className={box+'border-amber-200 bg-amber-50 text-amber-900'}>
    <p><strong>Recherche sur Shein…</strong> {state.collector_online?'Le PC lit la fiche : mesures et prix arrivent dans un instant.':'Allume le PC avec l’extension Shein : la recherche démarrera dès qu’il sera connecté.'}</p>
    {polls.current>=30&&<button type="button" className="mt-1 underline" onClick={()=>{polls.current=0;look(false)}}>Vérifier à nouveau</button>}
  </div>
  return <div className={box+'border-[#e8e4dd] bg-white text-[#79756f]'}>
    <p>{state.status==='failed'?`Fiche Shein introuvable pour ce SKU${state.message?` (${state.message})`:''}.`:state.message||'Pas encore de fiche Shein pour ce SKU.'}
      {state.status!=='unavailable'&&<button type="button" className="ml-2 underline" disabled={busy} onClick={()=>look(true)}>Chercher sur Shein</button>}</p>
  </div>
}
