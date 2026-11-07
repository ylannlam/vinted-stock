import {useState,useEffect} from 'react'
import * as T from '../constants'
const routes={ylavint:T.TAB_AGENT,agent:T.TAB_AGENT,adspower:T.TAB_ADSPOWER,annonces:T.TAB_LISTINGS,publication:T.TAB_PUBLICATION,accueil:T.TAB_HOME,ventes:T.TAB_SALES,catalogue:T.TAB_CATALOG,atelier:T.TAB_RESOURCES,budget:T.TAB_BUDGET,stock:T.TAB_TOUT,reception:T.TAB_A_RECEVOIR,expedition:T.TAB_A_ENVOYER,lots:T.TAB_A_ENVOYER_LOT,envoyes:T.TAB_ENVOYES,comptes:T.TAB_COMPTES_VINTED,historique:T.TAB_HISTORY,travail:T.TAB_WORKSPACE}
// « #ylavint/messagerie » : le segment après « / » est la rubrique de l'onglet.
function readRoute(){const [path,query='']=window.location.hash.slice(1).split('?');const [name,section]=path.split('/');return {tab:routes[name]||T.TAB_HOME,filters:{...Object.fromEntries(new URLSearchParams(query)),...(section?{section}:{})}}}
export function useNavigation(capture){
 const [route,setRoute]=useState(()=>capture()?{tab:T.TAB_CATALOG,filters:{}}:readRoute())
 useEffect(()=>{const update=()=>setRoute(readRoute());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update)},[])
 function navigate(value,filters={}){const tab=typeof value==='function'?value(route.tab):value;const name=Object.keys(routes).find(k=>routes[k]===tab)||'accueil';const query=new URLSearchParams(filters).toString();const hash=`#${name}${query?'?'+query:''}`;if(window.location.hash===hash)setRoute({tab,filters});else window.location.hash=hash}
 return [route.tab,navigate,route.filters]
}
