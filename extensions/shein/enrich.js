// Expand only the product's two information sections. No purchase or variant controls.
// Self-contained for scripting.executeScript; abort before any click on a challenge.
export async function expandProductSection(section,expectedId,expectedSku) {
  const text=document.body?.innerText||''
  if(/\/(?:risk\/challenge|captcha|challenge)(?:\/|$)/i.test(location.pathname)
    || /captcha|vérification de sécurité|not a robot|verify.{0,20}human|je ne suis pas un robot/i.test(text))return {error:'human_check'}
  const id=location.pathname.match(/-p-(\d+)\.html$/i)?.[1]
  const sku=[...document.querySelectorAll('button')].map(e=>e.getAttribute('aria-label')||'').find(s=>/^Copy SKU /i.test(s))?.replace(/^Copy SKU /i,'').trim()
    || text.match(/\bSKU:\s*([A-Za-z0-9_-]+)/)?.[1]
  if(id!==expectedId||sku?.toLowerCase()!==expectedSku?.toLowerCase())return {error:'sku_mismatch'}
  const names=section==='description'?/^(?:description|description du produit)$/i:/^(?:tailles?\s*(?:&|et)\s*mesures?|size\s*(?:&|and)\s*fit)$/i
  const button=[...document.querySelectorAll('button')].find(e=>e.getClientRects().length&&names.test((e.querySelector('.head-left .title')?.innerText||e.innerText.split('\n')[0]).trim())&&e.getAttribute('aria-expanded')==='false')
  if(!button)return {opened:false}
  button.click()
  // Wait for rendered content, bounded so the worker cannot get stuck on this section.
  await new Promise(resolve=>{
    let stable
    const done=()=>{clearTimeout(stable);clearTimeout(limit);observer.disconnect();resolve()}
    const observer=new MutationObserver(()=>{clearTimeout(stable);stable=setTimeout(done,250)})
    const limit=setTimeout(done,1800)
    observer.observe(button.parentElement||document.body,{childList:true,subtree:true,attributes:true,characterData:true})
  })
  return {opened:true}
}
