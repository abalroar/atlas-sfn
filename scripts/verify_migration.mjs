import {readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const document=JSON.parse(await readFile(path.join(root,'migration/source-inventory.json'),'utf8'));
const adjustments=new Set(document.adjustedFiles||[]);
const mismatches=[];
let files=0,bytes=0,data=0;
for(const item of document.files){
 const absolute=path.resolve(root,item.path);
 if(!absolute.startsWith(root))throw Error('Caminho de origem inválido.');
 if(adjustments.has(item.path))continue;
 const content=await readFile(absolute);
 const hash=createHash('sha256').update(content).digest('hex');
 if(content.length!==item.bytes||hash!==item.sha256)mismatches.push(item.path);
 files++;bytes+=content.length;
 if(item.path.startsWith('web/public/data/'))data++;
}
const links=[];
async function scan(directory){
 for(const item of await readdir(directory,{withFileTypes:true})){
  if(['.git','node_modules','.venv','.wrangler','__pycache__','outputs','.pytest_cache'].includes(item.name))continue;
  const absolute=path.join(directory,item.name);
  if(item.isSymbolicLink())links.push(path.relative(root,absolute));
  else if(item.isDirectory())await scan(absolute);
 }
}
await scan(root);
if(mismatches.length||links.length)throw Error(JSON.stringify({modifiedOriginalFiles:mismatches,externalLinks:links},null,2));
console.log(JSON.stringify({verifiedFiles:files,webDataFiles:data,bytes,originalCalculations:'identical',externalLinks:0,sourceCommit:document.sourceCommit},null,2));
