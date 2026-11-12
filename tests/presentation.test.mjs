import test from 'node:test';
import assert from 'node:assert/strict';
import {blankDocument,findingPresentation,findingRequest,bundleRequest} from '../src/audit.mjs';
const make=()=>{
 const extraction={report:blankDocument(),act:blankDocument(),contract:blankDocument(),amendment:blankDocument(),validation:[]};
 const set=(doc,field,value)=>extraction[doc][field]={value,quote:String(value)};
 for(const doc of ['report','act']){set(doc,'service','Охрана');set(doc,'period','2026-04');set(doc,'vat','included');set(doc,'area',2000);}
 set('report','amount',176000);set('act','amount',160000);set('report','rate',88);set('report','basis','monthly_per_m2');set('contract','rate',80);set('contract','vat','included');set('contract','basis','monthly_per_m2');set('contract','service','Охрана');set('contract','change_requires_agreement',true);
 return extraction;
};
test('Amount card identifies both documents, exact amounts and a concrete next action',()=>{
 const f={id:'amount-mismatch',title:'old',detail:'old disclaimer',amount:16000,level:'issue'};
 const view=findingPresentation(f,make());assert.equal(view.title,'Отчёт УК расходится с актом');assert.equal(view.summary,'');assert.equal(view.comparisons.length,2);assert.ok(view.comparisons[0].value.replace(/\s/g,'').includes('176000'));assert.ok(view.comparisons[1].value.replace(/\s/g,'').includes('160000'));assert.match(view.nextStep,/пояснение разницы/);
});
test('Single finding request stays scoped to that finding rather than all service findings',()=>{
 const text=findingRequest({id:'amount-mismatch',title:'',detail:'',level:'issue'},make(),'Охрана','2026-04');
 assert.match(text,/2026-04/);assert.match(text,/исправленный расчёт/);assert.doesNotMatch(text,/допсоглашение|32.?000|переплат/);
});
test('Request to UK asks the recipient for information instead of directing them to the app',()=>{
 const text=findingRequest({id:'vat-ra',title:'',detail:'',level:'missing'},make(),'Охрана','2026-04');assert.match(text,/Просим указать/);assert.doesNotMatch(text,/Откройте|Перейдите/);
});
test('General request contains separate service sections and does not sum linked discrepancies',()=>{
 const one=make(),two=make();two.report.service.value=two.act.service.value=two.contract.service.value='Клининг';
 const text=bundleRequest([{label:'Охрана',extraction:one,documents:{}},{label:'Клининг',extraction:two,documents:{}}],'2026-04');assert.match(text,/«Охрана»/);assert.match(text,/«Клининг»/);assert.doesNotMatch(text,/32.?000|экономия/i);
});
test('Applied signed amendment is reflected in the displayed comparison',()=>{
 const extraction=make();extraction.amendment.signed.value=true;extraction.amendment.rate.value=85;extraction.amendment.period.value='2026-04';
 const view=findingPresentation({id:'rate-mismatch',title:'',detail:'',level:'issue'},extraction);assert.match(view.comparisons[1].value,/85/);
});
