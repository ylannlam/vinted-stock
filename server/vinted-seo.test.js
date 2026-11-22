import test from 'node:test'
import assert from 'node:assert/strict'
import {composeVintedSeo,updateSeoDetails} from '../src/lib/vintedSeo.js'
import {generateListingText} from './listing-studio-core.js'

const parts={title:'Robe bordeaux',sentences:['Robe longue bordeaux au bustier drapé.','Sa jupe ample convient pour une cérémonie.'],hashtags:['robelongue','bordeaux','robe','bustier','drapé','soirée','robehabillée','jupeample','tenuedesoiree','invitéemariage','mariage','gala','cérémonie','coupeévasée','décolleté']}
test('Titre, deux paragraphes, mentions et exactement seize hashtags',()=>{
 const {title,description}=composeVintedSeo(parts)
 assert.equal(title,'Robe bordeaux taille M')
 const lines=description.split('\n\n')
 assert.deepEqual(lines.slice(0,3),[parts.sentences.join(' '),'Achat en lot possible, je fais un prix.','Taille : M | État : à préciser | Mesures : sur demande'])
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
 assert.equal(result.catalog_id,2)
 assert.deepEqual(result.color_ids,[23])
 assert.ok(contract.response_format.json_schema.schema.required.includes('hashtags'))
})
