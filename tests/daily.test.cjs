/**
 * 日常层测试
 * =====================================================================
 *   node tests/daily.test.cjs
 *
 * 分三段：
 *   一、日记的规则（daily/diary.js，纯函数）—— 天/时段怎么从节点 id 读出来、
 *       一条记事成不成立、哪几条排在前头
 *   二、剧本（daily/story.json）—— 时段菜单是闭合的、主线地点锁得住、
 *       每个幕尾反应节点都记了一笔
 *   三、界面接入（daily/daily.js，无头）—— HUD 那颗【日记】按钮什么时候在、
 *       什么时候亮、书摊开之后拦不拦得住空格
 *
 * 第三段跟 ui.test.cjs 一样用 tests/dom-stub.cjs 顶替浏览器。
 * daily.js 是**浏览器脚本**（直接摸 window/document），所以这里用 vm 起一个
 * 沙箱，把同一份 doc/win 递进去 —— 它和 ui.js 因此挂在同一个 document 上，
 * 捕获阶段的拦截才测试得出来。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadDom } = require('./dom-stub.cjs');
const { suite } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const api = require(path.join(ROOT, 'act1', 'engine.js'));
const uiApi = require(path.join(ROOT, 'act1', 'ui.js'));
const D = require(path.join(ROOT, 'daily', 'diary.js'));

const act1 = require(path.join(ROOT, 'act1', 'story.json'));
const act2 = require(path.join(ROOT, 'act2', 'story.json'));
const act3 = require(path.join(ROOT, 'act3', 'story.json'));
const dailyStory = require(path.join(ROOT, 'daily', 'story.json'));
// 狩猎篇也拼进来：第三幕的 c27_end 现在接着 hunt/ch4 的首节点，
// 少了这五份，「一路走到底」那条会停在悬空的 next 上。
const huntStories = [4, 5, 6, 7, 8].map((n) => require(path.join(ROOT, 'hunt', `ch${n}.json`)));
const whole = api.composeStories([act1, act2, act3, dailyStory, ...huntStories]);

const DAILY_SRC = fs.readFileSync(path.join(ROOT, 'daily', 'daily.js'), 'utf8');
const STAT_LABELS = act1.config.statLabels;

const { StoryEngine } = api;
const byId = new Map(whole.nodes.map((n) => [n.id, n]));

const t = suite('日常层');

/* =====================================================================
 * 一、日记的规则
 * =================================================================== */

t.section('日记 · 天与时段');
t.eq(D.stampOf('dy_d2_mo_hub'), { day: 2, slot: '早晨', key: 'mo' }, 'dy_ 节点 id 直接解析出天与时段');
t.eq(D.stampOf('dy_d6_ni_r'), { day: 6, slot: '夜晚', key: 'ni' }, '幕尾反应节点也一样（_r 后缀不挡路）');
t.eq(D.stampOf('b12_morning'), null, '原著节点自己不说是第几天 —— 给 null，由史回溯决定');
t.eq(D.stampOf(''), null, '空 id 给 null，不抛错');
/* 狩猎篇五章：id 里只有章号，天/时段由 HUNT_STAMP 那张表直接给。
   日期照原文填 —— 第五章开头「第二天」、第八章开头「午后的阳光」。 */
t.eq(D.stampOf('h4_knock'), { day: 6, slot: '夜晚', key: 'ni' },
  '第四章是第 6 天当夜（原文：「明天一早，你再来我的房间一趟」）');
t.eq(D.stampOf('h5_start'), { day: 7, slot: '早晨', key: 'mo' },
  '第五章从第 7 天的天没亮就开始（原文：「第二天，太阳还未从山边出来之时」）');
t.eq(D.stampOf('h7_hit'), { day: 7, slot: '午后', key: 'af' }, '第七章仍是同一天午后');
t.eq(D.stampOf('h8_end'), { day: 7, slot: '夜晚', key: 'ni' },
  '第八章收在当夜（原文：「太阳西下」「夜的寂静」）');
t.eq(D.stampOf('h3_x'), null, '只有第四～八章在那张表里，别的前缀还是 null');
{
  // 狩猎篇的牌子不能停在进狩猎篇之前的第 6 天 —— 这条是这次修的那个毛病本身
  const walked = ['dy_d6_ni_hub', 'c27_end', 'h4_knock', 'h5_start', 'h6_ride'];
  t.eq(D.stampFromHistory(walked), { day: 7, slot: '中午', key: 'nn' },
    '走到第六章，牌子上是第 7 天中午（不再是第 6 天）');
  t.eq(D.stampFromHistory(walked.slice(0, 4)), { day: 7, slot: '早晨', key: 'mo' },
    '走到第五章，是第 7 天早晨');
}

t.section('日记 · 从史回溯');
t.eq(D.stampFromHistory(['o1_arrive', 'b1_room', 'b11_sleep']), null,
  '第 1 天（序章 + 第一夜）全都不是 dy_ 节点 —— 没有时间牌子，也没有【日记】按钮');
t.eq(D.stampFromHistory(['o1_arrive', 'dy_d2_mo_hub', 'b12_morning', 'b15_hair']),
  { day: 2, slot: '早晨', key: 'mo' }, '原著段从「来路」上取时段（往回找最近一个 dy_ 节点）');
t.eq(D.stampFromHistory(['dy_d2_mo_hub', 'dy_d2_nn_hub', 'b16_montage']),
  { day: 2, slot: '中午', key: 'nn' }, '往回找的是**最近**一个，不是第一个');
t.eq(D.stampFromHistory([]), null, '空历史给 null');
t.eq(D.stampFromHistory(undefined), null, '连历史都没有也给 null');

