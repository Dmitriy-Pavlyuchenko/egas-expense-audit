export const FIELD_NAMES = {
  period: 'Период', service: 'Услуга', area: 'Площадь, м²', rate: 'Ставка, ₽/м²',
  amount: 'Сумма, ₽', vat: 'НДС', basis: 'Единица тарифа',
  change_requires_agreement: 'Договор требует допсоглашения для изменения ставки', signed: 'Согласование обеими сторонами',
};

const cell = (type) => ({ type: 'object', additionalProperties: false, properties: {
  value: {type: [type, 'null']}, quote: {type: 'string'},
}, required: ['value', 'quote'] });
const documentSchema = {type: 'object', additionalProperties: false, properties: {
  period: cell('string'), service: cell('string'), area: cell('number'), rate: cell('number'), amount: cell('number'),
  vat: cell('string'), basis: cell('string'), change_requires_agreement: cell('boolean'), signed: cell('boolean'),
}, required: Object.keys(FIELD_NAMES)};
export const extractionSchema = {type: 'object', additionalProperties: false, properties: {
  report: documentSchema, act: documentSchema, contract: documentSchema, amendment: documentSchema,
  notes: {type: 'array', items: {type: 'string'}},
}, required: ['report','act','contract','amendment','notes']};

// One comparable charge per item, with explicit source IDs to prevent blending files.
export const periodBundleSchema={type:'object',additionalProperties:false,properties:{
 items:{type:'array',items:{type:'object',additionalProperties:false,properties:{
  label:{type:'string'},source_ids:{type:'object',additionalProperties:false,properties:Object.fromEntries(['report','act','contract','amendment'].map(id=>[id,{type:['string','null']}])),required:['report','act','contract','amendment']},extraction:extractionSchema
 },required:['label','source_ids','extraction']}},
 limitations:{type:'array',items:{type:'string'}},complete:{type:'boolean'}
},required:['items','limitations','complete']};

export function validatePeriodBundle(input,sources,period){
 if(!input||!Array.isArray(input.items)||input.items.length>20||typeof input.complete!=='boolean'||!Array.isArray(input.limitations))throw new Error('Неполный разбор комплекта.');
 const items=input.items.map((item,index)=>{
  const documents={},selected={};
  for(const category of ['report','act','contract','amendment']){
   const sourceId=item.source_ids?.[category];
   const source=sources.find(s=>s.id===sourceId&&s.category===category);
   if(sourceId!==null&&!source)throw new Error('Неизвестный источник в ответе ИИ.');
   documents[category]=source?.text||'';selected[category]=source;
  }
  const extraction=validateExtraction(item.extraction,documents);
  for(const category of ['report','act']){
   const actual=extraction[category].period.value;
   if(actual&&actual!==period)throw new Error('ИИ включил начисление другого периода. Проверьте комплект и повторите.');
  }
  for(const category of ['report','act','contract','amendment'])for(const field of Object.values(extraction[category])){
   if(field.value===null||!selected[category])continue;
   const text=norm(selected[category].text),quote=norm(field.quote),pos=text.indexOf(quote),before=text.slice(0,pos);
   const pages=[...before.matchAll(/Страница (\d+)/g)],sheets=[...before.matchAll(/Лист ([^ ]+)/g)];
   field.source={id:selected[category].id,name:selected[category].name,location:pages.length?'страница '+pages.at(-1)[1]:sheets.length?sheets.at(-1)[0]:'текст документа'};
  }
  const label=String(item.label||extraction.report.service.value||extraction.act.service.value||'Расход '+(index+1)).slice(0,240);
  return {id:'charge-'+index,label,extraction,documents};
 });
 return {items,complete:input.complete,limitations:input.limitations.filter(x=>typeof x==='string').map(x=>x.slice(0,1000)).slice(0,30)};
}

export function blankDocument() {
  return Object.fromEntries(Object.keys(FIELD_NAMES).map(key => [key,{value: null,quote: ''}]));
}
const norm = text => String(text ?? '').replace(/\s+/g,' ').trim();
const validPeriod = value => value === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const numFields = ['area','rate','amount'];
const numberInQuote=(value,quote)=>[...quote.matchAll(/\d[\d \u00a0\u202f]*(?:[.,]\d+)?/g)].some(match=>Math.abs(Number(match[0].replace(/[ \u00a0\u202f]/g,'').replace(',','.'))-value)<0.00001);

