import {authorize} from '../server/auth.js'
import {issueAdsPowerTicket,verifyAdsPowerTicket} from '../server/adspower-ticket.js'
import {handlePublications} from '../server/publications.js'
export const config={maxDuration:30}

// The PC receives a short-lived capability, never the user's Supabase session.
export function adsPowerHandler(authorizer=authorize,key=()=>process.env.SUPABASE_SERVICE_ROLE_KEY,publications=handlePublications){
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store')
    try{
      const action=req.query?.action||req.body?.action
      if(typeof action==='string'&&(action==='publications'||action.startsWith('publication-'))){
        const auth=await authorizer(req,res,['admin']);if(!auth)return
        return res.json(await publications(req,auth))
      }
      if(req.method==='GET'){
        const auth=await authorizer(req,res,['admin']);if(!auth)return
        return res.json(issueAdsPowerTicket(auth.user.id,key()))
      }
      if(req.method==='POST'){
        if(req.body?.action!=='verify'||JSON.stringify(req.body).length>2000)return res.status(400).json({error:'Demande invalide.'})
        return res.json(verifyAdsPowerTicket(req.body.ticket,key()))
      }
      res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Méthode non autorisée.'})
    }catch(error){return res.status(error.status||500).json({error:error.status?error.message:'La connexion AdsPower est indisponible.'})}
  }
}
export default adsPowerHandler()
