import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createExploreServer} from '../server.mjs';

const makeState=problem=>({
  version:1,
  directions:[{id:'direction-1',name:'产品设计'}],
  experiments:[],
  sessions:[],
  memories:[],
  problems:problem?[{id:'problem-1',text:problem,workaround:'先记录',createdAt:'2026-10-06T08:00:00.000Z'}]:[]
});

test('本机备份原子保存最新状态并保留上一版',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'exploreos-backup-test-'));
  const server=createExploreServer({dataDir:directory});
  await new Promise((resolveListen,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolveListen);
  });
  const port=server.address().port,base=`http://127.0.0.1:${port}`;
  try{
    let response=await fetch(base+'/api/state');
    assert.deepEqual(await response.json(),{latest:null,previous:null});

    const first=makeState('');
    response=await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify(first)});
    assert.equal(response.status,200);
    const second=makeState('怎样降低探索的启动成本？');
    response=await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify(second)});
    assert.equal(response.status,200);

    response=await fetch(base+'/api/state');
    const saved=await response.json();
    assert.deepEqual(saved.latest.state,second);
    assert.deepEqual(saved.previous.state,first);
    assert.deepEqual(JSON.parse(await readFile(join(directory,'exploreos-latest.json'),'utf8')),second);
    assert.deepEqual(JSON.parse(await readFile(join(directory,'exploreos-previous.json'),'utf8')),first);

    response=await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:'{"version":99}'});
    assert.equal(response.status,400);
    assert.deepEqual(JSON.parse(await readFile(join(directory,'exploreos-latest.json'),'utf8')),second);

    response=await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://example.com'},body:JSON.stringify(first)});
    assert.equal(response.status,403);
  }finally{
    await new Promise(resolveClose=>server.close(resolveClose));
    const safeRoot=resolve(tmpdir())+sep;
    if(!resolve(directory).startsWith(safeRoot))throw Error('Refusing to remove a non-temporary test directory.');
    await rm(directory,{recursive:true,force:true});
  }
});
