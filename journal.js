import {visibleItems} from './model.js';

// Filters only read confirmed, visible records; memory snapshots remain separate.
export function journalEntries(state,{query='',directionId='',kind='',from='',to=''}={}) {
  if(from&&to&&from>to)return [];
  const experiments=new Map(visibleItems(state,'experiments').map(item=>[item.id,item]));
  const directions=new Map(state.directions.map(item=>[item.id,item.name]));
  const needle=query.trim().toLocaleLowerCase();
  const entries=[
    ...visibleItems(state,'sessions').map(item=>({kind:'session',item})),
    ...visibleItems(state,'notes').map(item=>({kind:'note',item}))
  ];
  return entries.filter(entry=>{
    const {item}=entry,experiment=experiments.get(item.experimentId);
    const sourceDirection=entry.kind==='note'?item.directionId:experiment?.directionId;
    const day=item.date.slice(0,10);
    if(directionId&&sourceDirection!==directionId)return false;
    if(kind==='unfiled'?(entry.kind!=='note'||item.sessionId):kind&&kind!==entry.kind)return false;
    if((from&&day<from)||(to&&day>to))return false;
    const text=entry.kind==='note'?[item.text,directions.get(sourceDirection)]:[item.action,item.insight,...item.skills,experiment?.title,directions.get(sourceDirection)];
    return !needle||text.join(' ').toLocaleLowerCase().includes(needle);
  }).sort((a,b)=>b.item.date.localeCompare(a.item.date));
}
