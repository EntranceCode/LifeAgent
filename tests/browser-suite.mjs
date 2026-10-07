// Every script gets a fresh disk directory and port, away from personal backups.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createExploreServer} from '../server.mjs';

if(!process.env.PLAYWRIGHT_MODULE)throw Error('Set PLAYWRIGHT_MODULE to the installed playwright/index.mjs path.');
const scripts=['browser-smoke.mjs','browser-storage.mjs','browser-v04.mjs','browser-review.mjs','browser-core.mjs'];
const selected=process.argv.slice(2);
if(selected.some(script=>!scripts.includes(script)))throw Error('Unknown browser test script.');
for(const script of selected.length?selected:scripts){
  const directory=await mkdtemp(join(tmpdir(),'exploreos-browser-test-'));
  const server=createExploreServer({dataDir:directory});
  try{
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
    await new Promise((done,reject)=>{
      const child=spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{
        stdio:'inherit',env:{...process.env,EXPLOREOS_TEST_URL:`http://127.0.0.1:${server.address().port}`}
      });
      child.once('error',reject);
      child.once('exit',code=>code===0?done():reject(Error(`${script} failed (${code}).`)));
    });
  }finally{
    if(server.listening)await new Promise(done=>server.close(done));
    const target=resolve(directory),tempRoot=resolve(tmpdir());
    if(target.startsWith(tempRoot+sep)&&target.slice(tempRoot.length+1).startsWith('exploreos-browser-test-'))await rm(target,{recursive:true,force:true});
  }
}
