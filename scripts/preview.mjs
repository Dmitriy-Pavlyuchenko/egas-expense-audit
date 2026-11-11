import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env={};
try{const raw=await fs.readFile(path.join(root,'.env.local'),'utf8');for(const line of raw.split(/\r?\n/)){const match=line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);if(match)env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}}catch{}
const moduleUrl=pathToFileURL(path.join(root,'dist/server/index.js'));
const worker=(await import(moduleUrl)).default;
const port=Number(process.argv[2]||process.env.PORT||4173);
const server=http.createServer(async(req,res)=>{try{const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>200000){res.writeHead(413);res.end('Too large');return;}chunks.push(chunk);}const body=Buffer.concat(chunks);const url='http://127.0.0.1:'+port+req.url;const request=new Request(url,{method:req.method,headers:req.headers,...(body.length?{body,duplex:'half'}:{})});const response=await worker.fetch(request,env,{waitUntil:promise=>promise.catch(()=>{})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end('Local preview failed.');}});
server.listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
