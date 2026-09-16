export const uid = () => crypto.randomUUID();
export const statuses = {active:'探索中',hold:'暂时放下',archived:'已归档'};
const collections = ['directions','experiments','sessions','memories','problems'];

export function initialState() {
  return {version:1,directions:['产品设计','AI 产品','写作','视频创作','技术服务'].map(name=>({id:uid(),name})),experiments:[],sessions:[],memories:[],problems:[]};
}

function checkCollection(collection) {
  if(!collections.includes(collection)) throw Error('无法识别这类记录。');
}

// Children remain stored while a parent is in the trash. Restoring the parent
// reveals them without changing separately deleted children or memory snapshots.
export function visibleItems(state,collection) {
  checkCollection(collection);
  const items=state[collection].filter(item=>!item.deletedAt);
  if(collection==='directions'||collection==='problems') return items;
  const directions=new Set(state.directions.filter(item=>!item.deletedAt).map(item=>item.id));
  if(collection==='experiments') return items.filter(item=>directions.has(item.directionId));
  const experiments=new Set(state.experiments.filter(item=>!item.deletedAt&&directions.has(item.directionId)).map(item=>item.id));
  return items.filter(item=>experiments.has(item.experimentId));
}

export function trashItems(state) {
  return collections.flatMap(collection=>state[collection].filter(item=>item.deletedAt).map(item=>({collection,item})));
}

export function trashItem(state,collection,id) {
  checkCollection(collection);
  const item=state[collection].find(item=>item.id===id);
  if(!item) throw Error('没有找到这条记录。');
  if(collection==='directions'&&state.experiments.some(experiment=>experiment.directionId===id)) {
    throw Error('这个方向下还有实验，暂时不能移入回收站。');
  }
  const deletedAt=item.deletedAt||new Date().toISOString();
  return {...state,[collection]:state[collection].map(item=>item.id===id?{...item,deletedAt}:item)};
}

export function restoreItem(state,collection,id) {
  checkCollection(collection);
  const item=state[collection].find(item=>item.id===id);
  if(!item) throw Error('没有找到这条记录。');
  const restoreIds=new Map([[collection,new Set([id])]]);
  let experiment;
  if(collection==='experiments') experiment=item;
  if(collection==='sessions'||collection==='memories') {
    experiment=state.experiments.find(experiment=>experiment.id===item.experimentId);
    if(!experiment) throw Error('找不到关联的实验，无法恢复这条记录。');
    restoreIds.set('experiments',new Set([experiment.id]));
  }
  if(experiment) {
    if(!state.directions.some(direction=>direction.id===experiment.directionId)) throw Error('找不到关联的方向，无法恢复这条记录。');
    restoreIds.set('directions',new Set([experiment.directionId]));
  }
  const next={...state};
  for(const [key,ids] of restoreIds) {
    next[key]=state[key].map(item=>{
      if(!ids.has(item.id)||!Object.hasOwn(item,'deletedAt')) return item;
      const {deletedAt,...restored}=item;
      return restored;
    });
  }
  return next;
}

export function summarize(sessions) {
  return {count:sessions.length, minutes:sessions.reduce((sum,s)=>sum+(s.minutes??0),0), timed:sessions.filter(s=>s.minutes!==null).length, insights:sessions.filter(s=>s.insight).map(s=>s.insight)};
}
export function makeMemory(state,experimentId,decision,reflection) {
  const e=visibleItems(state,'experiments').find(e=>e.id===experimentId);
  if(!e || !Object.hasOwn(statuses,decision) || typeof reflection!=='string' || !reflection.trim() || reflection.length>20000) throw Error('请填写复盘内容并选择有效决定。');
  const sessions=visibleItems(state,'sessions').filter(s=>s.experimentId===experimentId);
  if(!sessions.length) throw Error('先留下一次真实探索，再生成记忆卡。');
  return {id:uid(),experimentId,title:e.title,decision,reflection:reflection.trim(),sessions:structuredClone(sessions),createdAt:new Date().toISOString()};
}

function calendarDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year,month,day]=value.split('-').map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return year>=1&&month>=1&&month<=12&&day>=1&&day<=days[month-1];
}

function timestamp(value) {
  if(typeof value!=='string') return false;
  const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return !!match&&calendarDate(match[1])&&Number(match[2])<=23&&Number(match[3])<=59&&Number(match[4])<=59&&(!match[6]||(Number(match[6])<=23&&Number(match[7])<=59))&&Number.isFinite(Date.parse(value));
}

export function validateState(d) {
  const fail=()=>{throw Error('备份格式不正确或记录关联缺失，当前数据未被替换。');};
  const str=(v,max=20000)=>typeof v==='string'&&v.length<=max;
  const nonempty=v=>str(v,300)&&v.trim().length>0;
  const text=v=>str(v)&&v.trim().length>0;
  const date=v=>calendarDate(v)||timestamp(v);
  const deletion=v=>!Object.hasOwn(v,'deletedAt')||timestamp(v.deletedAt);
  const score=v=>v===null||(Number.isInteger(v)&&v>=1&&v<=5);
  const number=v=>v===null||(Number.isFinite(v)&&v>=0&&v<=1000000);
  if(!d||Array.isArray(d)||d.version!==1) fail();
  for(const key of collections) {
    if(!Array.isArray(d[key])||d[key].length>50000) fail();
    const ids=new Set();
    for(const item of d[key]) { if(!item||typeof item!=='object'||Array.isArray(item)||!nonempty(item.id)||ids.has(item.id)||!deletion(item)) fail(); ids.add(item.id); }
  }
  const dirs=new Set(d.directions.map(v=>v.id)), exps=new Set(d.experiments.map(v=>v.id));
  for(const v of d.directions) if(!nonempty(v.name)) fail();
  for(const v of d.experiments) if(!dirs.has(v.directionId)||!nonempty(v.title)||!str(v.hypothesis)||!number(v.budget)||!Object.hasOwn(statuses,v.status)||!date(v.createdAt)) fail();
  const session=v=>v&&typeof v==='object'&&!Array.isArray(v)&&nonempty(v.id)&&exps.has(v.experimentId)&&date(v.date)&&text(v.action)&&number(v.minutes)&&score(v.feeling)&&score(v.achievement)&&score(v.again)&&str(v.insight)&&Array.isArray(v.skills)&&v.skills.length<=100&&v.skills.every(nonempty)&&deletion(v);
  for(const v of d.sessions) if(!session(v)) fail();
  for(const v of d.memories) {
    if(!exps.has(v.experimentId)||!nonempty(v.title)||!Object.hasOwn(statuses,v.decision)||!text(v.reflection)||!date(v.createdAt)||!Array.isArray(v.sessions)||!v.sessions.length||v.sessions.length>50000||!v.sessions.every(s=>session(s)&&s.experimentId===v.experimentId)) fail();
    if(new Set(v.sessions.map(session=>session.id)).size!==v.sessions.length) fail();
  }
  for(const v of d.problems) if(!text(v.text)||!str(v.workaround)||!date(v.createdAt)) fail();
  return d;
}