t.section('日记 · 数据块');
t.eq(D.blockOf(whole).title, '西比拉手记', '书名来自 daily/story.json 的 diary 块（composeStories 把它带出来了）');
t.eq(D.entryFor(whole, 2) && D.entryFor(whole, 2).weather, '阴', '第 2 天那页有天气');
t.eq(D.entryFor(whole, 6) && D.entryFor(whole, 6).date, '第 6 日', '第 6 天那页有日期');
t.eq(D.entryFor(whole, 3) && D.entryFor(whole, 3).weather, '晴', '第 3 天那页有天气（自由日也有正文）');
t.eq(D.entryFor(act1, 2), null, '第一幕自己没写 diary 块，退回空白也不算错');

/* 附录 A 的四档。阈值只在 diary.js 的 tierOf() 里出现一处，界面上一个字都不显示 ——
   玩家读到的永远是一整页人写的话，不是「好感 +5」这种东西。 */
t.section('日记 · 四档语气');
const withStats = (s) => ({ getStat: (k) => s[k] || 0 });
t.eq(D.tierOf(withStats({})), 1, '什么都没动（开局）落在档 1：事件记录');
t.eq(D.tierOf(withStats({ 西比拉_好感: 19, 西比拉_亲密: 9 })), 1, '差一点也是档 1');
t.eq(D.tierOf(withStats({ 西比拉_好感: 20 })), 2, '好感够 20 进档 2');
t.eq(D.tierOf(withStats({ 西比拉_亲密: 10 })), 2, '亲密度够 10 也进档 2（两条路，取其一）');
t.eq(D.tierOf(withStats({ 西比拉_好感: 40, 西比拉_亲密: 24 })), 2, '档 3 要两条同时够：差一条就还停在档 2');
t.eq(D.tierOf(withStats({ 西比拉_好感: 40, 西比拉_亲密: 25 })), 3, '好感 40 且亲密 25，进档 3：个人情绪');
t.eq(D.tierOf(withStats({ 西比拉_埋怨: 30 })), 3, '埋怨够 30 也进档 3 —— 她开始有想说的话');
t.eq(D.tierOf(withStats({ 西比拉_埋怨: 29 })), 1, '埋怨 29：还不到，档 2/3 都不认它（设计稿里它只管档 3）');
t.eq(D.tierOf(withStats({ 西比拉_好感: 60, 西比拉_亲密: 45 })), 4, '够亲密、恨意没越线，档 4：真正私密');
t.eq(D.tierOf(withStats({ 西比拉_好感: 60, 西比拉_亲密: 45, 西比拉_恨意: D.HATE_LINE - 1 })), 4,
  '恨意在线下（29）仍然是档 4');
t.eq(D.tierOf(withStats({ 西比拉_好感: 60, 西比拉_亲密: 45, 西比拉_恨意: D.HATE_LINE })), 3,
  '恨意一到线就落回档 3 —— 同样亲近，恨着的人不会把什么都写下来');
t.eq(D.tierOf({}), 1, '连 getStat 都没有（假引擎）给档 1，不抛错');

t.section('日记 · 哪一档的正文');
t.eq(D.bodyFor(whole, withStats({}), 1), D.entryFor(whole, 1).body,
  '第 1 天只有 body —— 她刚领到册子，还谈不上语气，哪一档读到的都是它');
t.eq(D.bodyFor(whole, withStats({}), 2), D.entryFor(whole, 2).body, '第 2 天档 1 用 body');
t.eq(D.bodyFor(whole, withStats({ 西比拉_好感: 25 }), 2), D.entryFor(whole, 2).tiers[2], '档 2 用 tiers[2]');
t.eq(D.bodyFor(whole, withStats({ 西比拉_好感: 40, 西比拉_亲密: 25 }), 6),
  D.entryFor(whole, 6).tiers[3], '第 6 天档 3 用 tiers[3]');
t.eq(D.bodyFor(whole, withStats({ 西比拉_好感: 60, 西比拉_亲密: 45 }), 6),
  D.entryFor(whole, 6).tiers[4], '第 6 天档 4 用 tiers[4]');
{
  /* 缺一档不开天窗：往下回落到**低于它的最高那一档** */
  const holey = { diary: { entries: [{ day: 9, body: ['B'], tiers: { 2: ['T2'], 4: ['T4'] } }] } };
  t.eq(D.bodyFor(holey, withStats({ 西比拉_好感: 40, 西比拉_亲密: 25 }), 9), ['T2'],
    'tiers[3] 缺了就滑到 tiers[2]，不是空页');
  t.eq(D.bodyFor(holey, withStats({}), 9), ['B'], '都没写才退回 body');
  t.eq(D.bodyFor(holey, withStats({}), 99), [], '那一天压根没有正文：给空数组，不抛错');
}

t.section('日记 · 摊开的那一下在前还是在后');
{
  /* 第一天那场册子摊在**最后一句之后**。早一句，屏幕上最后那两句就被书盖住了：
     人还没把册子递上来，书先开了。这条边距只有拿真引擎逐句推才看得见。 */
  const ie = new StoryEngine(whole);
  ie.enterNode('dy_d2_mo_intro');
  const total = ie.visibleLines().length;
  t.ok(total > 1, '引入场不是一句话就完的（不然这条边距没意义）');
  t.eq(D.atLastLine(ie, 'dy_d2_mo_intro'), false, '刚进节点、第一句还没推：不摊开');
  t.eq(D.atLastLine(ie, 'dy_d2_mo_hub'), false, '节点对不上，一律 false');
  for (let i = 1; i < total; i++) {
    ie.advance();
    t.eq(D.atLastLine(ie, 'dy_d2_mo_intro'), false, `第 ${i + 1} 句上还不摊开`);
  }
  ie.advance();
  t.eq(ie.node.id, 'dy_d2_mo_intro', '最后一句播完，人还停在这个节点上');
  t.eq(D.atLastLine(ie, 'dy_d2_mo_intro'), true, '—— 就是这一下把册子摊开');
}

