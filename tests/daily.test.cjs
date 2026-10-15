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
// 狩猎篇也拼进来：日常层第 6 天夜里接着 hunt/ch4 的首节点，
// 少了这六份（含第九章），「一路走到底」那条会停在悬空的 next 上。
const huntStories = [4, 5, 6, 7, 8, 9].map((n) => require(path.join(ROOT, 'hunt', `ch${n}.json`)));
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
     人还没把册子递上来，书先开了。这条边距只有拿真引擎逐句推才看得见。
     第二轮回填后这场戏在第一夜（b8_diary_writing）：她领到书、写下第一笔、
     把书送回书房、回到房间 —— 最后一句之后书才摊开。 */
  const ie = new StoryEngine(whole);
  ie.enterNode('b8_diary_writing');
  const total = ie.visibleLines().length;
  t.ok(total > 1, '引入场不是一句话就完的（不然这条边距没意义）');
  t.eq(D.atLastLine(ie, 'b8_diary_writing'), false, '刚进节点、第一句还没推：不摊开');
  t.eq(D.atLastLine(ie, 'dy_d2_mo_hub'), false, '节点对不上，一律 false');
  for (let i = 1; i < total; i++) {
    ie.advance();
    t.eq(D.atLastLine(ie, 'b8_diary_writing'), false, `第 ${i + 1} 句上还不摊开`);
  }
  ie.advance();
  t.eq(ie.node.id, 'b8_diary_writing', '最后一句播完，人还停在这个节点上');
  t.eq(D.atLastLine(ie, 'b8_diary_writing'), true, '—— 就是这一下把册子摊开');
}

/* =====================================================================
 * 二、剧本
 * =================================================================== */

const dailyNodes = whole.nodes.filter((n) => /^dy_/.test(n.id));
// dy_d{天}_{时段}[_{地点}]_{类型}：地点那一段可有可无（菜单和幕尾反应没有地点）
// intro 只有 dy_d2_mo_intro 一个：第 2 天的开场（日记的剧情入口在第一夜，见下面那一段）
const DY_ID = /^dy_d\d+_(mo|nn|af|ev|ni)(_[a-z0-9]+)*_(hub|arr|e|r|intro)$/;

/* **下线的旧节点**：第二轮回填按作者新稿重排了第 2 天（中午/午后换成午餐后/午后，
   夜晚的菜单并进傍晚那场熬药），被顶掉的那几处正文一字未删地留在剧本里，
   但从菜单上下来了 —— 玩家走不到，--validate 会逐个提醒。
   这里的清单就是那批：凡是要问「这一天有什么」的地方都得把它们排除在外。 */
const RETIRED = [
  'dy_d2_mo_r',                                        // 「谁来收拾残局」（新稿里没有这一问）
  'dy_d2_nn_hl_e', 'dy_d2_nn_hl_r',                     // 旧中午·大厅（新稿换成「分配工作」）
  'dy_d2_nn_guest_e', 'dy_d2_nn_guest_r',               // 旧中午·会客厅
  'dy_d2_nn_account_e', 'dy_d2_nn_account_r',           // 旧中午·账房（并进午后的账册）
  'dy_d2_af_archive_e', 'dy_d2_af_archive_r',           // 旧午后·旧档案室
  'dy_d2_af_wall_e', 'dy_d2_af_wall_r',                 // 旧午后·西侧城墙
  'dy_d2_ni_hub', 'dy_d2_ni_paper_e', 'dy_d2_ni_paper_r', // 旧夜晚菜单（新稿到傍晚就收）
];
const liveDaily = dailyNodes.filter((n) => RETIRED.indexOf(n.id) < 0);

t.section('剧本 · 节点 id 的规矩');
t.empty(dailyNodes.filter((n) => !DY_ID.test(n.id)).map((n) => n.id),
  '所有日常层节点都是 dy_d{天}_{时段}[_{地点}]_{类型} 的形状（天与时段编进 id，存档才记得住）');
t.empty(dailyNodes.filter((n) => !D.stampOf(n.id)).map((n) => n.id),
  '每个 dy_ 节点 id 都能被 diary.js 解析出天与时段 —— 两边的规则是同一套');

const hubs = liveDaily.filter((n) => /_hub$/.test(n.id));
const reactions = liveDaily.filter((n) => /_r$/.test(n.id));
const SLOT_ORDER = ['mo', 'nn', 'af', 'ev', 'ni'];

t.section('剧本 · 标题只写地点');
// 标题栏是「你现在在哪儿」，HUD 那块牌子才是「现在第几天、什么时辰」。
// 两边各写一遍 = 同一个屏幕上把同一句话说两遍（这正是把 hub 标题改掉的原因）。
const TIME_WORD = /第\s*\d+\s*天|早晨|中午|午后|夜晚/;
t.empty(dailyNodes.filter((n) => TIME_WORD.test(n.title || '')).map((n) => `${n.id}：${n.title}`),
  '日常层没有一个节点的标题带「第几天 / 什么时辰」—— 时间只由 HUD 说');
t.empty(dailyNodes.filter((n) => !n.title).map((n) => n.id),
  '每个日常节点都有标题（读档的 toast 也要用它）');
t.eq(new Set(hubs.map((n) => n.title)).size, 1,
  '16 个活着的 _hub 节点标题是同一个地点名 —— 它们的背景都是 bg_aubrey_room，标题栏只说「你现在在哪儿」');
t.eq(new Set(hubs.map((n) => n.art && n.art.bg)).size, 1,
  '菜单的立绘背景也只有一张 —— 菜单是一块不动的界面，不是一处场景');
t.eq(hubs.length, 16, '16 个活着的 _hub：13 张时段菜单 + 3 个「煎药夜」收束 hub（第 3~5 天的夜晚）');
/* 一处活动 = 一对 _e / _r，两边标题得是同一个地名：进场和做决定之间不该换牌子。 */
{
  const seen = new Map();
  const titleSplit = [];
  for (const n of dailyNodes) {
    const m = /^(dy_d\d+_(?:mo|nn|af|ev|ni)_[a-z0-9]+)_(?:e|r)$/.exec(n.id);
    if (!m) continue;
    if (!seen.has(m[1])) seen.set(m[1], n.title);
    else if (seen.get(m[1]) !== n.title) titleSplit.push(`${m[1]}：${seen.get(m[1])} / ${n.title}`);
  }
  t.empty(titleSplit, '同一处活动的 _e 与 _r 挂着同一个地名（标题栏是「你现在在哪儿」）');
}
t.empty(dailyNodes.filter((n) => n.continueLabel).map((n) => n.id),
  '日常层一个 continueLabel 都不写 —— b25_end 已经不是结局屏了（见下面「时段是闭合的」）');

t.section('剧本 · 日记的剧情入口');
/* 设计稿 §4 的第一个入口：第 1 天不是按钮，是剧情 —— 她领到册子、当场写下第一笔。
   作者的新稿把它从**第 2 天早晨**挪回了**第一夜**：
     b8_farewell（海尔转告）→ b8_study_diary（书房里的吩咐）→ b8_diary_writing（写下第一篇手记）
   —— 最后一句播完，书当场摊开。第 2 天早晨不再交代写日记（dy_d2_mo_intro 只剩一句清晨）。 */
const intro = byId.get('b8_diary_writing');
t.ok(intro, '有 b8_diary_writing 这一个节点（第一夜写下的那一笔）');
t.eq(byId.get('b8_farewell').next, 'b8_study_diary', '送她出门之后接的是「书房里的吩咐」');
t.eq(byId.get('b8_farewell').choices, undefined,
  '送别那一场不再是决定点 —— 作者新稿把「捏枕头 / 备课文」二选一挪到写完之后');
t.eq(byId.get('b8_study_diary').next, 'b8_diary_writing', '吩咐完了回房写手记');
t.eq(byId.get('b8_study_diary').choices, undefined, '书房那一场没有岔路');
t.eq(byId.get('b8_study_diary').dialogues[0].text, '对了，西比拉小姐，奥布里大人叫您去书房一趟。',
  '第一句就是海尔转告的那一句（作者稿把它写在 b8_farewell 末尾，运行时落在这一节的开头）');
t.eq(intro.pov, '西比拉', '西比拉视角 —— 第一夜是她的');
t.eq((intro.choices || []).map((c) => c.next), ['b9_pillow', 'b10_desk'],
  '写完之后才是「捏枕头 / 备课文」二选一（原先挂在这一场前面的 b8_farewell 上）');
t.eq(intro.dialogues[intro.dialogues.length - 1].text,
  '西比拉推门进去，发现奥布里已经离开。她走到书桌旁，将厚书放在奥布里交代的位置，随后轻轻退出书房，回到自己的房间。',
  '末句是她回到房间 —— 册子摊开（第 1 日那一页）是在这一句**之后**，由 daily.js 在捕获阶段拦');
t.eq(byId.get('b11_sleep').next, 'dy_d2_mo_intro', '第一夜睡下之后接的是第 2 天的清晨');
t.eq((byId.get('dy_d2_mo_intro').dialogues || []).map((d) => d.text),
  ['第二天清晨，你回到书房。昨夜没有处理完的几份条陈仍摆在桌上。'],
  '第 2 天早晨只剩这一句 —— 写日记那件事头天夜里已经交代过了，不再重复');
