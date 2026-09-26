/**
 * 引擎自检（不碰 DOM）
 * =====================================================================
 *   node tests/engine.test.cjs
 *
 * 主要盯三件事：
 *   1. 剧本自身站得住 —— 没有悬空跳转、没有走不到的节点、数值都在 statLabels 里定义过
 *   2. 所有分支都能走通，而且「好感 + 警惕」恒等于 3（每走一个决定点必加一点）
 *   3. 存档 / 读档 / 像素图这些机制确实按预期工作
 */

const path = require('path');
const { suite, norm } = require('./harness.cjs');

const api = require(path.join(__dirname, '..', 'act1', 'engine.js'));
const act1 = require(path.join(__dirname, '..', 'act1', 'story.json'));
const act2 = require(path.join(__dirname, '..', 'act2', 'story.json'));

// 一幕一个 story.json，引擎只认一个 —— 和浏览器里 boot() 一样先拼起来
const story = api.composeStories([act1, act2]);

const { StoryEngine } = api;
const t = suite('引擎');

/* ===================================================================
 * 工具：把剧本当成一张图来走
 * =================================================================== */

const nodeById = new Map(story.nodes.map((n) => [n.id, n]));
const choicesOf = (id) => (nodeById.get(id).choices || []);

/** 枚举所有分支组合，返回 [{ picks: [每层选第几个], end: 终点节点 id }] */
function enumeratePaths() {
  const paths = [];
  const walk = (id, picks, depth) => {
    if (depth > 200) throw new Error('剧情成环了，走到 ' + id);
    const node = nodeById.get(id);
    if (!node) throw new Error('悬空节点：' + id);
    const choices = node.choices || [];
    if (choices.length) {
      choices.forEach((c, i) => walk(c.next, picks.concat(i), depth + 1));
      return;
    }
    if (node.next) { walk(node.next, picks, depth + 1); return; }
    // 结局屏上的「继续下一幕」也是往下走的一条路（不然第二幕一条都覆盖不到）
    if (node.continueTo) { walk(node.continueTo, picks, depth + 1); return; }
    paths.push({ picks, end: id });
  };
  walk(story.meta.start, [], 0);
  return paths;
}

/** 按 picks 把剧本跑一遍，顺手记下沿途看到的东西 */
function replay(picks) {
  const engine = new StoryEngine(story);
  engine.start();
  const seen = { nodes: [], bgs: [], portraits: [], lines: [], povSwitches: [] };
  let i = 0;
  let guard = 0;

  for (;;) {
    if (++guard > 5000) throw new Error('剧情没有终点');
    const node = engine.node;
    if (seen.nodes[seen.nodes.length - 1] !== node.id) {
      seen.nodes.push(node.id);
      const art = engine.currentArt();
      seen.bgs.push({ node: node.id, bg: art.bg });
      seen.portraits.push({ node: node.id, portrait: art.portrait });
    }
    if (engine.povSwitchInfo && seen.povSwitches[seen.povSwitches.length - 1] !== engine.povSwitchInfo) {
      seen.povSwitches.push(engine.povSwitchInfo);
    }

    const v = engine.advance();
    if (v.type === 'line') { seen.lines.push({ node: node.id, ...v }); continue; }
    if (v.type === 'end') {
      // 这一幕演完了，后面还有一幕就接着往下走（enterNode 会把 ended 清掉）
      const nextAct = v.node && v.node.continueTo;
      if (nextAct) { engine.enterNode(nextAct); continue; }
      // 用视图里的节点，不是循环开头那个 —— 结局常常是上一个节点 next 过来的
      seen.end = (v.node || node).id;
      seen.stats = Object.assign({}, engine.stats);
      return seen;
    }
    // choices
    if (i >= picks.length) throw new Error(`第 ${i + 1} 个决定点没有对应的选择（剧本分支比路径多）`);
    const res = engine.choose(picks[i++]);
    if (!res.ok) throw new Error(`第 ${i} 个决定点选了 ${picks[i - 1]} 却被拒：${res.reason}`);
  }
}

const ALL_PATHS = enumeratePaths();

/* ===================================================================
 * 1. 剧本自身
 * =================================================================== */

t.section('剧本结构');

const report = new StoryEngine(story).validate();

