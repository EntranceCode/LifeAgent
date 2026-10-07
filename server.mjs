import http from 'node:http';
import {copyFile, mkdir, readFile, rename, stat, writeFile, readdir, open, unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve, join} from 'node:path';
import {validateState} from './model.js';

const files={
  '/':['index.html','text/html'],
  '/index.html':['index.html','text/html'],
  '/styles.css':['styles.css','text/css'],
  '/app.js':['app.js','text/javascript'],
  '/model.js':['model.js','text/javascript'],
  '/guides.js':['guides.js','text/javascript'],
  '/journal.js':['journal.js','text/javascript']
};
const projectDir=fileURLToPath(new URL('.',import.meta.url));
const defaultDataDir=resolve(process.env.EXPLOREOS_DATA_DIR||join(projectDir,'data'));
const maxBody=10*1024*1024;
const revision=raw=>createHash('sha256').update(raw).digest('hex');
const historyName=/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{64}\.json$/;

function json(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
async function readBody(req){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBody)throw Object.assign(Error('Backup is larger than 10 MB.'),{status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function readSlot(path){
  try{
    const raw=await readFile(path,'utf8');
    const state=validateState(JSON.parse(raw));
    return {state,revision:revision(raw),modifiedAt:(await stat(path)).mtime.toISOString()};
  }catch(error){
    if(error.code==='ENOENT')return null;
    throw error;
  }
}
function allowedOrigin(req,server){
  if(!req.headers.origin)return true;
  const port=server.address()?.port;
  return req.headers.origin===`http://localhost:${port}`||req.headers.origin===`http://127.0.0.1:${port}`;
}

export function createExploreServer({dataDir=defaultDataDir}={}){
  const latestPath=join(dataDir,'exploreos-latest.json');
  const previousPath=join(dataDir,'exploreos-previous.json');
  const historyDir=join(dataDir,'history'),lockPath=join(dataDir,'.exploreos.lock');
  let operationQueue=Promise.resolve();
  // The shared lock also protects separate local servers using the same directory.
  async function locked(operation){
    await mkdir(dataDir,{recursive:true});
    let lock;
    for(let attempt=0;attempt<150;attempt++){
      try{lock=await open(lockPath,'wx');await lock.writeFile(String(process.pid));break;}
      catch(error){
        if(lock){await lock.close();await unlink(lockPath);throw error;}
        if(error.code!=='EEXIST')throw error;
        try{
          const owner=Number(await readFile(lockPath,'utf8'));
          if(Number.isInteger(owner)&&owner>0){
            try{process.kill(owner,0);}catch(dead){
              if(dead.code==='ESRCH'){await unlink(lockPath).catch(()=>{});continue;}
            }
          }
        }catch{}
        await new Promise(done=>setTimeout(done,20));
      }
    }
    if(!lock)throw Object.assign(Error('Local backup is busy. Please try again.'),{status:503});
    try{return await operation();}
    finally{await lock.close();await unlink(lockPath);}
  }
  function queued(operation){
    const result=operationQueue.catch(()=>{}).then(()=>locked(operation));
    operationQueue=result;
    return result;
  }
  async function history(){
    let entries;
    try{entries=await readdir(historyDir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    return entries.filter(name=>historyName.test(name)).sort().reverse().map(name=>({name,savedAt:name.slice(0,24).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,'T$1:$2:$3.$4Z')}));
  }
  async function snapshots(){
    return {latest:await readSlot(latestPath),previous:await readSlot(previousPath),history:await history()};
  }
  async function archive(raw,modifiedAt){
    await mkdir(historyDir,{recursive:true});
    const stamp=new Date(modifiedAt).toISOString().replace(/[:.]/g,'-');
    const path=join(historyDir,`${stamp}-${revision(raw)}.json`);
    try{if(await readFile(path,'utf8')===raw)return;}catch(error){if(error.code!=='ENOENT')throw error;}
    const temporary=join(historyDir,`.history-${process.pid}-${Date.now()}.tmp`);
    try{
      await writeFile(temporary,raw,{flag:'wx'});
      await rename(temporary,path);
    }finally{await unlink(temporary).catch(()=>{});}
  }
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/state'){
      if(!allowedOrigin(req,server)){json(res,403,{error:'Cross-origin backup request rejected.'});return;}
      if(req.method==='GET'){
        try{
          const name=url.searchParams.get('history');
          if(name&&!historyName.test(name)){json(res,400,{error:'Invalid history file.'});return;}
          const result=await queued(async()=>name?{snapshot:await readSlot(join(historyDir,name))}:snapshots());
          json(res,200,result);
        }
        catch{json(res,500,{error:'Unable to read the local backup.'});}
        return;
      }
      if(req.method==='POST'){
        try{
          const raw=await readBody(req);
          try{validateState(JSON.parse(raw));}catch{throw Object.assign(Error('Backup data is invalid.'),{status:400});}
          const write=async()=>{
            let old=null;
            try{old=await readFile(latestPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
            const expected=req.headers['x-exploreos-revision'];
            const current=old?revision(old):'none';
            if(expected===undefined)throw Object.assign(Error('Refresh ExploreOS before saving this backup.'),{status:428});
            if(old===raw)return {ok:true,...await snapshots()};
            if(expected!==current)return {conflict:true,...await snapshots()};
            if(old){
              await archive(old,(await stat(latestPath)).mtime.toISOString());
              await copyFile(latestPath,previousPath);
            }
            const temporary=join(dataDir,`.exploreos-${process.pid}-${Date.now()}.tmp`);
            try{
              await writeFile(temporary,raw,'utf8');
              await rename(temporary,latestPath);
            }finally{await unlink(temporary).catch(()=>{});}
            // Preserve every accepted version, including the first one.
            await archive(raw,(await stat(latestPath)).mtime.toISOString());
            return {ok:true,...await snapshots()};
          };
          const result=await queued(write);
          json(res,result.conflict?409:200,result);
        }catch(error){json(res,error.status||500,{error:error.status?error.message:'Unable to write the local backup.'});}
        return;
      }
      json(res,405,{error:'Method not allowed.'});return;
    }
    const entry=files[url.pathname];
    if(!entry){res.writeHead(404);res.end('Not found');return;}
    try{
      const body=await readFile(new URL(entry[0],import.meta.url));
      res.writeHead(200,{'Content-Type':entry[1]+'; charset=utf-8','Cache-Control':'no-store'});
      res.end(body);
    }catch{res.writeHead(500);res.end('Unable to read file');}
  });
  return server;
}

export function startExploreServer(port=Number(process.env.EXPLOREOS_PORT||4173)){
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('EXPLOREOS_PORT must be a valid port.');
  const server=createExploreServer();
  server.listen(port,'127.0.0.1',()=>console.log(`ExploreOS: http://localhost:${port}`));
  return server;
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)startExploreServer();
