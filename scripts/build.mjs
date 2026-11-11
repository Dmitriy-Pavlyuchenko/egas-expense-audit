import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFile(path.join(root,p),'utf8');
let pdfRoot=process.env.EGAS_PDFJS_DIR;
if(!pdfRoot)pdfRoot=path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

const assets={PAGE:await read('web/index.html'),STYLE:await read('web/styles.css'),CLIENT:await read('web/app.js'),CORE:await read('src/audit.mjs'),SAMPLES:(await read('src/samples.mjs')).replace("'./audit.mjs'","'/core.js'"),PDF_LIB:await fs.readFile(path.join(pdfRoot,'build/pdf.mjs'),'utf8'),PDF_WORKER:await fs.readFile(path.join(pdfRoot,'build/pdf.worker.mjs'),'utf8'),PDF_LICENSE:await fs.readFile(path.join(pdfRoot,'LICENSE'),'utf8')};
const assetCode=Object.entries(assets).map(([name,value])=>'const '+name+' = '+JSON.stringify(value)+';').join('\n');
const coreCode=assets.CORE.replace(/^export /gm,'');
let worker=await read('worker/index.js');
worker=worker.replace(/^import .*?;\r?\n/gm,'');
const output=coreCode+'\n'+assetCode+'\n'+worker;
await fs.mkdir(path.join(root,'dist/server'),{recursive:true});await fs.mkdir(path.join(root,'dist/.openai'),{recursive:true});
await fs.writeFile(path.join(root,'dist/server/index.js'),output);
await fs.copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
console.log('Built EGAS Worker ('+Math.round(Buffer.byteLength(output)/1024)+' KB), with local PDF reader.');