t.empty(report.errors, '自检没有 error');
t.empty(report.warnings, '自检也没有 warning');
t.eq(act1.nodes.length, 34, '第一幕 34 个节点');
t.eq(act2.nodes.length, 35, '第二幕 35 个节点（27 段剧情 + 8 个自由活动锚点）');
t.eq(report.stats.nodes, 69, '拼起来是 69 个节点');
t.eq(
  report.stats.endings,
  ['a10_end', 'b25_end', 'fr_the_end'],
  '三个结局：两幕各自的结局，加上自由活动里「结束游戏」的落点 fr_the_end'
);
t.eq(Object.keys(story.povs), ['西比拉', '奥布里'], '两个视角：西比拉 / 奥布里');
t.eq(story.meta.start, 'p1_carriage', '起点是 p1_carriage');
t.eq(act1.meta.continues, ['../act2/story.json'], '第一幕的 meta.continues 指向第二幕剧本');
t.eq(act2.meta.continues, undefined, '第二幕后面没有了，不写 continues');

t.section('走得到的节点');

const roam = story.freeRoam;

/**
 * 自由活动那一块的走法，独立于引擎再写一遍（和界面上能点的东西一一对应）：
 *   结局卡片 --hubs[].after--> hub --去房间--> 房间/装束 --离开--> hub
 *   hub/浮层里的「进入下一幕」「结束游戏」也是出口
 * 不这么写的话，8 个锚点会被当成「走不到」——它们确实没有节点指向，
 * 入口是结局屏上那个按钮。
 */
const roamEdges = (id) => {
  const out = [];
  for (const h of Object.keys(roam.hubs)) {
    if (roam.hubs[h].after === id) out.push(h);            // 结局卡片上的「自由活动 ▶」
  }
  const hub = roam.hubs[id];
  if (hub) {
    if (hub.nextAct) out.push(hub.nextAct);
    if (hub.endNode) out.push(hub.endNode);
    for (const name of Object.keys(roam.rooms)) {
      const r = roam.rooms[name];
      if (r.anchor) out.push(r.anchor);
      for (const k of Object.keys(r.outfits || {})) out.push(r.outfits[k].node);
    }
  }
  for (const name of Object.keys(roam.rooms)) {
    const r = roam.rooms[name];
    const inside = r.anchor === id || Object.keys(r.outfits || {}).some((k) => r.outfits[k].node === id);
    if (!inside) continue;
    for (const h of Object.keys(roam.hubs)) out.push(h);    // 「离开」按 after 猜回哪个 hub，这里全连上
    for (const k of Object.keys(r.outfits || {})) out.push(r.outfits[k].node);
  }
  return out;
};

// 从起点能不能走到每一个节点（防「写了个节点忘了接上」）
const reachable = new Set();
const queue = [story.meta.start];
while (queue.length) {
  const id = queue.shift();
  if (reachable.has(id)) continue;
  reachable.add(id);
  const n = nodeById.get(id);
  if (!n) continue;
  if (n.next) queue.push(n.next);
  if (n.continueTo) queue.push(n.continueTo);      // 跨幕的入口也是入口
  for (const c of n.choices || []) queue.push(c.next);
  for (const t2 of roamEdges(id)) queue.push(t2);
}
t.empty(
  story.nodes.map((n) => n.id).filter((id) => !reachable.has(id)),
  '所有节点都能走到'
);
t.eq(reachable.size, 69, '可达节点数 = 节点总数');
t.eq(
  story.nodes.filter((n) => n.id[0] === 'b' && !reachable.has(n.id)).map((n) => n.id),
  [],
  '第二幕的节点从第一幕结局接得过去'
);

t.section('素材');

const assetKeys = new Set(Object.keys(story.art.assets));
const badArt = [];
for (const n of story.nodes) {
  for (const k of ['bg', 'portrait']) {
    const key = n.art && n.art[k];
    if (key && !assetKeys.has(key)) badArt.push(`${n.id}.art.${k} -> ${key} 不存在`);
  }
}
t.empty(badArt, '节点引用的素材都存在');

t.empty(
  story.nodes.filter((n) => !(n.art && n.art.bg)).map((n) => n.id),
  '每个节点都写了 bg（不会出现空场）'
);

// 说话的人必须在 characters 里（否则界面上没有名字和颜色）
const badSpeakers = [];
for (const n of story.nodes) {
  for (const d of n.dialogues || []) {
    if (!story.characters[d.speaker]) badSpeakers.push(`${n.id}: ${d.speaker}`);
  }
}
t.empty(badSpeakers, '所有说话人都在 characters 里');

t.section('数值');

t.eq(story.config.statOrder, ['伊莎贝尔_好感', '西比拉_好感', '西比拉_警惕'], '三个隐藏数值');
t.eq(
  Object.keys(story.initialStats).sort(),
  ['伊莎贝尔_好感', '西比拉_好感', '西比拉_警惕'],
  '初始数值就是这三项'
);
t.empty(
  Object.entries(story.initialStats).filter(([, v]) => v !== 0).map(([k]) => k),
  '初始数值都是 0'
);
t.empty(
  Object.keys(story.initialStats).filter((k) => !story.config.statLabels[k]),
  '每个数值都有中文标签'
);

