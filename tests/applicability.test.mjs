import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExtraction,audit,amendmentReview,isAmendmentRelevant} from '../src/audit.mjs';
import {sample} from '../src/samples.mjs';
test('Agreement requirement and bilateral signature fields are ignored outside their applicable document type',()=>{
 const s=sample('clean');
 for(const id of ['report','act','amendment'])s.extraction[id].change_requires_agreement={value:true,quote:'цитата, которой нет'};
 for(const id of ['report','act','contract'])s.extraction[id].signed={value:true,quote:'цитата, которой нет'};
 const e=validateExtraction(s.extraction,s.documents);
 for(const id of ['report','act','amendment'])assert.equal(e[id].change_requires_agreement.value,null);
 for(const id of ['report','act','contract'])assert.equal(e[id].signed.value,null);
 assert.equal(e.validation.length,0);assert.equal(audit(e,s.documents).findings.length,0);
 assert.equal(e.contract.change_requires_agreement.value,true);
});
test('Legacy non-applicable validation entries do not become requests to fix the report or act',()=>{
 const s=sample('clean');s.extraction.validation=[{document:'report',field:'change_requires_agreement',message:'old warning'},{document:'act',field:'change_requires_agreement',message:'old warning'},{document:'contract',field:'signed',message:'old warning'}];
 assert.equal(audit(s.extraction,s.documents).findings.length,0);
});
test('An unrelated unconfirmed document does not create amendment warnings when the rate already matches',()=>{
 const s=sample('clean');s.documents.amendment='Уведомление о другом тарифе.';s.extraction.validation=[{document:'amendment',field:'rate',message:'rate unconfirmed'}];
 assert.equal(isAmendmentRelevant(s.extraction,s.documents),false);
 assert.equal(audit(s.extraction,s.documents).findings.length,0);
});
test('Unsigned notification produces a specific agreement action without unrelated field warnings',()=>{
 const s=sample('march');s.documents.amendment='Уведомление об изменении тарифа. Подписи заказчика нет.';
 s.extraction.amendment.signed={value:false,quote:'Подписи заказчика нет.'};
 s.extraction.validation=[{document:'amendment',field:'rate',message:'unconfirmed rate'}];
 const finding=audit(s.extraction,s.documents).findings.find(f=>f.id==='amendment-unclear');
 assert.equal(finding.title,'Нет подтверждения согласования новой ставки');assert.match(finding.detail,/уведомление/);assert.match(finding.detail,/Договор требует/);
 assert.deepEqual(finding.evidence.map(e=>e.field),['signed']);
 assert.ok(!audit(s.extraction,s.documents).findings.some(f=>f.id==='quote-amendment-rate'));
 assert.match(amendmentReview(s.extraction,s.documents).nextStep,/Запросите у УК подписанное/);
});
test('When signatures and rate are known, the unresolved start date is named directly',()=>{
 const s=sample('march');s.documents.amendment='Подписанное изменение тарифа.';s.extraction.amendment.signed.value=true;s.extraction.amendment.rate.value=65;
 const review=amendmentReview(s.extraction,s.documents);assert.equal(review.title,'Не определено начало действия новой ставки');assert.deepEqual(review.fields,['period']);assert.equal(review.addDocument,false);
});
test('Act tariff unit is only a clarification when an act rate is available for arithmetic',()=>{
 const s=sample('clean');s.extraction.act.basis={value:'monthly_per_m2',quote:'нет такой цитаты'};
 const e=validateExtraction(s.extraction,s.documents);assert.ok(e.validation.some(v=>v.document==='act'&&v.field==='basis'));
 assert.ok(!audit(e,s.documents).findings.some(f=>f.id==='quote-act-basis'));
 e.act.rate.value=60;assert.ok(audit(e,s.documents).findings.some(f=>f.id==='quote-act-basis'));
});