// Values enter the calculation only with an exact, source-backed quotation.
export function validateExtraction(input, documents) {
  if (!input || typeof input !== 'object') throw new Error('Модель не вернула структуру документов.');
  const result = {notes: [], validation: []};
  for (const id of ['report','act','contract','amendment']) {
    const source = String(documents[id] || '');
    const doc = input[id];
    if (!doc || typeof doc !== 'object') throw new Error('В ответе отсутствует документ: '+id);
    result[id] = blankDocument();
    for (const key of Object.keys(FIELD_NAMES)) {
      const field = doc[key];
      if (!field || !Object.hasOwn(field,'value') || typeof field.quote !== 'string') throw new Error('Неполное поле: '+id+'.'+key);
      if ((key==='change_requires_agreement'&&id!=='contract')||(key==='signed'&&id!=='amendment')) continue;
      let value = field.value;
      if (value === null) continue;
      if (numFields.includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12)) throw new Error('Недопустимое число: '+id+'.'+key);
      if (['signed','change_requires_agreement'].includes(key) && typeof value !== 'boolean') throw new Error('Недопустимое логическое поле.');
      if (!numFields.includes(key) && !['signed','change_requires_agreement'].includes(key) && typeof value !== 'string') throw new Error('Недопустимое текстовое поле.');
      if (key === 'period' && !validPeriod(value)) { result.validation.push({document:id,field:key,message:'Не удалось однозначно определить месяц и год.'}); continue; }
      if (key === 'vat' && !['included','excluded','unknown'].includes(value)) throw new Error('Неизвестный порядок НДС.');
      if (key === 'basis' && !['monthly_per_m2','monthly_flat','unknown'].includes(value)) throw new Error('Неизвестная единица тарифа.');
      if (!norm(field.quote) || !norm(source).includes(norm(field.quote))) {
        result.validation.push({document:id,field:key,message:'Цитата не найдена в исходном тексте. Значение исключено из расчёта.'});
        continue;
      }
      if (numFields.includes(key) && !numberInQuote(value,field.quote)) {
        result.validation.push({document:id,field:key,message:'Число не подтверждено цитатой. Значение исключено из расчёта.'});
        continue;
      }
      result[id][key] = {value,quote:field.quote};
    }
  }
  // Free-form model notes are not promoted to audit findings.
  return result;
}