t.eq(byId.get('dy_d2_mo_intro').next, 'dy_d2_mo_hub', '说完直接进第 2 天早晨的菜单');
t.ok(byId.get('dy_d2_mo_intro').povSwitch && byId.get('dy_d2_mo_intro').povSwitch.silent === true,
  '视角不弹提示 —— 日常层每个节点都带 povSwitch.silent，不然每次上下楼都要弹一次');
{
  // 「查看笔记」那一场是第 3 天的开场（接在 b25_end 之后），不是第 2 天。
  const d3intro = byId.get('dy_d3_mo_intro');
  t.ok(d3intro, '第 3 天的开场也是个 intro 节点（查看笔记）');
  t.eq((d3intro.choices || []).map((c) => c.next), ['dy_d3_mo_hub', 'dy_d3_mo_note_e'],
    '第 3 天开场有「不看 / 打开看看」两条路');
  t.eq((byId.get('dy_d3_mo_note_e').choices || []).length, 0, '「打开看看」落在一个没有选项的过场节点上');
  const d3pick = d3intro.choices[1];
  t.eq((d3pick.effects || []).map((e) => e.stat), ['奥布里_道德'],
    '「打开看看」扣的是奥布里_道德 —— 全剧本唯一动这个数值的地方');
}
{
  // 来路只有一条：谁都别想绕开这一场直接进第 2 天
  const sources = whole.nodes
    .filter((n) => n.next === 'dy_d2_mo_intro' || n.continueTo === 'dy_d2_mo_intro'
      || (n.choices || []).some((c) => c.next === 'dy_d2_mo_intro'))
    .map((n) => n.id);
  t.eq(sources, ['b11_sleep'], '它的来路只有 b11_sleep 一条');
  const introSources = whole.nodes
    .filter((n) => n.next === 'b8_diary_writing' || n.continueTo === 'b8_diary_writing'
      || (n.choices || []).some((c) => c.next === 'b8_diary_writing'))
    .map((n) => n.id);
  t.eq(introSources, ['b8_study_diary'], '册子摊开那一场也只从书房那一节进');
  const studySources = whole.nodes
    .filter((n) => n.next === 'b8_study_diary' || (n.choices || []).some((c) => c.next === 'b8_study_diary'))
    .map((n) => n.id);
  t.eq(studySources, ['b8_farewell'], '书房那一节的来路只有送别');
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
const MENU_IDS = {
  dy_d2_mo_hub: 3, dy_d2_nn_hub: 3, dy_d2_af_hub: 2,
  dy_d3_mo_hub: 2, dy_d3_nn_hub: 3, dy_d3_ev_hub: 2,
  dy_d4_mo_hub: 2, dy_d4_nn_hub: 3, dy_d4_ev_hub: 2,
  dy_d5_mo_hub: 2, dy_d5_nn_hub: 3,
  dy_d6_mo_hub: 2, dy_d6_nn_hub: 3,
};
t.eq(Object.keys(MENU_IDS).length, 13,
  '13 张时段菜单（第 2 天 3 + 第 3 天 3 + 第 4 天 3 + 第 5 天 2 + 第 6 天 2）—— ' +
  '第 2 天按新稿收在傍晚那场熬药上，夜晚的菜单下线了');
t.eq(hubs.length - Object.keys(MENU_IDS).length, 3, '另外 3 个 _hub 是第 3~5 天的煎药夜收束（没有选项）');
const menuProblems = [];
for (const [id, n] of Object.entries(MENU_IDS)) {
  const hub = byId.get(id);
  if (!hub) { menuProblems.push(`${id} 不存在`); continue; }
  if ((hub.choices || []).length !== n) menuProblems.push(`${id} 有 ${(hub.choices || []).length} 个选项，应当 ${n}`);
  if (hub.next) menuProblems.push(`${id} 写了 next —— 写了就再也回不到菜单`);
  for (const c of hub.choices || []) {
    if (c.if || c.lockedHint) menuProblems.push(`${id}「${c.text}」带着 if / lockedHint —— 菜单项必须永远可点`);
    if (!byId.has(c.next)) menuProblems.push(`${id}「${c.text}」指向不存在的 ${c.next}`);
  }
  const dests = (hub.choices || []).map((c) => c.next);
  if (new Set(dests).size !== dests.length) menuProblems.push(`${id} 有两个选项通向同一处`);
}
t.empty(menuProblems, '每张菜单：选项数目按稿子、永远可点、各去各的地方');
t.empty(dailyNodes.flatMap((n) => (n.choices || []).filter((c) => c.lockedHint).map((c) => `${n.id}「${c.text}」`)),
  '日常层一块 lockedHint 都没有 —— 没有灰着的选项');
{
  const bad = [];
  for (const id of ['dy_d3_ni_hub', 'dy_d4_ni_hub', 'dy_d5_ni_hub']) {
    const n = byId.get(id);
    if (!n || (n.choices || []).length || !n.next) bad.push(id);
  }
  t.empty(bad, '第 3~5 天的煎药夜是收束 hub：没有选项、一根 next 收尾');
}

t.section('剧本 · 主线不可跳过');
// 第 2 天早晨：原著授课线（b12～b22）只从本时段的菜单进；另两处标成「没亲历」走默认结算。
{
  const wrong = [];
  const d2hub = byId.get('dy_d2_mo_hub');
  if (d2hub.choices[0].next !== 'b12_morning') wrong.push('第一项不是 b12_morning');
  for (const c of d2hub.choices.slice(1)) if (c.skip !== 'b12_morning') wrong.push(`「${c.text}」没写 skip`);
  const sources = whole.nodes.filter((n) => n.next === 'b12_morning' || n.continueTo === 'b12_morning'
    || (n.choices || []).some((c) => c.next === 'b12_morning')).map((n) => n.id).sort();
  if (JSON.stringify(sources) !== JSON.stringify(['dy_d2_mo_hub'])) {
    wrong.push(`b12_morning 的来路是 ${sources}`);
  }
  /* 新稿的「活动 A」是**整条**原著授课线：b12_morning → … → b15_hair → b16_montage
     → b17_scream → … → b22_after → 午餐。首轮把 b12~b16 脱了链（那会儿只走对抗段），
     本轮接回来 —— 一间一节地对一遍，免得半路又断在哪里。 */
  const CHAIN = [
    ['b12_morning', 'b13_door'], ['b13_door', 'b14_dressing'], ['b14_dressing', 'b15_hair'],
    ['b15_hair', 'b16_montage'], ['b16_montage', 'b17_scream'], ['b17_scream', 'b18_classroom'],
    ['b18_classroom', 'b19_aubrey'], ['b20_lesson', 'b21_haier_calls'],
    ['b21_haier_calls', 'b22_after'], ['b22_after', 'dy_d2_nn_meal_e'],
  ];
  for (const [from, to] of CHAIN) {
    const n = byId.get(from);
    if (!n || n.next !== to) wrong.push(`${from} → ${n && n.next}，应当是 ${to}`);
  }
  t.eq(byId.get('b19_aubrey').choices.length, 3, '对抗段那个三选一还在（旗_授课方式 1/2/3）');
  t.empty(wrong, '授课线只从第 2 天早晨的菜单进，一路接回午餐 —— 一节不落');
}

t.section('剧本 · 处理选择节点');
/* 处理选择（_r）只在作者写了「选择：」的地方落 —— 第二轮回填后一共 10 个：
   第 2 天 6 个（早晨 2 + 午餐后 3 + 午后 1）、第 3 天 1 个、
   第 4 天 2 个、第 5 天 1 个。没有「选择：」的活动就是一段 _e 直连下一拍。 */
t.eq(reactions.length, 10, '10 个 _r 节点（第 2 天 6 + 第 3 天 1 + 第 4 天 2 + 第 5 天 1）');
/* 记日记的是「她的日子」那五处（午餐后的大厅 / 外院 / 后坡、任务簿、傍晚的后坡）；
   其余是政务与别人的事（修桥、马匹、账册、伊莎贝尔偷吃甜点……）——
   玩家怎么处理世界的事，日记不重述，两项也就不挂记录旗。 */
const DIARY_R = ['dy_d2_nn_hall_r', 'dy_d2_nn_yard_r', 'dy_d2_af_hil_r', 'dy_d3_nn_hall_r', 'dy_d4_ev_hill_r'];
t.eq(reactions.filter((n) => (n.choices || []).some((c) => typeof c.diary === 'string' && c.diary)).map((n) => n.id),
  DIARY_R, '有日记取材的处理选择就这五处 —— 她的日子与府里的公事分得开');
t.empty(reactions.filter((n) => (n.choices || []).length < 2).map((n) => `${n.id}：${(n.choices || []).length} 个`),
  '每个处理选择至少两个方向 —— 一条路撑不起一次选择' +
  '（外院那一处是作者稿的三选一：留饭 / 先吃 / 交给布朗）');
t.empty(reactions.flatMap((n) => (n.choices || []).filter((c) => !byId.has(c.next))
  .map((c) => `${n.id} → ${c.next}`)), '处理选择的每一条都指向真的节点');

/* 「落点」= 当天的下一个时段菜单 / 当天的收束（第 2 天 b25_end、第 6 天夜晚分流节点）。 */
const DAY_TERMINAL = { 2: 'b25_end', 3: 'dy_d4_mo_hub', 4: 'dy_d5_mo_hub', 5: 'dy_d6_mo_hub', 6: 'dy_d6_ni_night_e' };
const isStopNode = (id, day) => /^dy_d\d+_.*_hub$/.test(id) || id === DAY_TERMINAL[day];
const convProblems = [];
for (const n of reactions) {
  const day = D.stampOf(n.id).day;
  const landings = [];
  for (const i of n.choices.map((_, k) => k)) {
    const e = new StoryEngine(whole);
    e.enterNode(n.id);
    let landed = null;
    e.on('node', (p) => { if (landed === null && isStopNode(p.node.id, day)) landed = p.node.id; });
    e.choose(i);
    for (let g = 0; g < 500 && landed === null; g++) {
      const v = e.advance();
      if (v.type === 'end') { landed = 'END:' + e.node.id; break; }
      if (v.type === 'choices') e.choose(0);
    }
    landings.push(landed);
  }
  if (landings[0] !== landings[1]) convProblems.push(`${n.id}：两条路分别落在 ${landings.join(' / ')}`);
  if (!isStopNode(landings[0], day)) convProblems.push(`${n.id} 没有落到当天的下一站（${landings[0]}）`);
}
t.empty(convProblems, '每个处理选择的两项收在同一个落点上 —— 怎么处理不改变她接下来去哪儿');

/* 记录旗 = 日记的取数位：一项一面、静默、0/1 分得开，旗名带着自己的时段。 */
const slotCn = { mo: '早晨', nn: '中午', af: '午后', ev: '傍晚', ni: '夜晚' };
const flagProblems = [];
for (const n of reactions.filter((x) => DIARY_R.indexOf(x.id) >= 0)) {
  const flags = (n.choices || []).map((c) => (c.effects || []).filter((e) => D.isRecordStat(e.stat)));
  flags.forEach((fs, i) => {
    if (fs.length !== 1) {
      flagProblems.push(`${n.id} 第 ${i + 1} 项挂了 ${fs.length} 个记录旗 —— 日记靠"这一个"旗判断成不成立`);
    }
    for (const f of fs) {
      if (!(f.stat in STAT_LABELS)) flagProblems.push(`${n.id} 的 ${f.stat} 不在 config.statLabels 里`);
      // 记录旗是日记的取数位，不是给玩家的奖励反馈：记下来，但一个字都不说
      if (f.silent !== true) flagProblems.push(`${n.id} 的 ${f.stat} 没写 "silent": true`);
      if (f.note) flagProblems.push(`${n.id} 的 ${f.stat} 写了 note —— 静默的旗不该有提示文案`);
      /* 旗面本身还是「这一笔记下来了没有」，但一条活动有几个方向，旗就有几个值：
         两难是 0/1（首轮那几处），作者写了三选一的就是 0/1/2/3 里的三个。
         上限 3 是**合同的一部分**：再多就不该塞进一面旗，该换一张表。 */
      if (!Number.isInteger(f.value) || f.value < 0 || f.value > 3) {
        flagProblems.push(`${n.id} 的 ${f.stat} 值是 ${f.value} —— 只许 0~3`);
      }
    }
  });
  /* 两项必须共用**同一个**旗：一个「这个时段记下来了没有」的取数位，
     值按做法分岔（0 / 1）。各挂各的旗的话，日记要同时问两个问题。 */
  const names = flags.map((fs) => fs.map((f) => f.stat).join(','));
  if (new Set(names).size !== 1) flagProblems.push(`${n.id} 两项的旗不是同一面（${names.join(' / ')}）`);
  const values = flags.map((fs) => fs.map((f) => f.value).join(','));
  if (new Set(values).size !== values.length) {
    flagProblems.push(`${n.id} 两项的旗值一样（${values.join(' / ')}）—— 两条路就分不出来了`);
  }
  /* 旗名里得带着这个时段 —— 免得两天两处活动的旗撞在一起 */
  const st = D.stampOf(n.id);
  if (names[0] && names[0].indexOf(`第${st.day}天${slotCn[st.key]}`) < 0) {
    flagProblems.push(`${n.id} 的旗名 ${names[0]} 里没写第几天/什么时辰 —— 会和别的时段撞`);
  }
}
t.empty(flagProblems, '记录旗每项一面、定义过、静默、值分得开（0 / 1），而且旗名带着自己的时段');
t.empty(reactions.filter((n) => DIARY_R.indexOf(n.id) < 0).flatMap((n) => (n.choices || [])
  .filter((c) => c.diary || (c.effects || []).some((e) => D.isRecordStat(e.stat)))
  .map((c) => `${n.id}「${c.text}」`)),
  '不记日记的政务选择：两项都不写 diary、也不挂记录旗 —— 日记不重述玩家的每个动作');

// 真把两条路各走一遍，看旗有没有从哪条缝里漏出一句话来。
// 「留了记录」这件事本身不提示 —— 否则 A 路（旗 0，不出声）和 B 路（旗 1，
// 弹一句「这一笔，她会自己记下来。」）就是两种不同的手感，等于把日记当奖励在发。
const flagLeak = [];
const branchProblems = [];
for (const n of reactions.filter((x) => DIARY_R.indexOf(x.id) >= 0)) {
  const marks = [];
  for (const i of n.choices.map((_, k) => k)) {
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
      marks.push(e.getStat(f.stat));
    }
  }
  /* 每一项都是取数位：同一节点几条路必须落成**几个互不相同的数**
     （哪个是哪个由剧本定，不统一要求），而且都得在 0~3 里。 */
  if (new Set(marks).size !== marks.length) branchProblems.push(`${n.id} 有几条路记成了一样：${marks.join('/')}`);
  if (!marks.every((v) => Number.isInteger(v) && v >= 0 && v <= 3)) {
    branchProblems.push(`${n.id} 记的不是 0~3：${marks.join('/')}`);
  }
}
t.empty(flagLeak, 'A / B 两条路都只留记录、不出提示（engine 的 effects 认 "silent": true）');
t.empty(branchProblems,
  '每个日记取材的几条路在记录里都分得开（一面旗，几个互不相同的值）—— 日记正文要靠它分岔');

