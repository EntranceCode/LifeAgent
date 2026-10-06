// Suggestions describe actions, never infer a career fit from a few records.
export const sampleDirections=['生活体验','艺术与摄影','运动体验','职业体验'];
const profiles=[
  [/科研|论文|毕业/, {sample:'一份已完成的同类论文目录',observe:'只看目录与方法摘要，标出与你现有业务相关的一处',make:'把一个业务问题写成“输入、处理、结果”三句话',person:'完成过同类毕业要求的师兄师姐',question:'你当时怎样确定一个能完成的题目？',alternative:'列出已有数据、能做的实验和仍缺的条件'}],
  [/AI|人工智能/i, {sample:'一个 AI 工具的真实使用案例',observe:'实际体验同一个输入，记录有用的输出和一次错误',make:'用一个 AI 工具完成一段可检查的小任务',person:'实际使用 AI 工具的人',question:'你在哪一步会检查或修改它的结果？',alternative:'换一种输入方式，比较两次输出'}],
  [/产品|设计/, {sample:'一个常用产品的核心流程',observe:'亲自走完流程，标出一个卡顿和一个顺手之处',make:'用纸笔重画一个让你不舒服的流程',person:'这个产品的真实使用者',question:'最近一次使用时，哪一步最费劲？',alternative:'做一个只有一个主要动作的纸面页面'}],
  [/写作|阅读/, {sample:'一篇你愿意读完的短文',observe:'找出一个吸引你的开头，写下它如何引起好奇',make:'写一段 150 字的亲身经历',person:'喜欢阅读或写作的朋友',question:'哪一段让你愿意读下去，为什么？',alternative:'把同一段经历改成对话或另一种开头'}],
  [/视频|影视/, {sample:'一段三分钟以内的视频',observe:'标出开头、转折和结尾，观察画面与声音如何配合',make:'用手机拍三个镜头，表达一个日常场景',person:'拍摄或观看这类视频的人',question:'你最记得哪个镜头，为什么？',alternative:'把相同镜头换一种顺序，比较表达的变化'}],
  [/技术|编程|工具/, {sample:'一个与你现有技能接近的小工具',observe:'跑通最小示例，区分输入、处理和输出',make:'写一个能省去一次重复操作的小脚本或步骤表',person:'经常处理这个任务的同事',question:'哪一步最重复，你现在怎么处理？',alternative:'改一个输入或条件，检查工具是否仍然有用'}],
  [/艺术|摄影|绘画|音乐/, {sample:'一张照片、一幅画或一首曲子',observe:'选一个细节，描述它带来的感受，不急着评价好坏',make:'用手机拍三张同一主题的照片，或用纸笔画一个身边物件',person:'愿意分享作品感受的朋友',question:'你注意到哪个细节，它让你想到什么？',alternative:'换一个角度、光线或材料，再试一次'}],
  [/运动|身体|健身/, {sample:'一次轻松的步行或熟悉的活动',observe:'在舒适强度内体验，记录前后的精力和感受；不适时停止',make:'在方便的地方轻松走一小段，观察周围并记录感受',person:'有这项运动日常经验的人',question:'刚开始时，你怎样选择舒服、能继续的方式？',alternative:'换一个方便的场地或同伴，比较自己的感受'}],
  [/职业|工作/, {sample:'一位从业者对普通工作日的讲述',observe:'记下实际任务、协作对象和一个出乎意料的难处',make:'选一份工作中的小任务，做一页模拟交付',person:'比你早入行几步的从业者',question:'普通的一天在做什么，新人可以怎样试一次？',alternative:'列出这份工作的一个吸引点和一个实际代价'}],
  [/生活|旅行|关系|社区/, {sample:'一个方便到达的街区、公园或公共空间',observe:'观察三处平时忽略的细节，想想你愿不愿意再次来',make:'尝试一件平时没做过的生活小事，例如换条散步路线或做一道简单饭菜',person:'有不同生活经历的朋友',question:'最近有什么小尝试让你觉得生活多了一种可能？',alternative:'换一种日常安排，记录它带来的方便和不便'}]
];
function profileFor(name){
  return profiles.find(([pattern])=>pattern.test(name))?.[1]||{
    sample:`一个与「${name}」有关的真实作品或经历`,observe:'记录它具体做了什么、哪里与你的想象不同',
    make:`选择「${name}」中一个不需要新工具的小任务，亲手试一次`,
    person:`有「${name}」实际经验的人`,question:'你刚开始时做的第一件小事是什么？',
    alternative:'换一种方法体验同一个小任务，记录差别'
  };
}
export function guidePool(name,minutes,mode){
  const p=profileFor(name),long=Number(minutes)>15;
  const tasks={
    discover:[
      {title:`看见「${name}」的一个真实样本`,steps:[`选择${p.sample}`,p.observe,'记下一处意外和一个还想追问的问题']},
      {title:`观察「${name}」的具体过程`,steps:[`找到${p.sample}的一个具体片段`,'按发生顺序描述三步，不急着解释','写下哪一步吸引你，哪一步让你抗拒']}
    ],
    talk:[
      {title:`向「${name}」的实践者问一问`,steps:[`找一位${p.person}`,`只问一个具体问题：${p.question}`,'可以先发出消息；不必等到回复才算迈出这一步']},
      {title:`聊聊「${name}」的真实经历`,steps:[`约一位${p.person}聊几分钟`,'请对方讲最近一次实际经历，追问当时怎样处理','记下一个事实和一个自己的感受；约不到人时先留下问题']}
    ],
    make:[
      {title:`亲手试一次「${name}」`,steps:[p.make,'做到一个可以描述的小结果就停下','记录做的过程是否比想象中更吸引你']},
      {title:`换一种方式试试「${name}」`,steps:[p.alternative,'把第一次尝试和这次结果放在一起看','写下一处差别，以及是否愿意再试']}
    ]
  };
  return tasks[mode].map((task,i)=>({...task,guideKey:`${name}|${minutes}|${mode}|${i}`,
    summary:task.steps[0],
    steps:long?[...task.steps.slice(0,2),Number(minutes)>=180?'把剩余时间留给一次重复体验或具体反馈；不必用满':'留一点时间整理结果，也可以提前结束',task.steps[2]]:task.steps,
    completion:mode==='talk'?'留下一条具体问题或一段真实交流记录。':'留下一句话或一个小结果，并记录想不想再试。'
  }));
}
