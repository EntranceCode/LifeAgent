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
    assert.deepEqual(await response.json(),{latest:null,previous:null,history:[]});

    const first=makeState('');
    response=await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-ExploreOS-Revision':'none'},body:JSON.stringify(first)});
    assert.equal(response.status,200);
    const firstSaved=await response.json();
    const second=makeState('怎样降低探索的启动成本？');
    response=await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-ExploreOS-Revision':firstSaved.latest.revision},body:JSON.stringify(second)});
    assert.equal(response.status,200);

    response=await fetch(base+'/api/state');
    const saved=await response.json();
    assert.deepEqual(saved.latest.state,second);
    assert.deepEqual(saved.previous.state,first);
    assert.equal(saved.history.length,2);
    assert.ok(saved.history.every(item=>Number.isFinite(Date.parse(item.savedAt))));
    for(const item of saved.history){
      const historyResponse=await fetch(base+'/api/state?history='+encodeURIComponent(item.name));
      const snapshot=await historyResponse.json();
      assert.ok([JSON.stringify(first),JSON.stringify(second)].includes(JSON.stringify(snapshot.snapshot.state)));
    }
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

test('旧版本与多个本地服务同时保存均不能覆盖新记录',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'exploreos-conflict-test-'));
  const servers=[createExploreServer({dataDir:directory}),createExploreServer({dataDir:directory})];
  for(const server of servers)await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const bases=servers.map(server=>`http://127.0.0.1:${server.address().port}`);
  const post=(base,state,token)=>fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-ExploreOS-Revision':token}:{})},body:JSON.stringify(state)});
  try{
    assert.equal((await post(bases[0],makeState('无版本'),null)).status,428);
    const first=await (await post(bases[0],makeState('第一版'),'none')).json();
    const writes=await Promise.all(bases.map((base,i)=>post(base,makeState('同时保存 '+i),first.latest.revision)));
    assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
    const saved=await (await fetch(bases[0]+'/api/state')).json();
    assert.notEqual(saved.latest.revision,first.latest.revision);
    const stale=await post(bases[1],makeState('旧浏览器'),first.latest.revision);
    assert.equal(stale.status,409);
    assert.deepEqual((await stale.json()).latest.state,saved.latest.state);
    assert.equal((await post(bases[1],saved.latest.state,'outdated')).status,200,'Identical retries are harmless.');
    const after=await (await fetch(bases[0]+'/api/state')).json();
    assert.deepEqual(after.latest.state,saved.latest.state);
    assert.equal(after.history.length,2);
    assert.equal((await fetch(bases[0]+'/api/state?history=../exploreos-latest.json')).status,400);
  }finally{
    for(const server of servers)await new Promise(ok=>server.close(ok));
    if(!resolve(directory).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe test directory');
    await rm(directory,{recursive:true,force:true});
  }
});
