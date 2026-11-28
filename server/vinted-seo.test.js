import test from 'node:test'
import assert from 'node:assert/strict'
import {composeVintedSeo,updateSeoDetails} from '../src/lib/vintedSeo.js'
import {garmentCategory,generateListingText} from './listing-studio-core.js'
import {mergeListingCatalogs} from './scalency-catalogs.js'
import {catalogChoices} from '../src/lib/listingStudio.js'
import {quickIssues} from '../src/lib/scalencyQuick.js'

const parts={title:'Robe bordeaux',sentences:['Robe longue bordeaux au bustier drapé.','Sa jupe ample convient pour une cérémonie.'],hashtags:['robelongue','bordeaux','robe','bustier','drapé','soirée','robehabillée','jupeample','tenuedesoiree','invitéemariage','mariage','gala','cérémonie','coupeévasée','décolleté']}
test('Titre, deux paragraphes, mentions et exactement seize hashtags',()=>{
 const {title,description}=composeVintedSeo(parts)
 assert.equal(title,'Robe bordeaux taille M')
 const lines=description.split('\n\n')
 assert.deepEqual(lines.slice(0,3),[parts.sentences.join(' '),'Achat en lot possible, je fais un prix.','Taille : M | État : Neuf | Mesures : sur demande'])
 assert.equal(new Set(lines[3].split(' ')).size,16)
 assert.ok(lines[3].endsWith('#tailleM'))
})
test('Le titre conserve la taille exacte dans la limite des 100 caractères',()=>{
 const result=composeVintedSeo({...parts,title:'Robe bordeaux '+('avec dentelle '.repeat(10))},{size:'xxl',condition:'Bon état',measures:[{name:'Longueur',value:'90 cm'}]})
 assert.ok(result.title.length<=100)
 assert.ok(result.title.endsWith(' taille XXL'))
 assert.ok(result.description.includes('Taille : XXL | État : Bon état | Mesures : Longueur 90 cm'))
 const edited=updateSeoDetails(result,{size:'s'})
 assert.ok(edited.title.endsWith(' taille S'))
 assert.ok(edited.description.endsWith('#tailleS'))
 assert.ok(edited.description.includes('Mesures : sur demande'))
 assert.ok(updateSeoDetails(edited,{condition:'Satisfaisant'}).description.includes('État : Satisfaisant'))
})
test('Les répétitions et les phrases manquantes ne passent pas la validation',()=>{
 assert.throws(()=>composeVintedSeo({...parts,hashtags:[...parts.hashtags.slice(0,-1),'#ROBE']}))
 assert.throws(()=>composeVintedSeo({...parts,sentences:['Une seule phrase.']}))
 assert.throws(()=>composeVintedSeo({...parts,sentences:['Une phrase. Une autre.','Encore une.']}))
})
test('Le générateur Scalency construit le format à partir de données structurées',async()=>{
 let contract
 const mock=async(url,request)=>{
   contract=JSON.parse(request.body)
   return Response.json({choices:[{message:{content:JSON.stringify({...parts,is_dress:true,is_ball_gown:false,catalog_id:2,color_ids:[23],label_size:'L',review_notes:''})}}]})
 }
 const result=await generateListingText({fields:{size_text:'xs',seo_condition:'Très bon état'}},['https://example.test/photo'],[{id:2,title:'Robes',parent_id:null}],[{id:23,title:'Bordeaux'}],{fetcher:mock,token:'test',quick:true})
 assert.equal(result.title,'Robe bordeaux taille XS')
 assert.ok(result.description.includes('Taille : XS | État : Très bon état | Mesures : sur demande'))
 assert.equal(result.label_size,'L')
 assert.equal(result.catalog_id,1778)
 assert.deepEqual(result.color_ids,[23])
 assert.ok(contract.response_format.json_schema.schema.required.includes('hashtags'))
})

test('Scalency sélectionne le bal pour une robe volumineuse et conserve la catégorie des autres vêtements',async()=>{
 for(const [is_dress,is_ball_gown,expected] of [[true,true,1777],[true,false,1778],[false,false,2]]){
   const fetcher=async()=>Response.json({choices:[{message:{content:JSON.stringify({...parts,title:is_dress?parts.title:'Veste bordeaux',is_dress,is_ball_gown,catalog_id:2,color_ids:[],label_size:'',review_notes:''})}}]})
   const result=await generateListingText({fields:{}},[],[{id:2,title:'Vêtements',parent_id:null}],[],{fetcher,token:'test',quick:true})
   assert.equal(result.catalog_id,expected)
 }
})
test('le titre précise la pièce et le volume visible prime sur la seule longueur ou la taille',()=>{
 for(const [title,visual,expected] of [
   ['Bodies en dentelle', {isDress:true},1835],['Bodysuit noir',{},1835],
   ['Robe bodycon en dentelle taille XL',{isDress:false,catalogId:1835},1778],
   ['Robe de bal longue noire tulle bustier',{},1777],
   ['Robe longue bleu marine col halter froncée jupe volants fluide soirée',{},1778],
   ['Robe longue de soirée taille XS',{isDress:true,ball:true},1777],
   ['Jupe bouffante style robe de bal',{catalogId:198},198]
 ])assert.equal(garmentCategory(title,visual),expected)
})