/* =====================================================================
 * 二、剧本
 * =================================================================== */

const dailyNodes = whole.nodes.filter((n) => /^dy_/.test(n.id));
// dy_d{天}_{时段}[_{地点}]_{类型}：地点那一段可有可无（菜单和幕尾反应没有地点）
// intro 只有 dy_d2_mo_intro 一个：日记的剧情入口，挂在第一夜之后（见下面那一段）
const DY_ID = /^dy_d\d+_(mo|nn|af|ni)(_[a-z0-9]+)*_(hub|arr|e|r|intro)$/;

t.section('剧本 · 节点 id 的规矩');
t.empty(dailyNodes.filter((n) => !DY_ID.test(n.id)).map((n) => n.id),
  '所有日常层节点都是 dy_d{天}_{时段}[_{地点}]_{类型} 的形状（天与时段编进 id，存档才记得住）');
t.empty(dailyNodes.filter((n) => !D.stampOf(n.id)).map((n) => n.id),
  '每个 dy_ 节点 id 都能被 diary.js 解析出天与时段 —— 两边的规则是同一套');

const hubs = dailyNodes.filter((n) => /_hub$/.test(n.id));
const reactions = dailyNodes.filter((n) => /_r$/.test(n.id));
const SLOT_ORDER = ['mo', 'nn', 'af', 'ni'];

t.section('剧本 · 标题只写地点');
// 标题栏是「你现在在哪儿」，HUD 那块牌子才是「现在第几天、什么时辰」。
// 两边各写一遍 = 同一个屏幕上把同一句话说两遍（这正是把 hub 标题改掉的原因）。
const TIME_WORD = /第\s*\d+\s*天|早晨|中午|午后|夜晚/;
t.empty(dailyNodes.filter((n) => TIME_WORD.test(n.title || '')).map((n) => `${n.id}：${n.title}`),
  '日常层没有一个节点的标题带「第几天 / 什么时辰」—— 时间只由 HUD 说');
t.empty(dailyNodes.filter((n) => !n.title).map((n) => n.id),
  '每个日常节点都有标题（读档的 toast 也要用它）');
t.eq(new Set(dailyNodes.filter((n) => /_(hub|r)$/.test(n.id)).map((n) => n.title)).size, 1,
  '菜单与幕尾节点的标题是同一个地点名 —— 它们的背景都是 bg_aubrey_room');
t.eq(byId.get('dy_d3_mo_hub').continueLabel, '第 3 天',
  '标题改成地点之后，第二幕结局屏上那句「继续第 3 天」由 continueLabel 单独给'
  + '（ui.js 优先认它；不写的话就会拼出「继续奥布里的房间」）');

t.section('剧本 · 日记的剧情入口');
/* 设计稿 §4 的第一个入口：第 1 天不是按钮，是剧情 —— 她写完、敲门把册子递上来。
   它接在**第一夜 b11_sleep 之后、第 2 天早晨菜单之前**，原著 b1~b11 一字不动。 */
const intro = byId.get('dy_d2_mo_intro');
t.ok(intro, '有 dy_d2_mo_intro 这一个节点（日常层里唯一一个 intro）');
t.eq(byId.get('b11_sleep').next, 'dy_d2_mo_intro', '第一夜睡下之后接的就是它');
t.eq(intro.next, 'dy_d2_mo_hub', '它走完才进第 2 天早晨的菜单');
t.eq(intro.pov, '奥布里', '奥布里视角 —— 跟日常层其余节点一致');
t.ok(intro.povSwitch && intro.povSwitch.silent === true,
  '视角不弹提示 —— 日常层每个节点都带 povSwitch.silent，不然每次上下楼都要弹一次');
t.eq(intro.choices, undefined, '它是纯过场（没有 choices），摊开册子那一下由 daily.js 在捕获阶段拦');
t.eq(intro.dialogues[intro.dialogues.length - 1].text, '你开了门。她站在门外，把一本册子递了上来。',
  '末句是设计稿里写好的那一句 —— 册子是在这句**之后**摊开的');
{
  // 来路只有一条：谁都别想绕开这一场直接进第 2 天
  const sources = whole.nodes
    .filter((n) => n.next === 'dy_d2_mo_intro' || n.continueTo === 'dy_d2_mo_intro'
      || (n.choices || []).some((c) => c.next === 'dy_d2_mo_intro'))
    .map((n) => n.id);
  t.eq(sources, ['b11_sleep'], '它的来路只有 b11_sleep 一条');
}

t.section('剧本 · 那一页正文');
const entries = dailyStory.diary.entries || [];
t.eq(entries.map((e) => e.day), [1, 2, 3, 4, 5, 6], '第 1~6 天连着六页，一天也不少');
t.eq(entries.find((e) => e.day === 1).tiers, undefined,
  '第 1 天只有 body：那天她刚把册子领到手，四档还没有分别');
t.eq(entries.find((e) => e.day === 1).weather, '雨',
  '第 1 日的天气是雨 —— 到普里森堡那天原著里一直在下雨');
for (const d of [2, 3, 4, 5, 6]) {
  const e = entries.find((x) => x.day === d);
  for (const k of [2, 3, 4]) {
    t.ok(e.tiers && Array.isArray(e.tiers[k]) && e.tiers[k].length,
      `第 ${d} 天的档 ${k} 有一份自己的正文`);
    t.ne(JSON.stringify(e.tiers[k]), JSON.stringify(e.body),
      `第 ${d} 天档 ${k} 不是把 body 抄了一遍 —— 读起来得是两个人在写`);
  }
}

t.section('剧本 · 时段菜单');
t.eq(hubs.length, 20, '第 2~6 天，每天四个时段各一个菜单（5 × 4）');
t.empty([2, 3, 4, 5, 6].flatMap((d) => SLOT_ORDER
  .filter((s) => !byId.has(`dy_d${d}_${s}_hub`))
  .map((s) => `缺 dy_d${d}_${s}_hub`)), '五天四时段，一个 hub 都不缺');