t.empty(Object.keys(act1.config.statNotes).filter((k) => D.isRecordStat(k)).map((k) => `${k}：${act1.config.statNotes[k]}`),
  'config.statNotes 里一条记录旗的文案都没有 —— 留着就是等哪天一不留神弹出来');

t.section('剧本 · 每天都是闭合的');
/* 当天有哪些时段：从 hub 表里推，顺序就是 SLOTS 的顺序 —— 不写死一张表。 */
const hubsByDay = {};
for (const n of hubs) {
  const st = D.stampOf(n.id);
  (hubsByDay[st.day] = hubsByDay[st.day] || []).push(n.id);
}
for (const d of Object.keys(hubsByDay)) {
  hubsByDay[d].sort((a, b) => SLOT_ORDER.indexOf(D.stampOf(a).key) - SLOT_ORDER.indexOf(D.stampOf(b).key));
}
t.eq(hubsByDay[2].length, 3,
  '第 2 天三个时段菜单（早晨 / 午餐后 / 午后）—— 午餐与傍晚是固定事件，夜晚并进傍晚那场熬药');
t.eq(hubsByDay[3].length, 4, '第 3 天四个（含傍晚）');
t.eq(hubsByDay[4].length, 4, '第 4 天四个（含傍晚）');
t.eq(hubsByDay[5].length, 3, '第 5 天三个 —— 傍晚并进午后那场决定');
t.eq(hubsByDay[6].length, 2, '第 6 天两个 —— 夜里是分流节点，不是菜单');

/* 从早晨的菜单进，随便怎么选，最后都收在当天的收束处。 */
const dayProblems = [];
for (const [day, terminal] of Object.entries(DAY_TERMINAL)) {
  const startId = day === '2' ? 'dy_d2_mo_intro' : `dy_d${day}_mo_hub`;
  const walkDay = (nodeId, depth) => {
    if (depth > 60) { dayProblems.push(`第 ${day} 天从 ${nodeId} 越走越深（成环？）`); return; }
    if (nodeId === terminal) return;
    const n = byId.get(nodeId);
    if (!n) { dayProblems.push(`第 ${day} 天走到不存在的 ${nodeId}`); return; }
    if ((n.choices || []).length) { for (const c of n.choices) walkDay(c.next, depth + 1); return; }
    if (n.route && n.route.length) { for (const r of n.route) walkDay(r.next, depth + 1); return; }
    if (n.next) { walkDay(n.next, depth + 1); return; }
    dayProblems.push(`第 ${day} 天走到 ${nodeId} 就断了（既不是收束 ${terminal}，也没有出口）`);
  };
  walkDay(startId, 0);
}
t.empty([...new Set(dayProblems)],
  '五天各走一遍：从早晨进、随便怎么选，最后都收在当天的收束处');

/* 过场不再是「结算屏」：没有台词、没有 ending、没有 continueTo，advance() 直接穿过去。 */
t.eq(byId.get('b25_end').next, 'dy_d3_mo_intro', '穿过 b25_end 就是第 3 天的开场（查看笔记）');
t.eq(byId.get('b25_end').ending, undefined, 'b25_end 不是结局节点');
t.eq(byId.get('b25_end').continueTo, undefined, 'b25_end 也没有 continueTo（顺着 next 就过去了）');
t.eq((byId.get('b25_end').dialogues || []).length, 0,
  'b25_end 一句台词都不念 —— 结算屏那层皮整个去掉了');
t.eq(byId.get('c27_end').next, 'h4_knock',
  'c27_end 没动：旧第三幕链的内部接回保留原样（正文留档，受原文核对保护）');
t.eq((byId.get('c27_end').dialogues || []).length, 10, 'c27_end 自己的十句台词一句没少');
t.eq(byId.has('fr_end_hub'), false,
  '第二幕那个「幕间自由活动」入口已经不在节点表里了');

/* ---------------------------------------------------------------------
   每一张菜单 × 每一项：真引擎走一遍 —— 选完必须先落进本时段的活动，
   再（若有处理选择就）处理，最后收在当天的下一个站点上。一处不跳。
   --------------------------------------------------------------------- */
t.section('剧本 · 每张菜单的每一项都走得到当天的下一站');
const nextStopOf = (hubId) => {
  const st = D.stampOf(hubId);
  const list = hubsByDay[st.day];
  return list[list.indexOf(hubId) + 1] || DAY_TERMINAL[st.day];
};
const walkProblems = [];
for (const hubId of Object.keys(MENU_IDS)) {
  const hub = byId.get(hubId);
  const day = D.stampOf(hubId).day;
  const want = nextStopOf(hubId);
  hub.choices.forEach((c, i) => {
    const e = new StoryEngine(whole);
    e.enterNode(hubId);
    const seen = [hubId];
    let landed = null;
    e.on('node', (p) => { if (landed === null && isStopNode(p.node.id, day)) landed = p.node.id; });
    e.choose(i);
    seen.push(e.node.id);
    for (let g = 0; g < 20000 && landed === null; g++) {
      const v = e.advance();
      if (e.node.id !== seen[seen.length - 1]) seen.push(e.node.id);
      if (v.type === 'end') { landed = 'END:' + e.node.id; break; }
      if (v.type === 'choices') {
        const j = Number.isInteger(e.node.defaultPick) ? e.node.defaultPick : 0;
        e.choose(j);
        if (e.node.id !== seen[seen.length - 1]) seen.push(e.node.id);
      }
    }
    if (landed !== want) walkProblems.push(`${hubId} 第 ${i + 1} 项落在 ${landed}，应当是 ${want}`);
    /* 选项一按下，第一脚不能是下一个菜单 —— 中间必须真的有一处活动 */
    if (isStopNode(seen[1] || '', day)) {
      walkProblems.push(`${hubId} 第 ${i + 1} 项选完直接跳过了这一处活动（下一站就是 ${seen[1]}）`);
    }
  });
}
t.empty(walkProblems, '每张菜单的每一项：选完先落进本时段的活动，再收在当天的下一站 —— 一处不跳');

/* ---------------------------------------------------------------------
   跳过的那一段，数值必须和亲历那一遍**逐项相同**。
   这是「单一数据来源」那一条的机械核对：默认走法不另写一份效果，
   而是读原著自己写的 defaultPick（engine 的 applySegmentDefaults）。
   两边的效果分开维护的话，「看没看」就变成一条隐藏的强弱路线了。
   --------------------------------------------------------------------- */
t.section('剧本 · 跳过的那一段用的是同一份数据');
/* 新时间线里唯一「会被错过、要按默认结算」的原著段：第 2 天早晨的授课线
   （b12～b22）。菜单上选了别的两处，它照样发生 —— 数值沿它自己的
   defaultPick 落（引擎的 applySegmentDefaults），补记由她自己写。 */
function witnessedDefaults(entry) {
  const e = new StoryEngine(whole);
  e.enterNode(entry);
  for (let g = 0; g < 2000; g++) {
    const v = e.advance();
    if (v.type === 'end') break;
    if (v.type === 'choices') {
      // 与 applySegmentDefaults 同一条边界：撞到时段菜单就停（它后面是下一时段）
      if (/^dy_d\d+_.*_hub$/.test(e.node.id)) break;
      const i = Number.isInteger(e.node.defaultPick) ? e.node.defaultPick : 0;
      e.choose(i);
    }
  }
  return e;
}
const SEG_ENTRIES = ['b12_morning'];
const segProblems = [];
for (const entry of SEG_ENTRIES) {
  const a = witnessedDefaults(entry);             // 亲历，每个岔口按 defaultPick
  const b = new StoryEngine(whole);
  b.applySegmentDefaults(entry);                  // 跳过，走默认
  const keys = new Set([...Object.keys(a.stats), ...Object.keys(b.stats)]);
  for (const k of keys) {
    if ((a.stats[k] || 0) !== (b.stats[k] || 0)) {
      segProblems.push(`${entry}：${k} 亲历 ${a.stats[k] || 0} / 跳过 ${b.stats[k] || 0}`);
    }
  }
  /* 没亲历的时候，那一段由她自己补记 —— 补记的时段必须就是这一段所在的时段 */
  const rec = dailyStory.diary.offstage[entry];
  if (!rec) { segProblems.push(`${entry} 没有 offstage 补记`); continue; }
  t.eq([Number(rec.day), rec.slot], [2, 'mo'], `${entry} 的补记落在第 2 天早晨（她错过的那一刻）`);
  t.ok(rec.text.length >= 30, `${entry} 的补记不是一个字`);
}
t.empty(segProblems, '授课段：跳过时的数值与「亲历 + 按默认选」逐项相同');

