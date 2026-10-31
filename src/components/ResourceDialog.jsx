import {useEffect,useRef} from 'react'

export default function ResourceDialog({title,onClose,busy=false,children}) {
  const ref=useRef(null)
  useEffect(()=>{
    const previous=document.activeElement,overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    ;(ref.current?.querySelector('input,textarea')||ref.current?.querySelector('button'))?.focus()
    return()=>{document.body.style.overflow=overflow;previous?.focus()}
  },[])
  function keys(e) {
    if(e.key==='Escape'&&!busy){e.preventDefault();onClose()}
    if(e.key!=='Tab')return
    const nodes=[...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')]
    if(!nodes.length){e.preventDefault();return}
    if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus()}
    if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus()}
  }
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/45 p-3 sm:p-6" onKeyDown={keys}>
    <section ref={ref} role="dialog" aria-modal="true" aria-label={title} className="max-w-4xl mx-auto my-3 bg-white rounded-2xl shadow-xl">
      <header className="flex justify-between gap-4 items-center p-5 border-b"><h2 className="font-semibold text-lg">{title}</h2><button type="button" disabled={busy} className="border rounded-lg px-3 py-2 text-sm disabled:opacity-40" onClick={onClose}>Fermer</button></header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  </div>
}
