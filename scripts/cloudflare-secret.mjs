import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const file=process.argv[2];
if(!file)throw new Error('Pass the local env-file path. Its contents are never printed.');
const source=await fs.readFile(file,'utf8');
const raw=source.split(/\r?\n/).find(line=>/^OPENROUTER_API_KEY=/.test(line));
const secret=raw?.slice(raw.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
if(!secret)throw new Error('OPENROUTER_API_KEY is not configured in the supplied file.');
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const child=spawn(process.execPath,[cli,'secret','put','OPENROUTER_API_KEY'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['pipe','pipe','pipe']});
let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data.toString();});
child.stdin.end(secret+'\n');
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
// Secret values are never written to logs or passed as process arguments.
process.stdout.write(output.split(secret).join('[REDACTED]'));
process.exitCode=code||0;
