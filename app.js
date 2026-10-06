import {initialState,uid,statuses,summarize,makeMemory,validateState,visibleItems,trashItems,trashItem,restoreItem,attachNote} from './model.js';
import {guidePool,sampleDirections} from './guides.js';

const KEY='exploreos.v1', LEGACY_KEYS=['exploreos.v2','exploreos.v0.2'], DRAFT_KEY='exploreos.drafts.v1', DISK_BASE_KEY='exploreos.disk-base.v1';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={directions:'方向',experiments:'实验',sessions:'探索记录',memories:'记忆卡',problems:'问题',notes:'随手记'};
const ratingLabels={feeling:'投入感',achievement:'成就感',again:'继续意愿'};
let state,view='map',directionFilter='',statusFilter='',query='',loadError=false,storedRaw=null,legacySource='';
let noticeTimer,editor=null,undo=null,guideIndex=0,currentGuide=null;
let guidePrefs={energy:'normal',minutes:'60',mode:'discover',directionId:''};
let diskBackup={status:'checking',latest:null,previous:null,error:''},diskWrite=Promise.resolve(),diskReady=Promise.resolve(),diskBase='unknown';
const activityScore=data=>data.experiments.length+data.sessions.length+data.memories.length+data.problems.length+(data.notes||[]).length;
const pristine=data=>activityScore(data)===0&&!(data.guideFeedback||[]).length&&data.directions.length===5&&['产品设计','AI 产品','写作','视频创作','技术服务'].every((name,i)=>data.directions[i].name===name&&!data.directions[i].deletedAt);
try{
  diskBase=localStorage.getItem(DISK_BASE_KEY)||'unknown';
  storedRaw=localStorage.getItem(KEY);
  // Preserve an unreadable primary record for export before any recovery.
  if(storedRaw!==null)validateState(JSON.parse(storedRaw));
  const candidates=[KEY,...LEGACY_KEYS].map(key=>({key,raw:localStorage.getItem(key)})).filter(item=>item.raw).flatMap(item=>{
    try{return [{...item,data:validateState(JSON.parse(item.raw))}];}catch{return [];}
  });
  const primary=candidates.find(item=>item.key===KEY);
  const legacy=candidates.filter(item=>item.key!==KEY).sort((a,b)=>activityScore(b.data)-activityScore(a.data))[0];
  const chosen=!primary||(pristine(primary.data)&&legacy&&activityScore(legacy.data)>0)?legacy:primary;
  if(chosen){
    storedRaw=chosen.raw;state=chosen.data;
    if(chosen.key!==KEY){localStorage.setItem(KEY,storedRaw);legacySource=chosen.key;}
  }else{
    state=initialState();storedRaw=JSON.stringify(state);
    localStorage.setItem(KEY,storedRaw);
  }
}
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
const sameState=(a,b)=>!!a&&!!b&&JSON.stringify(a)===JSON.stringify(b);
const backupCounts=data=>`${data.directions.length} 个方向 · ${data.experiments.length} 个实验 · ${data.sessions.length} 条记录 · ${(data.notes||[]).length} 条随手记 · ${data.memories.length} 张记忆卡`;
const needsDiskRecovery=()=>activityScore(state)===0&&diskBackup.latest&&activityScore(diskBackup.latest.state)>0;
function acceptDiskPayload(payload,status){
  const latest=payload.latest?{...payload.latest,state:validateState(payload.latest.state)}:null;
  const previous=payload.previous?{...payload.previous,state:validateState(payload.previous.state)}:null;
  diskBackup={status:status||(latest?(sameState(latest.state,state)?'synced':'different'):'missing'),latest,previous,history:payload.history||[],error:''};
  return latest;
}
function rememberDiskBase(value){
  diskBase=value;
  try{localStorage.setItem(DISK_BASE_KEY,value);}catch{}
}
async function inspectDiskBackup(){
  try{
    const response=await fetch('/api/state',{cache:'no-store'});
    if(!response.ok)throw Error('本机备份服务暂时不可用。');
    const latest=acceptDiskPayload(await response.json());
    if(!latest)rememberDiskBase('none');
    else if(sameState(latest.state,state))rememberDiskBase(latest.revision);
    if(!latest&&!loadError&&activityScore(state)>0)void mirrorToDisk(storedRaw);
    render();
  }catch(error){
    diskBackup={...diskBackup,status:'unavailable',error:error.message};
    render();
  }
}
function mirrorToDisk(raw,{announce=false,expected=null}={}){
  diskWrite=diskWrite.catch(()=>{}).then(async()=>{
    await diskReady;
    const response=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json','X-ExploreOS-Revision':expected||diskBase},body:raw});
    const payload=await response.json();
    if(response.status===409){
      acceptDiskPayload(payload,'conflict');
      diskBackup.error='本机已有不同版本，已阻止覆盖。浏览器中的记录仍保留，请在这里选择恢复本机副本，或确认用浏览器副本更新。';
      render();notify('本机备份发生版本冲突，两份记录都已保留。请打开数据备份核对。');
      return;
    }
    if(!response.ok)throw Error(response.status===428?'请刷新页面后重试；如果仍失败，请重启本地服务。':'本机备份写入失败，请稍后重试或先导出 JSON。');
    const latest=acceptDiskPayload(payload);
    rememberDiskBase(latest.revision);
    if(!sameState(latest.state,state))diskBackup.status='pending';
    render();
    if(announce)notify('已保存到本机备份。');
  }).catch(error=>{
    diskBackup={...diskBackup,status:'unavailable',error:error.message};
    render();
    notify('浏览器记录已保留，但本机备份失败：'+error.message);
  });
  return diskWrite;
}
async function syncDiskManually(){
  if(loadError){notify('请先导出原始存储，再恢复有效备份。');return;}
  await diskWrite;
  const response=await fetch('/api/state',{cache:'no-store'});
  if(!response.ok)throw Error('无法检查本机备份，请稍后再试。');
  const latest=acceptDiskPayload(await response.json());
  const raw=storedRaw;
  if(latest&&!sameState(latest.state,state)){
    if(!confirm('本机副本和浏览器副本不同。确认用当前浏览器记录更新本机备份？更新前会下载本机副本，并保留历史版本。')){render();return;}
    download(JSON.stringify(latest.state,null,2),'exploreos-disk-before-update');
  }
  await mirrorToDisk(raw,{announce:true,expected:latest?.revision||'none'});
}
async function restoreHistory(name){
  const response=await fetch('/api/state?history='+encodeURIComponent(name),{cache:'no-store'});
  if(!response.ok)throw Error('无法读取这份历史备份。');
  const payload=await response.json();
  if(!payload.snapshot)throw Error('这份历史备份不存在。');
  diskBackup.historyRestore={...payload.snapshot,state:validateState(payload.snapshot.state)};
  restoreDisk('historyRestore');
}
function save(next){
  if(loadError)throw Error('原有存储无法读取。请先在数据备份导出原始存储，再恢复有效备份。');
  if(localStorage.getItem(KEY)!==storedRaw)throw Error('另一个页面更新了记录。草稿已保留，请刷新后再保存，避免覆盖新内容。');
  validateState(next);const raw=JSON.stringify(next);
  try{localStorage.setItem(KEY,raw);}catch{throw Error('浏览器空间不足或禁止存储，本次没有保存。请先导出备份，再释放空间。');}
  storedRaw=raw;state=next;diskBackup.status='pending';render();void mirrorToDisk(raw);
}
function update(collection,item){save({...state,[collection]:state[collection].map(old=>old.id===item.id?item:old)});}
function put(collection,item,isEdit){if(isEdit)update(collection,item);else save({...state,[collection]:[...(state[collection]||[]),item]});}
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
function guideDirection(){
  const dirs=visible('directions');
  const chosen=dirs.find(d=>d.id===guidePrefs.directionId);
  if(chosen)return chosen;
  return [...dirs].sort((a,b)=>{
    const count=d=>visible('experiments').filter(e=>e.directionId===d.id).reduce((sum,e)=>sum+sessions(e.id).length,0);
    return count(a)-count(b);
  })[0]||null;
}
function buildGuide(){
  const focus=guideDirection();
  const focusName=guidePrefs.directionId.startsWith('sample:')?guidePrefs.directionId.slice(7):focus?.name||'一个新方向';
  const pool=guidePool(focusName,guidePrefs.minutes,guidePrefs.mode);
  const feedback=new Map((state.guideFeedback||[]).map(item=>[item.guideKey,item.value]));
  const available=pool.filter(item=>!['later','tried'].includes(feedback.get(item.guideKey)))
    .sort((a,b)=>Number(feedback.get(b.guideKey)==='interested')-Number(feedback.get(a.guideKey)==='interested'));
  if(!available.length)return null;
  const idea=available[guideIndex%available.length];
  const low=guidePrefs.energy==='low',high=guidePrefs.energy==='high';
  return {...idea,directionId:guidePrefs.directionId.startsWith('sample:')?'':focus?.id||'',focusName,
    hypothesis:`这次接触「${focusName}」后，我是否愿意继续了解或再试一次？`,
    why:guidePrefs.directionId?`你主动选择了「${focusName}」，先用一次具体体验了解它。`:`「${focusName}」留下的探索较少，可以先用小成本走近。`,
    feedback:feedback.get(idea.guideKey),
    exit:low?'先做10分钟；如果仍然抗拒，就停下。记下“不想继续”也算完成。':'做到一半仍没有好奇，就停下，并记下原因。',
    stretch:high?'精力还有余量时：重复一次体验或找人聊一句反馈，不必用满时间。':''
  };
}
function guidePage(){
  currentGuide=buildGuide();
  const energies=[['low','很少，只想迈一步'],['normal','一般，可以专注一下'],['high','不错，想多走一点']];
  const times=[['15','15 分钟'],['60','1 小时'],['180','3 小时']];
  const modes=[['discover','先看见新东西'],['talk','去和人聊一聊'],['make','亲手做点东西']];
  const dirs=[['','帮我选择'],...visible('directions').map(d=>[d.id,d.name]),...sampleDirections.filter(name=>!visible('directions').some(d=>d.name===name)).map(name=>['sample:'+name,'新接触：'+name])];
  const g=currentGuide;
  return intro('GUIDED EXPLORATION','不知道往哪走时，先走一小步。','你不需要先找到方向。告诉我今天的状态，ExploreOS 会从现有版图中给出一个低压力的小探索。')+
    `<section class="guide-controls" aria-label="探索偏好">
      <label>今天的精力<select data-guide-pref="energy">${options(energies,guidePrefs.energy)}</select></label>
      <label>可以留出的时间<select data-guide-pref="minutes">${options(times,guidePrefs.minutes)}</select></label>
      <label>更想怎样接触<select data-guide-pref="mode">${options(modes,guidePrefs.mode)}</select></label>
      <label>想靠近的方向<select data-guide-pref="directionId">${options(dirs,guidePrefs.directionId)}</select></label>
    </section>
    ${g?`<article class="card guide-card" aria-live="polite">
      <div class="guide-kicker"><span>给你的下一小步</span>${tag(g.focusName)}</div>
      <h2>${esc(g.title)}</h2>
      <p class="guide-summary">${esc(g.summary)}</p>
      <div class="guide-why"><strong>为什么是它</strong><p>${esc(g.why)}</p></div>
      <div class="guide-details">
        <div><span class="eyebrow">预计投入</span><strong>${esc(times.find(([v])=>v===guidePrefs.minutes)[1])}</strong></div>
        <div><span class="eyebrow">想验证</span><strong>${esc(g.hypothesis)}</strong></div>
      </div>
      <ol class="guide-steps">${g.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol>
      <div class="guide-outcomes"><p><strong>做到这里就够了：</strong>${esc(g.completion)}</p><p><strong>允许退出：</strong>${esc(g.exit)}</p>${g.stretch?`<p><strong>可选加一步：</strong>${esc(g.stretch)}</p>`:''}</div>
      <div class="actions">${button('guide-experiment','保存为小实验','','primary')}${button('guide-next','换一个')}${button('guide-problem','先放进问题口袋','','text-button')}</div>
      <div class="guide-feedback" aria-label="这条建议的反馈">
        <span>${g.feedback==='interested'?'已标记感兴趣；随时可以换想法。':'这一步适合现在的你吗？'}</span>
        ${button('guide-interested','感兴趣')}${button('guide-later','暂时不想')}${button('guide-tried','已经试过')}
      </div>
    </article>`:empty('这一组建议已经看过了','可以换个方向、时间或接触方式，也可以重新看看之前的建议。',button('guide-reset','重新看看这一组'))}
    <p class="guide-note">建议根据方向、时间与接触方式整理。浏览和换一个不会写入记录；点击反馈或确认保存后才会留下。</p>`;
}
function overview(){
  const dirs=visible('directions'),exps=visible('experiments'),logs=visible('sessions'),memories=visible('memories');
  const explored=dirs.filter(d=>exps.some(e=>e.directionId===d.id&&sessions(e.id).length)).length;
  let html=intro('YOUR OPEN WORLD','人生没有唯一主线。','跟着好奇走一小段，让每次尝试留下点什么。',`<div class="title-actions">${button('go-guide','✦ 带我去看看','','primary')}${button('note','＋ 随手记')}${button('experiment','自己开始实验')}</div>`);
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
  const recentNotes=visible('notes').slice(-3).reverse();
  if(recentNotes.length)html+=`<div class="section-row"><h2>最近的随手记</h2>${button('go-journal','打开探索手记 →','','text-button')}</div><div class="card">${recentNotes.map(noteHTML).join('')}</div>`;
  return html;
}
function experimentsPage(){
  const items=visible('experiments').filter(e=>(!directionFilter||e.directionId===directionFilter)&&(!statusFilter||e.status===statusFilter)&&matches(e.title,e.hypothesis,direction(e.directionId),...sessions(e.id).flatMap(s=>[s.action,s.insight,...s.skills]))).reverse();
  return intro('SMALL EXPERIMENTS','先试试看。','用一次小小的尝试，回答一个具体的问题。',button('experiment','＋ 新建实验','','primary'))+toolbar({directions:true,status:true,placeholder:'搜索实验、假设或探索内容…'})+`<div class="section-row"><h2>我的实验 <span class="count">${items.length}</span></h2><small>先尝试，再了解自己</small></div>`+(items.length?`<div class="stack">${items.map(experimentCard).join('')}</div>`:empty('这里还没有实验',query||directionFilter||statusFilter?'换个关键词或筛选条件看看。':'从一个具体问题开始，预算可以留空。'));
}
function noteHTML(item){
  return `<article class="record quick-note" data-note="${esc(item.id)}"><div class="meta">${esc(item.date)} · 随手记${item.directionId?' · '+esc(direction(item.directionId)):''}${item.sessionId?' · 已整理为探索记录':''}</div><p>${esc(item.text)}</p><div class="actions subtle">${button('edit-note','编辑',item.id)}${!item.sessionId?button('attach-note','整理到实验',item.id):''}${button('trash-notes','移入回收站',item.id)}</div></article>`;
}
function journalPage(){
  const items=visible('sessions').filter(s=>(!directionFilter||experiment(s.experimentId)?.directionId===directionFilter)&&matches(s.action,s.insight,...s.skills,experiment(s.experimentId)?.title)).map(item=>({kind:'session',item}));
  const notes=visible('notes').filter(n=>(!directionFilter||n.directionId===directionFilter)&&matches(n.text,direction(n.directionId))).map(item=>({kind:'note',item}));
  const list=[...items,...notes].sort((a,b)=>b.item.date.localeCompare(a.item.date));
  return intro('EXPLORATION JOURNAL','那些亲自走过的片段。','看见、听到、试过，先记一句话，之后再整理。',`<div class="title-actions">${button('note','＋ 随手记','','primary')}${button('quick-session','记录到实验')}</div>`)+toolbar({directions:true,placeholder:'搜索随手记、做过的事或发现…'})+`<p class="meta">${notes.length} 条随手记 · ${items.length} 条探索记录</p>`+(list.length?`<div class="card journal-list">${list.map(({kind,item})=>kind==='note'?noteHTML(item):recordHTML(item,{editable:true,source:true})).join('')}</div>`:empty('一句话，也可以留下','不用先建立方向或实验，记录今天的一次好奇就够了。',button('note','写下第一句')));
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
  const diskLabel={checking:'正在检查',missing:'尚未建立',synced:'已同步',pending:'等待本机保存',different:'发现另一份',conflict:'版本冲突',unavailable:'暂时不可用'}[diskBackup.status]||'未知';
  const history=diskBackup.history||[];
  const diskCard=`<div class="card backup disk-backup"><div class="section-row"><h2>本机自动备份</h2>${tag(diskLabel,['unavailable','conflict'].includes(diskBackup.status))}</div><p>确认保存后同步写入本机；每个版本按日期留在 <code>data/history/</code> 中，不自动清理。版本不同会先阻止覆盖。</p>${diskBackup.latest?`<div class="backup-slot"><strong>最近本机保存</strong><span>${esc(backupCounts(diskBackup.latest.state))}</span><small>${new Date(diskBackup.latest.modifiedAt).toLocaleString('zh-CN')}</small></div>`:''}${diskBackup.previous?`<div class="backup-slot"><strong>上一版</strong><span>${esc(backupCounts(diskBackup.previous.state))}</span><small>${new Date(diskBackup.previous.modifiedAt).toLocaleString('zh-CN')}</small></div>`:''}${diskBackup.error?`<p class="backup-error" role="alert">${esc(diskBackup.error)}</p>`:''}<div class="actions">${button('sync-disk','用当前数据更新本机备份','','primary')}${diskBackup.latest&&!sameState(diskBackup.latest.state,state)?button('restore-disk-latest','恢复最新本机副本'):''}${diskBackup.previous?button('restore-disk-previous','恢复上一版'):''}</div>${history.length?`<details class="history-list"><summary>历史备份 · ${history.length} 个版本</summary>${history.map(item=>`<div class="backup-slot"><strong>${esc(new Date(item.savedAt).toLocaleString('zh-CN'))}</strong><span>独立保留的历史副本</span>${button('restore-history','恢复这一版',item.name)}</div>`).join('')}</details>`:'<p class="form-help">下一次本机保存成功后，会建立历史副本。</p>'}<p class="form-help">历史副本位于这台电脑。仍建议定期导出 JSON 到其他位置。</p></div>`;
  return intro('YOUR DATA','把走过的路，带在身边。','记录同时保存在浏览器和本机项目目录中，也可以随时导出独立副本。')+diskCard+`<div class="card backup"><h2>导出与导入</h2><p>导出包括所有方向、实验、探索、随手记、建议反馈、记忆和回收站。恢复会替换当前浏览器数据，操作前会先下载当前副本。</p><div class="actions">${button('export','↓ 导出 JSON','','primary')}${button('raw','导出原始存储')}</div><label for="import-file">从 JSON 恢复（支持 v0.1 备份）</label><input id="import-file" type="file" accept=".json,application/json"><p class="form-help">草稿单独保存在浏览器中，不包含在 JSON 和本机自动备份中。</p></div><div class="section-row"><h2>回收站 <span class="count">${deleted.length}</span></h2><small>记录暂存于此，随时可以恢复</small></div>${deleted.length?`<div class="stack">${deleted.map(({collection,item})=>`<article class="card trash-row"><div><div class="meta">${names[collection]} · ${date(item.deletedAt)}</div><h3>${esc(item.name||item.title||item.action||item.text)}</h3>${collection==='experiments'?'<p class="meta">恢复后，它的探索记录和记忆也会重新显示。</p>':''}</div>${button('restore-'+collection,'恢复',item.id)}</article>`).join('')}</div>`:empty('回收站是空的','移除的记录会暂存在这里，误操作也可以找回来。')}`;
}
function render(){
  const localStatus={checking:'正在检查本机备份',missing:'浏览器已保存 · 本机尚无副本',synced:'本机已保存'+(diskBackup.latest?' · '+new Date(diskBackup.latest.modifiedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):''),pending:'浏览器已保存 · 本机同步中',different:'浏览器与本机副本不同',conflict:'浏览器已保存 · 本机版本冲突',unavailable:'浏览器保存 · 本机备份不可用'};
  $('.local-dot').textContent=loadError?'存储异常 · 已暂停保存':localStatus[diskBackup.status];
  document.querySelectorAll('[data-view]').forEach(b=>{const selected=b.dataset.view===view;b.classList.toggle('selected',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const pages={map:overview,guide:guidePage,experiments:experimentsPage,journal:journalPage,memories:memoriesPage,skills:skillsPage,problems:problemsPage,backup:backupPage};
  let html=pages[view]();
  if(needsDiskRecovery())html=`<div class="card recovery-banner"><p role="status">浏览器里暂时没有探索记录，但找到一份本机备份：${esc(backupCounts(diskBackup.latest.state))}</p>${button('restore-disk-latest','恢复本机备份')}</div>`+html;
  if(view!=='backup'&&['conflict','unavailable'].includes(diskBackup.status))html=`<div class="card error-banner"><p role="status">${esc(diskBackup.error||'本机备份暂时不可用。')}</p>${button('go-backup','打开数据备份')}</div>`+html;
  if(legacySource)html=`<div class="card recovery-banner"><p role="status">已从旧版存储 <strong>${esc(legacySource)}</strong> 恢复记录。旧版原件仍保留在浏览器中。</p>${button('go-backup','立即导出一份备份')}</div>`+html;
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
  if(!visible('directions').length&&!prefill.directionName){notify('先在地图上留下一个方向，再开始实验。');return;}
  modal(item?'编辑实验':'开始一个小实验',select('directionId','探索方向',[...(prefill.directionName?[['','新方向：'+prefill.directionName]]:[]),...visible('directions').map(d=>[d.id,d.name])])+field('title','这次想尝试什么？','text',true,'试着设计 ExploreOS 的核心体验')+field('hypothesis','你想验证的问题（可选）','textarea',false,'我可能更喜欢设计产品机制，而非纯实现。')+field('budget','参考预算 · 小时（可选）','number',false,'不设预算也可以')+'<p class="form-help">预算只是参考。随时暂停，没有需要凑满的时长。</p>',values=>{
    const next={...item,...values,budget:number(values.budget),id:item?.id??uid(),status:item?.status??'active',createdAt:item?.createdAt??new Date().toISOString()};
    if(!next.directionId&&prefill.directionName){
      const existing=visible('directions').find(d=>d.name===prefill.directionName);
      const added=existing||{id:uid(),name:prefill.directionName};
      next.directionId=added.id;
      save({...state,directions:existing?state.directions:[...state.directions,added],experiments:[...state.experiments,next]});
    }else put('experiments',next,!!item);
    if(!item){view='experiments';query='';statusFilter='';directionFilter='';render();}
  },{values:item||{directionId:directionFilter||visible('directions')[0]?.id||'',...prefill},key:item?'experiment:'+item.id:'experiment:new'});
}
function problemForm(item=null,prefill={}){
  modal(item?'编辑问题':'装进口袋的问题',field('text','你遇到了什么问题？','textarea',true)+field('workaround','现在怎么解决？哪里不满意？（可选）','textarea'),values=>put('problems',{...item,...values,id:item?.id??uid(),createdAt:item?.createdAt??new Date().toISOString()},!!item),{values:item||prefill,key:'problem:'+(item?.id??'new')});
}
function noteForm(item=null){
  modal(item?'编辑随手记':'随手记一句',field('text','想留下什么？','textarea',true,'看了一段访谈，发现自己对……好奇。')+`<details class="optional-fields"><summary>补充日期和方向（可选）</summary>${field('date','日期','date',true)}${select('directionId','先归到一个方向',[['','暂不归类'],...visible('directions').map(d=>[d.id,d.name])])}</details>`,values=>{
    if(values.date>today())throw Error('请选择今天或之前的日期。');
    const now=new Date().toISOString();
    put('notes',{...item,id:item?.id||uid(),text:values.text,date:values.date,directionId:values.directionId||null,sessionId:item?.sessionId||null,createdAt:item?.createdAt||now,updatedAt:now},!!item);
  },{values:item||{date:today(),directionId:directionFilter},key:'note:'+(item?.id||'new')});
}
function attachNoteForm(id){
  const list=visible('experiments');
  if(!list.length){notify('这句话已经保留。建立一个实验后，就可以整理过去。');return;}
  modal('把随手记整理到实验',`<p class="form-help">原随手记会保留；同时新增一条探索记录，不会把未知时长或评分填成零。</p>`+select('experimentId','选择实验',list.map(e=>[e.id,e.title])),values=>save(attachNote(state,id,values.experimentId)),{key:'attach-note:'+id});
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
function restoreDisk(slotName){
  if(editor){notify('请先保存或关闭正在编辑的草稿，再恢复备份。');return;}
  const snapshot=diskBackup[slotName];
  if(!snapshot){notify('没有找到这份本机备份。');return;}
  const next=validateState(structuredClone(snapshot.state));
  if(!confirm(`恢复本机备份中的 ${next.experiments.length} 个实验、${next.sessions.length} 条记录？当前浏览器数据会先下载一份副本。`))return;
  download(localStorage.getItem(KEY)||JSON.stringify(state),'exploreos-before-disk-restore');
  const raw=JSON.stringify(next);
  localStorage.setItem(KEY,raw);storedRaw=raw;state=next;loadError=false;undo=null;
  rememberDiskBase(diskBackup.latest?.revision||'none');
  diskBackup.status='pending';
  render();void mirrorToDisk(raw);notify('已从本机备份恢复。');
}
function act(action,id){
  if(action==='note'||action==='edit-note'){noteForm(action==='edit-note'?state.notes.find(n=>n.id===id):null);return;}
  if(action==='attach-note'){attachNoteForm(id);return;}
  if(['guide-interested','guide-later','guide-tried'].includes(action)&&currentGuide){
    const value=action.slice(6),guideKey=currentGuide.guideKey;
    save({...state,guideFeedback:[...(state.guideFeedback||[]).filter(f=>f.guideKey!==guideKey),{guideKey,value,createdAt:new Date().toISOString()}]});
    notify(value==='interested'?'已记住这份好奇。':'已记住，先看看别的建议。');return;
  }
  if(action==='guide-reset'){
    const focus=guidePrefs.directionId.startsWith('sample:')?guidePrefs.directionId.slice(7):guideDirection()?.name||'一个新方向';
    const keys=new Set(guidePool(focus,guidePrefs.minutes,guidePrefs.mode).map(g=>g.guideKey));
    save({...state,guideFeedback:(state.guideFeedback||[]).filter(f=>!keys.has(f.guideKey))});return;
  }
  if(action==='sync-disk'){void syncDiskManually().catch(error=>notify(error.message));return;}
  if(action==='restore-history'){void restoreHistory(id).catch(error=>notify(error.message));return;}
  if(action==='restore-disk-latest'){restoreDisk('latest');return;}
  if(action==='restore-disk-previous'){restoreDisk('previous');return;}
  if(action.startsWith('go-')){navigate(action.slice(3));return;}
  if(action.startsWith('trash-')){const collection=action.slice(6);save(trashItem(state,collection,id));undo={collection,id};notify('已移入回收站，随时可以恢复。',true);return;}
  if(action.startsWith('restore-')){save(restoreItem(state,action.slice(8),id));notify('已恢复。');return;}
  if(action==='undo'){if(undo){save(restoreItem(state,undo.collection,undo.id));undo=null;notify('已撤销移除。');}return;}
  if(action==='open-direction'){navigate('experiments');directionFilter=id;render();return;}
  if(action==='open-experiment'){navigate('experiments');query=experiment(id).title;render();return;}
  if(action==='export'){download(JSON.stringify(state,null,2),'exploreos');return;}
  if(action==='raw'){download(localStorage.getItem(KEY)||'{}','exploreos-raw');return;}
  if(action==='export-memory'){download(memoryText(state.memories.find(m=>m.id===id)),'exploreos-memory','text/markdown;charset=utf-8','md');return;}
  if(action==='guide-next'){guideIndex++;render();return;}
  if(action==='guide-experiment'){
    if(!currentGuide)return;
    experimentForm(null,{directionId:currentGuide.directionId,directionName:currentGuide.focusName,title:currentGuide.title,hypothesis:currentGuide.hypothesis,budget:String(Number(guidePrefs.minutes)/60)});
    return;
  }
  if(action==='guide-problem'){
    if(!currentGuide)return;
    problemForm(null,{text:`我想进一步了解「${currentGuide.focusName}」：${currentGuide.title}`,workaround:`可以先用 ${guidePrefs.minutes} 分钟完成这一步：${currentGuide.summary}`});
    return;
  }
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
    problemForm(item);
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
  if(event.target.dataset.guidePref){
    guidePrefs={...guidePrefs,[event.target.dataset.guidePref]:event.target.value};
    guideIndex=0;render();return;
  }
  if(event.target.id==='direction-filter'){directionFilter=event.target.value;render();}
  if(event.target.id==='status-filter'){statusFilter=event.target.value;render();}
  if(event.target.id!=='import-file')return;
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>10*1024*1024)throw Error('文件超过 10 MB，请选择有效的 ExploreOS 备份。');
    const next=validateState(JSON.parse(await file.text()));
    if(!confirm(`恢复包含 ${next.experiments.length} 个实验、${next.sessions.length} 条记录的备份？这会替换当前数据，并先下载当前存储副本。`))return;
    download(localStorage.getItem(KEY)||JSON.stringify(state),'exploreos-before-restore');
    const raw=JSON.stringify(next);localStorage.setItem(KEY,raw);storedRaw=raw;state=next;loadError=false;undo=null;render();void mirrorToDisk(raw);notify('备份已恢复。');
  }catch(error){notify(error.message);}finally{event.target.value='';}
});
window.addEventListener('storage',event=>{
  if(event.key!==KEY)return;
  try{state=event.newValue?validateState(JSON.parse(event.newValue)):initialState();storedRaw=event.newValue;loadError=false;render();notify('已同步同一浏览器中另一个页面的记录。');}
  catch{loadError=true;render();notify('另一个页面的数据无法读取，已暂停保存。');}
});
render();
diskReady=inspectDiskBackup();