/* ===================================================================
 * 2. 分支
 * =================================================================== */

t.section('分支');

const choicePoints = story.nodes.filter((n) => n.choices && n.choices.length);
t.eq(choicePoints.length, 9, '决定点 9 个（第一幕 6 + 第二幕 3）');
t.eq(
  choicePoints.map((n) => n.id),
  ['p1_carriage', 'p5_bridge', 'p6_courtyard', 'a1_returned', 'a4_hair', 'a5_teach',
    'b2_haier_knock', 'b4_enter', 'b8_farewell'],
  '决定点就是这 9 个'
);
t.eq(ALL_PATHS.length, 1728, '分支组合共 1728 条（第一幕 216 × 第二幕 2×2×2）');

// 西比拉视角（序章 + 第二幕）：选项只决定「先看/先做原文里的哪一个动作」，不加减数值
t.empty(
  choicePoints.filter((n) => n.pov === '西比拉')
    .flatMap((n) => n.choices.filter((c) => c.effects && c.effects.length)
      .map((c) => `${n.id} 的「${c.text}」不该有效果`)),
  '西比拉视角的选项都不改数值（序章 + 第二幕）'
);

// 主场（奥布里视角）：每个选项恰好改一项、+1
const badMain = [];
for (const n of choicePoints.filter((n) => n.pov === '奥布里')) {
  for (const c of n.choices) {
    const eff = c.effects || [];
    if (eff.length !== 1) badMain.push(`${n.id}「${c.text}」效果有 ${eff.length} 条，应为 1`);
    else if (eff[0].value !== 1) badMain.push(`${n.id}「${c.text}」加的是 ${eff[0].value}，应为 1`);
  }
}
t.empty(badMain, '主场的每个选项都恰好 +1 一项数值');

t.empty(
  choicePoints.flatMap((n) => n.choices.filter((c) => !c.hint).map((c) => `${n.id}「${c.text}」没写 hint`)),
  '每个选项都有 hint（界面要显示）'
);

/* ===================================================================
 * 3. 把 216 条路全跑一遍
 * =================================================================== */

t.section('跑通全部 1728 条路径');

const ran = [];
const problems = { end: [], stats: [], bg: [], error: [], start: [], intoAct2: [] };

for (const p of ALL_PATHS) {
  let r;
  try {
    r = replay(p.picks);
  } catch (err) {
    problems.error.push(`路径 [${p.picks}] 跑挂了：${err.message}`);
    continue;
  }
  ran.push(r);
  if (r.end !== 'b25_end') problems.end.push(`路径 [${p.picks}] 停在 ${r.end}`);
  const sum = r.stats['伊莎贝尔_好感'] + r.stats['西比拉_警惕'];
  if (sum !== 3) {
    problems.stats.push(`路径 [${p.picks}] 好感+警惕=${sum}（好感 ${r.stats['伊莎贝尔_好感']} / 警惕 ${r.stats['西比拉_警惕']}）`);
  }
  for (const b of r.bgs) if (!b.bg) problems.bg.push(`路径 [${p.picks}] 节点 ${b.node} 没有背景`);
  if (r.nodes[0] !== 'p1_carriage') problems.start.push(`路径 [${p.picks}] 起点是 ${r.nodes[0]}`);
  if (!r.nodes.includes('b1_room')) problems.intoAct2.push(`路径 [${p.picks}] 没走进第二幕`);
}

t.eq(ran.length, 1728, '1728 条路径全部跑完，没有一条崩');
t.empty(problems.error, '没有路径抛错');
t.empty(problems.end, '每条路径都从第一幕一路走到第二幕的 b25_end');
t.empty(problems.stats, '每条路径的「好感 + 警惕」都恒等于 3（第二幕一个 effects 都没写）');
t.empty(problems.bg, '沿途每个节点都有背景（背景会一直沿用，不会空场）');
t.empty(problems.start, '每条路径都从 p1_carriage 开始');
t.empty(problems.intoAct2, '每条路径都真的进过第二幕（免得 continueTo 断了却假性通过）');

// 数值范围：警惕最多 3、好感最多 3
const maxGood = Math.max(...ran.map((r) => r.stats['伊莎贝尔_好感']));
const maxWary = Math.max(...ran.map((r) => r.stats['西比拉_警惕']));
t.eq([maxGood, maxWary], [3, 3], '好感 / 警惕 的上限都是 3');
t.ok(ran.every((r) => r.stats['伊莎贝尔_好感'] >= 0 && r.stats['西比拉_警惕'] >= 0), '数值不会变成负的');

