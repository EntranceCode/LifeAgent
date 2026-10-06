import http from 'node:http';
import {copyFile, mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, join} from 'node:path';
import {validateState} from './model.js';

const files={
  '/':['index.html','text/html'],
  '/index.html':['index.html','text/html'],
  '/styles.css':['styles.css','text/css'],
  '/app.js':['app.js','text/javascript'],
  '/model.js':['model.js','text/javascript']
};
const projectDir=fileURLToPath(new URL('.',import.meta.url));
const defaultDataDir=resolve(process.env.EXPLOREOS_DATA_DIR||join(projectDir,'data'));
const maxBody=10*1024*1024;

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
    return {state,modifiedAt:(await stat(path)).mtime.toISOString()};
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
  let writeQueue=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/state'){
      if(!allowedOrigin(req,server)){json(res,403,{error:'Cross-origin backup request rejected.'});return;}
      if(req.method==='GET'){
        try{json(res,200,{latest:await readSlot(latestPath),previous:await readSlot(previousPath)});}
        catch{json(res,500,{error:'Unable to read the local backup.'});}
        return;
      }
      if(req.method==='POST'){
        try{
          const raw=await readBody(req);
          validateState(JSON.parse(raw));
          const write=async()=>{
            await mkdir(dataDir,{recursive:true});
            let old=null;
            try{old=await readFile(latestPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
            if(old&&old!==raw)await copyFile(latestPath,previousPath);
            const temporary=join(dataDir,`.exploreos-${process.pid}-${Date.now()}.tmp`);
            await writeFile(temporary,raw,'utf8');
            await rename(temporary,latestPath);
            return readSlot(latestPath);
          };
          writeQueue=writeQueue.catch(()=>{}).then(write);
          json(res,200,{ok:true,latest:await writeQueue});
        }catch(error){json(res,error.status||400,{error:error.status?error.message:'Backup data is invalid.'});}
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
