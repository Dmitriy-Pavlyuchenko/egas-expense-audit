import test from 'node:test';
import assert from 'node:assert/strict';
import {audit,validateExtraction} from '../src/audit.mjs';
import {sample} from '../src/samples.mjs';
const copy=id=>structuredClone(sample(id));
const manual=(s,id,key,value)=>{s.extraction[id][key]={value,quote:'Проверено сотрудником',manual:true};};

test('March: 120 ruble act inconsistency is exposed; unknown VAT blocks financial comparisons',()=>{
 const s=copy('march'),r=audit(validateExtraction(s.extraction,s.documents),s.documents);
 assert.equal(r.findings.find(f=>f.id==='act-contract-math').amount,-120);
 assert.ok(r.findings.some(f=>f.id==='vat-ra'));
 assert.ok(r.findings.some(f=>f.id==='vat-rc'));
 assert.ok(!r.findings.some(f=>f.id==='rate-mismatch'));
 assert.ok(r.checks.some(c=>c.id==='report-math'));
});
test('Human VAT confirmation reveals distinct 22,380 and 22,500 differences without summing them',()=>{
 const s=copy('march');manual(s,'report','vat','included');const r=audit(s.extraction,s.documents);
 assert.equal(r.findings.find(f=>f.id==='rate-mismatch').amount,22380);
 assert.equal(r.findings.find(f=>f.id==='amount-mismatch').amount,22500);
 assert.equal(r.findings.find(f=>f.id==='act-contract-math').amount,-120);
 assert.equal(r.totalSavings,undefined);
});
test('Clean synthetic bundle produces no findings',()=>{
 const s=copy('clean'),r=audit(validateExtraction(s.extraction,s.documents),s.documents);
 assert.deepEqual(r.findings,[]);assert.ok(r.checks.length>=3);
});
test('Original September bundle is not a clean control: arithmetic is 120 rubles short',()=>{
 const s=copy('september'),r=audit(s.extraction,s.documents);
 assert.equal(r.findings.find(f=>f.id==='report-math').amount,-120);
});
test('Different periods do not create a report-act monetary finding',()=>{
 const s=copy('march');manual(s,'report','vat','included');manual(s,'act','period','2023-04');
 const r=audit(s.extraction,s.documents);assert.ok(r.findings.some(f=>f.id==='period-mismatch'));assert.ok(!r.findings.some(f=>f.id==='amount-mismatch'));
});
test('Missing act is a completeness issue, never a conclusion of fraud',()=>{
 const s=copy('clean');s.extraction.act.amount.value=null;
 const r=audit(s.extraction,s.documents);assert.ok(r.findings.some(f=>f.id==='act-missing'));assert.ok(!r.findings.some(f=>f.id==='amount-mismatch'));
});
test('Signed amendment effective in period changes the applicable rate',()=>{
 const s=copy('march');manual(s,'report','vat','included');manual(s,'act','amount',290940);s.documents.amendment='Согласованная новая ставка';
 for(const [key,value] of Object.entries({signed:true,rate:65,period:'2023-03'}))manual(s,'amendment',key,value);
 const r=audit(s.extraction,s.documents);assert.ok(r.checks.some(c=>c.id==='amendment-applied'));assert.ok(!r.findings.some(f=>f.id==='rate-mismatch'));
});
test('Future amendment does not authorize a past invoice rate',()=>{
 const s=copy('march');manual(s,'report','vat','included');s.documents.amendment='Изменение с апреля';
 for(const [key,value]of Object.entries({signed:true,rate:65,period:'2023-04'}))manual(s,'amendment',key,value);
 const r=audit(s.extraction,s.documents);assert.ok(!r.checks.some(c=>c.id==='amendment-applied'));assert.ok(r.findings.some(f=>f.id==='amendment-unclear'));
});
test('Per-day or unknown units do not get multiplied into monthly audit totals',()=>{
 const s=copy('clean');manual(s,'contract','basis','unknown');manual(s,'report','basis','unknown');manual(s,'report','amount',1);
 const r=audit(s.extraction,s.documents);assert.ok(r.findings.some(f=>f.id==='basis-unknown'));assert.ok(!r.findings.some(f=>f.id==='report-math'));
});
test('Different service is not silently matched',()=>{
 const s=copy('clean');manual(s,'act','service','Охрана');manual(s,'act','amount',100);
 const r=audit(s.extraction,s.documents);assert.ok(r.findings.some(f=>f.id==='service-ra'));assert.ok(!r.findings.some(f=>f.id==='amount-mismatch'));
});
test('Model hallucinated quotations cannot feed the calculation',()=>{
 const s=copy('march');s.extraction.report.area={value:1,quote:'Не существующая цитата'};
 const e=validateExtraction(s.extraction,s.documents);assert.equal(e.report.area.value,null);assert.equal(e.validation.length,1);
});
test('An existing quote with an unsupported number is rejected',()=>{
 const s=copy('march');s.extraction.contract.rate={value:65,quote:'60 рублей за 1 м²'};
 const e=validateExtraction(s.extraction,s.documents);assert.equal(e.contract.rate.value,null);assert.ok(e.validation.length);
});
test('Zero is retained, not turned into missing data',()=>{
 const s=copy('clean');s.documents.report+=' Дополнительная сумма: 0 ₽.';s.extraction.report.amount={value:0,quote:'0 ₽'};
 const e=validateExtraction(s.extraction,s.documents);assert.equal(e.report.amount.value,0);
});
test('Changing input recalculates amount comparison',()=>{
 const s=copy('clean');const first=audit(s.extraction,s.documents);assert.equal(first.findings.length,0);
 manual(s,'report','amount',300000);const second=audit(s.extraction,s.documents);
 assert.equal(second.findings.find(f=>f.id==='amount-mismatch').amount,31440);
});