/* ===================================================================
 * 4. 视角切换
 * =================================================================== */

t.section('视角切换');

const switches = ran[0].povSwitches;
t.eq(switches.length, 2, '整场切两次视角：序章→主场、第一幕→第二幕');
t.eq(switches[0].from, '西比拉', '第一次从西比拉开始');
t.eq(switches[0].to, '奥布里', '第一次切到奥布里');
t.ok(!!switches[0].line, '切换时有一行提示文字');
t.eq(switches[1].from, '奥布里', '第二幕接在第一幕的奥布里视角后面');
t.eq(switches[1].to, '西比拉', '第二次切回西比拉（第二幕全程西比拉视角）');
t.ok(!!switches[1].line, '跨幕切换也有一行提示文字');

t.empty(
  ran.filter((r) => r.povSwitches.length !== 2 || r.povSwitches[0].to !== '奥布里' || r.povSwitches[1].to !== '西比拉')
    .map((r) => `[${r.picks}]`),
  '不管走哪条分支，切视角的位置都一样'
);

// 前缀就说明了视角：p（序章）/ b（第二幕）是西比拉，a（第一幕主场）/ f（自由活动）是奥布里
t.empty(
  story.nodes.filter((n) => (n.id[0] === 'p' || n.id[0] === 'b') && n.pov !== '西比拉').map((n) => `${n.id} 的 pov 是 ${n.pov}`),
  'p 开头的序章节点和 b 开头的第二幕节点都是西比拉视角'
);
t.empty(
  story.nodes.filter((n) => (n.id[0] === 'a' || n.id[0] === 'f') && n.pov !== '奥布里').map((n) => `${n.id} 的 pov 是 ${n.pov}`),
  'a 开头的主场节点和 f 开头的自由活动节点都是奥布里视角'
);
// 反着也查一道：别的地方冒出个奥布里视角的节点，就是写串了
t.eq(
  Array.from(new Set(story.nodes.filter((n) => n.pov === '奥布里').map((n) => n.id[0]))).sort(),
  ['a', 'f'],
  '奥布里视角只出现在 a 和 f 这两种前缀里'
);

// 第二幕的选项点：和序章一样是「重播型」，一条 effects 都不许有
t.empty(
  act2.nodes.filter((n) => n.choices).flatMap((n) => n.choices.filter((c) => c.effects && c.effects.length)
    .map((c) => `${n.id} 的「${c.text}」不该有效果`)),
  '第二幕的选项一条 effects 都没写'
);

/* ===================================================================
 * 5. 机制
 * =================================================================== */

t.section('机制');

// 条件求值
const cond = (c, stats) => api.evaluateCondition(c, (n) => (stats[n] === undefined ? 0 : stats[n]));
t.eq(cond(null, {}), true, '没写条件 = 通过');
t.eq(cond({ stat: '西比拉_警惕', op: '>=', value: 2 }, { 西比拉_警惕: 2 }), true, '>= 命中');
t.eq(cond({ stat: '西比拉_警惕', op: '>=', value: 3 }, { 西比拉_警惕: 2 }), false, '>= 未命中');
t.eq(cond({ stat: '西比拉_警惕', op: '<', value: 3 }, { 西比拉_警惕: 2 }), true, '< 命中');
t.eq(cond({ stat: '西比拉_警惕', op: '==', value: 0 }, {}), true, '没记录的数值按 0 算');

// 被锁住的选项，绕过界面直接调用也会被拒
const locked = new StoryEngine(story);
locked.start();
locked.node = { id: 'x', pov: '西比拉', dialogues: [], choices: [{ text: '锁着的', next: 'p1_carriage', if: { stat: '西比拉_警惕', op: '>=', value: 99 } }] };
t.eq(locked.choose(0).ok, false, '锁住的选项选不了');
t.eq(locked.choose(0).reason, 'locked', '拒绝理由是 locked');
t.eq(locked.choose(99).reason, 'out-of-range', '越界的选项被拒');
t.eq(new StoryEngine(story).choose(0).reason, 'no-choices', '没 start() 时选择被拒');

// 幕间衔接：第一幕的结局屏上按「继续下一幕」
const bridge = new StoryEngine(story);
bridge.start();
bridge.enterNode('a10_end');
let endView = bridge.advance();
for (let i = 0; endView.type !== 'end' && i < 50; i++) endView = bridge.advance();
t.eq(endView.type, 'end', 'a10_end 仍然弹结局屏（不是直接溜进第二幕）');
t.eq(endView.node.id, 'a10_end', '结局视图里带着节点，界面才能读到 continueTo');
t.eq(endView.node.continueTo, 'b1_room', 'a10_end 的 continueTo 指向第二幕的开头');
t.eq(nodeById.get('b25_end').continueTo, undefined, '第二幕的结局后面没有了，不写 continueTo');