/* 九份补记（第 2 天原著段五份 + 第 3~6 天的课堂各一份）：
   每一份都指着一个真节点；日常层自己那些（dy_）的天/时段要和节点 id 对得上。 */
const recProblems = [];
for (const [entryId, rec] of Object.entries(dailyStory.diary.offstage)) {
  if (!byId.has(entryId)) { recProblems.push(`${entryId} 在合起来的剧本里不存在`); continue; }
  if (!slotCn[rec.slot]) { recProblems.push(`${entryId} 的补记写在没有的时段 ${rec.slot}`); continue; }
  const st = /^dy_/.test(entryId) ? D.stampOf(entryId) : null;
  if (st && (Number(rec.day) !== st.day || rec.slot !== st.key)) {
    recProblems.push(`${entryId} 的补记写在 第${rec.day}天/${rec.slot}，应当是 第${st.day}天/${st.key}`);
  }
  if (!rec.text || rec.text.length < 30) recProblems.push(`${entryId} 的补记太短`);
}
t.eq(Object.keys(dailyStory.diary.offstage).length, 9, '九份补记：第 2 天原著段五份 + 第 3~6 天的课堂各一份');
t.empty(recProblems, '每份补记都指着一个真节点，日常层那些的天/时段跟节点 id 对得上');

t.section('剧本 · 取消线那一段是作者原文');
/* 《第五天_狩猎取消线_作者原文只读.md》的正文必须原样转移，而且**只在选取消之后播**。
   源文存了一份在 store/狩猎取消线.txt（只摘正文，不含触发规则与待办注记）。
   这里做的是**拼接核对**：把节点台词按顺序拼起来、连引号带空白一起剥掉，
   应当与源文逐字相同 —— 自编、漏字、串序，三样一起堵死。 */
const CANCEL_SRC = fs.readFileSync(path.join(ROOT, 'store', '狩猎取消线.txt'), 'utf8');
const cancelNode = byId.get('dy_d5_ev_cancel_e');
t.ok(cancelNode, '有 dy_d5_ev_cancel_e 这一个节点（取消线专属那一场）');
const stripAll = (s) => String(s).replace(/[\s"'“”「」『』]/g, '');
t.eq(stripAll(cancelNode.dialogues.map((d) => d.text).join('')), stripAll(CANCEL_SRC),
  '取消线场景与作者原文逐字相同（拆分只把引号里的话挪到说话人名下，一个字没动）');
t.ok(cancelNode.dialogues.some((d) => d.text.indexOf('后日的狩猎，取消了罢') >= 0),
  '奥布里实际下令取消的那一句在场上 —— 取消分支的决定由这一段呈现');
t.ok(cancelNode.dialogues.some((d) => d.speaker === '布朗' && d.text.indexOf('我这个女儿') >= 0),
  '布朗把海尔叫「女儿」的原样保留 —— 一致性疑点只登记，不改字');
t.eq(cancelNode.title, '书房', '场景在书房（黄昏那一段，标题只写地点）');
t.eq(cancelNode.pov, '奥布里', '取消线这一段保持奥布里视角');
t.eq(cancelNode.next, 'dy_d5_ni_hub', '演完接第五天的夜晚');
{
  const sources = whole.nodes.filter((n) => n.next === 'dy_d5_ev_cancel_e'
    || n.continueTo === 'dy_d5_ev_cancel_e'
    || (n.choices || []).some((c) => c.next === 'dy_d5_ev_cancel_e')).map((n) => n.id);
  t.eq(sources, ['dy_d5_af_decision_e'], '只有周五那次决定能走进这一段（继续线一个字都不播）');
}

t.section('剧本 · 第一夜与第二天的新正文是作者原文');
/* 《普里森堡_第一二天剧情稿_第一夜日记后续衔接修正版》里那几段正文必须**逐字转移**，
   一个字都不许自己写。源文各存了一份在 store/（只摘正文，不含作者稿的说明与协作注记）：
     · store/第一夜日记衔接.txt   —— 第一夜那两场 + 第 1 日那一页
     · store/第二天新场景.txt     —— 第二天本轮新落的那些节点
   做法与首轮那条取消线一样，这里是**拼接核对**：把节点台词按顺序拼起来、
   连引号带空白一起剥掉，应当与源文逐字相同 —— 自编、漏字、串序，三样一起堵死。
   源文里的「--- 第N组」对的是节点里挂了 if 的台词（旗_授课方式 的三条路线各对一组），
   没有分组标记的节点就是一整段连续的正文。 */
function readSource(file) {
  const raw = fs.readFileSync(path.join(ROOT, 'store', file), 'utf8');
  const out = new Map();
  let id = null;
  let cur = [];
  let groups = [];
  const endGroup = () => { if (cur.length) groups.push(cur.join('')); cur = []; };
  const endSection = () => { if (!id) return; endGroup(); out.set(id, groups); groups = []; id = null; };
  for (const line of raw.split(/\r?\n/)) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) { endSection(); id = h[1]; continue; }
    if (!id) continue;                          // 文件头的说明
    if (/^---/.test(line)) { endGroup(); continue; }
    if (/^[=-]{4,}$/.test(line)) continue;      // 文件里的分隔线
    cur.push(line.trim());
  }
  endSection();
  return out;
}
/** 节点台词按「挂了同一个条件」切成连续几组 —— 与源文里的 --- 一一对应。 */
function groupDialogues(node) {
  const groups = [];
  let key = null;
  let started = false;
  for (const d of node.dialogues || []) {
    const k = d.if ? JSON.stringify(d.if) : '';
    if (!started || k !== key) { groups.push([]); key = k; started = true; }
    groups[groups.length - 1].push(d.text || '');
  }
  return groups.map((g) => g.join(''));
}
const AUTHOR_FILES = [
  ['第一夜日记衔接.txt', ['b8_study_diary', 'b8_diary_writing']],
  ['第二天新场景.txt', [
    'dy_d2_mo_intro', 'dy_d2_mo_hub', 'dy_d2_nn_meal_e',
    'dy_d2_nn_hub', 'dy_d2_nn_hall_e', 'dy_d2_nn_hall_r', 'dy_d2_nn_hall_a_e', 'dy_d2_nn_hall_b_e',
    'dy_d2_nn_yard_e', 'dy_d2_nn_yard_r', 'dy_d2_nn_yard_a_e', 'dy_d2_nn_yard_b_e', 'dy_d2_nn_yard_c_e',
    'dy_d2_nn_kitchen_e', 'dy_d2_nn_kitchen_a_e', 'dy_d2_nn_kitchen_b_e',
    'dy_d2_af_ledger_e', 'dy_d2_af_hub',
    'dy_d2_af_hil_e', 'dy_d2_af_hil_r', 'dy_d2_af_hil_a_e', 'dy_d2_af_hil_b_e',
    'dy_d2_af_yard_e', 'dy_d2_af_yard_r', 'dy_d2_af_yard_a_e', 'dy_d2_af_yard_b_e',
    'dy_d2_ev_brew_e',
  ]],
];
for (const [file, ids] of AUTHOR_FILES) {
  const src = readSource(file);
  // 「手记 · …」那一节不是节点（它是册子上的一页），下面单独对
  t.eq([...src.keys()].filter((k) => k.indexOf('手记') !== 0), ids,
    `store/${file} 的分节与覆盖的节点一一对应（少一节 = 有新正文没人在核）`);
  for (const id of ids) {
    const node = byId.get(id);
    t.ok(node, `${id} 在剧本里`);
    const want = src.get(id) || [];
    const got = groupDialogues(node);
    t.eq(got.length, want.length, `${id}：台词的组数与源文对得上`);
    got.forEach((g, i) => t.eq(stripAll(g), stripAll(want[i] || ''),
      `${id} 第 ${i + 1} 组与作者原文逐字相同`));
  }
}
{
  /* 第 1 日那一页不是节点台词（自编文本进 dialogues 是红线），所以单独对一次：
     日期 + 天气 + 她写的那几段，拼起来应当就是作者稿里那一段。 */
  const block = readSource('第一夜日记衔接.txt').get('手记 · 第 1 日') || [];
  const entry = dailyStory.diary.entries[0];
  t.eq(entry.date, '第 1 日', '她写的是第 1 日');
  t.eq(entry.weather, '雨', '那天在下雨');
  t.eq(stripAll([entry.date, entry.weather, ...(entry.body || [])].join('')), stripAll(block.join('')),
    '第 1 日那一页（日期 + 天气 + 她写的）与作者原文逐字相同');
}

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

t.section('端到端 · 第 2 天到第一幕收束');
t.eq(full.ended, 'h9_end', '一路走到底是 h9_end（日常层 → 狩猎篇五章 → 第九章；h8_end 只是中间一站）');
t.eq(walkedHubs, [2, 3, 4, 5, 6].flatMap((d) => hubsByDay[d]),
  '每天的时段菜单按「天 → 时段」依次路过，一个不跳、一个不倒');
t.ok(full.seen.includes('dy_d3_mo_intro') && full.seen.includes('h4_request') && full.seen.includes('h9_start'),
  '穿过 b25_end（它是空过场，一步不停）顺着日常层往下走，第 6 天夜里落进狩猎篇（h4_request），最后进第九章');
t.eq(full.seen.filter((id) => /^c\d/.test(id)), [],
  '旧第三幕链（c1～c27）不在主线上了 —— 正文留档，时间线不再从它进来');
t.eq(full.seen.filter((id) => id === 'dy_d6_ni_hunt_e').length, 1,
  '第一项就是「照原计划」：夜里走的是交付骑装那一场（继续线）');

const e2 = new StoryEngine(whole);
e2.enterNode('b11_sleep');
const toChoices = (e) => { for (let g = 0; g < 800; g++) { if (e.advance().type === 'choices') return e; } throw new Error('走不到决定点'); };
toChoices(e2);                                     // 第一夜 + 引入场演完，落在第 2 天早晨的菜单上

t.section('端到端 · 日记记得对不对');
t.eq(e2.node.id, 'dy_d2_mo_hub', '第一夜 + 引入场演完，落在第 2 天早晨的菜单上');
t.eq(D.eventTexts(whole, e2, 2), [], '第 2 天还没开始，一条都还没记下');

/** 从当前节点往前走：撞到本时段的处理选择就停（原著段里的小岔口按 defaultPick）。 */
function toReaction(e) {
  for (let g = 0; g < 3000; g++) {
    const v = e.advance();
    if (v.type === 'end') return null;
    if (v.type === 'choices') {
      if (/_hub$/.test(e.node.id)) return null;
      if (/_r$/.test(e.node.id)) return e.node.id;
      e.choose(Number.isInteger(e.node.defaultPick) ? e.node.defaultPick : 0);
    }
  }
  throw new Error('走不到这一时段的处理选择');
}
/** 在本时段的菜单上选 pick 项，一路走到处理选择（没有就给 null）。 */
function playSlot(e, pick) {
  e.choose(pick);
  return toReaction(e);
}