t.empty(hubs.filter((n) => n.next).map((n) => n.id),
  '菜单节点不写 next —— 写了就再也回不到菜单（advance() 里 next 优先于 choices）');
t.empty(hubs.filter((n) => !n.choices || !n.choices.length).map((n) => n.id),
  '每个菜单都得有选项可点');
t.empty(hubs.flatMap((n) => (n.choices || [])
  .filter((c) => !byId.has(c.next))
  .map((c) => `${n.id} → ${c.next}`)), '菜单里每一条都指向真的节点');
t.empty(hubs.flatMap((n) => (n.choices || [])
  .filter((c) => !c.lockedHint !== !c.if)              // 一个有、另一个没有 = 配错了
  .map((c) => `${n.id}：「${c.text}」lockedHint 与 if 必须成对`)),
  '锁着的选项一律 either 都写 either 都不写（--validate 也会拦这条）');

t.section('剧本 · 主线不可跳过');
const MAIN_GATE = {
  dy_d2_mo_hub: 'b12_morning', dy_d2_nn_hub: 'b16_montage',
  dy_d2_af_hub: 'b21_haier_calls', dy_d2_ni_hub: 'b23_corridor',
  dy_d6_mo_hub: 'c1_door', dy_d6_nn_hub: 'c8_stairs',
  dy_d6_af_hub: 'c13_out', dy_d6_ni_hub: 'c23_front',
};
const gateWrong = [];
for (const [hubId, entry] of Object.entries(MAIN_GATE)) {
  const hub = byId.get(hubId);
  if (!hub) { gateWrong.push(`${hubId} 不存在`); continue; }
  // 原著剧情的入口，来路必须只有一条，且只来自本时段的菜单
  const sources = new Set();
  for (const n of whole.nodes) {
    if (n.next === entry || n.continueTo === entry) sources.add(n.id);
    for (const c of n.choices || []) if (c.next === entry) sources.add(n.id);
  }
  if (sources.size !== 1 || !sources.has(hubId)) {
    gateWrong.push(`${entry} 的来路是 ${JSON.stringify([...sources])}，应当只有 ${hubId}`);
  }
  if (hub.choices[0].next !== entry) gateWrong.push(`${hubId} 的第一项应当就是主线地点`);
  if (hub.choices[0].if) gateWrong.push(`${hubId} 的主线地点不该有 if（它必须永远可点）`);
}
t.empty(gateWrong, '八个原著时段的入口，入度恒为 1 且来自本时段菜单 —— 这就是「主线一段都跳不过去」');

t.section('剧本 · 幕尾反应节点');
t.eq(reactions.length, 8, '第 2 天与第 6 天，八个时段各一个幕尾反应节点（自由日的三天还没有）');
t.empty(reactions.flatMap((n) => (n.choices || [])
  .filter((c) => typeof c.diary !== 'string' || !c.diary)
  .map((c) => `${n.id}：「${c.text}」没写 diary`)), '每个处理选择都记下了一笔');

const flagProblems = [];
for (const n of reactions) {
  const flags = (n.choices || []).map((c) => (c.effects || []).filter((e) => D.isRecordStat(e.stat)));
  flags.forEach((fs, i) => {
    if (!fs.length) flagProblems.push(`${n.id} 第 ${i + 1} 项没挂记录旗 —— diary.js 无从判断它成不成立`);
    for (const f of fs) {
      if (!(f.stat in STAT_LABELS)) flagProblems.push(`${n.id} 的 ${f.stat} 不在 config.statLabels 里`);
      // 记录旗是日记的取数位，不是给玩家的奖励反馈：记下来，但一个字都不说
      if (f.silent !== true) flagProblems.push(`${n.id} 的 ${f.stat} 没写 "silent": true`);
      if (f.note) flagProblems.push(`${n.id} 的 ${f.stat} 写了 note —— 静默的旗不该有提示文案`);
    }
  });
  if (flags.length === 2) {
    const v0 = flags[0].map((f) => f.value).join(',');
    const v1 = flags[1].map((f) => f.value).join(',');
    if (v0 === v1) flagProblems.push(`${n.id} 两项的旗值一样（${v0}）—— 两条路就分不出来了`);
    if (!flags.every((fs) => fs.every((f) => f.value === 0 || f.value === 1))) {
      flagProblems.push(`${n.id} 的旗值不是 0/1`);
    }
  }
}
t.empty(flagProblems, '记录旗都定义过、两条路的旗值分得开（0 / 1）');

// 真把两条路各走一遍，看旗有没有从哪条缝里漏出一句话来。
// 「留了记录」这件事本身不提示 —— 否则 A 路（旗 0，不出声）和 B 路（旗 1，
// 弹一句「这一笔，她会自己记下来。」）就是两种不同的手感，等于把日记当奖励在发。
const flagLeak = [];
const branchMarks = [];
for (const n of reactions) {
  for (const i of [0, 1]) {
    const e = new StoryEngine(whole);
    e.enterNode(n.id);
    const res = e.choose(i);
    for (const f of (n.choices[i].effects || []).filter((x) => D.isRecordStat(x.stat))) {
      if (res.effects.filter((x) => x.stat === f.stat).some((x) => x.note)) {
        flagLeak.push(`${n.id} 第 ${i + 1} 项：${f.stat} 生成了提示文案`);
      }
      if ((res.notes || []).some((s) => s.indexOf(STAT_LABELS[f.stat]) >= 0)) {
        flagLeak.push(`${n.id} 第 ${i + 1} 项：${f.stat} 在 #toast 里露面了`);
      }
      branchMarks.push(`${i}=${e.getStat(f.stat)}`);
    }
  }
}
t.empty(flagLeak, 'A / B 两条路都只留记录、不出提示（engine 的 effects 认 "silent": true）');
t.eq([...new Set(branchMarks)].sort().join(' '), '0=0 1=1',
  '两条路在记录里仍然分得开：A 记 0、B 记 1 —— 后面好几天的日记正文要靠它分岔');