const intoAct2 = bridge.enterNode(endView.node.continueTo);
t.eq(intoAct2.id, 'b1_room', '从结局节点能直接走进第二幕');
const afterBridge = bridge.advance();
t.eq(afterBridge.type, 'line', '接上之后照常演第二幕的第一句（不需要新的引擎方法）');
t.eq(bridge.pov, '西比拉', '第二幕是西比拉视角');
t.eq(bridge.povSwitchInfo.to, '西比拉', '跨幕时照常弹一次视角切换提示');
t.eq(bridge.povSwitchInfo.from, '奥布里', '切的是第一幕结尾那个奥布里视角');
t.eq(bridge.currentArt().bg, 'bg_sibylla_room', '第二幕开头换了新房间的背景');
t.eq(bridge.currentArt().portrait, 'chr_sibylla', '第二幕开头西比拉穿的是女仆装');

// 换装：只在换衣服那个节点上换个 art.portrait，没有别的机制
const teacherNodes = act2.nodes.filter((n) => n.art.portrait === 'chr_sibylla_teacher').map((n) => n.id);
const maidNodes = act2.nodes.filter((n) => n.art.portrait === 'chr_sibylla').map((n) => n.id);
t.eq(teacherNodes[0], 'b12_morning', '段30「换上了那身牧师服装」起换成牧师服立绘');
t.eq(teacherNodes[teacherNodes.length - 1], 'b23_corridor', '一直到回房前都还穿着牧师服');
t.eq(maidNodes[maidNodes.length - 1], 'b25_end', '段76 换回女仆装，立绘跟着换回来');
t.ok(maidNodes.indexOf('b11_sleep') < maidNodes.indexOf('b25_end'), '第二幕前半夜还是女仆装');
t.ok(story.art.assets.chr_sibylla_teacher, '牧师服（＝用户放的教师服）素材已注册');

// 像素图必须确定性（同一个素材每次画出来一模一样）
const e = new StoryEngine(story);
const keys = Object.keys(story.art.assets);
const nonDeterministic = keys.filter((k) => {
  const a = JSON.stringify(e.pixelArt(k).matrix);
  const b = JSON.stringify(api.buildPixelArt(story.art.assets[k]).matrix);
  return a !== b;
});
t.empty(nonDeterministic, '像素图是确定性的（同素材两次结果一致）');
t.eq(e.pixelArt('不存在的素材'), null, '不存在的素材返回 null');

// 存档 / 读档
const save = new StoryEngine(story);
save.start();
save.advance();
save.advance();
save.choose(0);
const snap = save.snapshot();
const json = JSON.parse(JSON.stringify(snap));       // 过一遍 JSON，模拟真的走网络
const back = new StoryEngine(story);
back.restore(json);
t.eq(back.node.id, save.node.id, '读档回到同一个节点');
t.eq(back.lineIndex, save.lineIndex, '读档回到同一行');
t.eq(back.stats, save.stats, '读档恢复数值');
t.eq(back.history, save.history, '读档恢复来路');
t.eq(back.povSwitchInfo, null, '读档不算「切换视角」（不会一进来就弹提示）');

// 反复「读档 -> 存档 -> 读档」，来路不能越滚越长（否则保存提示里的「第 N 步」会一直涨）
let round = new StoryEngine(story);
round.restore(json);
for (let i = 0; i < 5; i++) round.restore(JSON.parse(JSON.stringify(round.snapshot())));
t.eq(round.history, save.history, '反复读档不会让来路变长');
t.eq(round.history[round.history.length - 1], round.node.id, '来路的最后一项就是当前节点');

// 存档跨幕：存到第二幕的节点上，读回来照样解得开（两幕的节点在同一张表里）
const act2Save = new StoryEngine(story);
act2Save.start();
act2Save.enterNode('b12_morning');          // 已经换上牧师服的那一天
act2Save.advance();
act2Save.setStat('伊莎贝尔_好感', 2);
const act2Snap = JSON.parse(JSON.stringify(act2Save.snapshot()));
const act2Back = new StoryEngine(story);
act2Back.restore(act2Snap);
t.eq(act2Back.node.id, 'b12_morning', '第二幕的存档读得回来');
t.eq(act2Back.getStat('伊莎贝尔_好感'), 2, '第一幕攒下的数值带进了第二幕');
t.eq(act2Back.currentArt().portrait, 'chr_sibylla_teacher', '读档也读得回「此刻穿着哪套衣服」');
t.eq(act2Back.povSwitchInfo, null, '跨幕读档不会一进门就弹视角提示');