export function audit(extraction, documents = {}) {
  const findings = [], checks = [], questions = [];
  const val = (id,key) => extraction[id]?.[key]?.value ?? null;
  const evidence = (...items) => items.map(([document,field])=>({document,field,quote:extraction[document]?.[field]?.quote||'',source:extraction[document]?.[field]?.source,manual:!!extraction[document]?.[field]?.manual}));
  const rub = amount => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(amount)+' ₽';
  const cents = n => Math.round((n+Number.EPSILON)*100);
  const delta = (a,b) => (cents(a)-cents(b))/100;
  const isNum = n => typeof n === 'number' && Number.isFinite(n);
  const add = (id,level,title,detail,amount,refs,group) => findings.push({id,level,title,detail,amount,evidence:refs,group});
  const missing = (id,title,detail,refs=[]) => add(id,'missing',title,detail,null,refs,'completeness');
  const periodR = val('report','period'), periodA = val('act','period');
  const serviceR=val('report','service'),serviceA=val('act','service'),serviceC=val('contract','service');
  let comparableRA = true, comparableRC = true;
  const simplify = s => String(s||'').toLowerCase().replace(/[^а-яёa-z0-9]/g,'');
  if (!periodR || !periodA) { comparableRA=false; missing('period-missing','Период не установлен','Для сравнения отчёта и акта подтвердите месяц и год обоих документов.',evidence(['report','period'],['act','period'])); }
  else if (periodR!==periodA) {comparableRA=false; missing('period-mismatch','Отчёт и акт относятся к разным периодам','Суммы за '+periodR+' и '+periodA+' не сравниваются.',evidence(['report','period'],['act','period']));}
  if (!serviceR || !serviceA || simplify(serviceR)!==simplify(serviceA)) {comparableRA=false; missing('service-ra','Нужно сопоставить услугу отчёта и акта','Названия должны обозначать одну услугу. При необходимости подтвердите сопоставление в извлечённых данных.',evidence(['report','service'],['act','service']));}
  if (!serviceR || !serviceC || simplify(serviceR)!==simplify(serviceC)) {comparableRC=false; missing('service-rc','Нужно сопоставить услугу и договор','Договорный тариф нельзя применять, пока не подтверждена одна и та же услуга.',evidence(['report','service'],['contract','service']));}

  for (const id of ['report','act']) {
    const area=val(id,'area'),rate=val(id,'rate'),amount=val(id,'amount');
    if (isNum(area)&&isNum(rate)&&isNum(amount)&&val(id,'basis')==='monthly_per_m2') {
      const expected=cents(area*rate)/100, difference=delta(amount,expected);
      if (Math.abs(difference)>0.01) add(id+'-math','issue','Арифметика '+(id==='report'?'начисления':'акта')+' не сходится', 'Площадь × ставка = '+rub(expected)+', в документе '+rub(amount)+'. Проверьте единицы, округление и корректировки.',difference,evidence([id,'area'],[id,'rate'],[id,'amount']),'arithmetic');
      else checks.push({id:id+'-math',title:'Арифметика '+(id==='report'?'отчёта':'акта')+' сходится',detail:area+' м² × '+rate+' ₽ = '+rub(amount),evidence:evidence([id,'area'],[id,'rate'],[id,'amount'])});
    }
  }

  if(comparableRA&&isNum(val('report','area'))&&isNum(val('act','area'))&&Math.abs(val('report','area')-val('act','area'))>0.001) {
    add('area-mismatch','review','Площади отчёта и акта различаются','В отчёте '+val('report','area')+' м², в акте '+val('act','area')+' м². Уточните объём работ и соответствие документов.',null,evidence(['report','area'],['act','area']),'scope');
  }

  if (comparableRA && isNum(val('report','amount'))&&isNum(val('act','amount'))) {
    const vr=val('report','vat'),va=val('act','vat');
    if (!vr||!va||vr==='unknown'||va==='unknown'||vr!==va) missing('vat-ra','Уточните сопоставимость сумм по НДС','Разность отчёта и акта не рассчитана: порядок НДС неизвестен или различается. При необходимости подтвердите его вручную.',evidence(['report','vat'],['act','vat']));
    else {
      const difference=delta(val('report','amount'),val('act','amount'));
      if (Math.abs(difference)>0.01) add('amount-mismatch','issue','Начисление расходится с актом','Отчёт: '+rub(val('report','amount'))+'. Акт: '+rub(val('act','amount'))+'. Разность не является автоматически установленной переплатой.',difference,evidence(['report','amount'],['act','amount'],['report','vat'],['act','vat']),'same-charge');
      else checks.push({id:'amount-match',title:'Сумма отчёта совпадает с актом',detail:rub(val('act','amount')),evidence:evidence(['report','amount'],['act','amount'])});
    }
  } else if (!isNum(val('act','amount'))) missing('act-missing','Нет суммы акта для сверки','Загрузите акт или подтвердите отсутствие документа. Отсутствие в комплекте не доказывает отсутствие акта вообще.');

  let appliedRate=val('contract','rate');
  const amendmentText=String(documents.amendment||'').trim();
  const amendmentRelevant=isAmendmentRelevant(extraction,documents);
  if (amendmentRelevant) {
    if (val('amendment','signed')===true && isNum(val('amendment','rate')) && val('amendment','period') && periodR && val('amendment','period')<=periodR) {
      appliedRate=val('amendment','rate');
      checks.push({id:'amendment-applied',title:'Учтено изменение тарифа',detail:'По предоставленным сведениям: ставка '+appliedRate+' ₽/м² с '+val('amendment','period')+'. Подписи и применимость проверяет сотрудник.',evidence:evidence(['amendment','signed'],['amendment','rate'],['amendment','period'])});
    } else {const review=amendmentReview(extraction,documents);missing('amendment-unclear',review.title,review.detail,evidence(...review.fields.map(field=>['amendment',field])));}
  }
  if(comparableRA&&comparableRC&&isNum(appliedRate)&&isNum(val('act','area'))&&isNum(val('act','amount'))&&val('contract','basis')==='monthly_per_m2'&&val('act','vat')&&val('act','vat')!=='unknown'&&val('act','vat')===val('contract','vat')&&val('act','rate')===null) {
    const expected=cents(val('act','area')*appliedRate)/100,difference=delta(val('act','amount'),expected);
    if(Math.abs(difference)>0.01)add('act-contract-math','review','Сумма акта отличается от договорного расчёта','По указанной площади и тарифу получается '+rub(expected)+', в акте '+rub(val('act','amount'))+'. Уточните корректировки, объём работ и применимость тарифа.',difference,evidence(['act','area'],['act','amount'],['contract','rate'],['contract','basis']),'same-charge');
    else checks.push({id:'act-contract-match',title:'Сумма акта соответствует договорному расчёту',detail:val('act','area')+' м² × '+appliedRate+' ₽ = '+rub(expected),evidence:evidence(['act','area'],['act','amount'],['contract','rate'])});
  }
  if (comparableRC && isNum(appliedRate)&&isNum(val('report','rate'))) {
    const vr=val('report','vat'),vc=val('contract','vat'),basis=val('contract','basis');
    if (basis!=='monthly_per_m2') missing('basis-unknown','Подтвердите единицу договорного тарифа','Нужна ставка за м² в месяц. Суточные и разовые тарифы автоматически не приводятся.',evidence(['contract','basis']));
    else if (!vr||!vc||vr==='unknown'||vc==='unknown'||vr!==vc) missing('vat-rc','Договорная ставка пока несопоставима','Уточните, включён ли НДС в договорную ставку и начисление. Дополнительный налог автоматически не добавляется.',evidence(['report','vat'],['contract','vat']));
    else {
      const rateDifference=delta(val('report','rate'),appliedRate);
      if (Math.abs(rateDifference)>0.001) {
        const higher=rateDifference>0;
        const amount=isNum(val('report','area'))?cents(val('report','area')*rateDifference)/100:null;
        const requirement=val('contract','change_requires_agreement');
        const detail='В отчёте '+val('report','rate')+' ₽/м², применимый по представленным данным тариф '+appliedRate+' ₽/м².'+(isNum(amount)?' Разность по площади: '+rub(amount)+'.':'')+(requirement===true&&!amendmentText?' Договор требует согласованного изменения; подтверждающий документ не загружен.':' Проверьте основания и применимость изменения.');
        add('rate-mismatch',higher?'issue':'review',higher?'Ставка выше подтверждённого тарифа':'Ставка ниже подтверждённого тарифа',detail,amount,evidence(['report','rate'],['report','area'],['contract','rate'],['contract','change_requires_agreement']),'same-charge');
      } else checks.push({id:'rate-match',title:'Ставка соответствует представленным условиям',detail:appliedRate+' ₽/м² в месяц',evidence:evidence(['report','rate'],['contract','rate'])});
    }
  } else if (!isNum(appliedRate)) missing('contract-rate-missing','Не установлена договорная ставка','Добавьте договорные условия или проверьте извлечённые значения.');
  for (const item of extraction.validation||[]) {
    if(item.field==='change_requires_agreement'&&(item.document!=='contract'||!rateChangeNeedsReview(extraction)))continue;
    if(item.field==='signed'&&item.document!=='amendment')continue;
    if(item.document==='contract'&&['period','area','amount'].includes(item.field))continue;
    if(item.document==='act'&&item.field==='basis'&&!isNum(val('act','rate')))continue;
    if(item.document==='amendment'&&!amendmentRelevant)continue;
    if(item.document==='amendment'&&findings.some(f=>f.id==='amendment-unclear'))continue;
    missing('quote-'+item.document+'-'+item.field,'Значение требует подтверждения',FIELD_NAMES[item.field]+': '+item.message);
  }
  if (findings.some(f=>f.id==='rate-mismatch')) questions.push('Предоставить подписанное основание изменения тарифа с датой начала действия либо пояснить расчёт начисления.');
  if (findings.some(f=>f.id==='amount-mismatch')) questions.push('Объяснить разницу между отчётом и актом за один период; при необходимости представить корректировку.');
  if (findings.some(f=>['act-math','act-contract-math'].includes(f.id))) questions.push('Уточнить площадь, ставку и корректировки в акте: сумма отличается от расчёта по представленным условиям.');
  return {findings,checks,questions,notice:'Замечания относятся к предоставленному комплекту. Связанные разницы не складываются. Экономия, переплата и нарушение не установлены автоматически.'};
}