test('Claude prépare une fiche à partir de photos privées, sans clé Gemini',async()=>{
 const fetcher=async(url,request)=>{
   assert.equal(url,'https://api.oneprovider.dev/v1/messages')
   assert.equal(request.headers['x-api-key'],'one-test')
   const body=JSON.parse(request.body)
   const [photo,remote]=body.messages[0].content
   assert.deepEqual(photo.source,{type:'base64',media_type:'image/png',data:'cGhvdG8='})
   assert.deepEqual(remote.source,{type:'url',url:'https://example.test/image'})
   assert.ok(body.tools[0].input_schema.required.includes('hashtags'))
   return Response.json({model:body.model,content:[{type:'tool_use',name:'vinted_listing',input:{
     ...parts,is_dress:true,is_ball_gown:false,catalog_id:null,color_ids:[],label_size:'',review_notes:''}}]})
 }
 const result=await generateListingText({fields:{size_text:'XL'}},['data:image/png;base64,cGhvdG8=','https://example.test/image'],[],[],{quick:true,fetcher,oneProviderKey:'one-test',token:''})
 assert.match(result.usage.model,/^claude-/)
 assert.equal(result.catalog_id,1778)
 assert.equal(result.title,'Robe bordeaux taille XL')
 assert.equal(result.description.match(/#/g).length,16)
})

test('Une indisponibilité de Claude passe la même fiche à Gemini avec sa propre clé',async()=>{
 const hosts=[]
 const fetcher=async(url,request)=>{
   hosts.push(new URL(url).host)
   if(hosts.length===1)return new Response('',{status:503})
   assert.equal(request.headers.Authorization,'Bearer gemini-test')
   assert.equal(request.headers['x-api-key'],undefined)
   return Response.json({choices:[{message:{content:JSON.stringify({...parts,is_dress:true,is_ball_gown:true,color_ids:[]})}}],usage:{prompt_tokens:123,completion_tokens:42}})
 }
 const result=await generateListingText({fields:{size_text:'S'}},[],[],[],{fetcher,oneProviderKey:'one-test',token:'gemini-test',quick:true})
 assert.deepEqual(hosts,['api.oneprovider.dev','generativelanguage.googleapis.com'])
 assert.equal(result.catalog_id,1777)
 assert.match(result.usage.model,/gemini/)
})

test('La bio des articles neufs porte le même état avec ou sans étiquette',()=>{
 for(const condition of [undefined,'Neuf avec étiquette','Neuf sans étiquette']){
   const result=composeVintedSeo(parts,{condition})
   assert.ok(result.description.includes('État : Neuf |'))
   assert.ok(updateSeoDetails(result,{condition:'Neuf avec étiquette'}).description.includes('État : Neuf |'))
 }
})

test('Une robe pour une invitée ne reçoit pas le hashtag robe de mariée',()=>{
 const generation={...parts,sentences:['Robe longue bleu marine.','Idéale pour assister à un mariage.'],hashtags:['robedemariée',...parts.hashtags]}
 const guest=composeVintedSeo(generation)
 assert.doesNotMatch(guest.description,/#robedemariée/i)
 assert.match(guest.description,/#inviteemariage/)
 assert.equal(guest.description.match(/#/g).length,16)
 assert.match(composeVintedSeo({...generation,title:'Robe de mariée en dentelle'}).description,/#robedemariée/)
})

test('un index Scalency incomplet est enrichi pour les bodies et les autres vêtements',async()=>{
 const rows=mergeListingCatalogs([
   {id:1904,title:'Femmes',parent_id:null},{id:4,title:'Vêtements',parent_id:1904},
   {id:12,title:'Hauts et t-shirts',parent_id:4},{id:29,title:'Lingerie et pyjamas',parent_id:4},
   {id:13,title:'Test parent vestes',parent_id:4}
 ],[{id:98765,title:'Test veste courte',parent_id:13}])
 const choices=catalogChoices(rows)
 assert.ok(choices.some(c=>c.id===1835&&c.label==='Femmes › Vêtements › Hauts et t-shirts › Bodies'))
 assert.ok(choices.some(c=>c.id===1079&&c.label.endsWith('Vestes en jean')))
 assert.ok(choices.some(c=>c.id===222&&c.label.endsWith('Chemises')))
 assert.ok(!choices.some(c=>c.id===13))
 for(const [title,proposed,expected] of [
   ['Body lingerie rouge métallisé',29,1835],['Body effet cuir rouge',null,1835],
   ['Veste courte rouge',98765,98765],['Body bébé rouge',null,null]
 ]){
   const fetcher=async()=>Response.json({choices:[{message:{content:JSON.stringify({...parts,title,catalog_id:proposed,is_dress:false,is_ball_gown:false,color_ids:[]})}}]})
   const result=await generateListingText({fields:{}},[],rows,[],{fetcher,token:'test',quick:true})
   assert.equal(result.catalog_id,expected)
 }
 const issues=quickIssues({catalog_id:29},{catalog:{id:29},conditions:[],package_sizes:[]})
 assert.ok(issues.includes('Choisis une catégorie Vinted plus précise'))
 assert.ok(!issues.includes('État'))
})
