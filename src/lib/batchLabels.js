// Bordereaux en série : un bordereau par commande (un lot = un seul colis), puis un seul PDF à imprimer.
export function labelTargets(lines){
  const seen=new Set(),out=[]
  for(const l of lines){const key=l.order_id||l.order?.id||l.id;if(seen.has(key))continue;seen.add(key);out.push(l)}
  return out
}
export async function mergeLabels(pdfs){
  const {PDFDocument,PrintScaling}=await import('pdf-lib')
  const out=await PDFDocument.create()
  for(const base64 of pdfs){
    const source=await PDFDocument.load(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)))
    for(const page of await out.copyPages(source,source.getPageIndices()))out.addPage(page)
  }
  out.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)
  out.setTitle(`${pdfs.length} bordereaux 100 x 150 mm`)
  return out.save()
}
