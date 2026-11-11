import test from 'node:test';
import assert from 'node:assert/strict';
import {sample} from '../src/samples.mjs';
const worker=(await import(new URL('../dist/server/index.js',import.meta.url))).default;
test('Home and browser modules are served, private configuration is never exposed',async()=>{
 for(const path of ['/','/app.js','/core.js','/samples.js','/styles.css']){const r=await worker.fetch(new Request('https://example.com'+path),{},{});assert.equal(r.status,200);assert.ok((await r.text()).length>100);}
 const r=await worker.fetch(new Request('https://example.com/.env.local'),{},{});assert.equal(r.status,404);
});
test('Status returns a flag without revealing the configured secret',async()=>{
 const r=await worker.fetch(new Request('https://example.com/api/status'),{OPENAI_API_KEY:'test-secret'},{});const body=await r.text();assert.ok(!body.includes('test-secret'));assert.equal(JSON.parse(body).aiConfigured,true);
});
test('Cross-origin extraction is rejected before an external request',async()=>{
 const r=await worker.fetch(new Request('https://example.com/api/extract',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'}),{OPENAI_API_KEY:'test-secret'},{});assert.equal(r.status,403);
});
test('Missing AI connection is an explicit error, not a fabricated extraction',async()=>{
 const r=await worker.fetch(new Request('https://example.com/api/extract',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:'{}'}),{},{});assert.equal(r.status,503);assert.equal((await r.json()).code,'AI_NOT_CONFIGURED');
});
test('OpenRouter key selects the approved model and endpoint; extraction stays validated',async()=>{
 const original=globalThis.fetch;
 const fixture=sample('clean');let payload;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://openrouter.ai/api/v1/responses');
  assert.equal(options.headers.Authorization,'Bearer router-test-secret');
  payload=JSON.parse(options.body);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(fixture.extraction)}]}]});
 };
 try{
  const r=await worker.fetch(new Request('https://example.com/api/extract',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({documents:fixture.documents})}),{OPENROUTER_API_KEY:'router-test-secret',OPENAI_API_KEY:'unused'},{});
  assert.equal(r.status,200);const result=await r.json();
  assert.equal(result.model,'openai/gpt-4.1-mini');assert.equal(result.provider,'OpenRouter');
  assert.equal(payload.provider.require_parameters,true);assert.equal(payload.provider.data_collection,'deny');
  assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);
  assert.equal(result.extraction.act.amount.value,268560);
 }finally{globalThis.fetch=original;}
});
