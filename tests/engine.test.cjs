/**
 * 引擎自检（不碰 DOM）
 * =====================================================================
 *   node tests/engine.test.cjs
 *
 * 主要盯三件事：
 *   1. 剧本自身站得住 —— 没有悬空跳转、没有走不到的节点、数值都在 statLabels 里定义过
 *   2. 所有分支都能走通，而且跨进第三幕那一刻「好感 + 警惕」恒等于 3
 *      （第一幕每走一个决定点必加一点；第二幕不加；第三幕自己会各 ±1）
 *   3. 存档 / 读档 / 像素图这些机制确实按预期工作
 */

const path = require('path');
const { suite, norm } = require('./harness.cjs');

const api = require(path.join(__dirname, '..', 'act1', 'engine.js'));
const act1 = require(path.join(__dirname, '..', 'act1', 'story.json'));
const act2 = require(path.join(__dirname, '..', 'act2', 'story.json'));
const act3 = require(path.join(__dirname, '..', 'act3', 'story.json'));

// 一幕一个 story.json，引擎只认一个 —— 和浏览器里 boot() 一样先拼起来
const story = api.composeStories([act1, act2, act3]);

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
      // 「第一幕 + 第二幕」跑完的那一刻：跨进第三幕时数值还没被第三幕动过，
      // 所以第一幕那套不变量（好感 + 警惕 恒等于 3）在这一刀上切
      if (!seen.act1EndStats && node.id[0] === 'c') seen.act1EndStats = Object.assign({}, engine.stats);
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
t.eq(act2.nodes.length, 42, '第二幕 42 个节点（27 段剧情 + 9 个锚点 + 5 个来访锚点 + 报仇结局）');
t.eq(act3.nodes.length, 33, '第三幕 33 个节点（27 段主线 + 3 个决定点各岔出的 2 条支线）');
t.eq(report.stats.nodes, 109, '拼起来是 109 个节点');
t.eq(
  report.stats.endings,
  ['a10_end', 'b25_end', 'fr_the_end', 'fr_revenge', 'c27_end'],
  '五个结局：三幕各自的结局 + 自由活动的「结束游戏」 + 报仇'
);
t.eq(Object.keys(story.povs), ['西比拉', '奥布里'], '两个视角：西比拉 / 奥布里');
t.eq(story.meta.start, 'p1_carriage', '起点是 p1_carriage');
t.eq(act1.meta.continues, ['../act2/story.json'], '第一幕的 meta.continues 指向第二幕剧本');
t.eq(act2.meta.continues, ['../act3/story.json'], '第二幕的 meta.continues 指向第三幕剧本');
t.eq(act3.meta.continues, undefined, '第三幕后面没有了，不写 continues');

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
  // 「让布朗去请X过来」也是 hub 上的一条出口
  if (hub) {
    for (const iv of roam.invites || []) {
      const r = roam.rooms[iv.room];
      if (!r) continue;
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
    // 进驻这些房间时可能当场触发报仇（引擎掷骰子跳过去）
    const rv = roam.revenge;
    if (rv && rv.node && (rv.rooms || []).indexOf(name) >= 0) out.push(rv.node);
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
t.eq(reachable.size, 109, '可达节点数 = 节点总数');
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

t.eq(story.config.statOrder, ['伊莎贝尔_好感', '西比拉_好感', '西比拉_警惕', '西比拉_亲密'], '四个隐藏数值');
t.eq(
  Object.keys(story.initialStats).sort(),
  ['伊莎贝尔_好感', '西比拉_亲密', '西比拉_好感', '西比拉_警惕'],
  '初始数值就是这四项（.sort() 按码位排，所以「亲密」在「好感」前面）'
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
t.eq(choicePoints.length, 12, '决定点 12 个（第一幕 6 + 第二幕 3 + 第三幕 3）');
t.eq(
  choicePoints.map((n) => n.id),
  ['p1_carriage', 'p5_bridge', 'p6_courtyard', 'a1_returned', 'a4_hair', 'a5_teach',
    'b2_haier_knock', 'b4_enter', 'b8_farewell',
    'c5_lesson', 'c6_first', 'c26_invite'],
  '决定点就是这 12 个'
);
t.eq(ALL_PATHS.length, 13824, '分支组合共 13824 条（第一幕 216 × 第二幕 2×2×2 × 第三幕 2×2×2）');

// 序章 + 第二幕：选项只决定「先看/先做原文里的哪一个动作」，不加减数值
t.empty(
  choicePoints.filter((n) => n.pov === '西比拉' && n.id[0] !== 'c')
    .flatMap((n) => n.choices.filter((c) => c.effects && c.effects.length)
      .map((c) => `${n.id} 的「${c.text}」不该有效果`)),
  '序章 + 第二幕的选项都不改数值'
);

// 第三幕是西比拉当老师的那一段：选项各带 ±1，只动「伊莎贝尔_好感 / 西比拉_警惕」这两项
const badAct3 = [];
for (const n of choicePoints.filter((n) => n.id[0] === 'c')) {
  for (const c of n.choices) {
    const eff = c.effects || [];
    if (eff.length !== 1) badAct3.push(`${n.id}「${c.text}」效果有 ${eff.length} 条，应为 1`);
    else if (Math.abs(eff[0].value) !== 1) badAct3.push(`${n.id}「${c.text}」改的是 ${eff[0].value}，应为 ±1`);
    else if (['伊莎贝尔_好感', '西比拉_警惕'].indexOf(eff[0].stat) < 0) badAct3.push(`${n.id}「${c.text}」动的是 ${eff[0].stat}`);
  }
}
t.empty(badAct3, '第三幕的每个选项都恰好 ±1 一项数值（伊莎贝尔_好感 / 西比拉_警惕）');

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

t.section(`跑通全部 ${ALL_PATHS.length} 条路径`);

const ran = [];
const problems = { end: [], stats: [], bg: [], error: [], start: [], intoAct2: [], intoAct3: [] };

for (const p of ALL_PATHS) {
  let r;
  try {
    r = replay(p.picks);
  } catch (err) {
    problems.error.push(`路径 [${p.picks}] 跑挂了：${err.message}`);
    continue;
  }
  ran.push(r);
  if (r.end !== 'c27_end') problems.end.push(`路径 [${p.picks}] 停在 ${r.end}`);
  // 「好感 + 警惕 恒等于 3」是第一幕那条设计：第三幕会各自 ±1，所以在跨进第三幕那一刀上切
  const at = r.act1EndStats || {};
  const sum = at['伊莎贝尔_好感'] + at['西比拉_警惕'];
  if (sum !== 3) {
    problems.stats.push(`路径 [${p.picks}] 进第三幕时好感+警惕=${sum}（好感 ${at['伊莎贝尔_好感']} / 警惕 ${at['西比拉_警惕']}）`);
  }
  for (const b of r.bgs) if (!b.bg) problems.bg.push(`路径 [${p.picks}] 节点 ${b.node} 没有背景`);
  if (r.nodes[0] !== 'p1_carriage') problems.start.push(`路径 [${p.picks}] 起点是 ${r.nodes[0]}`);
  if (!r.nodes.includes('b1_room')) problems.intoAct2.push(`路径 [${p.picks}] 没走进第二幕`);
  if (!r.nodes.includes('c1_door')) problems.intoAct3.push(`路径 [${p.picks}] 没走进第三幕`);
}

t.eq(ran.length, ALL_PATHS.length, `${ALL_PATHS.length} 条路径全部跑完，没有一条崩`);
t.empty(problems.error, '没有路径抛错');
t.empty(problems.end, '每条路径都从第一幕一路走到第三幕的 c27_end');
t.empty(problems.stats, '每条路径进第三幕时「好感 + 警惕」都恒等于 3（第二幕一个 effects 都没写）');
t.empty(problems.bg, '沿途每个节点都有背景（背景会一直沿用，不会空场）');
t.empty(problems.start, '每条路径都从 p1_carriage 开始');
t.empty(problems.intoAct2, '每条路径都真的进过第二幕（免得 continueTo 断了却假性通过）');
t.empty(problems.intoAct3, '每条路径都真的进过第三幕（第二幕那颗「继续」按钮断了要拦下来）');

// 第一幕跑完那一刻的上下限：好感 / 警惕 都在 0~3
const boundAt = (key) => {
  const v = ran.map((r) => (r.act1EndStats || {})[key]);
  return [Math.min(...v), Math.max(...v)];
};
t.eq([...boundAt('伊莎贝尔_好感'), ...boundAt('西比拉_警惕')], [0, 3, 0, 3], '进第三幕时 好感 / 警惕 都在 0~3');
// 再叠上第三幕那三处 ±1：好感最多 3+1+1、最少 0-1；警惕最多 3+1+1、最少 0-1
const finalBound = (key) => {
  const v = ran.map((r) => r.stats[key]);
  return [Math.min(...v), Math.max(...v)];
};
// 警惕的区间是没写进 statRanges 的默认 [0, 100]，所以第三幕那个 -1 最低只能压到 0
t.eq([...finalBound('伊莎贝尔_好感'), ...finalBound('西比拉_警惕')], [-1, 5, 0, 5],
  '第三幕的 ±1 之后，好感落在 -1~5、警惕落在 0~5');
t.ok(ran.every((r) => Object.values(r.stats).every((v) => v >= -100 && v <= 100)),
  '数值都没跑出 config.statRanges 的区间');

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

// 前缀就说明了视角：p（序章）/ b（第二幕）/ c（第三幕）是西比拉，a（第一幕主场）/ f（自由活动）是奥布里
t.empty(
  story.nodes.filter((n) => (n.id[0] === 'p' || n.id[0] === 'b' || n.id[0] === 'c') && n.pov !== '西比拉').map((n) => `${n.id} 的 pov 是 ${n.pov}`),
  'p / b / c 开头的节点（序章、第二幕、第三幕）都是西比拉视角'
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
t.eq(nodeById.get('b25_end').continueTo, 'c1_door', '第二幕的 continueTo 指向第三幕的开头');
t.eq(nodeById.get('c27_end').continueTo, undefined, '第三幕是最后一幕，结局后面不写 continueTo');

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
t.eq(panel.statPanel().map((s) => s.display), ['?', '?', '?', '?'], '默认只给「?」不给数字');
panel.toggleStats(true);
t.eq(panel.statPanel().map((s) => s.display), ['3', '0', '0', '0'], '按 V 之后才显示真实数字');
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
t.eq(textOf(step.view.choices), ['去西比拉的房间', '去伊莎贝尔的房间', '让布朗去请西比拉过来', '让布朗去请伊莎贝尔过来', '进入下一幕', '结束游戏'],
  'hub 菜单：两个能去的地方 + 两个「请人过来」+ 进入下一幕 + 结束游戏');
t.eq(step.view.room, null, '在 hub 上没有「房间里那个人」，右槽留空');
t.empty(step.view.choices.filter((c) => !c.enabled).map((c) => c.text), 'hub 上已经没有点不动的项了');

// --- 进西比拉的房间：右槽直接是她当前的状态 ---
t.eq(roam1.choose(indexOfText(step.view.choices, '去西比拉的房间')).ok, true, '进得了西比拉的房间');
t.eq(roam1.node.id, 'fr_sib_maid', '默认穿女仆装，落点是 fr_sib_maid');
step = runToMenu(roam1);
t.eq(textOf(step.view.choices), ['称赞', '普通对话', '触摸', '换装', '离开'], '房间里：称赞 / 普通对话 / 触摸 / 换装 / 离开');
t.eq((step.view.room || {}).speaker, '西比拉', '视图告诉了界面右槽站谁');
t.eq((step.view.room || {}).portrait, 'chr_sibylla', '右槽是她此刻那套的半身像');
t.eq(roam1.currentArt().portrait, 'chr_aubrey', '左槽是奥布里（主视角角色此刻的样子）');

// --- 好感低：触摸 → 警惕上升、好感跟着掉（区间是 -100~100，掉得动） ---
t.eq(roam1.getStat('西比拉_好感'), 0, '刚进来好感是 0');
roam1.setStat('西比拉_好感', -10);          // 落到「≥-49」那一档
step = runToMenu(roam1);
let touch = roam1.choose(indexOfText(step.view.choices, '触摸'));
t.eq(touch.ok, true, '触摸点得动');
t.eq(touch.effects.filter((x) => x.stat === '西比拉_警惕' && x.delta === 1).length, 1, '好感低：触摸让警惕 +1');
t.eq(roam1.getStat('西比拉_好感'), -11, '好感低：触摸把好感往下打');
const lowLines = runToMenu(roam1).lines;
t.eq(lowLines.length > 0, true, '低好感那一档有它自己的占位台词');

// --- 好感高：同一次触摸走另一支（45 落在「≥40」那一档） ---
roam1.setStat('西比拉_好感', 45);
step = runToMenu(roam1);
touch = roam1.choose(indexOfText(step.view.choices, '触摸'));
t.ok(touch.roam.branch && roam1.roamData.affinity.tiers.includes(touch.roam.branch.value),
  '走的确实是有条件的那一条分支，档位取自数据里的 affinity.tiers');
t.eq(touch.effects.filter((x) => x.stat === '西比拉_好感' && x.delta === 1).length, 1, '好感高：触摸让好感 +1');
const highLines = runToMenu(roam1).lines;
t.eq(highLines.length > 0, true, '高好感那一档也有自己的台词');
t.ok(highLines.join('') !== lowLines.join(''), '两档的台词不是同一段');

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

// 「去她的房间」落的是她此刻穿着的那套 —— 否则每次回 hub 再进去都把她悄悄换回默认装，
// 「请她过来时穿她最近那套」就成了永远看不到的死代码
t.eq(roam1.choose(indexOfText(step.view.choices, '去西比拉的房间')).ok, true, '再进一次她的房间');
t.eq(roam1.node.id, 'fr_sib_riding', '落点还是骑装：她在哪儿、穿着什么，都跟着走');
t.eq(roam1.choose(indexOfText(runToMenu(roam1).view.choices, '离开')).ok, true, '再出来');
step = runToMenu(roam1);

// --- 伊莎贝尔的房间：没有换装 ---
step = runToMenu(roam1);
t.eq(roam1.choose(indexOfText(step.view.choices, '去伊莎贝尔的房间')).ok, true, '进得了伊莎贝尔的房间');
t.eq(roam1.node.id, 'fr_isa', '落点是 fr_isa');
step = runToMenu(roam1);
t.eq(textOf(step.view.choices), ['称赞', '普通对话', '触摸', '离开'], '伊莎贝尔房间没有「换装」');
t.eq(indexOfText(step.view.choices, '换装'), -1, '换装只在西比拉的房间里能选');
t.eq((step.view.room || {}).portrait, 'chr_isabelle', '右槽是伊莎贝尔');

/* --- 请人过来：让布朗去把西比拉或伊莎贝尔叫到奥布里的房间 --- */

t.section('请人过来');

const invites = story.freeRoam.invites;
t.eq(invites.map((i) => i.target), ['西比拉', '伊莎贝尔'], '两个能请的人');
for (const iv of invites) {
  const r = story.freeRoam.rooms[iv.room];
  t.ok(!!r, iv.label + ' 的落点房间「' + iv.room + '」在数据里');
  t.eq(r.hidden, true, iv.room + ' 是隐藏房间（不进 hub 的「去X的房间」列表）');
  t.eq(r.canChangeOutfit, false, iv.room + ' 里不给换装（来访的人换衣服会和她自己房间的状态打架）');
}

// hub 的去处列表里没有来访房间（hidden 生效）
const hubEng = new StoryEngine(story);
hubEng.start();
hubEng.enterNode('a10_end');
hubEng.enterRoam(hubEng.roamAnchorAfter('a10_end'));
const hubTexts = textOf(runToMenu(hubEng).view.choices);
t.empty(
  invites.map((i) => i.room).filter((n) => hubTexts.includes('去' + n + '的房间')),
  'hub 上没有「去来访房间」的入口'
);
t.ok(hubTexts.includes('去西比拉的房间') && hubTexts.includes('去伊莎贝尔的房间'),
  '正常房间照旧列着');

const visit = new StoryEngine(story);
visit.start();
visit.enterNode('a10_end');
visit.enterRoam(visit.roamAnchorAfter('a10_end'));
step = runToMenu(visit);
t.eq(visit.choose(indexOfText(step.view.choices, '让布朗去请西比拉过来')).ok, true, '请得动西比拉');
t.eq(visit.node.id, 'fr_visit_sib_maid', '默认这套（还没换过衣服）→ 请来的就是女仆装的她');
step = runToMenu(visit);
t.eq((step.view.room || {}).speaker, '西比拉', '视图告诉界面右槽站的是她');
t.eq(textOf(step.view.choices), ['称赞', '普通对话', '触摸', '离开'],
  '来访的西比拉借的是她自己房间的动作表，但没有「换装」');
t.eq(visit.currentArt().bg, 'bg_aubrey_room', '人是在奥布里的房间里');
t.eq(indexOfText(step.view.choices, '离开') >= 0, true, '还能离开');

// 她最近穿的是哪套，请来的时候就是哪套 —— 专测 maid → riding → maid 这个序列
const tail = new StoryEngine(story);
tail.start();
tail.enterNode('a10_end');
tail.enterRoam(tail.roamAnchorAfter('a10_end'));
tail.choose(indexOfText(runToMenu(tail).view.choices, '去西比拉的房间'));
runToMenu(tail);
tail.choose(indexOfText(runToMenu(tail).view.choices, '换装'));
runToMenu(tail);
tail.choose(indexOfText(runToMenu(tail).view.choices, '骑装'));      // maid → riding
runToMenu(tail);
tail.choose(indexOfText(runToMenu(tail).view.choices, '女仆装'));    // riding → maid
runToMenu(tail);
tail.choose(indexOfText(runToMenu(tail).view.choices, '退出换装'));
runToMenu(tail);
tail.choose(indexOfText(runToMenu(tail).view.choices, '离开'));
step = runToMenu(tail);
tail.choose(indexOfText(step.view.choices, '让布朗去请西比拉过来'));
t.eq(tail.node.id, 'fr_visit_sib_maid', '最后穿回女仆装 → 请来的也是女仆装（不是中间那套骑装）');
t.eq(tail._roamOutfitByHistory('西比拉'), 'maid', '按 history 从后往前找，不看 visited（它是 Set，不记重复）');

// 请伊莎贝尔：她的房间里没有换装
const isa = new StoryEngine(story);
isa.start();
isa.enterNode('a10_end');
isa.enterRoam(isa.roamAnchorAfter('a10_end'));
isa.choose(indexOfText(runToMenu(isa).view.choices, '让布朗去请伊莎贝尔过来'));
t.eq(isa.node.id, 'fr_visit_isa', '请得来伊莎贝尔');
step = runToMenu(isa);
t.eq(textOf(step.view.choices), ['称赞', '普通对话', '触摸', '离开'], '伊莎贝尔来访：没有换装');
t.eq((step.view.room || {}).portrait, 'chr_isabelle', '右槽是伊莎贝尔');
t.eq(isa.currentArt().bg, 'bg_aubrey_room', '也是在奥布里的房间里');

/* --- 高好感的特殊剧情：房间菜单里多出来的一项 --- */

t.section('特殊剧情');

const special = story.freeRoam.rooms['西比拉'].special;
t.eq(special.when.stat, '西比拉_好感', '特殊剧情挂在好感上');
t.eq(special.when.value, 80, '80 是门槛（和触摸分档的最高一档对齐）');
t.ok(special.lines.length >= 8, '特殊剧情是一整段（不是一句话）');

/** 在高/低好感下进她的房间，返回房间菜单 */
function roomMenuAt(value) {
  const eng = freshRoom();
  eng.setStat('西比拉_好感', value);
  return { eng, view: runToMenu(eng).view };
}
t.eq(indexOfText(roomMenuAt(45).view.choices, special.label), -1, '好感不够：菜单里没有这一项');
const high = roomMenuAt(85);
const specialIdx = indexOfText(high.view.choices, special.label);
t.ok(specialIdx >= 0, '好感够：菜单里多出来一项');
t.eq(specialIdx, 3, '摆在「触摸」和「换装」之间');
t.eq(high.view.choices[specialIdx].hint, special.hint, '菜单项用的是数据里的提示');

const intimacyBeforeSpecial = high.eng.getStat('西比拉_亲密');
const sp = high.eng.choose(specialIdx);
t.eq(sp.ok, true, '点得动');
t.eq(runToMenu(high.eng).lines.join('|'), special.lines.map((l) => l.text).join('|'), '播的就是数据里那段');
t.eq(high.eng.node.id, 'fr_sib_maid', '留在原地（不是换场景，台词播完回到房间菜单）');
t.eq(high.eng.getStat('西比拉_亲密'), intimacyBeforeSpecial + 2, '特殊剧情加亲密值');
t.ok(indexOfText(runToMenu(high.eng).view.choices, '换装') >= 0, '播完照样回房间菜单，换装还在');

/* --- 第二幕之后的 hub：没有「进入下一幕」 --- */
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
// 「f 开头的节点」里除了声明过的锚点，还有引擎自己跳过去的报仇结局，所以分开数
const anchors = story.freeRoam.anchors.map((id) => nodeById.get(id));
const roamNodes = story.nodes.filter((n) => n.id[0] === 'f');
t.eq(anchors.length, 14,
  '十四个自由活动锚点（3 个 hub + 4 个装束锚点 + 1 个房间锚点 + 5 个「请人过来」的落点 + 结束游戏的 fr_the_end）');
t.ok(anchors.every(Boolean), 'anchors 里写 id 全都在节点表里');
t.eq(roamNodes.length, anchors.length + 1, '锚点之外只有一个 f 开头的节点：报仇的落点');
t.empty(anchors.filter((n) => n.next || n.choices).map((n) => n.id),
  '锚点一律不写 next / choices（写了 next 会盖过状态机）');
t.empty(anchors.filter((n) => !n.freeRoam).map((n) => n.id), '锚点都打了 freeRoam 标记');
t.eq(anchors.filter((n) => n.ending).map((n) => n.id), ['fr_the_end'],
  '锚点里只有 fr_the_end 是结局，别的都是菜单');
t.eq(roamNodes.filter((n) => !story.freeRoam.anchors.includes(n.id) && n.ending).map((n) => n.id),
  ['fr_revenge'], '不在锚点里的那个 f 节点就是报仇结局');
t.empty(report.warnings, '自检没有把这些锚点当成「走不到」或「结局」');

// 自由活动之外一条 effects 都没有（好感只在自由活动里动）
t.empty(
  story.nodes.filter((n) => n.id[0] !== 'f').flatMap((n) => (n.choices || [])
    .filter((c) => (c.effects || []).some((e) => e.stat === '西比拉_好感'))
    .map((c) => `${n.id} 的「${c.text}」动了西比拉_好感`)),
  `主线那 ${ALL_PATHS.length} 条路径一条都不碰「西比拉_好感」`
);

// 没有 freeRoam 的剧本照旧跑（第一幕单独打开时就是这个情形）
const noRoam = new StoryEngine(api.composeStories([act1]));
noRoam.start();
t.eq(noRoam.roamData, null, '只拼第一幕时没有自由活动数据');
t.eq(noRoam.enterRoam('fr_hub').ok, false, '没有数据时进不了自由活动');
t.eq(noRoam.advance().type, 'line', '没有自由活动时 advance() 一切照旧');

/* ===================================================================
 * 7. 触摸分档 + 连摸五次
 * =================================================================== */

t.section('触摸分档');

const affinity = roam.affinity;
t.eq(affinity.stat, '西比拉_好感', '分档看的是西比拉的好感');
const touchAction = story.freeRoam.rooms['西比拉'].actions.filter((a) => a.id === 'touch')[0];
const branches = touchAction.branches;
t.eq(branches.filter((b) => b.if).map((b) => b.if.value), affinity.tiers,
  '每一档的阈值都写在 affinity.tiers 里，分支条件照着它写');
t.eq(branches.length, affinity.tiers.length + 1, '最后一条不写 if，是兜底');
t.eq(branches[branches.length - 1].if, undefined, '兜底那条确实没写 if');

// 用户的硬要求：每一档都得说拒绝的话，只是激烈程度不同
const tierText = branches.map((b) => b.lines.map((l) => l.text).join(''));
t.eq(new Set(tierText).size, tierText.length, '五档的台词各不相同');
t.eq(
  tierText.filter((s) => !/请您|不合适/.test(s)).length,
  0,
  '五档都在拒绝（每档至少有一句「请您…」或「不合适」）'
);

t.section('触摸分档的行为');

/** 进西比拉的房间（进去之后再改数值，免得撞上进门时的掷骰） */
function freshRoom(hub) {
  const eng = new StoryEngine(story);
  eng.start();
  eng.enterNode(hub === 'fr_end_hub' ? 'b25_end' : 'a10_end');
  eng.enterRoam(eng.roamAnchorAfter(eng.node.id));
  eng.choose(indexOfText(runToMenu(eng).view.choices, '去西比拉的房间'));
  return eng;
}

/** 在房间里连做同一个动作 n 次，返回每次 choose 的结果 */
function doAction(eng, label, times) {
  const out = [];
  for (let i = 0; i < times; i++) {
    out.push(eng.choose(indexOfText(runToMenu(eng).view.choices, label)));
    runToMenu(eng);
  }
  return out;
}

/** 在某一档好感上摸一下：返回说完话之后的好感、以及说了什么 */
function touchAt(value) {
  const eng = freshRoom();
  eng.setStat('西比拉_好感', value);
  const res = eng.choose(indexOfText(runToMenu(eng).view.choices, '触摸'));
  return { after: res.effects.filter((e) => e.stat === '西比拉_好感').map((e) => e.after)[0],
           lines: runToMenu(eng).lines };
}

t.eq(touchAt(99).after, 100, '好感 ≥80 那一档：触摸让好感升一点');
t.eq(touchAt(45).after, 46, '好感 ≥40 那一档：也升一点');
t.eq(touchAt(5).after, undefined, '好感 ≥0 那一档：不碰数值');
t.eq(touchAt(-10).after, -11, '好感 ≥-49 那一档：好感掉 1');
t.eq(touchAt(-60).after, -62, '低于 -50 那一档：好感掉 2');
t.eq(new Set([99, 45, 5, -10, -60].map((v) => touchAt(v).lines.join('|'))).size, 5,
  '五档说出来的是五段不同的话');

t.section('连摸五次');

const combo = story.freeRoam.touchCombo;
t.eq(combo.every, 5, '五次一档（每逢第 5 次，不是第 5 次之后一直掉）');
t.eq(combo.peakStat, 90, '90 是分界：以上不掉好感，改加亲密值');
t.ok(story.config.statOrder.includes(combo.reward.stat), '加的那个数值是面板上的一项');
t.eq(story.initialStats[combo.reward.stat], 0, '亲密值从 0 开始');

// 好感 0：摸五下，第五下挨罚
const five = freshRoom();
const fiveRes = doAction(five, '触摸', 5);
t.eq(five.roam.touchStreak, 5, '连击数攒到 5');
t.eq(fiveRes[4].effects.filter((e) => e.stat === combo.stat && e.delta === -2).length, 1,
  '第五下多扣 2 点好感');
t.eq(fiveRes[3].effects.filter((e) => e.stat === combo.stat && e.delta === -2).length, 0,
  '第四下还没有惩罚');
t.eq(five.roam.touchStreak, 5, '触发之后接着往下数（不归零），第 10 下还会再罚一次');

// 中间插一个别的动作，连击就断了
doAction(five, '称赞', 1);
t.eq(five.roam.touchStreak, 0, '换一个动作（称赞）就把连击打断了');

const broken = freshRoom();
doAction(broken, '触摸', 4);
doAction(broken, '称赞', 1);
const againTouch = doAction(broken, '触摸', 1);
t.eq(broken.roam.touchStreak, 1, '摸 4 下 → 称赞一下 → 重新从一开始数');
t.eq(againTouch[0].effects.filter((e) => e.stat === combo.stat && e.delta === -2).length, 0,
  '被打断之后这一下没有惩罚');

// 好感 90 以上：不掉好感，改加亲密值
const peak = freshRoom();
peak.setStat(combo.stat, 95);
const intimacyBefore = peak.getStat(combo.reward.stat);
const peakRes = doAction(peak, '触摸', 5);
t.eq(peakRes[4].effects.filter((e) => e.stat === combo.reward.stat && e.delta === 1).length, 1,
  '好感 90 以上：第五下加的是亲密值');
t.eq(peakRes.flatMap((r) => r.effects).filter((e) => e.stat === combo.stat && e.delta < 0).length, 0,
  '好感 90 以上：一下都不掉好感');
t.eq(peak.getStat(combo.reward.stat), intimacyBefore + 1, '亲密值真的加上去了');
const intimacyNote = peakRes[4].effects.filter((e) => e.stat === combo.reward.stat)[0].note;
t.ok(!!intimacyNote && !/\d/.test(intimacyNote), '加亲密值时给的也是一句不带数字的感觉');

// 离开房间再回来，连击归零
const left = freshRoom();
doAction(left, '触摸', 2);
t.eq(left.roam.touchStreak, 2, '摸了两下，连击数 2');
left.choose(indexOfText(runToMenu(left).view.choices, '离开'));
left.choose(indexOfText(runToMenu(left).view.choices, '去西比拉的房间'));
t.eq(left.roam.touchStreak, 0, '离开房间再进来，连击归零');

t.section('换装之后的话也分档');

const outfits = story.freeRoam.rooms['西比拉'].outfits;
t.eq(
  Object.keys(outfits).filter((id) => !(outfits[id].branches || []).length),
  [],
  '四套装束换完之后的话都按好感分档'
);

/** 换到某一套，返回浮层上她说的那句话 */
function wearLine(outfitLabel, value) {
  const eng = freshRoom();
  eng.setStat('西比拉_好感', value);
  eng.choose(indexOfText(runToMenu(eng).view.choices, '换装'));
  eng.choose(indexOfText(runToMenu(eng).view.choices, outfitLabel));
  return runToMenu(eng).view.line;
}

const lowWear = wearLine('骑装', 0);
const highWear = wearLine('骑装', 85);
t.ok(lowWear && highWear && lowWear.text !== highWear.text, '同一套衣服，好感不同说出来的话不一样');
t.eq(wearLine('骑装', 85).text, highWear.text, '同一档里说的话是稳定的');
t.eq(lowWear.speaker, '西比拉', '换装之后那句话还是她说的（占位文本，等作者替换）');

/* ===================================================================
 * 报仇：好感掉到 -50 以下，再进她房间时按概率触发
 * =================================================================== */

t.section('报仇');

const rev = story.freeRoam.revenge;
t.eq(rev.stat, '西比拉_好感', '报仇看的是好感');
t.eq(rev.threshold, -50, '-50 是分界（正好 -50 不下手，更低才报）');
t.eq(rev.node, 'fr_revenge', '落点是 fr_revenge');
t.eq(nodeById.get('fr_revenge').ending, true, 'fr_revenge 是个结局节点');
t.eq(story.freeRoam.anchors.indexOf('fr_revenge'), -1, '报仇结局不在 anchors 里（不该能从结局卡片直接点进去）');
// 结局卡片顶上那行字用的是 currentTitle()（沿 history 回看最近一个有 title 的节点）。
// 报仇节点自己不写 title 的话，卡片会顶着「自由活动 · 西比拉的房间」——像个章节标题，不像结局。
t.ok(nodeById.get('fr_revenge').title, '报仇节点自己带标题（别让结局卡片借房间那行字）');
t.eq(new StoryEngine(story).roamAnchorAfter('fr_revenge'), null, '它后面没有「自由活动 ▶」可点');
t.ok((rev.rooms || []).includes('西比拉'), '她自己的房间是会出事的地方');
t.ok(rev.lines.length > 0, '报仇那段台词写在数据块里（不进节点 dialogues，免得被 fidelity 当成自编台词）');

/** 换个报仇参数的剧本副本：骰子的确定性要和概率脱钩，测的时候才方便 */
function revengeStory(patch) {
  const copy = JSON.parse(JSON.stringify(story));
  Object.assign(copy.freeRoam.revenge, patch);
  return copy;
}

/** 用某份剧本进西比拉的房间；进门前先把好感设成 value（在 hub 上设，不会提前掷骰） */
function roomWith(s, value) {
  const eng = new StoryEngine(s);
  eng.start();
  eng.enterNode('a10_end');
  eng.enterRoam(eng.roamAnchorAfter('a10_end'));
  eng.setStat(s.freeRoam.revenge.stat, value);
  eng.choose(indexOfText(runToMenu(eng).view.choices, '去西比拉的房间'));
  return eng;
}

// --- 骰子只用存档里存着的东西算 ---
const dice = roomWith(revengeStory({ chance: 0 }), -60);
const rollA = dice._roamRoll('revenge', rev.stat, -60);
t.eq(rollA, dice._roamRoll('revenge', rev.stat, -60), '同一个种子掷两次，点数一样');
t.ok(rollA >= 0 && rollA < 1, '掷出来的是 [0,1) 里的小数');

t.eq(dice._roamVisitIndex('fr_sib_maid'), 1, '这是第一次进她的房间（history 里数得出来）');
dice.choose(indexOfText(runToMenu(dice).view.choices, '离开'));
dice.choose(indexOfText(runToMenu(dice).view.choices, '去西比拉的房间'));
t.eq(dice._roamVisitIndex('fr_sib_maid'), 2, '再进来一次，数到 2');
t.ok(dice._roamRoll('revenge', rev.stat, -60) !== rollA,
  '离开再进来，history 长了一条，骰子跟着换个数（不然躲不掉）');

const counted = new StoryEngine(story);
counted.restore(JSON.parse(JSON.stringify(dice.snapshot())));
t.eq(counted._roamVisitIndex('fr_sib_maid'), 2, '读档之后还是 2（history 是存档里存着的）');

// --- 概率 1：低于 -50 一定报 ---
const always = roomWith(revengeStory({ chance: 1 }), -60);
const alwaysStep = runToMenu(always);
t.eq(always.node.id, 'fr_revenge', '概率 1 + 好感低于 -50：一进房间就落到报仇结局');
t.eq(always.node.ending, true, 'fr_revenge 是结局节点');
t.ok(alwaysStep.lines.length > 0, '先把占位台词播出来（不是当场黑屏）');
t.eq(alwaysStep.view.type, 'end', '台词播完就是结局屏');
t.eq(always.currentTitle(), nodeById.get('fr_revenge').title, '结局卡片顶上写的是报仇自己那行字，不是房间的章节标题');
t.eq(always.ended, true, '引擎也记成结束了');
t.eq(always._roamHasMenu(), false, '结局里不再弹自由活动的菜单');
t.eq(always.availableChoices().length, 0, '一个按钮都不给（「继续下一幕」由界面自己决定）');
t.eq(always.advance().type, 'end', '再点一下还是结局，不会又跳一次');
t.eq(alwaysStep.lines.join('|'), rev.lines.map((l) => l.text).join('|'), '播的就是数据块里那段占位台词');
t.eq(alwaysStep.view.room, undefined, '报仇场景不在任何房间里，右槽不摆「房间里那个人」');

// --- 概率 0：同样低于 -50，一次也不报 ---
const never = roomWith(revengeStory({ chance: 0 }), -60);
t.eq(runToMenu(never).view.type, 'choices', '概率 0：进了她的房间，什么也没发生');

// --- 好感没低到 -50：就算概率 1 也不报 ---
t.eq(runToMenu(roomWith(revengeStory({ chance: 1 }), -50)).view.type, 'choices', '-50 正好不下手（要更低才报）');
t.eq(runToMenu(roomWith(revengeStory({ chance: 1 }), 0)).view.type, 'choices', '好感 0 更不会报');

// --- 同一份存档读两次，结果必须一样（不能靠读档刷） ---
const hubSnap = (() => {
  const eng = new StoryEngine(story);
  eng.start();
  eng.enterNode('a10_end');
  eng.enterRoam(eng.roamAnchorAfter('a10_end'));
  eng.setStat('西比拉_好感', -60);
  runToMenu(eng);
  return JSON.parse(JSON.stringify(eng.snapshot()));
})();
function replaySave(snap) {
  const eng = new StoryEngine(story);
  eng.restore(JSON.parse(JSON.stringify(snap)));
  const step = runToMenu(eng);
  eng.choose(indexOfText(step.view.choices, '去西比拉的房间'));
  const view = runToMenu(eng);
  return { node: eng.node.id, view: view.view.type, roll: eng._roamRoll('revenge', '西比拉_好感', eng.getStat('西比拉_好感')) };
}
const replayA = replaySave(hubSnap);
const replayB = replaySave(hubSnap);
t.eq(replayA.roll, replayB.roll, '同一份存档读两次，骰子点数一致');
t.eq(replayA.node, replayB.node, '同一份存档读两次，报仇发生没发生也一致');
t.eq(replayA.view, replayB.view, '连落在哪个屏上（菜单还是结局）都一样');

/* ===================================================================
 * 中途暂停：剧情 → 自由活动 → 回到原来那一句
 * =================================================================== */

t.section('中途暂停');

const pz = new StoryEngine(story);
pz.start();
pz.enterNode('b1_room');
pz.advance();
const pauseNode = pz.node.id;
const pauseLine = pz.lineIndex;
t.ok(pauseLine > 0, '先往前播了一句（这样才测得出「回到原来那一句」）');
t.eq(pz.paused, false, '一开始没暂停');

const paused = pz.pauseToStory();
t.eq(paused.ok, true, '剧情中途按暂停：进得去');
t.eq(pz.paused, true, '记成暂停了');
t.eq(pz.isFreeRoamNode(pz.node), true, '人已经在自由活动里了');
t.eq(pz.node.id, 'fr_hub', '落在自由活动的 hub 上');
t.eq(pz.pauseToStory().ok, false, '已经在自由活动里，再按一次不算「暂停」');

step = runToMenu(pz);
t.eq(step.view.type, 'choices', '暂停之后自由活动的菜单照常出');
t.ok(textOf(step.view.choices).includes('去西比拉的房间'), '去得了她的房间');
t.empty(textOf(step.view.choices).filter((s) => /下一幕|结束游戏/.test(s)),
  '暂停中 hub 菜单里没有「进入下一幕」「结束游戏」（要跳幕得先回到剧情）');

// 暂停期间自由活动照常玩，涨的好感要留住
pz.choose(indexOfText(step.view.choices, '去西比拉的房间'));
const gainBefore = pz.getStat('西比拉_好感');
doAction(pz, '称赞', 1);
t.eq(pz.getStat('西比拉_好感'), gainBefore + 1, '暂停里自由活动照常涨好感');
const visitBefore = pz._roamVisitIndex('fr_sib_maid');

const backToStory = pz.resumeFromStory();
t.eq(backToStory.ok, true, '按一下回到剧情');
t.eq(pz.paused, false, '暂停状态解除了');
t.eq(pz.node.id, pauseNode, '回到暂停时那个节点');
t.eq(pz.lineIndex, pauseLine, '接着原来那一句往下播（lineIndex 一模一样）');
t.eq(pz.getStat('西比拉_好感'), gainBefore + 1, '自由活动里涨的好感一分不丢');
t.eq(pz.roam, null, '自由活动的运行时状态清掉了');
t.eq(pz.isFreeRoamNode(pz.node), false, '人已经不在自由活动里了');
t.eq(pz._roamVisitIndex('fr_sib_maid'), visitBefore,
  '暂停 + 恢复没有多算一次「进过她的房间」（报仇的骰子不会因此重掷）');

const resumed = pz.advance();
t.eq(resumed.type, 'line', '恢复之后接着往下播');
t.eq(resumed.index, pauseLine, '播的是原来那一句的后一句，不是从头再来');
t.eq(pz.resumeFromStory().ok, false, '没暂停着就不能「回到剧情」');

// 结局之后没什么可暂停的
const done = new StoryEngine(story);
done.start();
done.enterNode('b25_end');
while (done.advance().type === 'line') { /* 一路播到底 */ }
t.eq(done.ended, true, '演完了');
t.eq(done.pauseToStory().ok, false, '结局之后不能再暂停');
t.eq(done.resumeFromStory().ok, false, '没暂停过也就回不去');

// 从结局卡片进的自由活动没有「原来的剧情」，不给暂停
const roaming = new StoryEngine(story);
roaming.start();
roaming.enterNode('a10_end');
roaming.enterRoam('fr_hub');
t.eq(roaming.pauseToStory().ok, false, '结局卡片进的自由活动没有可回的地方，按暂停是无效的');

/* ===================================================================
 * 数值区间：好感能掉到负数（报仇线要靠它）
 * =================================================================== */

t.section('数值区间');

const ranged = new StoryEngine(story);
t.eq(ranged.statRange('西比拉_警惕'), [0, 100], '没写进 config.statRanges 的数值默认 0~100');
t.eq(ranged.statRange('西比拉_好感'), [-100, 100], '好感写在 config.statRanges 里：-100~100');
t.eq(act1.config.statRanges['西比拉_好感'], [-100, 100],
  '区间写在第一幕的 config 里（第二幕的 config 会被 composeStories 丢掉，写那儿没用）');

ranged.start();
ranged.setStat('西比拉_好感', 0);
t.eq(ranged.applyEffects([{ stat: '西比拉_好感', value: -1 }])[0].after, -1, '好感掉得进负数');
t.eq(ranged.applyEffects([{ stat: '西比拉_好感', value: -500 }])[0].after, -100, '掉不出 -100 这条下限');
ranged.setStat('西比拉_好感', 0);
t.eq(ranged.applyEffects([{ stat: '西比拉_警惕', value: -1 }])[0].after, 0, '警惕还是 0~100，趴在 0 上减不动');
t.eq(ranged.setStat('西比拉_好感', -250), -100, 'setStat 也按下限夹');

// 面板的条按下限缩放：-100 空、0 在正中、100 满
ranged.setStat('西比拉_好感', -100);
const barLow = ranged.statPanel().filter((s) => s.name === '西比拉_好感')[0];
t.eq(barLow.min, -100, '面板把下限一并告诉界面');
t.eq(barLow.ratio, 0, '好感 -100 时条是空的');
ranged.setStat('西比拉_好感', 0);
t.eq(ranged.statPanel().filter((s) => s.name === '西比拉_好感')[0].ratio, 0.5, '好感 0 时条在一半');
ranged.setStat('西比拉_好感', 100);
t.eq(ranged.statPanel().filter((s) => s.name === '西比拉_好感')[0].ratio, 1, '好感 100 时条是满的');

// 读档是唯一不可信的数据入口：越界值要按各自区间夹回去（旧存档、手改的存档）
const wildSnap = JSON.parse(JSON.stringify(ranged.snapshot()));
wildSnap.stats = { 西比拉_好感: -9999, 西比拉_警惕: 9999 };
const clamped = new StoryEngine(story);
clamped.restore(wildSnap);
t.eq(clamped.getStat('西比拉_好感'), -100, '读档时越界的好感夹回下限');
t.eq(clamped.getStat('西比拉_警惕'), 100, '读档时越界的警惕夹回上限');

// 剧本作者写坏了区间，自检要说出来（别静默夹住，那样很难查）
const badRange = JSON.parse(JSON.stringify(act1));
badRange.config.statRanges['西比拉_好感'] = [100, -100];
t.ok(new StoryEngine(badRange).validate().errors.some((e) => e.includes('statRanges')),
  'statRanges 写成 [100, -100] 会报错');

const unknownRange = JSON.parse(JSON.stringify(act1));
unknownRange.config.statRanges['不存在的好感'] = [0, 10];
t.ok(new StoryEngine(unknownRange).validate().errors.some((e) => e.includes('不存在的好感')),
  'statRanges 里写了没定义的数值会报错');

const badInitial = JSON.parse(JSON.stringify(act1));
badInitial.initialStats['西比拉_警惕'] = 200;
t.ok(new StoryEngine(badInitial).validate().errors.some((e) => e.includes('initialStats')),
  'initialStats 超出自己的区间会报错（作者写错了要报，不许静默夹）');

t.done();