t.empty(Object.keys(act1.config.statNotes).filter((k) => D.isRecordStat(k)).map((k) => `${k}：${act1.config.statNotes[k]}`),
  'config.statNotes 里一条记录旗的文案都没有 —— 留着就是等哪天一不留神弹出来');

t.section('剧本 · 时段是闭合的');
const NEXT_HUB = {
  dy_d2_mo_r: 'dy_d2_nn_hub', dy_d2_nn_r: 'dy_d2_af_hub',
  dy_d2_af_r: 'dy_d2_ni_hub', dy_d2_ni_r: 'b25_end',
  dy_d6_mo_r: 'dy_d6_nn_hub', dy_d6_nn_r: 'dy_d6_af_hub',
  dy_d6_af_r: 'dy_d6_ni_hub', dy_d6_ni_r: 'c27_end',
};
t.empty(reactions.flatMap((n) => (n.choices || [])
  .filter((c) => c.next !== NEXT_HUB[n.id])
  .map((c) => `${n.id} 的「${c.text}」走到 ${c.next}，应当是 ${NEXT_HUB[n.id]}`)),
  '处理选择做完就自动推进：两个选项落到同一个地方，不跳时段、不跳天');

/* 自由日（第 3~5 天）的脚手架：菜单两项都开着，事件节点全都汇到下一时段的菜单 */
const freeDays = [3, 4, 5];
const freeProblems = [];
for (const d of freeDays) {
  SLOT_ORDER.forEach((s, i) => {
    const hub = byId.get(`dy_d${d}_${s}_hub`);
    if (!hub) { freeProblems.push(`缺 dy_d${d}_${s}_hub`); return; }
    const locked = hub.choices.filter((c) => c.if);
    if (locked.length) freeProblems.push(`${hub.id} 是自由日，不该有锁着的地点`);
    const nextSlot = SLOT_ORDER[i + 1];
    const want = nextSlot ? `dy_d${d}_${nextSlot}_hub` : `dy_d${d + 1}_mo_hub`;
    for (const c of hub.choices) {
      const ev = byId.get(c.next);
      if (!ev) { freeProblems.push(`${hub.id} → ${c.next} 不存在`); continue; }
      if (ev.id === want) continue;                 // 菜单直接连菜单（理论上不该有）
      for (const cc of ev.choices || []) {
        if (cc.next !== want) freeProblems.push(`${ev.id} 的「${cc.text}」走到 ${cc.next}，应当是 ${want}`);
      }
    }
  });
}
t.empty(freeProblems, '第 3~5 天：选哪个地点都收在下一时段的菜单上，链是闭合的');

/* =====================================================================
 * 三、端到端：真引擎走一遍
 * =================================================================== */

/**
 * 从某个节点起走到底，把路过的节点按顺序记下来。
 * 每个决定点都挑第一个能点的；走到带 continueTo 的结局（幕与幕之间的接缝）
 * 就顺着走过去 —— 那是「继续下一幕」那颗按钮在程序里干的事，不是剧情分支。
 */
function walk(startId, pick) {
  const e = new StoryEngine(whole);
  e.enterNode(startId);
  const seen = [e.node.id];
  const note = () => { if (e.node.id !== seen[seen.length - 1]) seen.push(e.node.id); };
  for (let g = 0; g < 8000; g++) {
    const v = e.advance();
    note();
    if (v.type === 'end') {
      const ct = e.node && e.node.continueTo;
      if (!ct) return { engine: e, seen, ended: e.node.id };
      e.enterNode(ct);
      note();
      continue;
    }
    if (v.type === 'choices') {
      const list = e.availableChoices();
      e.choose(pick ? pick(e, list) : list.findIndex((c) => c.enabled));
      note();
    }
  }
  throw new Error(`${startId} 之后走不完`);
}

const full = walk('dy_d2_mo_hub', () => 0);
const walkedHubs = full.seen.filter((id) => /_hub$/.test(id));

t.section('端到端 · 第 2 天到第 6 天');
t.eq(full.ended, 'h8_end', '一路走到底是 h8_end（第三幕之后接着狩猎篇五章，第八章末才是第一幕的收束）');
t.ok(full.seen.includes('c27_end') && full.seen.includes('h4_knock'),
  '路过 c27_end 之后确实落进了狩猎篇的第一章（那根 next 接上了）');
t.eq(walkedHubs, [2, 3, 4, 5, 6].flatMap((d) => SLOT_ORDER.map((s) => `dy_d${d}_${s}_hub`)),
  '20 个时段菜单按「天 → 时段」依次路过，一个不跳、一个不倒');

const e2 = new StoryEngine(whole);
e2.enterNode('b11_sleep');
const toChoices = (e) => { for (let g = 0; g < 800; g++) { if (e.advance().type === 'choices') return e; } throw new Error('走不到决定点'); };
toChoices(e2);                                     // 第一夜演完，落在第 2 天早晨的菜单上

t.section('端到端 · 日记记得对不对');
t.eq(D.eventTexts(whole, e2, 2), [], '第一夜还没走完，第 2 天一条都还没记下');