/** 从处理选择一路走到下一个时段菜单（本时段剩下的活动演完；原著里的小岔口按 defaultPick）。 */
function toNextHub(e) {
  for (let g = 0; g < 4000; g++) {
    if (/_hub$/.test(e.node.id)) return e.node.id;
    const v = e.advance();
    if (v.type === 'end') return null;
    if (v.type === 'choices') e.choose(Number.isInteger(e.node.defaultPick) ? e.node.defaultPick : 0);
  }
  throw new Error('走不到下一个菜单');
}

/** 走完这一天：一路推到第 3 天的开场（夜里那一格过了，当天的收束才结得清）。 */
function toDayEnd(e) {
  for (let g = 0; g < 2000; g++) {
    const v = e.advance();
    if (v.type === 'end') break;
    if (v.type === 'choices') {
      if (e.node.id === 'dy_d3_mo_intro') return e.node.id;
      e.choose(Number.isInteger(e.node.defaultPick) ? e.node.defaultPick : 0);
    }
  }
  return e.node.id;
}

/* 第 2 天三个时段：早晨走原著授课线（它自己没有 _r，选择权在 b19_aubrey 那个三选一上），
   午餐后与外院各有自己的处理选择。 */
const d2want = [['mo', null], ['nn', 'dy_d2_nn_hall_r'], ['af', 'dy_d2_af_hil_r']];
d2want.forEach(([s, want], k) => {
  const r = playSlot(e2, 0);
  t.eq(r, want, `${slotCn[s]}：${want ? '落到本时段的处理选择 ' + want : '本时段没有处理选择（授课线的选择在 b19 上）'}`);
  if (r) {
    // 站在处理选择上、还没迈步的时候：这一笔还不该出现（旗是 0，和「选了 A」同形）
    const standing = D.eventTexts(whole, e2, 2);
    t.ok(standing.indexOf(byId.get(r).choices[0].diary) < 0,
      `${slotCn[s]}：站在处理选择上还没迈步，日记里不该先写着做法`);
    e2.choose(0);
  }
  if (k < d2want.length - 1) toNextHub(e2);
});
toDayEnd(e2);                                      // 傍晚那场熬药收束，第二天结清
const day2 = D.collect(whole, e2, 2);
t.eq(day2.map((x) => x.node), ['dy_d2_nn_hall_r', 'dy_d2_af_hil_r', 'b23_corridor'],
  '第 2 天：她记下的两笔 + 没亲历的走廊那一份补记');
t.eq(day2.map((x) => x.slot), ['中午', '午后', '夜晚'],
  '按「中午 → 午后 → 夜晚」排好，每一条挂在自己的时辰上');
t.eq(day2.filter((x) => x.offstage).map((x) => x.node), ['b23_corridor'],
  '只有走廊那一份是补记 —— 授课线整条亲历过，轮不到补记');
t.eq(day2[0].text, byId.get('dy_d2_nn_hall_r').choices[0].diary, '第一笔取自她选的那一项');

/* 全走最后一条路：不去教室（授课段整段错过）、午餐后去厨房、午后去外院。 */
const e2b = new StoryEngine(whole);
e2b.enterNode('dy_d2_mo_hub');
for (let k = 0; k < 3; k++) {
  const list = e2b.availableChoices();
  const on = list.map((x, i) => (x.enabled ? i : -1)).filter((i) => i >= 0);
  const r = playSlot(e2b, on[on.length - 1]);
  if (r) e2b.choose(1);
  if (k < 2) toNextHub(e2b);
}
/* 第二天要**走完**才结账：站在傍晚那一步上时，夜晚那一格还没过去 */
t.eq(toDayEnd(e2b), 'dy_d3_mo_intro', '第二天走完，穿过 b25_end 落进第 3 天开场（查看笔记）');
const day2b = D.collect(whole, e2b, 2);
t.eq(day2b.filter((x) => x.offstage).map((x) => x.node).sort(),
  ['b12_morning', 'b16_montage', 'b17_scream', 'b21_haier_calls', 'b23_corridor'],
  '授课段整段没亲历：那五段由她自己补记');
t.eq(day2b.filter((x) => !x.offstage).length, 0,
  '厨房与外院那两处都不进她的册子（她不在场，或者那件事不值得记）');
t.eq([...new Set(day2b.map((x) => x.slot))].sort(), ['午后', '中午', '夜晚', '早晨'].sort(),
  '补记挂在她错过的那些时辰上（授课线横跨早晨到午后，走廊那一段在夜里）');
t.ne(JSON.stringify(day2b.map((x) => x.text)), JSON.stringify(day2.map((x) => x.text)),
  '同一时段的 A / B 两条路，日记里写的是两件事');

t.section('端到端 · 第 3~6 天');
const e3 = walk('dy_d3_mo_hub', () => 0);          // 一路走到第一幕收束
/* 第 3~6 天只有作者写了「选择：」的地方才记日记：任务簿一笔、傍晚后坡一笔，
   第 5、6 天没有 —— 那几天「她写的」那一页照写，事件栏是空的。 */
t.eq(D.collect(whole, e3.engine, 3).map((x) => x.node), ['dy_d3_nn_hall_r'], '第 3 天：任务簿那一笔');
t.eq(D.collect(whole, e3.engine, 4).map((x) => x.node), ['dy_d4_ev_hill_r'], '第 4 天：傍晚后坡那一笔');
t.eq(D.collect(whole, e3.engine, 5), [], '第 5 天：没有记日记的处（狩猎决定本身不写进册子）');
t.eq(D.collect(whole, e3.engine, 6), [], '第 6 天同理');
/* 没去教室的日子，课堂由她自己补记 —— 第 3~6 天各一条，挂在自己的时辰上。 */
const e3skip = new StoryEngine(whole);
e3skip.enterNode('dy_d3_mo_hub');
t.eq(playSlot(e3skip, 1), null, '第 3 天早晨不去教室：这一段没有处理选择，直接进午餐');
t.eq(D.offstageFor(whole, e3skip, 3).map((x) => x.node), ['dy_d3_mo_class_e'],
  '没亲历课堂：那一段由她自己补记（第 3 天）');
t.eq(D.offstageFor(whole, e3skip, 3)[0].slot, '早晨', '补记挂在她错过的那个时辰上');

/* 没亲历的原著段：第 2 天早晨要是花在别处，那一整段照样发生，
   只是日记里换成她自己补的一段 —— 而且**要等那个时段过去**才写得出来。 */
t.section('端到端 · 没亲历的那一段');
{
  const skip = new StoryEngine(whole);
  skip.enterNode('dy_d2_mo_hub');
  skip.choose(1);                                  // 本时段去书房，授课线整段错过
  t.eq(skip.node.id, 'dy_d2_mo_doc_e', '落在书房那处活动上（不是原著段）');
  t.eq(skip.getStat('旗_授课方式'), 2,
    '授课线按默认走法结掉了 —— b19_aubrey 的 defaultPick 是 1（「照原来的节奏教下去」→ 旗 2）');
  t.eq(toReaction(skip), 'dy_d2_mo_doc_r', '书房活动自己的处理选择');
  t.eq(D.offstageFor(whole, skip, 2), [], '这个时段还没过去，补记先不写（不然是提前剧透）');
  skip.choose(0);                                  // 处理完，推到午餐
  t.eq(skip.node.id, 'dy_d2_nn_meal_e', '接着是午餐那一场（固定事件，不是菜单）');
  t.eq(toNextHub(skip), 'dy_d2_nn_hub', '午餐演完推到午餐后的菜单');
  const rec = D.offstageFor(whole, skip, 2);
  t.eq(rec.map((x) => x.node), ['b12_morning', 'b17_scream'],
    '早晨那两段原著补记进来了 —— 补记按它自己挂的时辰走：b16 挂中午、b21 挂午后，还没到');
  t.eq(rec.map((x) => x.slot), ['早晨', '早晨'], '补记挂在她错过的那个时辰上');
  t.eq(rec.every((x) => x.offstage === true), true, '哪一条是补记的，数据里标得出来');
  const texts = D.eventTexts(whole, skip, 2);
  t.ok(!texts.includes(byId.get('dy_d2_mo_r').choices[0].diary)
    && !texts.includes(byId.get('dy_d2_mo_r').choices[1].diary),
    '下线的旧节点（dy_d2_mo_r）一个字都没漏进来 —— 它没进过 visited，旗也没人写过');
  /* 亲历过的那天：授课线不写补记，只有走廊那一份照写 */
  t.eq(D.offstageFor(whole, e2, 2).map((x) => x.node), ['b23_corridor'],
    '亲历过的授课线不写补记 —— 走廊那一段（b23）仍照写');
}

/* =====================================================================
 * 三·五、两条路线的不变量（首轮回填的验收清单，逐条落成机械检查）
 * =================================================================== */

t.section('不变量 · 周五定一次，两条路线互斥');

/** 从第 2 天早晨走完整个第一幕；decide = 周五那次决定选哪一项。 */
function playAll(decide) {
  const e = new StoryEngine(whole);
  e.enterNode('dy_d2_mo_hub');
  const seen = [e.node.id];
  const note = () => { if (e.node.id !== seen[seen.length - 1]) seen.push(e.node.id); };
  for (let g = 0; g < 20000; g++) {
    const v = e.advance();
    note();
    if (v.type === 'end') break;
    if (v.type === 'choices') {
      let i = 0;
      if (e.node.id === 'dy_d5_af_decision_e') i = decide;
      else i = e.availableChoices().findIndex((x) => x.enabled);
      e.choose(i < 0 ? 0 : i);
      note();
    }
  }
  return { engine: e, seen };
}

/* ① 只决定一次 */
{
  const deciders = whole.nodes.filter((n) => (n.choices || []).some((c) =>
    (c.effects || []).some((x) => x.stat === '旗_狩猎继续' || x.stat === '旗_狩猎取消')));
  t.eq(deciders.map((n) => n.id), ['dy_d5_af_decision_e'], '全剧本只有这一处写狩猎决定的旗');
  const flagWrites = whole.nodes.flatMap((n) => (n.choices || []).flatMap((c) => c.effects || []))
    .filter((x) => x.stat === '旗_狩猎继续' || x.stat === '旗_狩猎取消');
  t.eq(flagWrites.map((x) => x.stat + '=' + x.value).sort(), ['旗_狩猎取消=1', '旗_狩猎继续=1'],
    '两面旗各只被写过一次、都写 1 —— 没有任何一处把它写回 0（决定了就不复问）');
}

const CONT = playAll(0);   // 继续
const CANC = playAll(1);   // 取消
t.eq(CONT.seen.filter((id) => id === 'dy_d5_af_decision_e').length, 1, '继续线：决定点只经过一次');
t.eq(CANC.seen.filter((id) => id === 'dy_d5_af_decision_e').length, 1, '取消线：也只经过一次（没有第二次确认）');

