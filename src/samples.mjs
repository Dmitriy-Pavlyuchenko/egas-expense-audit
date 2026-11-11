import {blankDocument} from './audit.mjs';
const fill=(entries)=>Object.assign(blankDocument(),Object.fromEntries(Object.entries(entries).map(([key,value])=>[key,{value:value[0],quote:value[1]}])));
export function sample(id='march') {
  const period=id==='march'?'2023-03':'2023-09';
  const clean=id==='clean';
  const reportRate=id==='march'?65:60;
  const reportAmount=id==='march'?290940:clean?268560:268440;
  const actAmount=clean?268560:268440;
  const title=id==='march'?'Март 2023 — начисление по 65 ₽':clean?'Контрольный пример — совпадение':'Сентябрь 2023 — исходный пример';
  const documents={
    report:'Период: '+period+'. Статья: клининг. Площадь: 4 476 м². Цена: '+reportRate+' ₽/м² в месяц. Сумма: '+reportAmount+' ₽. '+(id==='march'?'Примечание: начисление с пересчётом тарифа.':'Примечание: доп. механ. уборка ТП.')+'\n'+(clean?'Сумма и ставка включают НДС 20%.':'Порядок НДС в исходной строке не указан.'),
    act:'Период: '+period+'. Акт: клининг. Оказаны услуги по ежедневной механизированной уборке мест общего пользования торгового центра в объёме 4 476 м². Стоимость услуги — '+actAmount+' рублей, в том числе НДС 20%.\nСтавка в фрагменте акта отдельно не указана.',
    contract:'Услуга: клининг. Пункт 2.1. Размер ежемесячной платы за услуги клининга составляет 60 рублей за 1 м² обрабатываемой площади. Объём работ уточняется ежемесячно актом. Стоимость считается с учётом НДС, отдельной строкой не выделяется.\nПункт 2.4. Изменение размера платы возможно только по дополнительному соглашению сторон либо по акту индексации, подписанному обеими сторонами. В остальных случаях применяется базовая ставка.',
    amendment:'',
  };
  const extraction={
    report:fill({period:[period,period],service:['Клининг','клининг'],area:[4476,'4 476 м²'],rate:[reportRate,reportRate+' ₽/м² в месяц'],amount:[reportAmount,reportAmount+' ₽'],vat:[clean?'included':'unknown',clean?'Сумма и ставка включают НДС 20%.':'Порядок НДС в исходной строке не указан.'],basis:['monthly_per_m2',reportRate+' ₽/м² в месяц']}),
    act:fill({period:[period,period],service:['Клининг','клининг'],area:[4476,'4 476 м²'],amount:[actAmount,actAmount+' рублей'],vat:['included','в том числе НДС 20%']}),
    contract:fill({service:['Клининг','клининг'],rate:[60,'60 рублей за 1 м²'],vat:['included','Стоимость считается с учётом НДС'],basis:['monthly_per_m2','ежемесячной платы за услуги клининга составляет 60 рублей за 1 м²'],change_requires_agreement:[true,'Изменение размера платы возможно только по дополнительному соглашению сторон либо по акту индексации, подписанному обеими сторонами.']}),
    amendment:blankDocument(),notes:[],validation:[],
  };
  return {id,title,documents,extraction,synthetic:clean};
}