t.throws(() => new StoryEngine(story).restore({}), '没有 nodeId 的存档会被拒');
t.throws(() => new StoryEngine(story).restore({ nodeId: '不存在的节点' }), '指向未知节点的存档会被拒');

// 数值面板：默认藏数字
const panel = new StoryEngine(story);
panel.setStat('伊莎贝尔_好感', 3);
t.eq(panel.statPanel().map((s) => s.display), ['?', '?', '?'], '默认只给「?」不给数字');
panel.toggleStats(true);
t.eq(panel.statPanel().map((s) => s.display), ['3', '0', '0'], '按 V 之后才显示真实数字');
t.eq(panel.getStat('没定义过的'), 0, '没记录的数值读出来是 0');

// 效果会给一句「感觉」而不是数字
const notes = new StoryEngine(story);
const r = notes.applyEffects([{ stat: '西比拉_警惕', value: 1 }]);
t.ok(!!r[0].note && !/\d/.test(r[0].note), '隐藏数值时给的是文字感觉，不带数字');

/* ===================================================================
 * 6. 幕间自由活动
 * =================================================================== */

t.section('幕间自由活动');

/** 一路 advance 到菜单/结局，返回那个视图（顺便收下中间播过的台词） */
function runToMenu(eng) {
  const lines = [];
  for (let i = 0; i < 100; i++) {
    const v = eng.advance();
    if (v.type === 'line') { lines.push(v.line.text); continue; }
    return { view: v, lines };
  }
  throw new Error('自由活动停不下来（台词成环了？）');
}
const textOf = (list) => list.map((c) => c.text);
const indexOfText = (list, text) => list.findIndex((c) => c.text === text);

// --- 从结局卡片进 hub ---
const roam1 = new StoryEngine(story);
roam1.start();
t.eq(roam1.enterRoam('a10_end').ok, false, '结局节点本身不是自由活动的入口（要走 hubs[].after 反查）');
t.eq(roam1.roamAnchorAfter('a10_end'), 'fr_hub', '第一幕结局之后进 fr_hub');
t.eq(roam1.roamAnchorAfter('b25_end'), 'fr_end_hub', '第二幕结局之后进 fr_end_hub');
t.eq(roam1.roamAnchorAfter('p1_carriage'), null, '没安排自由活动的节点反查得到 null');

roam1.enterNode('a10_end');
t.eq(roam1.enterRoam(roam1.roamAnchorAfter('a10_end')).ok, true, '从第一幕结局进得了自由活动');
t.eq(roam1.node.id, 'fr_hub', '落在 fr_hub 上');
t.eq(roam1.pov, '奥布里', '自由活动是奥布里视角');
t.eq(roam1.enterRoam('b12_morning').ok, false, '没声明成锚点的节点进不去');

let step = runToMenu(roam1);
t.eq(step.view.type, 'choices', 'hub 上出的是菜单（和普通选项同一个形状）');
t.eq(step.lines, ['[夜里，你还没睡。]'], '进 hub 先播一句占位开场白');
t.eq(textOf(step.view.choices), ['去西比拉的房间', '去伊莎贝尔的房间', '让布朗通知别人过来', '进入下一幕', '结束游戏'],
  'hub 菜单：两个能去的地方 + 一个锁住的 + 进入下一幕 + 结束游戏');
t.eq(step.view.room, null, '在 hub 上没有「房间里那个人」，右槽留空');

const lockedItem = step.view.choices[2];
t.eq(lockedItem.enabled, false, '「让布朗通知别人过来」显示出来但是锁住的');
t.ok(!!lockedItem.lockedHint, '锁住的那项说了为什么：' + lockedItem.lockedHint);
t.eq(roam1.choose(2).ok, false, '锁住的项点不动');
t.eq(roam1.choose(2).reason, 'locked', '拒绝的理由是 locked');

// --- 进西比拉的房间：右槽直接是她当前的状态 ---
t.eq(roam1.choose(indexOfText(step.view.choices, '去西比拉的房间')).ok, true, '进得了西比拉的房间');
t.eq(roam1.node.id, 'fr_sib_maid', '默认穿女仆装，落点是 fr_sib_maid');
step = runToMenu(roam1);
t.eq(textOf(step.view.choices), ['称赞', '普通对话', '触摸', '换装', '离开'], '房间里：称赞 / 普通对话 / 触摸 / 换装 / 离开');
t.eq((step.view.room || {}).speaker, '西比拉', '视图告诉了界面右槽站谁');
t.eq((step.view.room || {}).portrait, 'chr_sibylla', '右槽是她此刻那套的半身像');
t.eq(roam1.currentArt().portrait, 'chr_aubrey', '左槽是奥布里（主视角角色此刻的样子）');

