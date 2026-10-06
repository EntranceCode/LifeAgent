import {initialState,uid,statuses,summarize,makeMemory,validateState,visibleItems,trashItems,trashItem,restoreItem} from './model.js';

const KEY='exploreos.v1', LEGACY_KEYS=['exploreos.v2','exploreos.v0.2'], DRAFT_KEY='exploreos.drafts.v1';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={directions:'方向',experiments:'实验',sessions:'探索记录',memories:'记忆卡',problems:'问题'};
const ratingLabels={feeling:'投入感',achievement:'成就感',again:'继续意愿'};
let state,view='map',directionFilter='',statusFilter='',query='',loadError=false,storedRaw=null,legacySource='';
let noticeTimer,editor=null,undo=null,guideIndex=0,currentGuide=null;
let guidePrefs={energy:'normal',minutes:'60',mode:'discover',directionId:''};
let diskBackup={status:'checking',latest:null,previous:null,error:''},diskWrite=Promise.resolve();
const activityScore=data=>data.experiments.length+data.sessions.length+data.memories.length+data.problems.length;
try{
  storedRaw=localStorage.getItem(KEY);
  // Preserve an unreadable primary record for export before any recovery.
  if(storedRaw!==null)validateState(JSON.parse(storedRaw));
  const candidates=[KEY,...LEGACY_KEYS].map(key=>({key,raw:localStorage.getItem(key)})).filter(item=>item.raw).flatMap(item=>{
    try{return [{...item,data:validateState(JSON.parse(item.raw))}];}catch{return [];}
  });
  const primary=candidates.find(item=>item.key===KEY);
  const legacy=candidates.filter(item=>item.key!==KEY).sort((a,b)=>activityScore(b.data)-activityScore(a.data))[0];
  const chosen=!primary||(activityScore(primary.data)===0&&legacy&&activityScore(legacy.data)>0)?legacy:primary;
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
const backupCounts=data=>`${data.directions.length} 个方向 · ${data.experiments.length} 个实验 · ${data.sessions.length} 条记录 · ${data.memories.length} 张记忆卡 · ${data.problems.length} 个问题`;
const needsDiskRecovery=()=>activityScore(state)===0&&diskBackup.latest&&activityScore(diskBackup.latest.state)>0;
async function inspectDiskBackup(){
  try{
    const response=await fetch('/api/state',{cache:'no-store'});
    if(!response.ok)throw Error('本机备份服务暂时不可用。');
    const payload=await response.json();
    const latest=payload.latest?{...payload.latest,state:validateState(payload.latest.state)}:null;
    const previous=payload.previous?{...payload.previous,state:validateState(payload.previous.state)}:null;
    diskBackup={status:latest?(sameState(latest.state,state)?'synced':'different'):'missing',latest,previous,error:''};
    if(!latest&&activityScore(state)>0){void mirrorToDisk(storedRaw);return;}
    if(view==='backup'||needsDiskRecovery())render();
  }catch(error){
    diskBackup={...diskBackup,status:'unavailable',error:error.message};
    if(view==='backup')render();
  }
}
function mirrorToDisk(raw,{announce=false}={}){
  diskWrite=diskWrite.catch(()=>{}).then(async()=>{
    const oldLatest=diskBackup.latest;
    const response=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});
    const payload=await response.json();
    if(!response.ok)throw Error(payload.error||'无法写入本机备份。');
    const latest={...payload.latest,state:validateState(payload.latest.state)};
    diskBackup={status:'synced',latest,previous:oldLatest&&!sameState(oldLatest.state,latest.state)?oldLatest:diskBackup.previous,error:''};
    if(view==='backup')render();
    if(announce)notify('已保存到本机备份。');
  }).catch(error=>{
    diskBackup={...diskBackup,status:'unavailable',error:error.message};
    if(view==='backup')render();
    if(announce)notify('浏览器记录仍在，但本机备份失败：'+error.message);
  });
  return diskWrite;
}
function save(next){
  if(loadError)throw Error('原有存储无法读取。请先在数据备份导出原始存储，再恢复有效备份。');
  if(localStorage.getItem(KEY)!==storedRaw)throw Error('另一个页面更新了记录。草稿已保留，请刷新后再保存，避免覆盖新内容。');
  validateState(next);const raw=JSON.stringify(next);
  try{localStorage.setItem(KEY,raw);}catch{throw Error('浏览器空间不足或禁止存储，本次没有保存。请先导出备份，再释放空间。');}
  storedRaw=raw;state=next;render();void mirrorToDisk(raw);
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
const guideCatalog={
  discover:{
    '15':[
      {title:'认识一个陌生职业',summary:'找一段从业者的真实讲述，看看这份工作每天到底在做什么。',steps:['选一个你只听过名字的职业','看一段从业者访谈或“一天”记录','记下一个意外、一个抗拒点和一个想追问的问题'],completion:'留下三句话：意外、抗拒、问题。'},
      {title:'看见一种新生活样本',summary:'走近一种与你当前生活不同的选择，扩大对“可以怎样生活”的想象。',steps:['选一个人物、社区或真实项目','了解它如何开始，以及普通的一天怎样度过','记下哪一部分吸引你，哪一部分不适合你'],completion:'说清楚一个“我想靠近”和一个“我不想要”。'}
    ],
    '60':[
      {title:'拆解一个产品的核心体验',summary:'从使用者视角理解一个产品为何存在，以及它怎样让人完成关键动作。',steps:['挑一个最近常用或让你困惑的产品','写下它服务谁、解决什么问题','亲自走完一次核心流程并标出三个关键节点','画出你会改动的一处，并写明理由'],completion:'产出一张简图，包含用户、问题、核心流程和一个改动。'},
      {title:'走近一个陌生方向',summary:'用入门材料、从业者故事和真实作品拼出一张小地图。',steps:['找一份高质量入门介绍','再看一个从业者的真实经历','找到一个该领域的实际产出','写下它与你原先想象的不同'],completion:'留下三个事实和一个还想追的问题。'}
    ],
    '180':[
      {title:'做一次领域试水',summary:'先学一个最小概念，再亲手复现并修改一个例子。',steps:['用不超过30分钟理解一个基础概念','照着教程完成最小例子','脱离教程改动一个变量或步骤','记录卡住的位置和完成后的感受'],completion:'得到一个可展示的结果，并判断是否愿意再投入三小时。'},
      {title:'完成一次产品考古',summary:'从第一版到今天，理解一个产品怎样围绕真实需求演变。',steps:['找到产品最早解决的问题和目标用户','查看早期版本或关键迭代','亲自体验当前核心流程','如果由你重做第一版，只保留一个功能'],completion:'产出一页产品演变记录和你的第一版方案。'}
    ]
  },
  talk:{
    '15':[
      {title:'发出一条请教消息',summary:'向一个比你早走几步的人，问一个具体而容易回答的问题。',steps:['选一个有真实经验的人','用一句话说明你为何向他请教','只问一个与实际工作有关的问题','发出消息后记下你最想知道的答案'],completion:'发出一条不超过五行的消息。'},
      {title:'收集一个真实问题',summary:'问身边的人最近哪里最麻烦，先理解经历，不急着给方案。',steps:['找一个方便聊几分钟的人','问“最近哪件小事最费劲”','追问一次“你现在怎么处理”','复述你的理解，请对方纠正'],completion:'记下一段具体场景、现有办法和不满意之处。'}
    ],
    '60':[
      {title:'完成一次职业访谈',summary:'用二十分钟了解一份工作的日常、难处和入门真相。',steps:['约一位相关从业者或学长','准备四问：日常、难处、误解、低成本试法','访谈时追问一个具体案例','结束后区分“喜欢想象”与“喜欢实际工作”'],completion:'得到四个问题的答案和一个可执行的试水建议。'},
      {title:'请一个人试用你的作品',summary:'观察对方怎样理解和操作，发现你独自思考时看不到的地方。',steps:['选一个现有页面、流程或草图','给出目标，不讲操作方法','观察对方在哪停顿、误解或惊喜','最后只问“最想改变哪里”'],completion:'记录三个观察事实和一个优先修改点。'}
    ],
    '180':[
      {title:'完成一次小型用户观察',summary:'连续观察两个人解决同一个问题，寻找重复出现的阻碍。',steps:['确定一个具体任务和两位参与者','分别观察他们完成任务','只记录行为与原话，暂不解释','比较共同点并提出一个可验证的改动'],completion:'得到两份观察记录和一个共同问题。'},
      {title:'还原一段真实工作',summary:'跟着一位从业者，把一个任务从输入到交付完整画出来。',steps:['选择一个具体任务而不是泛聊职业','询问任务从哪里来、如何判断完成','标出工具、协作对象和最难节点','请对方检查你的流程图'],completion:'完成一张经从业者确认的工作流程图。'}
    ]
  },
  make:{
    '15':[
      {title:'捕捉一个别扭瞬间',summary:'把一次真实的不顺手变成可讨论的产品问题。',steps:['回想今天一次卡顿或不耐烦','写清当时想完成什么','记录实际发生了什么','画出你希望看到的变化'],completion:'留下一段场景描述和一个改动草图。'},
      {title:'把模糊想法画成五步流程',summary:'不用学习新工具，用纸笔让脑中的想法第一次可见。',steps:['写下谁遇到了什么问题','确定用户最后要完成什么','只画开始到结束的五个步骤','圈出最不确定的一步'],completion:'得到一张五步流程和一个待验证点。'}
    ],
    '60':[
      {title:'重画一个产品流程',summary:'选择一个让你不舒服的流程，用一小时做出更清楚的版本。',steps:['完整走一遍当前流程并截图或速记','标出多余、模糊和缺少反馈之处','重画不超过五步的新流程','自己扮演首次用户走一遍'],completion:'得到当前流程、改进流程和三条设计理由。'},
      {title:'做一张一页原型',summary:'把一个问题压缩到一个页面，用可点击或纸面原型表达核心想法。',steps:['写下目标用户和唯一要解决的问题','确定页面上最重要的一个动作','完成低保真页面','请一个人说说他认为这个页面能做什么'],completion:'得到一页原型和一条外部反馈。'}
    ],
    '180':[
      {title:'做出一个可体验的小原型',summary:'围绕一个真实问题做最小版本，并让一个人实际体验。',steps:['用二十分钟限定用户、问题和成功标准','搭出只覆盖核心流程的原型','自己完成一次完整任务','请一个目标用户试用并记录观察'],completion:'完成一个可体验原型和一次真实试用。'},
      {title:'解决身边人的一个小问题',summary:'从具体的人和场景出发，做一个今天能交付的小工具或方案。',steps:['请一个人描述最近反复遇到的小麻烦','确认他目前怎样解决以及哪里不满','制作最简单的替代方案','交给对方使用并收集一句反馈'],completion:'真实交付一次，并获得是否有用的反馈。'}
    ]
  }
};
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
  const focus=guideDirection(),pool=guideCatalog[guidePrefs.mode][guidePrefs.minutes];
  const idea=pool[guideIndex%pool.length],focusName=focus?.name||'一个新方向';
  const low=guidePrefs.energy==='low',high=guidePrefs.energy==='high';
  return {...idea,directionId:focus?.id||'',focusName,
    hypothesis:`我想验证：亲自完成“${idea.title}”后，我是否愿意继续了解「${focusName}」。`,
    why:guidePrefs.directionId?`你主动选择了「${focusName}」，这一步可以把模糊兴趣变成一次真实体验。`:`「${focusName}」在你的地图里留下的探索较少，适合先用小成本走近。`,
    exit:low?'先做10分钟；如果仍然抗拒，就停下。记下“不想继续”也算完成。':'做到一半仍没有好奇，就停下，并记下原因。',
    stretch:high?'精力还有余量时：把结果发给一个人，请他只提一个问题。':''
  };
}
function guidePage(){
  currentGuide=buildGuide();
  const energies=[['low','很少，只想迈一步'],['normal','一般，可以专注一下'],['high','不错，想多走一点']];
  const times=[['15','15 分钟'],['60','1 小时'],['180','3 小时']];
  const modes=[['discover','先看见新东西'],['talk','去和人聊一聊'],['make','亲手做点东西']];
  const dirs=[['','帮我选择'],...visible('directions').map(d=>[d.id,d.name])];
  const g=currentGuide;
  return intro('GUIDED EXPLORATION','不知道往哪走时，先走一小步。','你不需要先找到方向。告诉我今天的状态，ExploreOS 会从现有版图中给出一个低压力的小探索。')+
    `<section class="guide-controls" aria-label="探索偏好">
      <label>今天的精力<select data-guide-pref="energy">${options(energies,guidePrefs.energy)}</select></label>
      <label>可以留出的时间<select data-guide-pref="minutes">${options(times,guidePrefs.minutes)}</select></label>
      <label>更想怎样接触<select data-guide-pref="mode">${options(modes,guidePrefs.mode)}</select></label>
      <label>想靠近的方向<select data-guide-pref="directionId">${options(dirs,guidePrefs.directionId)}</select></label>
    </section>
    <article class="card guide-card" aria-live="polite">
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
    </article>
    <p class="guide-note">建议只根据你刚才的选择和当前探索版图生成。换一个不会写入记录；只有确认保存后才会留下。</p>`;
}
function overview(){
  const dirs=visible('directions'),exps=visible('experiments'),logs=visible('sessions'),memories=visible('memories');
  const explored=dirs.filter(d=>exps.some(e=>e.directionId===d.id&&sessions(e.id).length)).length;
  let html=intro('YOUR OPEN WORLD','人生没有唯一主线。','跟着好奇走一小段，让每次尝试留下点什么。',`<div class="title-actions">${button('go-guide','✦ 带我去看看','','primary')}${button('experiment','自己开始实验')}</div>`);
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
  const diskLabel={checking:'正在检查',missing:'尚未建立',synced:'已同步',different:'发现另一份',unavailable:'暂时不可用'}[diskBackup.status]||'未知';
  const diskCard=`<div class="card backup disk-backup"><div class="section-row"><h2>本机自动备份</h2>${tag(diskLabel,diskBackup.status==='unavailable')}</div><p>每次确认保存后，除了浏览器存储，还会原子写入项目的 <code>data/exploreos-latest.json</code>；更新前的版本保存在 <code>data/exploreos-previous.json</code>。</p>${diskBackup.latest?`<div class="backup-slot"><strong>最新本机副本</strong><span>${esc(backupCounts(diskBackup.latest.state))}</span><small>${new Date(diskBackup.latest.modifiedAt).toLocaleString('zh-CN')}</small></div>`:''}${diskBackup.previous?`<div class="backup-slot"><strong>上一版</strong><span>${esc(backupCounts(diskBackup.previous.state))}</span><small>${new Date(diskBackup.previous.modifiedAt).toLocaleString('zh-CN')}</small></div>`:''}${diskBackup.error?`<p class="backup-error">${esc(diskBackup.error)}</p>`:''}<div class="actions">${button('sync-disk','用当前数据更新本机备份','','primary')}${diskBackup.latest&&!sameState(diskBackup.latest.state,state)?button('restore-disk-latest','恢复最新本机副本'):''}${diskBackup.previous?button('restore-disk-previous','恢复上一版'):''}</div><p class="form-help">本机副本不依赖浏览器端口或浏览器资料，但仍建议定期导出 JSON 到其他位置。</p></div>`;
  return intro('YOUR DATA','把走过的路，带在身边。','记录同时保存在浏览器和本机项目目录中，也可以随时导出独立副本。')+diskCard+`<div class="card backup"><h2>导出与导入</h2><p>导出包括所有方向、实验、探索、记忆和回收站。恢复会替换当前浏览器数据，操作前会先下载当前副本。</p><div class="actions">${button('export','↓ 导出 JSON','','primary')}${button('raw','导出原始存储')}</div><label for="import-file">从 JSON 恢复（支持 v0.1 备份）</label><input id="import-file" type="file" accept=".json,application/json"><p class="form-help">草稿单独保存在浏览器中，不包含在 JSON 和本机自动备份中。</p></div><div class="section-row"><h2>回收站 <span class="count">${deleted.length}</span></h2><small>记录暂存于此，随时可以恢复</small></div>${deleted.length?`<div class="stack">${deleted.map(({collection,item})=>`<article class="card trash-row"><div><div class="meta">${names[collection]} · ${date(item.deletedAt)}</div><h3>${esc(item.name||item.title||item.action||item.text)}</h3>${collection==='experiments'?'<p class="meta">恢复后，它的探索记录和记忆也会重新显示。</p>':''}</div>${button('restore-'+collection,'恢复',item.id)}</article>`).join('')}</div>`:empty('回收站是空的','移除的记录会暂存在这里，误操作也可以找回来。')}`;
}
function render(){
  document.querySelectorAll('[data-view]').forEach(b=>{const selected=b.dataset.view===view;b.classList.toggle('selected',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const pages={map:overview,guide:guidePage,experiments:experimentsPage,journal:journalPage,memories:memoriesPage,skills:skillsPage,problems:problemsPage,backup:backupPage};
  let html=pages[view]();
  if(needsDiskRecovery())html=`<div class="card recovery-banner"><p role="status">浏览器里暂时没有探索记录，但找到一份本机备份：${esc(backupCounts(diskBackup.latest.state))}</p>${button('restore-disk-latest','恢复本机备份')}</div>`+html;
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
  if(!visible('directions').length){notify('先在地图上留下一个方向，再开始实验。');return;}
  modal(item?'编辑实验':'开始一个小实验',select('directionId','探索方向',visible('directions').map(d=>[d.id,d.name]))+field('title','这次想尝试什么？','text',true,'试着设计 ExploreOS 的核心体验')+field('hypothesis','你想验证的问题（可选）','textarea',false,'我可能更喜欢设计产品机制，而非纯实现。')+field('budget','参考预算 · 小时（可选）','number',false,'不设预算也可以')+'<p class="form-help">预算只是参考。随时暂停，没有需要凑满的时长。</p>',values=>{
    const next={...item,...values,budget:number(values.budget),id:item?.id??uid(),status:item?.status??'active',createdAt:item?.createdAt??new Date().toISOString()};
    put('experiments',next,!!item);
    if(!item){view='experiments';query='';statusFilter='';directionFilter='';render();}
  },{values:item||{directionId:directionFilter||visible('directions')[0].id,...prefill},key:item?'experiment:'+item.id:'experiment:new'});
}
function problemForm(item=null,prefill={}){
  modal(item?'编辑问题':'装进口袋的问题',field('text','你遇到了什么问题？','textarea',true)+field('workaround','现在怎么解决？哪里不满意？（可选）','textarea'),values=>put('problems',{...item,...values,id:item?.id??uid(),createdAt:item?.createdAt??new Date().toISOString()},!!item),{values:item||prefill,key:'problem:'+(item?.id??'new')});
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
  const snapshot=diskBackup[slotName];
  if(!snapshot){notify('没有找到这份本机备份。');return;}
  const next=validateState(structuredClone(snapshot.state));
  if(!confirm(`恢复本机备份中的 ${next.experiments.length} 个实验、${next.sessions.length} 条记录？当前浏览器数据会先下载一份副本。`))return;
  download(localStorage.getItem(KEY)||JSON.stringify(state),'exploreos-before-disk-restore');
  const raw=JSON.stringify(next);
  localStorage.setItem(KEY,raw);storedRaw=raw;state=next;loadError=false;undo=null;
  render();void mirrorToDisk(raw);notify('已从本机备份恢复。');
}
function act(action,id){
  if(action==='sync-disk'){void mirrorToDisk(storedRaw,{announce:true});return;}
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
    experimentForm(null,{directionId:currentGuide.directionId,title:currentGuide.title,hypothesis:currentGuide.hypothesis,budget:String(Number(guidePrefs.minutes)/60)});
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
void inspectDiskBackup();
