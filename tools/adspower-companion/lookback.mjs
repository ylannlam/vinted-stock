import {LocalError,delay} from './adspower.mjs'

// Opening a new Dotb panel and loading its preferences are asynchronous.
// Retry only local selection, never the Start button.
export async function setTwelveHours(ui,root,feature,{wait=delay}={}){
  const current=s=>s.cards.find(c=>c.id===feature.id)
  async function waitFor(check,iterations=16){
    for(let i=0;i<iterations;i++){const state=await ui.read(root);if(check(state))return state;await wait(150)}
    return null
  }
  for(let attempt=0;attempt<4;attempt++){
    let state=await ui.read(root),card=current(state)
    if(!card)throw new LocalError('Le panneau Dotb a changé. Réessaie le lancement.')
    if(card.state==='running')return
    if(!card.twelveHours){
      if(!card.rangeExpanded)await ui.click(root,'range',feature.id)
      state=await waitFor(s=>current(s)?.rangeExpanded&&s.twelveOption)
      if(!state)continue
      await ui.click(root,'twelveHours',feature.id)
      state=await waitFor(s=>current(s)?.twelveHours)
      if(!state)continue
    }
    // A late preferences render must not silently reset the chosen range.
    let stable=true
    for(let i=0;i<4;i++){await wait(200);if(!current(await ui.read(root))?.twelveHours){stable=false;break}}
    if(stable)return
  }
  throw new LocalError('Dotb n’a pas conservé les 12 dernières heures pour « '+feature.label+' ». Réessaie le lancement.')
}