/* ②③ 两条路线各自的形状 */
t.ok(CONT.seen.includes('dy_d6_ni_hunt_e') && CONT.seen.includes('h4_request'),
  '继续线：周六夜里交付骑装，紧接着进狩猎篇');
t.eq(CANC.seen.filter((id) => /^h[4-8]_/.test(id)), [], '取消线：一步都没进狩猎篇');
t.eq(CANC.seen.filter((id) => id === 'dy_d6_ni_hunt_e'), [], '取消线：没有骑装交付那一场');
t.eq(CONT.seen.filter((id) => id === 'dy_d5_ev_cancel_e'), [], '继续线：作者那一段一个字都不播');
t.ok(CANC.seen.includes('dy_d5_ev_cancel_e') && CANC.seen.includes('dy_d6_ni_cancel_e')
  && CANC.seen.includes('dy_d7_mo_care_e') && CANC.seen.includes('dy_d8_mo_pick_e'),
  '取消线：作者原文那一场 → 周六夜（占位）→ 周日照料（占位）→ 周一承接（占位）');
t.ok(CANC.seen.includes('h9_stairs'), '取消线最后并入第九章（h9_stairs）');
t.ok(CONT.seen.includes('h8_end') && CONT.seen.includes('h9_start') && CONT.seen.includes('h9_end'),
  '继续线：第八章末接第九章开场，收在 h9_end');
t.eq(CONT.seen.filter((id) => /^c\d/.test(id)), [], '两条路线都不再经过旧第三幕链（c1～c27 脱链留档）');
t.eq(CANC.seen.filter((id) => /^c\d/.test(id)), [], '取消线同理');

/* ④ 取消线三处占位：没有代写 */
{
  const bad = [];
  for (const id of ['dy_d6_ni_cancel_e', 'dy_d7_mo_care_e', 'dy_d8_mo_pick_e']) {
    const n = byId.get(id);
    const lines = n.dialogues || [];
    if (!lines.length) bad.push(`${id} 一句占位都没有`);
    for (const d of lines) {
      if (!/^\[.*\]$/.test(d.text)) bad.push(`${id} 有一行不是占位：${d.text.slice(0, 18)}`);
    }
    if (!lines.some((d) => d.text.indexOf('待作者填入') >= 0)) bad.push(`${id} 没写「待作者填入」`);
  }
  t.empty(bad, '取消线三段占位：整段用 [ ] 括起、写明待作者填入 —— 一个字都没有代写');
  t.ok((byId.get('dy_d6_ni_cancel_e').dialogues || []).some((d) => d.text.indexOf('脚部烫伤') >= 0),
    '已知结果（奥布里跌倒、撞到火盆、脚部烫伤）记在占位说明里，没有铺成正文');
}

/* ⑤ 周六夜的分流：只有继续线转西比拉视角 */
{
  const cont = new StoryEngine(whole);
  cont.enterNode('dy_d6_ni_hunt_e');
  t.eq(cont.pov, '西比拉', '交付骑装那一场是西比拉视角');
  t.eq(CANC.engine.pov, '西比拉', '取消线走到头也停在第九章（西比拉视角，且是静默切换）');
  const loud = CANC.seen.filter((id) => {
    const n = byId.get(id);
    return n && n.povSwitch && !n.povSwitch.silent && n.id !== 'dy_d6_ni_hunt_e';
  });
  t.empty(loud, '取消线一路上没有一处会弹视角切换横幅（进第九章那几步都是静默的）');
}

/* ⑥ 同一时段只走一条支线 —— 菜单上的其他活动这一次不出现 */
{
  /** 在这张菜单上选第 pick 项，一路走到当天下一站，把路过的节点全记下来。 */
  const walkOption = (hubId, pick) => {
    const day = D.stampOf(hubId).day;
    const e = new StoryEngine(whole);
    e.enterNode(hubId);
    let landed = null;
    e.on('node', (p) => { if (landed === null && isStopNode(p.node.id, day)) landed = p.node.id; });
    e.choose(pick);
    const seen = [e.node.id];
    for (let g = 0; g < 3000 && landed === null; g++) {
      const v = e.advance();
      if (e.node.id !== seen[seen.length - 1]) seen.push(e.node.id);
      if (v.type === 'end') break;
      if (v.type === 'choices') {
        e.choose(Number.isInteger(e.node.defaultPick) ? e.node.defaultPick : 0);
        if (e.node.id !== seen[seen.length - 1]) seen.push(e.node.id);
      }
    }
    return seen;
  };
  const multi = [];
  for (const hubId of Object.keys(MENU_IDS)) {
    const hub = byId.get(hubId);
    const dests = hub.choices.map((c) => c.next);
    const walks = hub.choices.map((c, i) => walkOption(hubId, i));
    /* 某一项的去处，只有选它才会走到 —— 别的项若也走得到，说明两条支线搅在一起了。
       （当天末尾的收束节点可能所有人都到，那种是「回合结束」，不是「又去了一个地方」。） */
    walks.forEach((seen, i) => {
      if (seen.indexOf(dests[i]) < 0) multi.push(`${hubId} 第 ${i + 1} 项：没走到 ${dests[i]}`);
      dests.forEach((d, j) => {
        if (j === i || seen.indexOf(d) < 0) return;
        if (walks.every((w) => w.indexOf(d) >= 0)) return;    // 大家都到，是收束
        multi.push(`${hubId} 第 ${i + 1} 项：同一次里还走过了 ${d}`);
      });
    });
  }
  t.empty(multi, '每张菜单的每一次选择都只走过那一条支线 —— 同时段的其他活动不出现');
}

/* ⑦ 没亲历就不给未亲历的信息：同一处活动按记录旗分岔，两条不同时出现 */
{
  const mealTexts = (flag) => {
    const e = new StoryEngine(whole);
    e.enterNode('dy_d4_nn_meal_b_e');
    e.applyEffects([{ stat: '旗_第4天早晨', value: flag }]);
    return e.visibleLines().map((l) => l.text);
  };
  t.eq(mealTexts(1).length, 1, '第 4 天午餐后：去没去教室，两条 if 互斥，只念一句');
  t.eq(mealTexts(0).length, 1, '另一条同理');
  t.ne(mealTexts(1)[0], mealTexts(0)[0], '而且念的是两句不一样的话（未亲历就是未亲历）');
  /* 这两条是**台词级 if**（不是选项 if）：36 行分岔旁白全靠它。
     构建时把条件摊平在台词上（d.stat 而不是 d.if）＝ 两条一起念 —— 这条钉住它。 */
  t.empty(dailyNodes.flatMap((n) => (n.dialogues || [])
    .filter((d) => d.stat !== undefined || d.all !== undefined)
    .map((d) => n.id)), '台词级的条件都收在 d.if 里 —— 摊平在台词上等于没有条件');
  const bad = [];
  for (const n of dailyNodes) {
    for (const d of n.dialogues || []) {
      if (d.if && d.if.stat && !(d.if.stat in STAT_LABELS)) bad.push(`${n.id}：${d.if.stat}`);
    }
  }
  t.empty(bad, '日常层每一条 if 都指着定义过的数值（未亲历的分岔靠同一面旗）');
}

/* ⑧ 存档快照把这一层一起带走（位置 = nodeId + stats + lineIndex，visited 也在） */
{
  const e = new StoryEngine(whole);
  e.enterNode('dy_d4_ev_hill_r');
  e.choose(1);                                     // 留下来坐了一会儿（旗 1）
  const snap = JSON.parse(JSON.stringify(e.snapshot()));
  const back = new StoryEngine(whole);
  back.restore(snap);
  t.eq(back.node.id, e.node.id, '读回来还站在原处');
  t.eq(back.getStat('旗_第4天傍晚_后坡'), 1, '记录旗在存档里 —— 日记靠它判今天记不记这一条');
  t.ok(back.visited.has('dy_d4_ev_hill_r') && back.visited.has('dy_d4_ev_hill_b_e'),
    'visited 也存回来了（补记靠它判亲历没亲历）—— 站在哪一格、迈到了哪一格都在');
  t.eq(D.stampOf(back.node, whole).day, 4, '牌子的天/时段跟着节点走，不用另存一份');
}

/* =====================================================================
 * 四、文案的硬规矩
 * =================================================================== */

t.section('文案 · 日记是「她写的」');
/* 查的是**所有**写了 diary 的选项，不只是处理选择那几条：
   每一条正文都是新写的，漏查一处就等于给自己留了一块没人看的地方。 */
const diaryTexts = (dailyStory.nodes || [])
  .flatMap((n) => (n.choices || []).map((c) => c.diary))
  .filter((x) => typeof x === 'string' && x);
/* 「她写的」那一页的**每一档**都要一起查：档 2~4 是新写的正文，
   漏查一段就等于给自己留了一块没人看的地方。 */
const bodies = (dailyStory.diary.entries || []).flatMap((e) => (e.body || [])
  .concat(Object.keys(e.tiers || {}).sort().flatMap((k) => e.tiers[k])));
/* 补记也是她写的，一起查 —— 它最容易写成「剧情摘要」，正是要防的那种口气 */
const offstageTexts = Object.values(dailyStory.diary.offstage || {}).map((r) => r.text);
t.eq(diaryTexts.length, 15,
  '15 条题材一条不落：活着的四处（大厅两条、外院三条、后坡两条、任务簿两条、傍晚后坡两条）' +
  '＋ 下线留档那两处（旧中午大厅、旧「谁来收拾残局」各两条）—— 留在文件里的字也是字，一样要查');
t.eq((dailyStory.nodes || []).filter((n) => n._scaffold).length, 0, '脚手架一个不剩');
t.eq(bodies.length, 69, '正文查的是每一档（第 1 天 4 段 + 第 2~6 天各 13 段），不只是 body');
t.eq(offstageTexts.length, 9, '九份补记（第 2 天原著段五份 + 第 3~6 天的课堂各一份）');
t.empty(diaryTexts.concat(bodies, offstageTexts).filter((s) => /\d/.test(s)),
  '日记里不出现数字 —— 它读起来得像一个人写给自己看的东西，不是一行日志');
t.empty(diaryTexts.concat(bodies, offstageTexts).filter((s) => /奥布里|好感|亲密|埋怨|恨意/.test(s)),
  '日记里不出现「奥布里」这个名字，也不出现属性名 —— 玩家是那件事的原因，不是那句话的主语');
/* 她称呼他「沃大人」—— 稿子里就是这么写的，第三幕伊莎贝尔还要问这个称呼的来历，
   所以它在日记里是**有戏的**，不是需要抹掉的玩家痕迹。 */
t.ok(offstageTexts.concat(diaryTexts).some((s) => /沃大人/.test(s)),
  '「沃大人」这个称呼照稿保留（她对他的称呼，不是系统里的名字）');
/* 补记得让玩家知道「发生了什么事、牵涉到谁、结果如何」（要求六），
   所以它不能是一句话。别的日记题材也一样 —— 一行日志的口气是要防的那个东西。 */
t.empty(offstageTexts.filter((s) => s.length < 40).map((s) => s.slice(0, 12)),
  '九份补记都写到足够详细 —— 玩家错过的那一段，得从这几行里读明白');
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

