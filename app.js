import {initialState,uid,statuses,summarize,makeMemory,validateState,visibleItems,trashItems,trashItem,restoreItem} from './model.js';

const KEY='exploreos.v1', DRAFT_KEY='exploreos.drafts.v1';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={directions:'方向',experiments:'实验',sessions:'探索记录',memories:'记忆卡',problems:'问题'};
const ratingLabels={feeling:'投入感',achievement:'成就感',again:'继续意愿'};
let state,view='map',directionFilter='',statusFilter='',query='',loadError=false,storedRaw=null;
let noticeTimer,editor=null,undo=null;
try{storedRaw=localStorage.getItem(KEY);state=storedRaw?validateState(JSON.parse(storedRaw)):initialState();if(!storedRaw){storedRaw=JSON.stringify(state);localStorage.setItem(KEY,storedRaw);}}
catch{state=initialState();loadError=true;}
const visible=collection=>visibleItems(state,collection);
const direction=id=>state.directions.find(item=>item.id===id)?.name??'';
const experiment=id=>state.experiments.find(item=>item.id===id);
const sessions=id=>visible('sessions').filter(item=>item.experimentId===id).sort((a,b)=>a.date.localeCompare(b.date));
const date=value=>new Date(value).toLocaleDateString('zh-CN');
const today=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;};
const number=value=>value===''?null:Number(value);
const matches=(...values)=>!query||values.join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase());
function notify(message,canUndo=false){
  $('#notice').innerHTML=`<span>${esc(message)}</span>${canUndo?'<button data-action="undo">撤销</button>':''}`;
  $('#notice').style.display='flex';clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>$('#notice').style.display='none',7000);
}
function save(next){
  if(loadError)throw Error('原有存储无法读取。请先在数据备份导出原始存储，再恢复有效备份。');
  if(localStorage.getItem(KEY)!==storedRaw)throw Error('另一个页面更新了记录。草稿已保留，请刷新后再保存，避免覆盖新内容。');
  validateState(next);const raw=JSON.stringify(next);
  try{localStorage.setItem(KEY,raw);}catch{throw Error('浏览器空间不足或禁止存储，本次没有保存。请先导出备份，再释放空间。');}
  storedRaw=raw;state=next;render();
}
function update(collection,item){save({...state,[collection]:state[collection].map(old=>old.id===item.id?item:old)});}
function put(collection,item,isEdit){if(isEdit)update(collection,item);else save({...state,[collection]:[...state[collection],item]});}
function navigate(next){view=next;directionFilter='';statusFilter='';query='';render();window.scrollTo({top:0});}
function timeText(list){const s=summarize(list);return s.timed?`${+(s.minutes/60).toFixed(1)} 小时${s.timed<s.count?'（部分未填时长）':''}`:'未记录时长';}
const button=(action,text,id='',cls='')=>`<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${text}</button>`;
const intro=(label,title,text,action='')=>`<section class="intro"><div class="eyebrow">${label}</div><div class="title-row"><h1>${title}</h1>${action}</div><p>${text}</p></section>`;
const empty=(title,text,action='')=>`<div class="empty"><span class="empty-symbol" aria-hidden="true">✧</span><h3>${title}</h3><p>${text}</p>${action}</div>`;
const tag=(text,muted=false)=>`<span class="tag ${muted?'muted':''}">${esc(text)}</span>`;
const options=(items,selected)=>items.map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');
function toolbar({directions=false,status=false,placeholder='搜索记录…'}={}){
  return `<div class="toolbar"><div class="search-field"><label class="sr-only" for="search">搜索</label><input type="search" id="search" value="${esc(query)}" placeholder="${placeholder}"></div>${directions?`<div><label class="sr-only" for="direction-filter">查看方向</label><select id="direction-filter">${options([['','全部方向'],...visible('directions').map(d=>[d.id,d.name])],directionFilter)}</select></div>`:''}${status?`<div><label class="sr-only" for="status-filter">实验状态</label><select id="status-filter">${options([['','全部状态'],...Object.entries(statuses)],statusFilter)}</select></div>`:''}</div>`;
}
function recordHTML(record,{editable=false,source=false}={}){
  return `<article class="record" data-record="${esc(record.id)}"><div class="meta">${esc(record.date)} · ${record.minutes===null?'未填时长':record.minutes+' 分钟'}${source?` · ${esc(experiment(record.experimentId)?.title)}`:''}</div><p>${esc(record.action)}</p>${record.insight?`<p class="insight">发现：${esc(record.insight)}</p>`:''}<div class="meta">${Object.entries(ratingLabels).filter(([key])=>record[key]!==null).map(([key,label])=>`${label} ${record[key]}/5`).join(' · ')}</div><div class="pill-row">${record.skills.map(skill=>tag(skill)).join('')}</div>${editable?`<div class="actions subtle">${button('edit-session','编辑记录',record.id)}${button('trash-sessions','移入回收站',record.id)}</div>`:''}</article>`;
}
function experimentCard(item){
  const list=sessions(item.id);
  return `<article class="card experiment-card" data-experiment="${esc(item.id)}"><div class="section-row"><h3>${esc(item.title)}</h3>${tag(statuses[item.status])}</div><div class="meta">${esc(direction(item.directionId))} · ${list.length} 条记录 · ${timeText(list)}${item.budget!==null?` · 参考预算 ${item.budget} 小时`:''}</div><p>想验证：${esc(item.hypothesis)||'还没有明确假设，也可以先看看。'}</p><div class="actions">${item.status==='active'?button('session','＋ 记录探索',item.id,'primary'):button('resume','重新开启',item.id)}${button('review','复盘与记忆卡',item.id)}${button('edit-experiment','编辑实验',item.id)}${item.status==='active'?button('hold','暂时放下',item.id):''}</div>${list.length?`<details><summary>回看 ${list.length} 条探索记录</summary>${list.map(s=>recordHTML(s,{editable:true})).join('')}</details>`:''}<div class="card-footer">${button('trash-experiments','移入回收站',item.id,'text-button')}</div></article>`;
}
function overview(){
  const dirs=visible('directions'),exps=visible('experiments'),logs=visible('sessions'),memories=visible('memories');
  const explored=dirs.filter(d=>exps.some(e=>e.directionId===d.id&&sessions(e.id).length)).length;
  let html=intro('YOUR OPEN WORLD','人生没有唯一主线。','跟着好奇走一小段，让每次尝试留下点什么。',button('experiment','＋ 开始一个小实验','','primary'));
  html+=`<section class="hero"><div><span class="eyebrow">NO EXPLORATION IS WASTED</span><h2>还不知道答案，也可以出发。</h2><p>这里收集你走过的路、意外的发现，以及那些「好像不适合我」的瞬间。想探索时再来，休息也很好。</p><div class="stats"><span><b>${explored}</b> 个方向留下足迹</span><span><b>${logs.length}</b> 次真实探索</span><span><b>${memories.length}</b> 张记忆卡</span></div></div><div class="orbit" aria-hidden="true"><span>✳</span></div></section>`;
  const active=exps.filter(e=>e.status==='active').slice(-2).reverse();
  if(active.length)html+=`<div class="section-row"><h2>想继续的时候，从这里出发</h2>${button('go-experiments','查看全部 →','','text-button')}</div><div class="continue-grid">${active.map(e=>`<article class="card compact-card"><div class="eyebrow">${esc(direction(e.directionId))}</div><h3>${esc(e.title)}</h3><div class="meta">${sessions(e.id).length} 次记录 · ${timeText(sessions(e.id))}</div><div class="actions">${button('session','＋ 记录探索',e.id,'primary')}${button('open-experiment','回看实验',e.id)}</div></article>`).join('')}</div>`;
  else if(!exps.length)html+=`<div class="start-note"><span>01 / 从一次小尝试开始</span><p>例如：花一点时间观察一个喜欢的产品，看看自己对哪个环节好奇。你只需要先记下想尝试什么。</p>${button('starter','用这个想法开始 →','','text-button')}</div>`;
  html+=`<div class="section-row"><h2>你的探索版图</h2><small>走过的方向，即使归档，也会保留足迹</small></div><div class="grid">`;
  const icons=['⌘','✳','✎','▷','⌁'];
  html+=dirs.map((d,i)=>{const list=exps.filter(e=>e.directionId===d.id),n=list.reduce((count,e)=>count+sessions(e.id).length,0);return `<article class="card direction" data-card-action="open-direction" data-id="${esc(d.id)}"><span class="symbol" aria-hidden="true">${icons[i%icons.length]}</span>${tag(n?'已留下足迹':'待探索',!n)}<button class="direction-open" data-action="open-direction" data-id="${esc(d.id)}"><h3>${esc(d.name)} ↗</h3></button><p>${n?`${n} 次探索 · ${list.length} 个小实验`:list.length?`${list.length} 个小实验，等一次真实的尝试。`:'一个可能的方向，等你好奇时走近。'}</p><div class="direction-actions">${button('edit-direction','编辑',d.id,'text-button')}</div></article>`;}).join('');
  html+=button('direction','＋ 留下一个新方向','','card quiet')+'</div>';
  const recent=[...logs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
  if(recent.length)html+=`<div class="section-row"><h2>最近留下的片段</h2>${button('go-journal','打开探索手记 →','','text-button')}</div><div class="card">${recent.map(s=>recordHTML(s,{source:true,editable:true})).join('')}</div>`;
  return html;
}
function experimentsPage(){
  const items=visible('experiments').filter(e=>(!directionFilter||e.directionId===directionFilter)&&(!statusFilter||e.status===statusFilter)&&matches(e.title,e.hypothesis,direction(e.directionId),...sessions(e.id).flatMap(s=>[s.action,s.insight,...s.skills]))).reverse();
  return intro('SMALL EXPERIMENTS','先试试看。','用一次小小的尝试，回答一个具体的问题。',button('experiment','＋ 新建实验','','primary'))+toolbar({directions:true,status:true,placeholder:'搜索实验、假设或探索内容…'})+`<div class="section-row"><h2>我的实验 <span class="count">${items.length}</span></h2><small>先尝试，再了解自己</small></div>`+(items.length?`<div class="stack">${items.map(experimentCard).join('')}</div>`:empty('这里还没有实验',query||directionFilter||statusFilter?'换个关键词或筛选条件看看。':'从一个具体问题开始，预算可以留空。'));
}
function journalPage(){
  const items=visible('sessions').filter(s=>(!directionFilter||experiment(s.experimentId)?.directionId===directionFilter)&&matches(s.action,s.insight,...s.skills,experiment(s.experimentId)?.title)).sort((a,b)=>b.date.localeCompare(a.date));
  return intro('EXPLORATION JOURNAL','那些亲自走过的片段。','做了什么、有什么感受，想起来时记一笔。',button('quick-session','＋ 记录探索','','primary'))+toolbar({directions:true,placeholder:'搜索做过的事、发现或技能…'})+`<p class="meta">${items.length} 条探索记录</p>`+(items.length?`<div class="card journal-list">${items.map(s=>recordHTML(s,{editable:true,source:true})).join('')}</div>`:empty('每一条真实经历，都值得留存','有一个小实验后，就可以在这里记录和回看。'));
}
function memoriesPage(){
  const items=visible('memories').filter(m=>matches(m.title,m.reflection,...m.sessions.flatMap(s=>[s.action,s.insight]))).reverse();
  return intro('MEMORY COLLECTION','走过，就有留下。','有些路会继续，有些路停在这里。它们都是你的一部分。')+toolbar({placeholder:'搜索记忆标题、感受或经历…'})+(items.length?`<div class="grid">${items.map(m=>`<article class="card memory"><span class="eyebrow">MEMORY CARD</span><h2>${esc(m.title)}</h2><div class="meta">${date(m.createdAt)} · ${timeText(m.sessions)}</div><p class="quote">${esc(m.reflection)}</p>${tag(statuses[m.decision])}<details><summary>这张记忆里的 ${m.sessions.length} 条记录</summary>${m.sessions.map(s=>recordHTML(s)).join('')}</details><div class="actions">${button('export-memory','导出为文字',m.id)}${button('trash-memories','移入回收站',m.id)}</div><p class="snapshot-note">复盘时的快照，后续编辑记录不会改写这张记忆。</p></article>`).join('')}</div>`:empty(query?'没有找到这段记忆':'第一张记忆，等你亲手留下',query?'换个关键词看看。':'做过一次探索后，在实验里复盘，就能收藏这段经历。'));
}
function skillsPage(){
  const skills=new Map();visible('sessions').forEach(s=>new Set(s.skills).forEach(k=>skills.set(k,[...(skills.get(k)||[]),s])));
  const items=[...skills].filter(([name])=>matches(name)).sort((a,b)=>b[1].length-a[1].length);
  return intro('GROWING CONNECTIONS','能力，从经历中长出来。','你亲自标记的技能线索，记录它们在哪里出现过。')+toolbar({placeholder:'查找一个技能…'})+(items.length?`<div class="grid">${items.map(([name,list])=>`<article class="card"><span class="eyebrow">✧ CAPABILITY</span><h2>${esc(name)}</h2><div class="skill-count">${list.length} <small>次接触</small></div><p>来自 ${new Set(list.map(s=>s.experimentId)).size} 个实验 · ${timeText(list)}</p><details><summary>查看来源</summary>${list.map(s=>recordHTML(s,{source:true})).join('')}</details></article>`).join('')}</div>`:empty('技能树还在萌芽','记录探索时，写下接触的技能；它们会在这里连接起来。'));
}
function problemsPage(){
  const items=visible('problems').filter(p=>matches(p.text,p.workaround)).reverse();
  return intro('A POCKET OF QUESTIONS','先收集问题，不急着找答案。','那些「为什么这么麻烦」的瞬间，也许是下次探索的起点。',button('problem','＋ 记下一个问题','','primary'))+toolbar({placeholder:'搜索问题或现有解决方式…'})+(items.length?`<div class="stack">${items.map(p=>`<article class="card problem-card"><div class="meta">${date(p.createdAt)}</div><h2>${esc(p.text)}</h2><p>${esc(p.workaround)||'还没有记录当前的解决方式。'}</p><div class="actions">${button('problem-experiment','变成小实验 →',p.id)}${button('edit-problem','编辑问题',p.id)}${button('trash-problems','移入回收站',p.id)}</div></article>`).join('')}</div>`:empty(query?'没有找到这个问题':'把一个生活里的小困惑装进口袋',query?'换个关键词看看。':'不用先想出解决方案，也不需要它能变成生意。'));
}
function backupPage(){
  const deleted=trashItems(state).sort((a,b)=>b.item.deletedAt.localeCompare(a.item.deletedAt));
  return intro('YOUR DATA','把走过的路，带在身边。','记录保存在这个浏览器中。你可以随时导出一份自己的副本。')+`<div class="card backup"><h2>备份与恢复</h2><p>导出包括所有方向、实验、探索、记忆和回收站。清理浏览器数据前，请保存一份副本。恢复会替换当前数据，操作前会先下载当前存储备份。</p><div class="actions">${button('export','↓ 导出 JSON','','primary')}${button('raw','导出原始存储')}</div><label for="import-file">从 JSON 恢复（支持 v0.1 备份）</label><input id="import-file" type="file" accept=".json,application/json"><p class="form-help">个人数据仅保存在此浏览器；草稿单独保存，不包含在 JSON 备份中。</p></div><div class="section-row"><h2>回收站 <span class="count">${deleted.length}</span></h2><small>记录暂存于此，随时可以恢复</small></div>${deleted.length?`<div class="stack">${deleted.map(({collection,item})=>`<article class="card trash-row"><div><div class="meta">${names[collection]} · ${date(item.deletedAt)}</div><h3>${esc(item.name||item.title||item.action||item.text)}</h3>${collection==='experiments'?'<p class="meta">恢复后，它的探索记录和记忆也会重新显示。</p>':''}</div>${button('restore-'+collection,'恢复',item.id)}</article>`).join('')}</div>`:empty('回收站是空的','移除的记录会暂存在这里，误操作也可以找回来。')}`;
}
function render(){
  document.querySelectorAll('[data-view]').forEach(b=>{const selected=b.dataset.view===view;b.classList.toggle('selected',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const pages={map:overview,experiments:experimentsPage,journal:journalPage,memories:memoriesPage,skills:skillsPage,problems:problemsPage,backup:backupPage};
  let html=pages[view]();
  if(loadError)html=`<div class="card error-banner"><p role="alert">原有存储无法读取，已暂停保存以保护数据。请先导出原始存储，再恢复有效备份。</p>${button('go-backup','打开数据备份')}</div>`+html;
  $('#content').innerHTML=html;
}

// Drafts are kept separately from confirmed exploration records.
function drafts(){try{const data=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}');return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch{return {};}}
function formValues(){return Object.fromEntries([...new FormData($('#form'))].map(([key,value])=>[key,value.trim()]));}
function cacheDraft(){
  if(!editor)return;
  try{const all=drafts();all[editor.key]=formValues();localStorage.setItem(DRAFT_KEY,JSON.stringify(all));$('#draft-status').textContent='草稿已保存在此浏览器';}
  catch{$('#draft-status').textContent='草稿暂时无法保存，请先完成记录';}
}
function clearDraft(){if(!editor)return;try{const all=drafts();delete all[editor.key];localStorage.setItem(DRAFT_KEY,JSON.stringify(all));}catch{/* Main data is saved independently. */}}
function modal(title,fields,handler,{values={},key=title}={}){
  $('#dialog-title').textContent=title;$('#fields').innerHTML=fields;$('#form-error').textContent='';
  editor={key,handler,base:storedRaw};const recovered=drafts()[key];
  for(const [name,value] of Object.entries(recovered||values)){
    const element=$('#form').elements.namedItem(name);
    if(element)element.value=Array.isArray(value)?value.join('，'):element.type==='date'&&typeof value==='string'?value.slice(0,10):value??'';
  }
  const extra=$('#fields details');if(extra&&recovered)extra.open=true;
  $('#draft-status').textContent=recovered?'已找回未完成的草稿':'填写内容会自动存为草稿';
  $('#dialog').showModal();
  $('#fields input, #fields textarea, #fields select')?.focus();
}
function field(name,label,type='text',required=false,placeholder=''){
  return `<label for="f-${name}">${label}</label>${type==='textarea'?`<textarea id="f-${name}" name="${name}" maxlength="20000" ${required?'required':''} placeholder="${esc(placeholder)}"></textarea>`:`<input id="f-${name}" name="${name}" type="${type}" ${required?'required':''} ${type==='number'?'min="0" max="1000000" step="any"':type==='date'?'':'maxlength="300"'} placeholder="${esc(placeholder)}">`}`;
}
const select=(name,label,items,selected='')=>`<label for="f-${name}">${label}</label><select name="${name}" id="f-${name}">${options(items,selected)}</select>`;
function experimentForm(item=null,prefill={}){
  if(!visible('directions').length){notify('先在地图上留下一个方向，再开始实验。');return;}
  modal(item?'编辑实验':'开始一个小实验',select('directionId','探索方向',visible('directions').map(d=>[d.id,d.name]))+field('title','这次想尝试什么？','text',true,'试着设计 ExploreOS 的核心体验')+field('hypothesis','你想验证的问题（可选）','textarea',false,'我可能更喜欢设计产品机制，而非纯实现。')+field('budget','参考预算 · 小时（可选）','number',false,'不设预算也可以')+'<p class="form-help">预算只是参考。随时暂停，没有需要凑满的时长。</p>',values=>{
    const next={...item,...values,budget:number(values.budget),id:item?.id??uid(),status:item?.status??'active',createdAt:item?.createdAt??new Date().toISOString()};
    put('experiments',next,!!item);
    if(!item){view='experiments';query='';statusFilter='';directionFilter='';render();}
  },{values:item||{directionId:directionFilter||visible('directions')[0].id,...prefill},key:item?'experiment:'+item.id:'experiment:new'});
}
function sessionForm(experimentId,item=null){
  const ratings=Object.entries(ratingLabels).map(([key,label])=>select(key,label+'（可选）',[['','暂不评分'],...Array.from({length:5},(_,i)=>[String(i+1),`${i+1} · ${i===0?'很低':i===4?'很高':'中间程度'}`])])).join('');
  const list=visible('experiments');
  if(!list.length){notify('先创建一个小实验，再留下一次探索。');experimentForm();return;}
  const choice=experimentId||item?.experimentId||list.find(e=>e.status==='active')?.id||list[0].id;
  const fields=select('experimentId','属于哪个实验？',list.map(e=>[e.id,e.title]))+field('date','日期','date',true)+field('action','今天做了什么？','textarea',true)+field('insight','感受与发现（可选）','textarea',false,'喜欢什么？不喜欢什么？也可以还不确定。')+`<details class="optional-fields" ${item?'open':''}><summary>补充时长、感受评分和技能（都可不填）</summary>${field('minutes','大约花了多久 · 分钟','number')}${ratings}${field('skills','接触的技能（用逗号分隔）','text',false,'原型设计，用户观察')}</details>`;
  modal(item?'编辑探索记录':'留下一次探索',fields,values=>{
    if(values.date>today())throw Error('这是一条已发生的探索，请选择今天或之前的日期。');
    const next={...item,...values,id:item?.id??uid(),minutes:number(values.minutes),feeling:number(values.feeling),achievement:number(values.achievement),again:number(values.again),skills:[...new Set(values.skills.split(/[,，]/).map(s=>s.trim()).filter(Boolean))]};
    put('sessions',next,!!item);
  },{values:item||{experimentId:choice,date:today()},key:item?'session:'+item.id:'session:new:'+choice});
}
function reviewForm(id){
  const list=sessions(id);
  if(!list.length){notify('先留下一次真实探索，再生成记忆卡。现在也可以暂时放下这个实验。');return;}
  const averages=Object.entries(ratingLabels).map(([key,label])=>{
    const rated=list.filter(s=>s[key]!==null);
    return `<div><span>${label}</span><strong>${rated.length?(rated.reduce((sum,s)=>sum+s[key],0)/rated.length).toFixed(1)+' / 5':'未评分'}</strong><small>${rated.length} 条评分</small></div>`;
  }).join('');
  modal('把这段经历，存成记忆',`<p class="form-help">回看 ${list.length} 条记录 · ${timeText(list)}。这些是你的记录摘要，决定仍由你做。</p><div class="review-stats">${averages}</div><details><summary>回看探索证据与感受</summary>${list.map(s=>recordHTML(s)).join('')}</details>`+field('reflection','你发现了什么？为什么做这个决定？','textarea',true,'什么让我想继续？什么还不确定？下次想改变什么？')+select('decision','接下来，我想',[['active','继续探索'],['hold','暂时放下'],['archived','归档这段经历']]),values=>{
    const memory=makeMemory(state,id,values.decision,values.reflection);
    save({...state,memories:[...state.memories,memory],experiments:state.experiments.map(e=>e.id===id?{...e,status:values.decision}:e)});
  },{values:{decision:experiment(id).status},key:'review:'+id});
}
function memoryText(memory){
  return `# ${memory.title}\n\n${date(memory.createdAt)} · ${statuses[memory.decision]} · ${timeText(memory.sessions)}\n\n${memory.reflection}\n\n## 探索证据\n\n${memory.sessions.map(s=>`### ${s.date}\n\n${s.action}\n\n${s.insight?'发现：'+s.insight+'\n\n':''}${s.skills.length?'技能线索：'+s.skills.join('、')+'\n':''}`).join('\n')}\n---\nNo Exploration Is Wasted.\n`;
}
function download(data,prefix,type='application/json',extension='json'){
  const url=URL.createObjectURL(new Blob([data],{type})),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`;
  anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function act(action,id){
  if(action.startsWith('go-')){navigate(action.slice(3));return;}
  if(action.startsWith('trash-')){const collection=action.slice(6);save(trashItem(state,collection,id));undo={collection,id};notify('已移入回收站，随时可以恢复。',true);return;}
  if(action.startsWith('restore-')){save(restoreItem(state,action.slice(8),id));notify('已恢复。');return;}
  if(action==='undo'){if(undo){save(restoreItem(state,undo.collection,undo.id));undo=null;notify('已撤销移除。');}return;}
  if(action==='open-direction'){navigate('experiments');directionFilter=id;render();return;}
  if(action==='open-experiment'){navigate('experiments');query=experiment(id).title;render();return;}
  if(action==='export'){download(JSON.stringify(state,null,2),'exploreos');return;}
  if(action==='raw'){download(localStorage.getItem(KEY)||'{}','exploreos-raw');return;}
  if(action==='export-memory'){download(memoryText(state.memories.find(m=>m.id===id)),'exploreos-memory','text/markdown;charset=utf-8','md');return;}
  if(action==='direction'||action==='edit-direction'){
    const item=action==='edit-direction'?state.directions.find(d=>d.id===id):null;
    modal(item?'编辑探索方向':'一个好奇的新方向',field('name','方向名称','text',true,'例如：摄影、身体、人与关系')+(item&&!state.experiments.some(e=>e.directionId===id)?`<div class="actions">${button('remove-direction','把这个空方向移入回收站',id,'text-button')}</div>`:''),values=>{
      if(visible('directions').some(d=>d.id!==item?.id&&d.name.toLocaleLowerCase()===values.name.toLocaleLowerCase()))throw Error('这个方向已经在地图上了。');
      put('directions',{...item,...values,id:item?.id??uid()},!!item);
    },{values:item||{},key:'direction:'+(item?.id??'new')});
  }
  if(action==='remove-direction'){save(trashItem(state,'directions',id));clearDraft();$('#dialog').close();notify('方向已移入回收站。');}
  if(action==='experiment'||action==='edit-experiment')experimentForm(action==='edit-experiment'?experiment(id):null);
  if(action==='starter')experimentForm(null,{title:'观察一个自己喜欢的产品',hypothesis:'了解它怎样解决一个真实问题，看看自己对哪个环节好奇。'});
  if(action==='problem-experiment'){const p=state.problems.find(p=>p.id===id);experimentForm(null,{title:p.text.slice(0,100),hypothesis:`我想进一步了解这个问题：${p.text}\n\n现有方式：${p.workaround||'还没记录'}`});}
  if(action==='session'||action==='quick-session'||action==='edit-session')sessionForm(action==='session'?id:null,action==='edit-session'?state.sessions.find(s=>s.id===id):null);
  if(action==='hold'||action==='resume'){update('experiments',{...experiment(id),status:action==='hold'?'hold':'active'});notify(action==='hold'?'已经暂放。想继续时，随时回来。':'已经重新开启。');}
  if(action==='review')reviewForm(id);
  if(action==='problem'||action==='edit-problem'){
    const item=action==='edit-problem'?state.problems.find(p=>p.id===id):null;
    modal(item?'编辑问题':'装进口袋的问题',field('text','你遇到了什么问题？','textarea',true)+field('workaround','现在怎么解决？哪里不满意？（可选）','textarea'),values=>put('problems',{...item,...values,id:item?.id??uid(),createdAt:item?.createdAt??new Date().toISOString()},!!item),{values:item||{},key:'problem:'+(item?.id??'new')});
  }
}
document.addEventListener('click',event=>{
  const b=event.target.closest('button');
  const card=event.target.closest('[data-card-action]');
  if(!b&&!card)return;
  try{if(b?.dataset.view)navigate(b.dataset.view);else if(b?.dataset.action)act(b.dataset.action,b.dataset.id);else if(card)act(card.dataset.cardAction,card.dataset.id);}
  catch(error){notify(error.message);}
});
$('#close-dialog').onclick=()=>{cacheDraft();$('#dialog').close();};
$('#dialog').addEventListener('cancel',()=>cacheDraft());
$('#dialog').addEventListener('close',()=>{editor=null;});
$('#discard-draft').onclick=()=>{clearDraft();$('#dialog').close();notify('已丢弃草稿，已有记录没有改变。');};
$('#form').addEventListener('input',cacheDraft);
$('#form').addEventListener('change',cacheDraft);
$('#form').onsubmit=event=>{
  event.preventDefault();
  try{
    if(editor.base!==storedRaw)throw Error('记录已在另一个页面更新，草稿已保留。请关闭并重新打开后核对。');
    editor.handler(formValues());clearDraft();$('#dialog').close();notify('已保存。每一段探索，都有留下。');
  }catch(error){$('#form-error').textContent=error.message;}
};
function searchInput(event){
  if(event.target.id!=='search'||event.isComposing)return;
  query=event.target.value;const cursor=event.target.selectionStart;render();$('#search').focus();
  try{$('#search').setSelectionRange(cursor,cursor);}catch{/* Some browsers do not expose a search selection. */}
}
document.addEventListener('input',searchInput);
document.addEventListener('compositionend',searchInput);
document.addEventListener('change',async event=>{
  if(event.target.id==='direction-filter'){directionFilter=event.target.value;render();}
  if(event.target.id==='status-filter'){statusFilter=event.target.value;render();}
  if(event.target.id!=='import-file')return;
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>10*1024*1024)throw Error('文件超过 10 MB，请选择有效的 ExploreOS 备份。');
    const next=validateState(JSON.parse(await file.text()));
    if(!confirm(`恢复包含 ${next.experiments.length} 个实验、${next.sessions.length} 条记录的备份？这会替换当前数据，并先下载当前存储副本。`))return;
    download(localStorage.getItem(KEY)||JSON.stringify(state),'exploreos-before-restore');
    const raw=JSON.stringify(next);localStorage.setItem(KEY,raw);storedRaw=raw;state=next;loadError=false;undo=null;render();notify('备份已恢复。');
  }catch(error){notify(error.message);}finally{event.target.value='';}
});
window.addEventListener('storage',event=>{
  if(event.key!==KEY)return;
  try{state=event.newValue?validateState(JSON.parse(event.newValue)):initialState();storedRaw=event.newValue;loadError=false;render();notify('已同步同一浏览器中另一个页面的记录。');}
  catch{loadError=true;render();notify('另一个页面的数据无法读取，已暂停保存。');}
});
render();
