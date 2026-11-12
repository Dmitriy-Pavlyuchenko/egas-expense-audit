import test from 'node:test';
import assert from 'node:assert/strict';
import {blankDocument,validatePeriodBundle,audit} from '../src/audit.mjs';
import {sample} from '../src/samples.mjs';
const fixture=sample('clean');
const categories=['report','act','contract','amendment'];
const sources=categories.filter(id=>fixture.documents[id]).map(category=>({id:category+'-file',category,name:category+'.pdf',text:'Страница 2\n'+fixture.documents[category]}));
const item=()=>({label:'Клининг',source_ids:Object.fromEntries(categories.map(id=>[id,sources.some(s=>s.category===id)?id+'-file':null])),extraction:structuredClone(fixture.extraction)});
test('Full bundle keeps separate charges and source pages, not a merged amount',()=>{
 const second=item();second.label='Клининг другого объекта';
 const result=validatePeriodBundle({items:[item(),second],complete:false,limitations:['Объекты требуют проверки.']},sources,'2023-09');
 assert.equal(result.items.length,2);assert.equal(result.complete,false);
 assert.equal(result.items[0].extraction.report.amount.source.name,'report.pdf');
 assert.equal(result.items[0].extraction.report.amount.source.location,'страница 2');
 assert.notEqual(result.items[0].extraction,result.items[1].extraction);
 assert.equal(audit(result.items[0].extraction,result.items[0].documents).findings.length,0);
});
test('A quotation in a different file cannot validate a field',()=>{
 const altered=item();altered.source_ids.report='another-report';
 const result=validatePeriodBundle({items:[altered],complete:true,limitations:[]},[...sources,{id:'another-report',category:'report',name:'wrong.pdf',text:'Документ без начислений.'}],'2023-09');
 assert.equal(result.items[0].extraction.report.amount.value,null);
 assert.ok(result.items[0].extraction.validation.length>0);
});
test('Source from a different category and invented source ID are rejected',()=>{
 for(const id of ['contract-file','invented']){const changed=item();changed.source_ids.report=id;assert.throws(()=>validatePeriodBundle({items:[changed],complete:true,limitations:[]},sources,'2023-09'),/Неизвестный источник/);}
});
test('Charge explicitly belonging to a different month is rejected',()=>{
 assert.throws(()=>validatePeriodBundle({items:[item()],complete:true,limitations:[]},sources,'2026-04'),/другого периода/);
});
test('Skipped categories remain blank and restrict comparisons',()=>{
 const changed=item();for(const category of ['act','contract','amendment']){changed.source_ids[category]=null;changed.extraction[category]=blankDocument();}
 const result=validatePeriodBundle({items:[changed],complete:false,limitations:['Нет актов и договоров.']},sources.filter(s=>s.category==='report'),'2023-09');
 const output=audit(result.items[0].extraction,result.items[0].documents);
 assert.ok(output.findings.some(f=>f.id==='contract-rate-missing'));
 assert.ok(!output.findings.some(f=>f.id==='amount-mismatch'));
});
test('One-source request accepts skipped categories and validates period before model call',async()=>{
 const worker=(await import('../dist/server/index.js')).default;
 const original=globalThis.fetch;let calls=0;
 const changed=item();for(const id of ['act','contract','amendment']){changed.source_ids[id]=null;changed.extraction[id]=blankDocument();}
 globalThis.fetch=async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items:[changed],complete:false,limitations:['Нет договора.']})}]}]});};
 const send=body=>worker.fetch(new Request('https://bundle.example/api/extract',{method:'POST',headers:{origin:'https://bundle.example','content-type':'application/json'},body:JSON.stringify(body)}),{OPENROUTER_API_KEY:'test-only'},{});
 try{
  const invalid=await send({mode:'period',period:'2026-99',sources:sources.slice(0,1)});assert.equal(invalid.status,400);assert.equal(calls,0);
  const response=await send({mode:'period',period:'2023-09',sources:sources.filter(s=>s.category==='report')});assert.equal(response.status,200);assert.equal(calls,1);assert.equal((await response.json()).bundle.items.length,1);
 }finally{globalThis.fetch=original;}
});
