import {effectiveSettings} from './vinted-agent-config.js'
export const COPY_GROUPS={all:['limits','unmask','pricing','likes','messaging','order_flow'],likes:['likes'],flux:['order_flow'],agent:['messaging'],prix:['unmask','pricing']}
export function copiedSettings(source,target,section){
  const out=effectiveSettings(target),from=effectiveSettings(source)
  for(const group of COPY_GROUPS[section])out[group]=structuredClone(from[group])
  // Copier les paramètres ne doit pas allumer une automatisation sur un autre compte.
  out.features=effectiveSettings(target).features
  out.messaging.offers.enabled=target?.messaging?.offers?.enabled===true
  out.messaging.executor=target?.messaging?.executor||'extension'
  out.likes.history_since=target?.likes?.history_since||null
  out.messaging.history_since=target?.messaging?.history_since||null
  out.messaging.offers.history_since=target?.messaging?.offers?.history_since||null
  return out
}
