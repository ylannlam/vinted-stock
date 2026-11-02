import {PDFDocument, degrees, PrintScaling} from 'pdf-lib'
import {getDocument, OPS} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {AppError} from './dotb.js'
import {createCanvas} from '@napi-rs/canvas'
import {fileURLToPath} from 'node:url'

export const LABEL_SIZE = [100 * 72 / 25.4, 150 * 72 / 25.4]
const pdfOptions={useSystemFonts:false,isEvalSupported:false,standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/')}
const unknown = () => new AppError('Ce format de bordereau n’est pas encore reconnu. Le document original reste disponible dans Dotb.', 422)
const multiply = (a,b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]

// Read the carrier's actual label frame, including transforms in embedded forms.
export function labelFrames(operators) {
  let matrix=[1,0,0,1,0,0]
  const stack=[],frames=[]
  for(let i=0;i<operators.fnArray.length;i++){
    const op=operators.fnArray[i],args=operators.argsArray[i]
    if(op===OPS.save)stack.push([...matrix])
    else if(op===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0]
    else if(op===OPS.transform)matrix=multiply(matrix,args)
    else if(op===OPS.paintFormXObjectBegin){stack.push([...matrix]);if(args[0])matrix=multiply(matrix,args[0])}
    else if(op===OPS.paintFormXObjectEnd)matrix=stack.pop()||[1,0,0,1,0,0]
    else if(op===OPS.constructPath){
      const path=args[1]?.[0],bounds=args[2]
      if(!path||path.length!==13||path[0]!==0||path[3]!==1||path[6]!==1||path[9]!==1||path[12]!==4||!bounds)continue
      const points=[[bounds[0],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[1]],[bounds[2],bounds[3]]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]])
      const left=Math.min(...points.map(p=>p[0])),bottom=Math.min(...points.map(p=>p[1])),right=Math.max(...points.map(p=>p[0])),top=Math.max(...points.map(p=>p[1]))
      const dimensions=[right-left,top-bottom].sort((a,b)=>a-b)
      if(dimensions.every((v,n)=>Math.abs(v-LABEL_SIZE[n])<5))frames.push({left:left-2,bottom:bottom-2,right:right+2,top:top+2,rotate:right-left>top-bottom?90:0})
    }
  }
  return frames
}

export function identifyLabel({width,height,rotation=0,items,frames=[]}) {
  const dimensions=[width,height].sort((a,b)=>a-b)
  if(dimensions.every((v,n)=>Math.abs(v-LABEL_SIZE[n])<18))return {left:0,bottom:0,right:width,top:height,rotate:rotation?(360-rotation)%360:width>height?90:0,carrier:'Bordereau thermique'}
  if(rotation!==0||Math.abs(width-595)>2||Math.abs(height-842)>2)throw unknown()
  const text=items.map(i=>i.str||'').join(' '),at=(pattern,x,y)=>items.some(i=>pattern.test(i.str||'')&&Math.abs(i.transform[4]-x)<8&&Math.abs(i.transform[5]-y)<8)
  // These A4 layouts have been checked against real Dotb carrier PDFs.
  if(/vintedgo\.com\/deals/i.test(text)&&at(/Scanner le QR code/,49,673))return {left:10,bottom:height-410,right:288,top:height-10,rotate:0,carrier:'Vinted Go'}
  if(/Shop2Shop/.test(text)&&at(/^Chronopost/,44,330)&&items.some(i=>/Chronopost/.test(i.str||'')&&i.transform[1]<0))return {left:18,bottom:10,right:567,top:342,rotate:90,carrier:'Chronopost'}
  if(/\b24R\b/.test(text)&&(/InPost|inpost\./i.test(text)||/Receiver/.test(text))&&frames.length===1)return {...frames[0],carrier:'Mondial Relay / InPost'}
  throw unknown()
}

export async function thermalLabel(bytes,{preview=false}={}) {
  let parsed
  try{
    const source=await PDFDocument.load(bytes)
    if(source.getPageCount()!==1)throw unknown()
    const original=source.getPage(0),box=original.getCropBox()
    if(box.x!==0||box.y!==0)throw unknown()
    parsed=await getDocument({data:new Uint8Array(bytes),...pdfOptions,disableFontFace:true}).promise
    const page=await parsed.getPage(1)
    const [{items},operators]=await Promise.all([page.getTextContent(),page.getOperatorList()])
    const crop=identifyLabel({width:box.width,height:box.height,rotation:original.getRotation().angle,items,frames:labelFrames(operators)})
    const output=await PDFDocument.create(),embedded=await output.embedPage(original,crop)
    const target=output.addPage(LABEL_SIZE)
    const sideways=crop.rotate===90||crop.rotate===270
    const w=sideways?embedded.height:embedded.width,h=sideways?embedded.width:embedded.height
    const scale=Math.min((LABEL_SIZE[0]-4)/w,(LABEL_SIZE[1]-4)/h),dw=w*scale,dh=h*scale
    let x=(LABEL_SIZE[0]-dw)/2,y=(LABEL_SIZE[1]-dh)/2
    if(crop.rotate===90)x+=dw
    if(crop.rotate===180){x+=dw;y+=dh}
    if(crop.rotate===270)y+=dh
    target.drawPage(embedded,{x,y,xScale:scale,yScale:scale,rotate:degrees(crop.rotate)})
    output.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)
    output.setTitle('Bordereau 100 x 150 mm')
    const prepared=await output.save()
    let image
    if(preview){
      const printable=await getDocument({data:new Uint8Array(prepared),...pdfOptions}).promise
      try{
        const sheet=await printable.getPage(1),viewport=sheet.getViewport({scale:1.5}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
        await sheet.render({canvasContext:canvas.getContext('2d'),viewport}).promise
        image=canvas.toBuffer('image/png')
      }finally{await printable.destroy()}
    }
    return {bytes:prepared,carrier:crop.carrier,preview:image}
  }catch(error){if(error instanceof AppError)throw error;throw new AppError('Le bordereau reçu ne peut pas être préparé pour l’impression. Réessaie depuis Dotb.',422)}
  finally{await parsed?.destroy()}
}