export function findingPresentation(f,extraction){
 const value=(doc,key)=>extraction[doc]?.[key]?.value??null;
 const rub=n=>typeof n==='number'?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)+' ₽':'Не определено';
 const rate=n=>typeof n==='number'?rub(n)+'/м² в месяц':'Не определена';
 let applied=value('contract','rate');
 if(value('amendment','signed')===true&&value('amendment','rate')!==null&&value('amendment','period')&&value('report','period')&&value('amendment','period')<=value('report','period'))applied=value('amendment','rate');
 const view={title:f.title,comparisons:[],summary:f.detail,nextStep:'Проверьте указанные документы и запросите у УК недостающие сведения.',needsData:f.level==='missing'};
 if(f.id==='amount-mismatch')Object.assign(view,{title:'Отчёт УК расходится с актом',comparisons:[{label:'В отчёте УК',value:rub(value('report','amount'))},{label:'В акте',value:rub(value('act','amount'))}],summary:'',nextStep:'Запросите у УК пояснение разницы и при необходимости исправленный расчёт.'});
 else if(f.id==='rate-mismatch')Object.assign(view,{title:'Ставка в отчёте УК отличается от согласованных условий',comparisons:[{label:'В отчёте УК',value:rate(value('report','rate'))},{label:'По условиям договора',value:rate(applied)}],summary:value('contract','change_requires_agreement')===true?'По договору изменение ставки требует допсоглашения, подписанного обеими сторонами.':'',nextStep:'Запросите у УК основание изменения ставки или пояснение расчёта.'});
 else if(f.id==='act-contract-math')Object.assign(view,{title:'Сумма акта отличается от расчёта по договору',comparisons:[{label:'В акте',value:rub(value('act','amount'))},{label:'Площадь × ставка договора',value:rub(Math.round(value('act','area')*applied*100)/100)}],summary:'',nextStep:'Запросите расшифровку суммы акта: площадь, ставку и корректировки.'});
 else if(['report-math','act-math'].includes(f.id)){const doc=f.id==='act-math'?'act':'report';Object.assign(view,{title:doc==='act'?'Сумма акта не сходится с площадью и ставкой':'Начисление в отчёте УК не сходится с площадью и ставкой',comparisons:[{label:'В документе',value:rub(value(doc,'amount'))},{label:'Площадь × ставка',value:rub(Math.round(value(doc,'area')*value(doc,'rate')*100)/100)}],summary:'',nextStep:'Запросите у УК расчёт суммы и пояснение корректировок.'});}
 else if(f.id==='area-mismatch')Object.assign(view,{title:'Площадь в отчёте УК отличается от акта',comparisons:[{label:'В отчёте УК',value:value('report','area')+' м²'},{label:'В акте',value:value('act','area')+' м²'}],summary:'',nextStep:'Уточните у УК, какая площадь обслуживалась и почему документы различаются.'});
 else if(['vat-ra','vat-rc'].includes(f.id))Object.assign(view,{title:'Неясно, включён ли НДС в сравниваемые суммы',summary:'Порядок НДС неизвестен или различается. Сравнение сумм или ставок пока недоступно.',nextStep:'Откройте данные расхода и проверьте поля НДС. Если в документах этого нет, запросите пояснение у УК.'});
 else if(f.id==='act-missing')Object.assign(view,{title:'Для начисления не найдена сумма в акте',summary:'Без суммы акта нельзя сопоставить её с начислением в отчёте УК.',nextStep:'Проверьте, добавлен ли подходящий акт. Если его нет, запросите у УК акт за выбранный период.'});
 else if(f.id==='contract-rate-missing')Object.assign(view,{title:'Для расхода не определена договорная ставка',summary:'Пока нельзя проверить, соответствует ли начисление условиям договора.',nextStep:'Проверьте договор в данных расхода. Если условия отсутствуют, запросите их у УК.'});
 else if(f.id==='amendment-unclear'){const review=amendmentReview(extraction,{});Object.assign(view,{title:review.title,summary:f.detail,nextStep:review.nextStep});}
 else if(f.id.startsWith('quote-'))Object.assign(view,{title:'Не удалось подтвердить значение по документу',nextStep:'Перейдите к данным расхода и проверьте соответствующее поле по исходному тексту. Запросите сведения у УК, если их нет в документе.'});
 return view;
}