SLOT_ORDER.forEach((s, i) => {
  e2.choose(0);                                    // 选本时段的地点
  toChoices(e2);                                   // 原著段整段演完
  // 站在幕尾反应节点上、还没点的时候：这一笔还不该出现（旗是 0，和「选了 A」同形）
  t.eq(D.eventTexts(whole, e2, 2).length, i, `${s}：站在处理选择上还没迈步，日记里不该先写着做法`);
  e2.choose(0);
});
const day2 = D.collect(whole, e2, 2);
t.eq(day2.map((x) => x.slot), ['早晨', '中午', '午后', '夜晚'], '四时段走完，四条按「早晨 → 夜晚」排好');
t.eq(day2.map((x) => x.node), ['dy_d2_mo_r', 'dy_d2_nn_r', 'dy_d2_af_r', 'dy_d2_ni_r'],
  '每条都对得上它那个时段的幕尾反应节点');

const e2b = new StoryEngine(whole);
e2b.enterNode('dy_d2_mo_hub');
SLOT_ORDER.forEach(() => {
  e2b.choose(0);
  toChoices(e2b);
  e2b.choose(1);                                   // 这一遍全走 B 路
});
const day2b = D.eventTexts(whole, e2b, 2);
t.eq(day2b.length, 4, 'B 路也是四条');
t.ne(JSON.stringify(day2b), JSON.stringify(day2.map((x) => x.text)), '同一时段的 A / B 两条路，日记里写的是两件事');

t.section('端到端 · 还没写的日子');
const e3 = walk('dy_d3_mo_hub', () => 0);
/* 自由日走完也是四条 —— 一天几笔只认那一天的记录旗，和主线日同一个规矩。
   走全 A 和走全 B 记下来的得是两页不一样的话（地点不同、做法也不同）。 */
t.eq(D.eventTexts(whole, e3.engine, 3).length, 4, '第 3 天走完是四条');
t.eq(D.eventTexts(whole, e3.engine, 4).length, 4, '第 4 天同理');
t.eq(D.eventTexts(whole, e3.engine, 5).length, 4, '第 5 天同理');
// 全走第二条路。自由日没有锁选项，所以到第 3~5 天就是「每条都选后一个」；
// 主线日那几个灰掉的地点不算（list 里带着它们，索引得先筛一遍 enabled）
const e3b = walk('dy_d3_mo_hub', (e, list) => {
  const on = list.map((c, i) => (c.enabled ? i : -1)).filter((i) => i >= 0);
  return on[on.length - 1];
});
const day3b = D.eventTexts(whole, e3b.engine, 3);
t.eq(day3b.length, 4, '第 3 天全走 B 也是四条');
t.ne(JSON.stringify(day3b), JSON.stringify(D.eventTexts(whole, e3.engine, 3)),
  '同一天的 A / B 两条路，日记里写的是两件事');
t.eq(e3b.engine.getStat('旗_第5天夜晚_马厩'), 0,
  '自由日的记录旗真的被写进去了（走到第 5 天夜里，旗子按最后一次选择落定）');
t.eq(D.eventTexts(whole, e3.engine, 6).length, 4, '走到第 6 天，那天照样四条 —— 一天几笔只认那一天的记录');

/* =====================================================================
 * 四、文案的硬规矩
 * =================================================================== */

t.section('文案 · 日记是「她写的」');
/* 查的是**所有**写了 diary 的选项，不只是幕尾那几条：自由日一天四条，
   每条的正文都是新写的，漏查一处就等于给自己留了一块没人看的地方。 */
const diaryTexts = (dailyStory.nodes || [])
  .flatMap((n) => (n.choices || []).map((c) => c.diary))
  .filter((x) => typeof x === 'string' && x);
/* 「她写的」那一页的**每一档**都要一起查：档 2~4 是新写的正文，
   漏查一段就等于给自己留了一块没人看的地方。 */
const bodies = (dailyStory.diary.entries || []).flatMap((e) => (e.body || [])
  .concat(Object.keys(e.tiers || {}).sort().flatMap((k) => e.tiers[k])));
t.eq(diaryTexts.length, 64, '64 条题材（幕尾反应 16 + 自由日 48）一条不落');
t.eq((dailyStory.nodes || []).filter((n) => n._scaffold).length, 0, '自由日的脚手架一个不剩');
t.ok(bodies.length >= 4 + 8 + 8, '正文查的是每一档，不只是 body');
t.empty(diaryTexts.concat(bodies).filter((s) => /\d/.test(s)),
  '日记里不出现数字 —— 它读起来得像一个人写给自己看的东西，不是一行日志');
t.empty(diaryTexts.concat(bodies).filter((s) => /奥布里|沃大人|好感|亲密|埋怨|恨意/.test(s)),
  '日记里不出现玩家的名字，也不出现属性名 —— 玩家是那件事的原因，不是那句话的主语');
t.empty((dailyStory.diary.entries || []).filter((e) => !(e.body || []).length).map((e) => e.day),
  '每页都得有「她写的」那一半');

