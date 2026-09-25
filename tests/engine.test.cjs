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

const api = require(path.join(__dirname, '..', 'act1', 'game.js'));
const story = require(path.join(__dirname, '..', 'act1', 'story.json'));

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
      seen.end = node.id;
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
t.eq(report.stats.nodes, 34, '节点 34 个');
t.eq(report.stats.endings, ['a10_end'], '结局只有 a10_end 一个');
t.eq(Object.keys(story.povs), ['西比拉', '奥布里'], '两个视角：西比拉 / 奥布里');
t.eq(story.meta.start, 'p1_carriage', '起点是 p1_carriage');

t.section('走得到的节点');

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
  for (const c of n.choices || []) queue.push(c.next);
}
t.empty(
  story.nodes.map((n) => n.id).filter((id) => !reachable.has(id)),
  '所有节点都能走到'
);
t.eq(reachable.size, 34, '可达节点数 = 节点总数');

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

t.eq(story.config.statOrder, ['伊莎贝尔_好感', '西比拉_警惕'], '只剩两个隐藏数值');
t.eq(Object.keys(story.initialStats).sort(), ['伊莎贝尔_好感', '西比拉_警惕'], '初始数值就是这两项');
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
t.eq(choicePoints.length, 6, '决定点 6 个');
t.eq(choicePoints.map((n) => n.id), ['p1_carriage', 'p5_bridge', 'p6_courtyard', 'a1_returned', 'a4_hair', 'a5_teach'], '决定点就是这 6 个');
t.eq(ALL_PATHS.length, 216, '分支组合共 216 条（序章 3×3×3 × 主场 2×2×2）');

// 序章（西比拉视角）：选项只决定「先看/先做原文里的哪一个动作」，不加减数值
t.empty(
  choicePoints.filter((n) => n.pov === '西比拉')
    .flatMap((n) => n.choices.filter((c) => c.effects && c.effects.length)
      .map((c) => `${n.id} 的「${c.text}」不该有效果`)),
  '序章的选项都不改数值'
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

t.section('跑通全部 216 条路径');

const ran = [];
const problems = { end: [], stats: [], bg: [], error: [] };

for (const p of ALL_PATHS) {
  let r;
  try {
    r = replay(p.picks);
  } catch (err) {
    problems.error.push(`路径 [${p.picks}] 跑挂了：${err.message}`);
    continue;
  }
  ran.push(r);
  if (r.end !== 'a10_end') problems.end.push(`路径 [${p.picks}] 停在 ${r.end}`);
  const sum = r.stats['伊莎贝尔_好感'] + r.stats['西比拉_警惕'];
  if (sum !== 3) {
    problems.stats.push(`路径 [${p.picks}] 好感+警惕=${sum}（好感 ${r.stats['伊莎贝尔_好感']} / 警惕 ${r.stats['西比拉_警惕']}）`);
  }
  for (const b of r.bgs) if (!b.bg) problems.bg.push(`路径 [${p.picks}] 节点 ${b.node} 没有背景`);
}

t.eq(ran.length, 216, '216 条路径全部跑完，没有一条崩');
t.empty(problems.error, '没有路径抛错');
t.empty(problems.end, '每条路径都走到 a10_end');
t.empty(problems.stats, '每条路径的「好感 + 警惕」都恒等于 3');
t.empty(problems.bg, '沿途每个节点都有背景（背景会一直沿用，不会空场）');

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
t.eq(switches.length, 1, '整场只切一次视角');
t.eq(switches[0].from, '西比拉', '从西比拉开始');
t.eq(switches[0].to, '奥布里', '切到奥布里');
t.ok(!!switches[0].line, '切换时有一行提示文字');

t.empty(
  ran.filter((r) => r.povSwitches.length !== 1 || r.povSwitches[0].to !== '奥布里').map((r) => `[${r.picks}]`),
  '不管走哪条分支，切视角的位置都一样'
);

// 序章全是西比拉，主场全是奥布里
t.empty(
  story.nodes.filter((n) => (n.id[0] === 'p') !== (n.pov === '西比拉')).map((n) => `${n.id} 的 pov 是 ${n.pov}`),
  'p 开头的序章节点都是西比拉视角'
);
t.empty(
  story.nodes.filter((n) => (n.id[0] === 'a') !== (n.pov === '奥布里')).map((n) => `${n.id} 的 pov 是 ${n.pov}`),
  'a 开头的主场节点都是奥布里视角'
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

t.throws(() => new StoryEngine(story).restore({}), '没有 nodeId 的存档会被拒');
t.throws(() => new StoryEngine(story).restore({ nodeId: '不存在的节点' }), '指向未知节点的存档会被拒');

// 数值面板：默认藏数字
const panel = new StoryEngine(story);
panel.setStat('伊莎贝尔_好感', 3);
t.eq(panel.statPanel().map((s) => s.display), ['?', '?'], '默认只给「?」不给数字');
panel.toggleStats(true);
t.eq(panel.statPanel().map((s) => s.display), ['3', '0'], '按 V 之后才显示真实数字');
t.eq(panel.getStat('没定义过的'), 0, '没记录的数值读出来是 0');

// 效果会给一句「感觉」而不是数字
const notes = new StoryEngine(story);
const r = notes.applyEffects([{ stat: '西比拉_警惕', value: 1 }]);
t.ok(!!r[0].note && !/\d/.test(r[0].note), '隐藏数值时给的是文字感觉，不带数字');

t.done();