/** 把这个时段走完：选第一项 → 一路演到下一个菜单（原著段里的小岔口按 defaultPick）。 */
function finishSlot(env) {
  env.engine.choose(0);
  for (let g = 0; g < 3000; g++) {
    const v = env.engine.advance();
    if (v.type === 'end') return;
    if (v.type === 'choices') {
      if (/_hub$/.test(env.engine.node.id)) return;
      env.engine.choose(Number.isInteger(env.engine.node.defaultPick) ? env.engine.node.defaultPick : 0);
    }
  }
  throw new Error('这一时段走不完');
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
t.eq(btn.disabled, false, '还没做过任何处理选择，按钮也是亮的 —— 册子在她手上，不是「今天没写字就锁起来」');
t.eq(btn.title, '', '按钮上没有「今天还没有记下什么」那种解说');
t.ok(btn._class.has('dy-ready'), '第 2 天起一直描着金边（和「查看数值」是同一套语言）浏览器实测见 tests/shots.cjs');

finishSlot(b);
t.eq(clock.getElementsByClassName('dy-clock-slot')[0].textContent, '中午',
  '一个时段走完，时辰自己往前走一格（时间随 nodeId 走，不用谁去推）');
t.eq(btn.disabled, false, '走完一个时段，按钮照旧是亮的 —— 全天的状态都不变');

t.section('界面 · 摊开的那本册子');
const opened = b.DailyUI.openDiary();
t.eq(opened, undefined, 'openDiary() 没有返回值，成功与否看下面这块');
t.ok(b.DailyUI.isOpen(), '点了【日记】，书摊开了');
t.eq(inBook('dy-diary-title').textContent, '西比拉手记', '书名');
t.eq(inBook('dy-diary-day').textContent, '第 2 日', '日期用的是数据里写死的那个（不引入随机，读档之后不会变）');
t.eq(inBook('dy-diary-weather').textContent, '阴', '天气同理');
t.eq(inBook('dy-diary-events').children.length, 0,
  '中午这一刻还没有一笔记事：上午走的是原著授课线，而**原著段的选项不记日记**' +
  '（新稿又把原先挂在早晨末尾的那一问去掉了）；补记只在她**错过**那一段时才写');
t.eq(D.tierOf(b.engine), 1, '刚开局关系还没动过，落的是档 1');
/* 打开的这一天就是**当前这天**，所以只看得到已经形成的记录：
   她那一页是夜里写的，白天翻开还是空的 —— 它第一次露面是第二天早上那场总结。 */
t.eq(inBook('dy-diary-note').textContent, '',
  '当前的这一天，「她写的」那一页还不露面（她自己还没写）');
t.eq(inBook('dy-diary-note').style.display, 'none', '整段收掉，纸上不留一块空白');
t.eq(inBook('dy-diary-empty').style.display, '', '一时段里还没记下什么，就照实说 —— 不画空行');
t.eq(screen.getElementsByClassName('dy-diary-cover').length, 1, '书皮也在（「缓缓打开」全靠它绕着书脊转）');

/* 往前翻：前一天（第 1 日）那一页是写完的，看得见她自己的字。
   这颗按钮全天可用、能一直翻回去，就是这一轮要的手感。 */
t.eq(b.DailyUI.bookDay(), 2, '翻开时停在当前这天');
t.eq(b.DailyUI.bookMax(), 2, '能翻到的最远就是当前这天 —— 后面还没发生');
t.eq(inBook('dy-diary-pageno').textContent, '2 / 2', '页码是「第几页 / 共几页」');
t.eq(inBook('dy-diary-prev').disabled, false, '「前一天」点得动');
t.eq(inBook('dy-diary-next').disabled, true, '「后一天」到头了');
b.DailyUI.goDay(-1);
t.eq(b.DailyUI.bookDay(), 1, '翻到第 1 天');
t.eq(inBook('dy-diary-day').textContent, '第 1 日', '日期跟着翻');
t.eq(inBook('dy-diary-note').textContent, dailyStory.diary.entries[0].body.join('\n\n'),
  '「她写的」那一半是 diary.entries[].body（档 1）—— 不是节点台词，不进 dialogues');
t.eq(inBook('dy-diary-note').textContent, D.bodyFor(whole, b.engine, 1).join('\n\n'),
  '而确实是走 bodyFor 算出来的那一档');
b.DailyUI.goDay(0);
t.eq(b.DailyUI.bookDay(), 1, '翻 0 天什么也不做');
b.DailyUI.goDay(-1);
t.eq(b.DailyUI.bookDay(), 1, '第 1 天已经是最前了，再往前翻不动');
b.DailyUI.goDay(1);
t.eq(b.DailyUI.bookDay(), 2, '翻回来');
t.eq(inBook('dy-diary-note').textContent, '', '翻回当前这天，那一页又收起来了');

/* 翻开册子、来回翻页、再合上 —— 都不该动任何数值。
   这是**浏览**，不是「偷看她的私人笔记」，也不是一次行动：
   没有代价、没有收益、不记账。（「偷看扣道德」挂在第 3 天开场那个选项上
   —— 翻这颗按钮不算偷看。） */
const statsBeforeDiary = JSON.stringify(b.engine.stats);
b.DailyUI.closeDiary();
b.DailyUI.openDiary();
b.DailyUI.goDay(-1);
b.DailyUI.goDay(1);
b.DailyUI.closeDiary();
t.eq(JSON.stringify(b.engine.stats), statsBeforeDiary,
  '开册子 / 翻页 / 合上，一个数值都没动');
t.eq(b.engine.getStat('奥布里_道德'), 50,
  '翻册子不扣「奥布里_道德」—— 那个数值只挂在第 3 天开场「打开看看」那一下');

b.DailyUI.closeDiary();
t.ok(!b.DailyUI.isOpen(), '点了「合上」，书收起来（不推进剧情、不消耗时段）');

t.section('界面 · 进新一天时先把上一天摊开');
{
  /* 上一个时段走完就翻篇 —— 这件事不能只靠玩家自己想起来。
     踏进第 3 天早晨的那一刻，先把「第 2 日总结」摊在他眼前，
     合上之后才是当天的活动菜单。（设计稿 §4 的第三个入口。） */
  const s = bootDaily();
  const sScreen = s.doc.body.children.filter((e) => e._class.has('dy-diary-screen'))[0];
  const sIn = (cls) => sScreen.getElementsByClassName(cls)[0];

  s.engine.enterNode('dy_d2_mo_hub');
  for (let i = 0; i < 2; i++) finishSlot(s);
  t.eq(s.engine.node.id, 'dy_d2_af_hub', '走完早晨与午餐后，落在午后的菜单上');
  t.ok(!s.DailyUI.isOpen(), '第 2 天里书不会自己摊开 —— 总结是「翻篇」那一刻才有的事');

  s.engine.choose(0);                              // 午后：去后坡
  for (let g = 0; g < 800; g++) {
    const v = s.engine.advance();
    if (v.type === 'end') break;
    if (v.type === 'choices') {
      if (s.engine.node.id === 'dy_d3_mo_intro') break;
      s.engine.choose(Number.isInteger(s.engine.node.defaultPick) ? s.engine.node.defaultPick : 0);
    }
  }
  t.eq(s.engine.node.id, 'dy_d3_mo_intro',
    '第二天走完（傍晚那场熬药收束、穿过空过场 b25_end），落在第 3 天的开场（查看笔记）');
  t.ok(!s.DailyUI.isOpen(), '开场戏还没演完：书还合着');

  s.engine.choose(0);                              // 不看 → 第 3 天早晨的菜单
  t.eq(s.engine.node.id, 'dy_d3_mo_hub', '一脚踏进第 3 天早晨的菜单 —— 中间没有停');
  t.ok(s.DailyUI.isOpen(), '进新一天的第一个菜单：先把「第 2 日总结」摊开');
  t.eq(sIn('dy-diary-title').textContent, '第 2 日总结', '标题写的是总结（不是书名）');
  t.eq(sIn('dy-diary-day').textContent, '第 2 日', '摊开的是**被总结的那一天**');
  t.eq(sIn('dy-diary-events').children.length, 3,
    '那一天记下的三条都在：午餐后大厅那一笔、午后后坡那一笔、还有走廊那份补记');
  t.eq(sIn('dy-diary-note').textContent, D.bodyFor(whole, s.engine, 2).join('\n\n'),
    '她自己写的那一页第一次露面 —— 第 2 天里翻开是看不到的（所以总结非看不可）');
  t.eq(s.engine.node.id, 'dy_d3_mo_hub', '书摊开的时候，剧情一步没动（合上就回到这个菜单）');
  s.DailyUI.closeDiary();
  t.ok(!s.DailyUI.isOpen(), '合上之后才是第 3 天的活动菜单');
  t.eq(s.engine.node.id, 'dy_d3_mo_hub', '合上不推进剧情、不消耗时段');

  s.engine.enterNode('dy_d3_ni_hub');
  s.engine.enterNode('dy_d3_mo_hub');
  t.ok(!s.DailyUI.isOpen(), '同一天的第一个菜单只摊开一次 —— 来回走一趟不会再弹一遍');
  s.engine.enterNode('dy_d4_mo_hub');
  t.ok(s.DailyUI.isOpen(), '下一天早晨再进，摊的是「第 3 日总结」');
  t.eq(sIn('dy-diary-day').textContent, '第 3 日', '换成第 3 天那一页');
  s.DailyUI.closeDiary();
}

t.section('界面 · 时段菜单是图标卡（Stage0 那套）');
{
  /* 菜单不再是「1 / 2 / 3」的竖排列表：右下角一排图标卡，悬停浮出地点说明。
     形状和 stage0 一样 —— daily.js 只往 #choices 上挂一个类 + 塞图标，
     点击走的还是 ui.js 原来挂在 #choices 上的事件代理。 */
  const c = bootDaily();
  const cChoices = c.doc.getElementById('choices');
  const mkBtn = (i, text) => {
    const btn = c.doc.createElement('button');
    btn.className = 'choice-btn';
    btn.setAttribute('data-index', String(i));
    const key = c.doc.createElement('span'); key.className = 'choice-key'; key.textContent = String(i + 1);
    const txt = c.doc.createElement('span'); txt.className = 'choice-text'; txt.textContent = text;
    const hint = c.doc.createElement('span'); hint.className = 'choice-hint'; hint.textContent = text + '的说明';
    btn.appendChild(key); btn.appendChild(txt); btn.appendChild(hint);
    return btn;
  };
  const fill = (...names) => {
    while (cChoices.children.length) cChoices.removeChild(cChoices.children[0]);
    names.forEach((t, i) => cChoices.appendChild(mkBtn(i, t)));
    c.pokeObservers();
  };
  // id 是运行时加的（index.html 里没有），所以按类找，不按 getElementById
  const slotLabel = c.doc.body.children.filter((e) => e._class.has('dy-slot-label'))[0];
  t.eq(slotLabel.id, 'dy-slot-label', '那行小字的 id 是运行时挂上去的');

  c.engine.enterNode('dy_d3_mo_hub');
  fill('去教室看看。', '先处理书房的事。');
  t.ok(cChoices._class.has('dy-cards'), '菜单上，#choices 挂着 dy-cards（右下角那一排）');
  t.ok(slotLabel._class.has('on'), '菜单正上方那行小字亮起来');
  t.eq(slotLabel.textContent, '早晨 · 选择去向', '写着现在是几点');
  t.eq(cChoices.children.map((b) => b.getElementsByClassName('dy-icon').length), [1, 1],
    '每张卡各有一个图标（ICON_ORDER 里最特别的那个名字先命中）');
  t.ok(cChoices.children.every((b) => b.firstChild._class.has('dy-icon')),
    '图标塞在最前面 —— 卡片是「图标在上、地点名在下」');
  t.ok(cChoices.children[0].getElementsByClassName('dy-icon')[0].innerHTML.indexOf('<svg') === 0,
    '图标是描边 SVG（stroke=currentColor，颜色跟着卡片的金色走）');
  t.eq(cChoices.children[0].getElementsByClassName('choice-key').length, 1,
    '编号还在 DOM 里（CSS 把它 display:none 掉了 —— 位置本身就是提示，不需要「1 2 3」）');
  /* 已经塞过的不重复塞：菜单会被反复重画 */
  c.pokeObservers();
  t.eq(cChoices.children.map((b) => b.getElementsByClassName('dy-icon').length), [1, 1],
    '同一批按钮重复走一遍装饰，不会塞出第二个图标');

  /* 处理选择节点也有选项，但它该是原来那套竖排列表 */
  c.engine.enterNode('dy_d3_nn_hall_r');
  fill('按原来的用量记。', '让西比拉自己列出所需的东西。');
  t.ok(!cChoices._class.has('dy-cards'), '处理选择节点上，卡片那套整个摘掉（回到竖排列表）');
  t.ok(!slotLabel._class.has('on'), '时段提示那行也跟着收起来');
  t.eq(cChoices.children.map((b) => b.getElementsByClassName('dy-icon').length), [0, 0],
    '不带图标的按钮保持原样 —— 处理选择那两句长句子不会硬塞一个图标');

  /* 菜单收起（选项被点掉）之后，卡片那套也要摘掉 */
  c.engine.enterNode('dy_d3_mo_hub');
  fill('去教室看看。', '先处理书房的事。');
  t.ok(cChoices._class.has('dy-cards'), '回到菜单上又是图标卡');
  while (cChoices.children.length) cChoices.removeChild(cChoices.children[0]);
  c.pokeObservers();
  t.ok(!cChoices._class.has('dy-cards'), '选项一空（玩家点完了），卡片那套立刻摘掉');

  /* 幕尾那个自由活动锚点（fr_hub / fr_act3_hub）名字里也带 `_hub`，但它不是时段菜单：
     六项竖排列表。判据必须是 id 形状（dy_d{天}_{时段}_hub），不是「结尾是不是 _hub」——
     曾经按结尾判，于是这六项里有两项被硬塞了地点图标（截图量出来的）。 */
  for (const anchor of ['fr_hub', 'fr_act3_hub']) {
    c.engine.enterNode(anchor);
    fill('一览', '后坡', '书房', '马厩', '教堂', '账房');
    t.ok(!cChoices._class.has('dy-cards'), `${anchor} 是幕尾六项竖排列表，不是三张活动卡`);
    t.ok(!slotLabel._class.has('on'), `${anchor} 不亮「早晨 · 选择去向」那行小字`);
    t.eq(cChoices.children.map((b) => b.getElementsByClassName('dy-icon').length), [0, 0, 0, 0, 0, 0],
      `${anchor} 六项一个图标都不塞`);
  }
}

t.section('界面 · 十四张菜单上，每一张卡都画得出图标');
{
  /* 拿**剧本里真正写的字**去点一遍：每个地点名一个一个过。
     曾经 ICON_ORDER 里写着「伊莎贝尔小姐」而 ICONS 里没有这一条 ——
     「三楼，伊莎贝尔小姐门前」那张卡就空着顶（单测里手写的名字没覆盖到，
     截图量出来的）。所以这里不手写名字，直接从剧本里取。 */
  const h = bootDaily();
  const hChoices = h.doc.getElementById('choices');
  const hubIds = whole.nodes
    .filter((n) => /^dy_d\d+_(mo|nn|af|ev|ni)_hub$/.test(n.id) && (n.choices || []).length)
    .map((n) => n.id);
  t.eq(hubIds.length, 14, '十四张时段菜单（没有选项的收束 hub 不算），一个不落');

  const naked = [];
  const seenNames = new Set();
  for (const hubId of hubIds) {
    h.engine.enterNode(hubId);
    const texts = h.engine.availableChoices().map((it) => it.text);
    texts.forEach((x) => seenNames.add(x));
    while (hChoices.children.length) hChoices.removeChild(hChoices.children[0]);
    texts.forEach((txt, i) => {
      const btn = h.doc.createElement('button');
      btn.className = 'choice-btn';
      btn.setAttribute('data-index', String(i));
      const key = h.doc.createElement('span'); key.className = 'choice-key'; key.textContent = String(i + 1);
      const txtEl = h.doc.createElement('span'); txtEl.className = 'choice-text'; txtEl.textContent = txt;
      btn.appendChild(key); btn.appendChild(txtEl);
      hChoices.appendChild(btn);
    });
    h.pokeObservers();
    const counts = hChoices.children.map((b) => b.getElementsByClassName('dy-icon').length);
    t.eq(counts, texts.map(() => 1), `${hubId}：每张卡各一个图标（${texts.join(' / ')}）`);
    hChoices.children.forEach((b, i) => { if (!counts[i]) naked.push(`${hubId}「${texts[i]}」`); });
  }
  t.empty(naked, '没有一个地点名落在图标表外头 —— 落了就是那张卡空着顶');

  /* 同一个地方在剧本里有两种写法，得画成同一张图；
     门前是另一个地方，不能也拿小床那个图标。 */
  t.eq([...seenNames].filter((x) => x.indexOf('伊莎贝尔') >= 0).sort(),
    ['伊莎贝尔', '伊莎贝尔的房间'],
    '剧本里两个带「伊莎贝尔」的地点名（第 6 天菜单上那个是简写）');
  const draw = (name) => {
    while (hChoices.children.length) hChoices.removeChild(hChoices.children[0]);
    h.engine.enterNode('dy_d5_nn_hub');
    const btn = h.doc.createElement('button');
    btn.className = 'choice-btn';
    const txtEl = h.doc.createElement('span'); txtEl.className = 'choice-text'; txtEl.textContent = name;
    btn.appendChild(txtEl);
    hChoices.appendChild(btn);
    h.pokeObservers();
    const ic = btn.getElementsByClassName('dy-icon')[0];
    return ic ? ic.innerHTML : '';
  };
  t.eq(draw('伊莎贝尔'), draw('伊莎贝尔的房间'),
    '「伊莎贝尔」和「伊莎贝尔的房间」是同一个小床图标');
  t.ok(draw('三楼，伊莎贝尔小姐门前') && draw('三楼，伊莎贝尔小姐门前') !== draw('伊莎贝尔的房间'),
    '「门前」是另一张图（门 + 灯），不是小床 —— ICON_ORDER 里它排在「伊莎贝尔」前面');
}

t.section('界面 · 第一天的册子（剧情入口，不是按钮）');
{
  /* 第 1 天没有【日记】按钮 —— 那一天是剧情：她写完、敲门把册子递上来。
     入口在 daily.js 的捕获阶段，判据是 diary.js 的 atLastLine（最后一句之后）。 */
  const g = bootDaily();
  const gScreen = g.doc.body.children.filter((e) => e._class.has('dy-diary-screen'))[0];
  const gIn = (cls) => gScreen.getElementsByClassName(cls)[0];
  const gClock = g.doc.body.children.filter((e) => e._class.has('dy-clock'))[0];

  g.engine.enterNode('b8_diary_writing');
  g.pokeObservers();
  t.eq(g.DailyUI.introPhase(), 'idle', '刚跨进这一场：这一轮还是待命的');
  t.ok(!g.DailyUI.isOpen(), '书没开');

  // 还在前几句上：这一下空格该交给 ui.js 推台词，不该摊开册子
  const early = g.fireKey(' ');
  t.ok(!early.__stopped, '还没到最后一句，空格不被拦');
  t.ok(!g.DailyUI.isOpen(), '册子还没摊开 —— 她还没写完');
  t.eq(g.DailyUI.introPhase(), 'idle', '这一轮没被消耗掉，后面还认');

  const total = g.engine.visibleLines().length;
  while (g.engine.lineIndex < total) g.engine.advance();
  g.pokeObservers();
  t.ok(D.atLastLine(g.engine, 'b8_diary_writing'), '推到「最后一句已经播完」那一格');

  const fired = g.fireKey(' ');
  t.ok(fired.__stopped, '这一下被捕获阶段拦住了（不然 ui.js 会先把人推出这一场）');
  t.ok(g.DailyUI.isOpen(), '册子摊开了');
  t.eq(g.DailyUI.introPhase(), 'open', '阶段进到 open');
  t.eq(gClock._class.has('on'), false,
    '第 1 天还没有时间牌子 —— 这一场发生在进日常层之前');
  t.eq(gIn('dy-diary-day').textContent, '第 1 日',
    '摊开的是第 1 日那一页：日记的日期记的是**被写的那一天**');
  t.eq(gIn('dy-diary-weather').textContent, '雨', '那天在下雨（原著里到普里森堡就是一整天的雨）');
  t.eq(gIn('dy-diary-events').style.display, 'none', '那天一件记事都没有：今日事件整块收掉');
  t.eq(gIn('dy-diary-rule').style.display, 'none', '连分隔线也一起收掉，不留一块空白');
  t.eq(gIn('dy-diary-note').textContent, dailyStory.diary.entries[0].body.join('\n\n'),
    '一页纸上只有她自己的字');
  t.eq(g.doc.getElementById('hud').children[0].style.display, 'none',
    '这会儿还没有【日记】按钮 —— 第 1 天是剧情，不是按钮（它要等进了日常层才在）');

  g.DailyUI.closeDiary();
  t.ok(!g.DailyUI.isOpen(), '合上');
  t.eq(g.DailyUI.introPhase(), 'done', '这一轮过去了');

  const after = g.fireKey(' ');
  t.ok(!after.__stopped, '合上之后再按空格，照常交给 ui.js');
  t.ok(!g.DailyUI.isOpen(), '不会又摊开一次');
  t.eq(g.engine.node.id, 'b8_diary_writing', '人还停在写手记这一场 —— 这一下不会把人推走');
  t.eq(g.engine.availableChoices().map((c) => c.text),
    ['歇一歇 · 捏一捏那个枕头', '不歇了 · 直接走到书桌前'],
    '写完之后才是那两个选项（书摊在最后一句与选项之间）');
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