export function findingRequest(f,extraction,label,period){
 const view=findingPresentation(f,extraction);
 const facts=view.comparisons.length?view.comparisons.map(c=>c.label+': '+c.value).join('. ')+'.':view.summary;
 const asks={
  'amount-mismatch':'Просим пояснить разницу между отчётом и актом и предоставить расшифровку начисления. При ошибке просим направить исправленный расчёт.',
  'rate-mismatch':'Просим предоставить основание изменения ставки, включая подписанное допсоглашение и дату начала применения новой ставки, либо пояснить расчёт.',
  'act-contract-math':'Просим предоставить расшифровку суммы акта с площадью, ставкой и всеми корректировками.',
  'area-mismatch':'Просим уточнить фактическую обслуживаемую площадь и пояснить различие между отчётом и актом.',
  'vat-ra':'Просим указать, включён ли НДС в сумму отчёта и сумму акта, и привести суммы к сопоставимому виду.',
  'vat-rc':'Просим указать, включён ли НДС в ставку отчёта и договорную ставку.',
  'act-missing':'Просим предоставить акт по этой услуге за указанный период с суммой и объёмом оказанных услуг.',
  'contract-rate-missing':'Просим предоставить договор или приложение, устанавливающее ставку и порядок расчёта этой услуги.',
  'amendment-unclear':amendmentReview(extraction,{}).addDocument?'Просим предоставить подписанное обеими сторонами допсоглашение с новой ставкой и датой начала её применения.':amendmentReview(extraction,{}).fields.includes('rate')?'Просим уточнить размер новой ставки по согласованному изменению тарифа.':'Просим уточнить дату начала действия новой ставки и основание её применения в указанном месяце.'
 };
 return 'По расходу «'+label+'» за '+period+':\n'+view.title+'.\n'+facts+'\n'+(asks[f.id]||'Просим уточнить указанные сведения и предоставить подтверждающие документы и расчёт.');
}

