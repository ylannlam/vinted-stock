import {previewImage} from './shippingLabelPreviewImage.js'
export async function shippingLabelPreview(){
  const {PDFDocument,rgb,PrintScaling}=await import('pdf-lib')
  const pdf=await PDFDocument.create(),page=pdf.addPage([100*72/25.4,150*72/25.4])
  page.drawRectangle({x:12,y:12,width:259,height:401,borderWidth:1,borderColor:rgb(0.2,0.3,0.3)})
  page.drawText('ETIQUETTE DE DEMONSTRATION',{x:24,y:384,size:12})
  page.drawText('100 x 150 mm',{x:24,y:360,size:20})
  page.drawText('Ne pas utiliser pour un envoi',{x:24,y:335,size:11})
  page.drawLine({start:{x:24,y:310},end:{x:259,y:310},thickness:1})
  page.drawText('DESTINATAIRE FICTIF',{x:24,y:285,size:12})
  page.drawText('Exemple de bordereau',{x:24,y:260,size:11})
  page.drawText('Aucune adresse reelle',{x:24,y:241,size:11})
  page.drawRectangle({x:24,y:70,width:235,height:110,color:rgb(0.94,0.96,0.95)})
  page.drawText('Zone du code-barres',{x:60,y:120,size:12})
  page.drawText('DEMONSTRATION UNIQUEMENT',{x:30,y:37,size:12})
  pdf.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)
  return {pdf:await pdf.saveAsBase64(),preview:previewImage,filename:'demonstration-100x150.pdf',format:'100 × 150 mm',carrier:'Aperçu de démonstration'}
}