t.section('原文核对 · 日常层刻意不入');
const fidelitySrc = fs.readFileSync(path.join(ROOT, 'tests', 'fidelity.cjs'), 'utf8');
const checked = [...fidelitySrc.matchAll(/require\(path\.join\(ROOT,\s*([^)]*)\)\)/g)]
  .map((m) => m[1].replace(/\s|'|"/g, ''));
t.empty(checked.filter((p) => /daily/.test(p)),
  'ACTS 里没有日常层：它的文本是新写的，进去就会被正查拦下');
// 狩猎篇不一样 —— 它是原著（store/第四～第八章），一章一文件地进核对。
// 阶段 6 之前这里写的是「daily|hunt 都不许出现」，狩猎篇落地之后只剩 daily 这一条红线。
t.eq(checked.filter((p) => /hunt/.test(p)).length, 5,
  '狩猎篇五章逐章进了原文核对（store 第四章～第八章，一章配一份 hunt/chN.json）');

/* =====================================================================
 * 五、界面接入（无头）
 * =================================================================== */

/** 起一个装好的界面 + 挂上 daily.js，等价于浏览器里 index.html 末尾那四行 */
function bootDaily() {
  const dom = loadDom();
  const engine = new StoryEngine(whole);
  const ui = new uiApi.Act1UI(engine, { doc: dom.doc, win: dom.win });
  ui.mount();
  ui.start();
  ui.showTitleScreen();

  dom.win.DailyDiary = D;
  dom.win.act1 = { engine, ui, story: whole, report: null };
  const sandbox = {
    window: dom.win,
    document: dom.doc,
    MutationObserver: dom.win.MutationObserver,
    setTimeout: dom.win.setTimeout,
    clearTimeout: dom.win.clearTimeout,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(DAILY_SRC, sandbox, { filename: 'daily/daily.js' });
  return { ...dom, engine, ui, DailyUI: dom.win.DailyUI };
}

const b = bootDaily();
const hud = b.doc.getElementById('hud');
const btn = hud.children[0];
const clock = b.doc.body.children.filter((e) => e._class.has('dy-clock'))[0];
const screen = b.doc.body.children.filter((e) => e._class.has('dy-diary-screen'))[0];
const inBook = (cls) => screen.getElementsByClassName(cls)[0];

/** 走到第 2 天早晨的菜单（等于「第一夜演完、天亮了」） */
function enterDay2(env) {
  env.engine.enterNode('dy_d2_mo_hub');
  return env;
}

/** 把这个时段走完：选地点 → 原著段演完 → 做一次处理选择 */
function finishSlot(env) {
  env.engine.choose(0);
  for (let g = 0; g < 800; g++) { if (env.engine.advance().type === 'choices') break; }
  env.engine.choose(0);
}

t.section('界面 · HUD');
t.ok(btn && btn._class.has('dy-diary-btn'), '【日记】按钮长在 #hud 里');
t.ok(btn && hud.children[0] === btn, '而且是 HUD 的第一颗按钮（它是这一层唯一要玩家主动去点的东西）');
t.ok(clock && screen, '时间牌子和日记本都是运行时造的，挂在 body 上');
t.eq(b.doc.__ids && [...b.doc.__ids].filter((id) => /^dy_/.test(id)), [],
  'daily.js 一个 id 都没往页面上加（dom-stub 是按 index.html 的 id 正则扫元素的，加了就要改 ui.js 的 mount() 清单）');

t.ok(!clock._class.has('on'), '刚开始（第 1 天）还没有时间牌子');
t.eq(btn.style.display, 'none', '第 1 天也没有【日记】按钮 —— 日常模式从第二天开始');

enterDay2(b);
t.ok(clock._class.has('on'), '走进第 2 天，时间牌子亮起来');
t.eq(clock.getElementsByClassName('dy-clock-day')[0].textContent, '第 2 天', '牌子上写着第几天');
t.eq(clock.getElementsByClassName('dy-clock-slot')[0].textContent, '早晨', '还有时辰（跟随 nodeId，读到哪个时段就是哪个）');
t.eq(btn.style.display, '', '第 2 天起【日记】按钮在');
t.eq(btn.disabled, true, '还没做过任何处理选择：按钮在，但是暗的（「暗」而不是「藏」）');
t.eq(btn.title, '今天还没有记下什么', '暗着的时候鼠标悬停有一句说明');

finishSlot(b);
t.eq(clock.getElementsByClassName('dy-clock-slot')[0].textContent, '中午',
  '一个时段走完，时辰自己往前走一格（时间随 nodeId 走，不用谁去推）');
t.eq(btn.disabled, false, '刚做了一次处理选择，今天已经有一笔了 —— 按钮是亮的');
t.ok(btn._class.has('dy-ready'), '亮起来的样子是 .dy-ready（和「查看数值」是同一套语言）浏览器实测见 tests/shots.cjs');

t.section('界面 · 摊开的那本册子');
const opened = b.DailyUI.openDiary();
t.eq(opened, undefined, 'openDiary() 没有返回值，成功与否看下面这块');
t.ok(b.DailyUI.isOpen(), '点了【日记】，书摊开了');
t.eq(inBook('dy-diary-title').textContent, '西比拉手记', '书名');
t.eq(inBook('dy-diary-day').textContent, '第 2 日', '日期用的是数据里写死的那个（不引入随机，读档之后不会变）');
t.eq(inBook('dy-diary-weather').textContent, '阴', '天气同理');
t.eq(inBook('dy-diary-events').children.length, 1, '今日事件就是今天真记下的那一条');
t.eq(D.tierOf(b.engine), 1, '刚开局关系还没动过，落的是档 1');
t.eq(inBook('dy-diary-note').textContent,
  dailyStory.diary.entries.find((e) => e.day === 2).body.join('\n\n'),
  '「她写的」那一半是 diary.entries[].body（档 1）—— 不是节点台词，不进 dialogues');
t.eq(inBook('dy-diary-note').textContent, D.bodyFor(whole, b.engine, 2).join('\n\n'),
  '而确实是走 bodyFor 算出来的那一档');
t.eq(screen.getElementsByClassName('dy-diary-cover').length, 1, '书皮也在（「缓缓打开」全靠它绕着书脊转）');

b.DailyUI.closeDiary();
t.ok(!b.DailyUI.isOpen(), '点了「合上」，书收起来（不推进剧情、不消耗时段）');

t.section('界面 · 第一天的册子（剧情入口，不是按钮）');
{
  /* 第 1 天没有【日记】按钮 —— 那一天是剧情：她写完、敲门把册子递上来。
     入口在 daily.js 的捕获阶段，判据是 diary.js 的 atLastLine（最后一句之后）。 */
  const g = bootDaily();
  const gScreen = g.doc.body.children.filter((e) => e._class.has('dy-diary-screen'))[0];
  const gIn = (cls) => gScreen.getElementsByClassName(cls)[0];
  const gClock = g.doc.body.children.filter((e) => e._class.has('dy-clock'))[0];

  g.engine.enterNode('dy_d2_mo_intro');
  g.pokeObservers();
  t.eq(g.DailyUI.introPhase(), 'idle', '刚跨进引入场：这一轮还是待命的');
  t.ok(!g.DailyUI.isOpen(), '书没开');

  // 还在前几句上：这一下空格该交给 ui.js 推台词，不该摊开册子
  const early = g.fireKey(' ');
  t.ok(!early.__stopped, '还没到最后一句，空格不被拦');
  t.ok(!g.DailyUI.isOpen(), '册子还没摊开 —— 人还没把册子递上来');
  t.eq(g.DailyUI.introPhase(), 'idle', '这一轮没被消耗掉，后面还认');

  const total = g.engine.visibleLines().length;
  while (g.engine.lineIndex < total) g.engine.advance();
  g.pokeObservers();
  t.ok(D.atLastLine(g.engine, 'dy_d2_mo_intro'), '推到「最后一句已经播完」那一格');

  const fired = g.fireKey(' ');
  t.ok(fired.__stopped, '这一下被捕获阶段拦住了（不然 ui.js 会先把人推出这一场）');
  t.ok(g.DailyUI.isOpen(), '册子摊开了');
  t.eq(g.DailyUI.introPhase(), 'open', '阶段进到 open');
  t.eq(gClock.getElementsByClassName('dy-clock-day')[0].textContent, '第 2 天',
    'HUD 上这会儿是第 2 天早晨 —— 这场戏发生在天刚亮');
  t.eq(gIn('dy-diary-day').textContent, '第 1 日',
    '摊开的却是第 1 日那一页：日记的日期记的是**被写的那一天**');
  t.eq(gIn('dy-diary-weather').textContent, '雨', '那天在下雨（原著里到普里森堡就是一整天的雨）');
  t.eq(gIn('dy-diary-events').style.display, 'none', '那天一件记事都没有：今日事件整块收掉');
  t.eq(gIn('dy-diary-rule').style.display, 'none', '连分隔线也一起收掉，不留一块空白');
  t.eq(gIn('dy-diary-note').textContent, dailyStory.diary.entries[0].body.join('\n\n'),
    '一页纸上只有她自己的字');
  t.eq(g.doc.getElementById('hud').children[0].disabled, true,
    '这会儿【日记】按钮还是暗的（第 2 天今天还没有记录）');

  g.DailyUI.closeDiary();
  t.ok(!g.DailyUI.isOpen(), '合上');
  t.eq(g.DailyUI.introPhase(), 'done', '这一轮过去了');

  const after = g.fireKey(' ');
  t.ok(!after.__stopped, '合上之后再按空格，照常交给 ui.js');
  t.ok(!g.DailyUI.isOpen(), '不会又摊开一次');
  t.eq(g.engine.node.id, 'dy_d2_mo_hub',
    '这一下推进到第 2 天早晨的菜单 —— 背后那句台词是念给玩家听的，不跳');
}

t.section('界面 · 书开着的时候，空格不许漏到背后去');
b.DailyUI.openDiary();
t.ok(b.DailyUI.isOpen(), '书开着');
const lineBefore = b.engine.lineIndex;
const blocked = b.fireKey(' ');
t.ok(blocked.__stopped, '书开着时的输入被捕获阶段拦住了（stopImmediatePropagation —— 同节点上光 stopPropagation 拦不住）');
t.ok(blocked.__prevented, '顺手 preventDefault');
t.eq(b.engine.lineIndex, lineBefore, '拦住了就是没推进 —— 背后的对话一句都没动');
b.DailyUI.closeDiary();

// 合上之后空格要照常交给 ui.js。另起一局，让界面自己走到第一句上，
// 这样「有没有推进」看 ui.view 就够了（不用猜 ui.js 内部状态）
const k = bootDaily();
k.ui.begin();
while (k.ui.view.type !== 'line') k.ui.step();
const viewBefore = k.ui.view;
const passed = k.fireKey(' ');
t.ok(!passed.__stopped, '书没开的时候，空格不会被拦');
t.ne(k.ui.view, viewBefore, '而且真的推到了下一句 —— 拦住的那一下才是特例，平时一切照旧');

t.section('界面 · 还没挂上的时候');
{
  // ui.js 的 boot() 是异步的，daily.js 只是排在它后面先加载、再等 window.act1。
  // 两头差着最多 30ms：无头截图脚本就是在这个缝里点 openDiary 的 —— 那时候
  // 把手已经存在（脚本末尾同步挂的），书还没造出来。不许炸。
  const late = loadDom();
  late.win.DailyDiary = D;
  const sandbox = {
    window: late.win, document: late.doc, MutationObserver: late.win.MutationObserver,
    setTimeout: late.win.setTimeout, clearTimeout: late.win.clearTimeout, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(DAILY_SRC, sandbox, { filename: 'daily/daily.js' });
  t.ok(late.win.DailyUI, '把手是脚本一加载就挂上的（不等 mount）');
  let threw = null;
  try { late.win.DailyUI.openDiary(); late.win.DailyUI.closeDiary(); } catch (err) { threw = err; }
  t.eq(threw && threw.message, null, '剧本还没读进来时点它，什么都不发生，也不报错');
  t.eq(late.win.DailyUI.isOpen(), false, '没挂上就谈不上开着');
}

t.section('界面 · 开始界面盖住时间牌子');
b.engine.enterNode('dy_d2_mo_hub');
const titleEl = b.doc.getElementById('title-screen');
titleEl.classList.add('on');
b.pokeObservers();
t.ok(clock._class.has('dy-hidden'), '开始界面收起来之前，左上角那块牌子藏起来（它下面不是不透明的一层）');
titleEl.classList.remove('on');
b.pokeObservers();
t.ok(!clock._class.has('dy-hidden'), '开始界面收掉，牌子回来');

t.done();
