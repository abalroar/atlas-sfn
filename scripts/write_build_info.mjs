import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../web/public/data/manifest.json',import.meta.url),'utf8'));
const commit=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Commit de publicação inválido.');
const info={app:'Atlas SFN',schemaVersion:1,repository:'abalroar/atlas-sfn',worker:'atlas-sfn',frontendCommit:commit,frontendBuiltAt:new Date().toISOString(),sourceData:manifest.sourceCommit,builtAt:manifest.builtAt,charts:manifest.chartCount};
await writeFile(new URL('../web/dist/build.json',import.meta.url),JSON.stringify(info,null,2)+'\n');
console.log(`Publicação Atlas identificada por ${commit.slice(0,7)}.`);