// --- 好感低：触摸 → 警惕上升、好感不升（0 到底了，钳在 0） ---
t.eq(roam1.getStat('西比拉_好感'), 0, '刚进来好感是 0');
let touch = roam1.choose(indexOfText(step.view.choices, '触摸'));
t.eq(touch.ok, true, '触摸点得动');
t.eq(touch.effects.filter((x) => x.stat === '西比拉_警惕' && x.delta === 1).length, 1, '好感低：触摸让警惕 +1');
t.eq(roam1.getStat('西比拉_好感') > 0, false, '好感低：触摸不会让好感上升');
step = runToMenu(roam1);
t.eq(step.lines.length > 0, true, '低好感那支有它自己的占位台词');

// --- 好感高：同一次触摸走另一支 ---
roam1.setStat('西比拉_好感', 2);
step = runToMenu(roam1);
t.eq(roam1.roamData.affinity.threshold, 2, '「好感高」的阈值写在数据里');
touch = roam1.choose(indexOfText(step.view.choices, '触摸'));
t.eq(touch.effects.filter((x) => x.stat === '西比拉_好感' && x.delta === 1).length, 1, '好感高：触摸让好感 +1');
t.ok(touch.roam.branch && touch.roam.branch.value === 2, '走的确实是有条件的那一条分支');
const highLines = runToMenu(roam1).lines;
t.eq(highLines.length > 0, true, '高好感那支也有自己的台词');
t.ok(highLines.join('') !== step.lines.join(''), '两支护照，台词不是同一段');

// --- 换装 ---
step = runToMenu(roam1);
t.eq(roam1.choose(indexOfText(step.view.choices, '换装')).ok, true, '开得了换装浮层');
let ov = runToMenu(roam1);
t.eq(ov.view.type, 'outfit', '换装浮层是独立的一种视图（不是 choices）');
t.eq(ov.view.line.text, '[您要给我挑衣服？]', '浮层自带一句占位台词（不走对话框）');
t.eq(ov.view.full, 'full_sibylla_maid', '浮层里先显示她现在这套的全身图');
t.ok(!!roam1.assets[ov.view.full], '全身图的素材是真注册过的');
t.eq(textOf(ov.view.choices), ['女仆装', '牧师服', '骑装', '黑礼服', '退出换装', '进入下一幕', '结束游戏'],
  '浮层菜单：四套衣服 + 退出 + 下一幕 + 结束游戏');
t.eq(ov.view.choices[0].worn, true, '现在穿着的那套标了出来');
t.eq(ov.view.choices[2].worn, false, '别的没标');

const beforeWear = roam1.getStat('西比拉_好感');
const wear = roam1.choose(indexOfText(ov.view.choices, '骑装'));
t.eq(wear.ok, true, '换得了骑装');
t.eq(wear.changed, true, '确实换了一套');
t.eq(roam1.node.id, 'fr_sib_riding', '装束＝位置：换了衣服就换了锚点');
t.eq(roam1.getStat('西比拉_好感') > beforeWear, true, '换装影响好感');
ov = runToMenu(roam1);
t.eq(ov.view.full, 'full_sibylla_riding', '浮层里的全身图跟着换');
t.eq(ov.view.choices[2].worn, true, '标记挪到骑装上');
t.eq(runToMenu(roam1).view.roomName, '西比拉', '浮层里也知道是在谁的房间');

// 反复穿同一套不重复加好感（否则来回切就能刷）
const beforeAgain = roam1.getStat('西比拉_好感');
const again = roam1.choose(indexOfText(runToMenu(roam1).view.choices, '骑装'));
t.eq(again.changed, false, '再穿一次同一套：没换');
t.eq(again.effects.length, 0, '再穿一次同一套：不加好感');
t.eq(roam1.getStat('西比拉_好感'), beforeAgain, '数值没动');

// --- 退出浮层 → 离开房间 → 回 hub ---
step = runToMenu(roam1);
t.eq(roam1.choose(indexOfText(step.view.choices, '退出换装')).ok, true, '退得出去');
step = runToMenu(roam1);
t.eq(step.view.type, 'choices', '退出浮层后回到房间菜单');
t.eq(step.view.room.portrait, 'chr_sibylla_riding', '退出来她还是穿着骑装');