export function bundleRequest(items,period){
 const parts=items.flatMap(item=>audit(item.extraction,item.documents).findings.map(f=>findingRequest(f,item.extraction,item.label,period)));
 return parts.length?'Просим пояснить следующие замечания к документам за '+period+'.\n\n'+parts.map((text,i)=>(i+1)+'. '+text).join('\n\n'):'По проверенным данным замечаний для запроса в УК нет.';
}

export function rateChangeNeedsReview(extraction){
 const report=extraction.report?.rate?.value,contract=extraction.contract?.rate?.value;
 const normService=s=>String(s||'').toLowerCase().replace(/[^а-яёa-z0-9]/g,'');
 const reportService=normService(extraction.report?.service?.value),contractService=normService(extraction.contract?.service?.value);
 return typeof report==='number'&&typeof contract==='number'&&Math.abs(report-contract)>.001&&!!reportService&&reportService===contractService;
}
export function isAmendmentRelevant(extraction,documents){
 if(!String(documents.amendment||'').trim())return false;
 if(rateChangeNeedsReview(extraction))return true;
 const val=(doc,key)=>extraction[doc]?.[key]?.value??null;
 return val('report','service')&&String(val('report','service')).toLowerCase()===String(val('contract','service')).toLowerCase()&&val('amendment','signed')===true&&typeof val('amendment','rate')==='number'&&val('amendment','period')&&val('report','period')&&val('amendment','period')<=val('report','period');
}
export function amendmentReview(extraction,documents){
 const val=(doc,key)=>extraction[doc]?.[key]?.value??null;
 if(val('amendment','signed')!==true){
  const notification=/уведомлени[ея]/i.test(String(documents.amendment||'').slice(0,600));
  return {title:'Нет подтверждения согласования новой ставки',detail:(notification?'Загружено уведомление об изменении тарифа. ':'В загруженном документе об изменении тарифа ')+(notification?'Согласование новой ставки обеими сторонами не подтверждено. ':'не подтверждено согласование новой ставки обеими сторонами. ')+(val('contract','change_requires_agreement')===true?'Договор требует подписанного обеими сторонами допсоглашения.':'Уточните основание применения новой ставки.'),nextStep:val('contract','change_requires_agreement')===true?'Запросите у УК подписанное обеими сторонами допсоглашение.':'Запросите у УК документ, подтверждающий согласование новой ставки.',fields:['signed'],addDocument:true};
 }
 if(typeof val('amendment','rate')!=='number')return {title:'В документе не определена новая ставка',detail:'Изменение согласовано обеими сторонами, но из документа не удалось извлечь размер новой ставки. Поэтому она пока не используется в расчёте.',nextStep:'Проверьте размер ставки в документе или запросите у УК уточнение.',fields:['rate'],addDocument:false};
 if(!val('amendment','period'))return {title:'Не определено начало действия новой ставки',detail:'Не удалось определить, с какого месяца действует согласованная ставка. Пока её нельзя применить к выбранному периоду.',nextStep:'Проверьте дату начала действия в документе или уточните её у УК.',fields:['period'],addDocument:false};
 return {title:'Новая ставка действует с другого периода',detail:'В документе новая ставка действует с '+val('amendment','period')+', а начисление относится к '+val('report','period')+'. Для этого месяца используется прежняя ставка.',nextStep:'Проверьте дату применения ставки. Если УК применила её раньше, запросите основание такого начисления.',fields:['period'],addDocument:false};
}
