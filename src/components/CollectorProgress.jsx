import {collectionProgress} from '../lib/collector'

export default function CollectorProgress({state,browser,error,onOpen}) {
  const progress=collectionProgress(state.progress,browser,state.devices,error)
  return <section className={`collector-progress is-${progress.tone}${progress.working?' is-working':''}`} aria-label="Avancement Shein">
    <button type="button" className="collector-progress-open" onClick={onOpen} aria-label="Voir l’activité de l’extension Shein">
      <span className="collector-progress-heading"><span className="collector-progress-eyebrow"><span className="collector-progress-dot"/>Extension Shein <span aria-hidden="true">↗</span></span><span className="collector-progress-status" role="status">{progress.label}</span></span>
      <strong className="collector-progress-percent">{progress.percent==null?'—':progress.percent}<small>{progress.percent!=null?'%':''}</small></strong>
    </button>
    <div className="collector-progress-track" role="progressbar" aria-label="Fiches Shein récupérées" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent??undefined} aria-valuetext={progress.percent==null?progress.label:progress.detail}>
      <span className="collector-progress-fill" style={{width:`${progress.percent||0}%`}}/>
    </div>
    <p className="collector-progress-detail">{progress.detail}</p>
  </section>
}