// --- 存档：她此刻穿什么也被记住了（就存在房间里，装束是靠锚点 id 记住的） ---
const ridingSnap = JSON.parse(JSON.stringify(roam1.snapshot()));
const ridingBack = new StoryEngine(story);
ridingBack.restore(ridingSnap);
t.eq(ridingBack.node.id, 'fr_sib_riding', '存档记着自由活动里人在哪儿');
t.eq((runToMenu(ridingBack).view.room || {}).portrait, 'chr_sibylla_riding', '存档也记着她此刻穿着哪套');
t.eq(ridingBack.getStat('西比拉_好感'), roam1.getStat('西比拉_好感'), '自由活动攒的数值跟着存档走');

t.eq(roam1.choose(indexOfText(step.view.choices, '离开')).ok, true, '离开房间');
t.eq(roam1.node.id, 'fr_hub', '回到进来的那个 hub');
step = runToMenu(roam1);
t.eq(indexOfText(step.view.choices, '进入下一幕') >= 0, true, '第一幕之后有「进入下一幕」');

// --- 伊莎贝尔的房间：没有换装 ---
step = runToMenu(roam1);
t.eq(roam1.choose(indexOfText(step.view.choices, '去伊莎贝尔的房间')).ok, true, '进得了伊莎贝尔的房间');
t.eq(roam1.node.id, 'fr_isa', '落点是 fr_isa');
step = runToMenu(roam1);
t.eq(textOf(step.view.choices), ['称赞', '普通对话', '触摸', '离开'], '伊莎贝尔房间没有「换装」');
t.eq(indexOfText(step.view.choices, '换装'), -1, '换装只在西比拉的房间里能选');
t.eq((step.view.room || {}).portrait, 'chr_isabelle', '右槽是伊莎贝尔');

// --- 第二幕之后的 hub：没有「进入下一幕」 ---
const roam2 = new StoryEngine(story);
roam2.start();
roam2.enterNode('b25_end');
t.eq(roam2.enterRoam(roam2.roamAnchorAfter('b25_end')).ok, true, '第二幕结局之后进得了自由活动');
t.eq(roam2.node.id, 'fr_end_hub', '落在 fr_end_hub 上');
step = runToMenu(roam2);
t.eq(indexOfText(step.view.choices, '进入下一幕'), -1, '已经是最后一幕了，不显示「进入下一幕」');
t.eq(indexOfText(step.view.choices, '结束游戏') >= 0, true, '只留「结束游戏」');

t.eq(roam2.choose(indexOfText(step.view.choices, '结束游戏')).ok, true, '结束游戏点得动');
t.eq(roam2.node.id, 'fr_the_end', '落在 fr_the_end 上');
step = runToMenu(roam2);
t.eq(step.view.type, 'end', 'fr_the_end 是结局屏，不是菜单');
t.eq(step.view.node.ending, true, 'fr_the_end 写了 ending');
t.eq(roam2.ended, true, '引擎也认为演完了');

// --- 锚点没有 next / choices，但引擎不许说它「会卡死」 ---
const anchors = story.nodes.filter((n) => n.id[0] === 'f');
t.eq(anchors.length, 8, '八个自由活动锚点');
t.empty(anchors.filter((n) => n.next || n.choices).map((n) => n.id),
  '锚点一律不写 next / choices（写了 next 会盖过状态机）');
t.empty(anchors.filter((n) => !n.freeRoam).map((n) => n.id), '锚点都打了 freeRoam 标记');
t.empty(anchors.filter((n) => n.id !== 'fr_the_end' && n.ending).map((n) => n.id),
  '只有 fr_the_end 是结局，别的 7 个锚点是菜单');
t.empty(report.warnings, '自检没有把这些锚点当成「走不到」或「结局」');

// 自由活动之外一条 effects 都没有（好感只在自由活动里动）
t.empty(
  story.nodes.filter((n) => n.id[0] !== 'f').flatMap((n) => (n.choices || [])
    .filter((c) => (c.effects || []).some((e) => e.stat === '西比拉_好感'))
    .map((c) => `${n.id} 的「${c.text}」动了西比拉_好感`)),
  '「西比拉_好感」只在自由活动里变动，主线那 1728 条路径一条都不碰它'
);

// 没有 freeRoam 的剧本照旧跑（第一幕单独打开时就是这个情形）
const noRoam = new StoryEngine(api.composeStories([act1]));
noRoam.start();
t.eq(noRoam.roamData, null, '只拼第一幕时没有自由活动数据');
t.eq(noRoam.enterRoam('fr_hub').ok, false, '没有数据时进不了自由活动');
t.eq(noRoam.advance().type, 'line', '没有自由活动时 advance() 一切照旧');

t.done();
