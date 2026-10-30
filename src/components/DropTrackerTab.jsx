import { useEffect, useRef, useState } from 'react'
import html from '../assets/drop-tracker.html?raw'
import validation from '../../server/drop-tracker.js?raw'
const authenticatedFetch = (...args) => import('../lib/api').then(m => m.authenticatedFetch(...args))
const embeddedHtml = html.replace('<script>', '<script>' + validation.replace('export function', 'function'))

export default function DropTrackerTab({ request = authenticatedFetch }) {
  const frame = useRef(null)
  const revision = useRef(0)
  const queue = useRef(Promise.resolve())
  const blocked = useRef(false)
  const [initial, setInitial] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Chargement de la sauvegarde…')
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    let active = true
    request('/api/drop-tracker').then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      if (active) { revision.current = data.revision; setInitial(data.payload); setStatus('Sauvegarde partagée chargée') }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [generation])
  useEffect(() => {
    function receive(event) {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'drop-save' || blocked.current) return
      const payload = event.data.payload
      setStatus('Enregistrement…')
      queue.current = queue.current.then(async () => {
        if (blocked.current) return
        const response = await request('/api/drop-tracker', {method:'PUT', body:JSON.stringify({payload, revision:revision.current})})
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        revision.current = result.revision
        setStatus('Enregistré dans Supabase')
      }).catch(e => {
        blocked.current = true
        setError(e.message + ' Les dernières modifications affichées ne sont pas enregistrées. Vous pouvez les exporter avant de recharger.')
        setStatus('Enregistrement interrompu')
      })
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  return <main className="p-3">
    <div className="flex flex-wrap justify-between gap-2 text-sm mb-2"><span role="status">{status}</span><span className="text-gray-500">Suivi interne des comptes · Les délais ne confirment pas une validation par Vinted.</span></div>
    {error && <div role="alert" className="bg-red-50 text-red-800 p-3 mb-2 rounded">{error} <button className="underline font-semibold" onClick={() => {blocked.current=false;setError('');setInitial(null);setGeneration(n=>n+1)}}>Recharger les données enregistrées</button></div>}
    {initial && <iframe key={generation} ref={frame} title="Suivi des comptes et budget" srcDoc={embeddedHtml}
      sandbox="allow-scripts allow-modals allow-downloads" className="w-full border-0 rounded-lg" style={{height:'calc(100vh - 170px)',minHeight:600}}
      onLoad={() => frame.current?.contentWindow?.postMessage({type:'drop-init',payload:initial}, '*')} />}
  </main>
}
