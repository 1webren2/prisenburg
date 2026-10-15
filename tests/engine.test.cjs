/**
 * 引擎自检（不碰 DOM）
 * =====================================================================
 *   node tests/engine.test.cjs
 *
 * 主要盯三件事：
 *   1. 剧本自身站得住 —— 没有悬空跳转、没有走不到的节点、数值都在 statLabels 里定义过
 *   2. 所有分支都能走通：第一幕内部全跑（第一天幕间摘掉后只剩 1 条直路），跨幕链路逐条走
 *      第二幕一个 effects 都没写，所以「b 开头的节点上一次都不许改数值」——
 *      这条现在直接盯着 statChanges 查（从前是靠「跨进第三幕 vs 跨进第二幕
 *      的数值逐项相同」间接推的，但第一幕改造后中间夹进了日常层，日常层
 *      本来就该改数值，那条间接不变式自然作废）
 *      注：v1 那条「好感 + 警惕 恒等于 3」的不变量随 v2 上线作废了 ——
 *      v2 的警惕从 80 起（v1 是 0），而且第一幕的选项本身就在动警惕/好感
 *   3. 存档 / 读档 / 像素图这些机制确实按预期工作
 */

const path = require('path');
const { suite, norm } = require('./harness.cjs');

const api = require(path.join(__dirname, '..', 'act1', 'engine.js'));
const act1 = require(path.join(__dirname, '..', 'act1', 'story.json'));
const act2 = require(path.join(__dirname, '..', 'act2', 'story.json'));
const act3 = require(path.join(__dirname, '..', 'act3', 'story.json'));
const daily = require(path.join(__dirname, '..', 'daily', 'story.json'));
// 狩猎篇：一章一文件，加载链排在日常层之后（首轮回填后第八章接第九章；第三幕的旧链留档不再进入主线）
const hunt = [4, 5, 6, 7, 8].map((n) => require(path.join(__dirname, '..', 'hunt', `ch${n}.json`)));
const ch9 = require(path.join(__dirname, '..', 'hunt', 'ch9.json'));

// 一幕一个 story.json，引擎只认一个 —— 和浏览器里 boot() 一样先拼起来。
// 第一幕改造后多了一层日常层（daily/story.json），它的加载位置排在第三幕之后，
// 但剧情上的位置在第二幕与第三幕之间 —— 加载链与导航是两回事，见各文件 meta。
const story = api.composeStories([act1, act2, act3, daily, ...hunt, ch9]);

const { StoryEngine } = api;
const t = suite('引擎');

/* ===================================================================
 * 工具：把剧本当成一张图来走
 * =================================================================== */

const nodeById = new Map(story.nodes.map((n) => [n.id, n]));
const choicesOf = (id) => (nodeById.get(id).choices || []);

/** 谁指向它（含 route 条件路由的候选边） */
const preds = (id) => story.nodes.filter((n) => {
  if (n.next === id || n.continueTo === id) return true;
  if ((n.route || []).some((r) => r.next === id)) return true;
  return (n.choices || []).some((c) => c.next === id);
}).map((n) => n.id);

/**
 * 枚举一条线上的分支组合，返回 [{ picks, end }]。
 * 走到 `stopAt` 那个节点就收手，**不跟 continueTo 跨幕** —— 这样第一幕
 * （幕间摘掉后只剩一条直路）可以单独全跑，跨幕的笛卡尔积不必跟着一起炸。
 */
function enumeratePaths(startId, stopAt) {
  const paths = [];
  const walk = (id, picks, depth) => {
    if (depth > 200) throw new Error('剧情成环了，走到 ' + id);
    const node = nodeById.get(id);
    if (!node) throw new Error('悬空节点：' + id);
    if (stopAt && id === stopAt) { paths.push({ picks, end: id }); return; }
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
  walk(startId || story.meta.start, [], 0);
  return paths;
}

/**
 * 按 picks 把剧本跑一遍，顺手记下沿途看到的东西。
 * stopAt：走到这个结局节点就收手（不点「继续下一幕」）—— 第一幕单独全跑时用。
 */
function replay(picks, stopAt, chooser) {
  const engine = new StoryEngine(story);
  engine.start();
  const seen = { nodes: [], bgs: [], portraits: [], lines: [], povSwitches: [], statChanges: [] };
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
    /* 停在指定的节点上。**第一章不再以结局屏收尾**（作者定稿：第一章与第一夜连续演出），
       所以「第一幕跑完了」这件事现在是「走到了 s4_portrait」，而它不弹 end 事件 ——
       原来那条靠 continueTo 收尾的判据在这一幕上没有了，补一条按节点停的。 */
    if (stopAt && node.id === stopAt) {
      seen.end = node.id;
      seen.stats = Object.assign({}, engine.stats);
      return seen;
    }

    const v = engine.advance();
    if (v.type === 'line') { seen.lines.push({ node: node.id, ...v }); continue; }
    if (v.type === 'end') {
      // 这一幕演完了，后面还有一幕就接着往下走（enterNode 会把 ended 清掉）
      const nextAct = v.node && v.node.continueTo;
      if (nextAct && !(stopAt && (v.node || node).id === stopAt)) { engine.enterNode(nextAct); continue; }
      // 用视图里的节点，不是循环开头那个 —— 结局常常是上一个节点 next 过来的
      seen.end = (v.node || node).id;
      seen.stats = Object.assign({}, engine.stats);
      return seen;
    }
    // choices
    // chooser：跨幕链路用。第一幕 / 第二幕 / 第三幕 / 日常层各有各的选择序列，
    // 按节点 id 的首字母分派给不同的计数器 —— 日常层夹在中间，按下标硬排是排不出来的。
    let pick;
    if (chooser) {
      pick = chooser(node.id, v.choices);
    } else {
      if (i >= picks.length) throw new Error(`第 ${i + 1} 个决定点没有对应的选择（剧本分支比路径多）`);
      pick = picks[i++];
    }
    const before = Object.assign({}, engine.stats);
    const res = engine.choose(pick);
    if (!res.ok) throw new Error(`决定点 ${node.id} 选了 ${pick} 却被拒：${res.reason}`);
    for (const k of Object.keys(engine.stats)) {
      if (engine.stats[k] !== before[k]) {
        seen.statChanges.push({ node: node.id, stat: k, from: before[k], to: engine.stats[k] });
      }
    }
  }
}

// 第一幕内部：全枚举。第一天不设玩家选择（作者定稿：不设奥布里幕间、不进行玩家选择），
// s1_rain → s4_portrait 是一条直路 —— 枚举出来只有 1 条（原来是 4608 条）。
// 终点用**第一幕的最后一节**：第一章现在直接接第一夜（作者定稿「两段连续演出」），
// 不再经过那张「第一章 · 普里森堡的阴雨」的收束屏 —— o4_end 已留档（见 LEGACY）。
const ACT1_PATHS = enumeratePaths('s1_rain', 's4_portrait');
// 第二幕的第一夜（b1_room…b11_sleep）：3 个决定点，每个 2 选，8 条。
// 从前这里能一口气枚举到 b25_end，现在 b11_sleep 后面接的是日常层，
// 所以只在「原著连成一片的那一段」里枚举。
const ACT2_NIGHT_PATHS = enumeratePaths('b1_room', 'b11_sleep');
// 第三幕自己的三个决定点：c5_lesson / c6_first / c26_invite，都是 2 选。
// 不再用 enumeratePaths 从 c1_door 一路枚举 —— 那中间夹着第 6 天的四个时段（含被锁的选项）。
const ACT3_PICKS = [];
for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) ACT3_PICKS.push([a, b, c]);

/**
 * 日常层的走法：**不枚举**。
 * 日常层每个时段是个三选一的菜单（三项都点得动），第 2 / 6 天各四时段、
 * 第 3~5 天共十二时段 —— 3^20 条路线，而跨幕要验的东西（接得上、
 * 原著段入口唯一、数值不越界、视角切得对）跟它具体选哪条关系不大。
 * 所以给它三条代表路线：全选第一项 / 全选中间那项 / 全选最后一项。
 * 三条各覆盖一列活动（主线那一列只有第 2、6 天有），数值包络因此不至于漏掉中间那一列。
 * 日常层自己的结构性核对（三选项、_e→_r 的两拍、记录旗）在 daily.test.cjs 里。
 */
const firstEnabled = (list) => {
  const k = list.findIndex((c) => c.enabled);
  return k < 0 ? 0 : k;
};
const middleEnabled = (list) => {
  const on = list.map((c, k) => (c.enabled ? k : -1)).filter((k) => k >= 0);
  return on.length ? on[Math.floor((on.length - 1) / 2)] : 0;
};
const lastEnabled = (list) => {
  for (let k = list.length - 1; k >= 0; k--) if (list[k].enabled) return k;
  return 0;
};
const DAILY_PLANS = [firstEnabled, middleEnabled, lastEnabled];
// 狩猎篇同理：五章加起来二十来个决定点，每个 2 选，全枚举是天文数字。
// 它的选项只改数值、不改走向（next 是写死的），所以两条代表路线足够。
const HUNT_PLANS = [firstEnabled, lastEnabled];

/**
 * 五个区域各走各的选择序列，按节点 id 的首字母分派：
 *   s / o → 第一幕，b → 第二幕，c → 第三幕，d（dy_）→ 日常层，h（h4_…h8_）→ 狩猎篇。
 * 这样日常层夹在 b 与 c 中间也不会把下标排乱。
 * 狩猎篇的选择点和日常层一样是「2 选」，也同样**不枚举**（一章一堆决定点，
 * 笛卡尔积不值当），跟日常层共用同一条代表路线（全选第一个能选的 / 最后一个能选的）。
 * 代价：`plan` 这一项同时代表日常层与狩猎篇两条路线的取值，见 FINAL_RANGES 的注记。
 */
function chooserFor(a1picks, a2picks, a3picks, plan, huntPlan) {
  let i1 = 0;
  let i2 = 0;
  let i3 = 0;
  return (nodeId, list) => {
    const p = nodeId[0];
    if (p === 'h') return (huntPlan || plan)(list);
    if (p === 'd') return plan(list);
    if (p === 'b') return a2picks[i2++];
    if (p === 'c') return a3picks[i3++];
    return a1picks[i1++];
  };
}

const spread = (arr, n) => {
  const out = [];
  for (let k = 0; k < n; k++) out.push(arr[Math.floor((k * arr.length) / n)]);
  return out;
};
const SAMPLE1 = spread(ACT1_PATHS, 24);

/* 第二幕的 'b' 类选择序列：第一夜的 3 个（b2/b4/b8）+ 第二天的授课方式 b19（普通）。
   首轮回填后 b19 是 'b' 区里的第 4 个决定点，序列短了会在它那里被拒。 */
const A2_PICKS = ACT2_NIGHT_PATHS.map((p) => p.picks.concat([1]));

const CROSS_PATHS = [];
// A. 第一幕每条分支各配一组「第二幕夜里的走法 + 日常层路线」（轮流取端点），
//    保证每一条第一幕分支都真走完了全程（旧第三幕已脱链，不再参与跨幕枚举）
const ENDS = [];
for (const a2 of A2_PICKS) {
  for (const plan of DAILY_PLANS) ENDS.push({ a2, plan });
}
ACT1_PATHS.forEach((a1, k) => {
  const e = ENDS[k % ENDS.length];
  CROSS_PATHS.push({ a1: a1.picks, a2: e.a2, plan: e.plan });
});
// B. 均匀抽 24 条第一幕代表，配满第二幕夜里 8 × 日常层 3，保证每个组合都有人走过
for (const a1 of SAMPLE1) {
  for (const a2 of A2_PICKS) for (const plan of DAILY_PLANS) {
    CROSS_PATHS.push({ a1: a1.picks, a2, plan });
  }
}

/* ===================================================================
 * 1. 剧本自身
 * =================================================================== */

t.section('剧本结构');

const report = new StoryEngine(story).validate();

t.empty(report.errors, '自检没有 error');
// 留档的入口没有入边 —— 是登记的「脱链」，不是接漏了（见「走得到的节点」）。
// 【本轮：第一天幕间摘掉 + 台词对齐后重测】第一天的奥布里幕间整批摘掉（作者定稿：
// 不设置奥布里幕间、不进行玩家选择），四个幕间入口（o1_wait / o2_watch / o3_watch / o4_review）
// 跟着下线 —— 提醒从 8 条涨到 12 条。顺序按节点表，幕间四条排在最前（其余八条不动：
// 旧日终 b23 + 旧第三幕 c1_door 两条链首，第二天重排下线六条链首）。
t.eq(
  report.warnings,
  ['o1_wait 没有任何节点指向它，走不到', 'o2_watch 没有任何节点指向它，走不到',
    'o3_watch 没有任何节点指向它，走不到', 'o4_review 没有任何节点指向它，走不到',
    'b23_corridor 没有任何节点指向它，走不到', 'c1_door 没有任何节点指向它，走不到',
    'dy_d2_mo_r 没有任何节点指向它，走不到', 'dy_d2_nn_hl_e 没有任何节点指向它，走不到',
    'dy_d2_nn_guest_e 没有任何节点指向它，走不到', 'dy_d2_nn_account_e 没有任何节点指向它，走不到',
    'dy_d2_af_archive_e 没有任何节点指向它，走不到', 'dy_d2_af_wall_e 没有任何节点指向它，走不到'],
  '自检的 warning 涨到十二条「留档链入口走不到」的登记（幕间四条 + 旧日终 / 旧第三幕两条 + 第二天重排下线六条）'
);
t.eq(act1.nodes.length, 30, '第一幕 30 个节点（西比拉 12 + 奥布里 18）');
t.eq(act2.nodes.length, 41, '第二幕 41 个节点（27 段剧情 + 13 个自由活动锚点 + 报仇结局 fr_revenge —— fr_end_hub 已删）');
t.eq(act3.nodes.length, 33, '第三幕 33 个节点（27 段主线 + 3 个决定点各岔出的 2 条支线）');
t.eq(daily.nodes.length, 112,
  '日常层 112 个节点（第二轮回填后的第 2~6 天：49 + 16 + 18 + 13 + 12，含取消线第 7、8 天各一个占位节点'
  + '；第 2 天那 49 个里有 14 个是本次重排下线的留档，另外两个 b8_ 节点是第一夜那场戏）');
t.eq(hunt.map((h) => h.nodes.length), [22, 26, 28, 33, 18], '狩猎篇五章各 22 / 26 / 28 / 33 / 18 个节点（store 第四～第八章，一章一文件）');
t.eq(
  hunt.map((h) => h.meta.continues),
  [['ch5.json'], ['ch6.json'], ['ch7.json'], ['ch8.json'], ['ch9.json']],
  '狩猎篇的加载链一章接一章，第八章接上第九章'
);
t.eq(ch9.meta.start, 'h9_start', '第九章从 h9_start 开始（清晨，西比拉视角）');
t.eq(report.stats.nodes, 351, '拼起来是 351 个节点（30 + 41 + 33 + 112 + 127 + 8）');
t.eq(
  report.stats.endings,
  ['o4_end', 'fr_the_end', 'fr_revenge', 'h9_end'],
  '四个结局：第一幕收束 o4_end + 自由活动的「结束游戏」与报仇 + 第九章末尾 h9_end'
  + '（h8_end 已经退出结局名单 —— 它现在只是一根 next，第一幕的收束挪到了 h9_end）'
);
t.eq(Object.keys(story.povs), ['西比拉', '奥布里'], '两个视角：西比拉 / 奥布里');
t.eq(story.meta.start, 's1_rain', '起点是 s1_rain（马车里，西比拉视角）');
t.eq(act1.nodes.find((n) => n.ending).id, 'o4_end', '第一幕的结局节点是 o4_end');
t.eq(act1.nodes.find((n) => n.ending).continueTo, 'b1_room', 'o4_end 指向第二幕开头 b1_room');
t.eq(act1.meta.continues, ['../act2/story.json'], '第一幕的 meta.continues 指向第二幕剧本');
t.eq(act2.meta.continues, ['../act3/story.json'], '第二幕的 meta.continues 指向第三幕剧本');
t.eq(act3.meta.continues, ['../daily/story.json'], '第三幕的 meta.continues 指向日常层');
// 加载链与剧情顺序故意不同：daily 排在 act3 之后加载，剧情上却插在 act2 与 act3 中间。
// 这一条盯的就是「两边都别写串」。
t.eq(daily.meta.continues, ['../hunt/ch4.json'], '日常层的 continues 接上狩猎篇第一章');
// 旧第三幕（c1～c27）整条链留档：正文一字不动，但新时间线不再从它进来（详见「走得到的节点」）
t.eq(act3.nodes.find((n) => n.ending), undefined, '第三幕自己不再有结局节点 —— 第一幕的收束点交给第九章末尾');
t.eq(act3.nodes.filter((n) => n.endSub).length, 0, '第三幕的临时 endSub 也一起摘干净了');
t.eq(act3.nodes.find((n) => n.id === 'c27_end').next, 'h4_knock', '第三幕的旧收束链保留原样（c27_end → h4_knock 还在，供旧稿追溯）');
t.eq(hunt[0].meta.start, 'h4_knock', '狩猎篇第一章的起始节点还是 h4_knock（旧整章入口；新入口见跨幕一节）');
t.ok(!hunt[4].nodes.find((n) => n.id === 'h8_end').ending
  && hunt[4].nodes.find((n) => n.id === 'h8_end').next === 'h9_start'
  && hunt[4].nodes.find((n) => n.id === 'h8_end').endSub === undefined,
  'h8_end 不再弹结局屏：只留一根 next 接第九章（不显示「第一幕尾声」一类提示）');
t.ok(ch9.nodes.find((n) => n.id === 'h9_end').ending && !ch9.nodes.find((n) => n.id === 'h9_end').continueTo,
  '第九章末尾 h9_end 才是第一幕真正的收束（ending，无 continueTo）');
t.eq(ch9.nodes.find((n) => n.id === 'h9_end').title, undefined, 'h9_end 不写标题 —— 结局屏上不出现「第一幕结束」一类大字');
t.empty(
  hunt.flatMap((h) => h.nodes.filter((n) => !/^h[45678]_/.test(n.id)).map((n) => n.id)),
  '狩猎篇的节点 id 全部符合 h{章}_…'
);
t.eq(daily.meta.start, 'dy_d2_mo_intro', '日常层的入口是第 2 天早晨那场日记引入（只是元数据，真正的入口是 b11_sleep.next）');
t.eq(act2.nodes.find((n) => n.id === 'b11_sleep').next, 'dy_d2_mo_intro', '第一夜睡下 → 日记引入场 → dy_d2_mo_hub（原著正文一字不动，只换这一根指针）');
t.ok(ACT2_NIGHT_PATHS.length === 8, '第二幕第一夜 8 条分支');

t.section('日常层骨架');

/* **第二天重排下线的旧节点**：作者新稿把第 2 天的中午/午后换成「午餐后 / 午后」，
   夜晚的菜单并进了傍晚那场熬药 —— 被顶掉的那几处正文一字未删地留在 daily/story.json 里，
   但从菜单上下来了（玩家走不到，--validate 会逐个提醒）。
   凡是问「这一天现在有什么」的核对都要先把这批扣掉。 */
const RETIRED_DAILY = [
  'dy_d2_mo_r',                                        // 「谁来收拾残局」（新稿里没有这一问）
  'dy_d2_nn_hl_e', 'dy_d2_nn_hl_r',                    // 旧中午 · 大厅
  'dy_d2_nn_guest_e', 'dy_d2_nn_guest_r',              // 旧中午 · 会客厅
  'dy_d2_nn_account_e', 'dy_d2_nn_account_r',          // 旧中午 · 账房（并进午后的账册）
  'dy_d2_af_archive_e', 'dy_d2_af_archive_r',          // 旧午后 · 旧档案室
  'dy_d2_af_wall_e', 'dy_d2_af_wall_r',                // 旧午后 · 西侧城墙
  'dy_d2_ni_hub', 'dy_d2_ni_paper_e', 'dy_d2_ni_paper_r', // 旧夜晚菜单（新稿到傍晚就收）
];
const liveDaily = daily.nodes.filter((n) => RETIRED_DAILY.indexOf(n.id) < 0);

// 时段：早晨 / 中午 / 午后 /（傍晚）/ 夜晚；不是每天都有全部时段。
// 时段菜单（带选项的 hub）；第 3~5 天的煎药夜是「收束 hub」：没有选项、一根 next 收尾
const hubIds = daily.nodes.filter((n) => /^dy_d\d_(mo|nn|af|ev|ni)_hub$/.test(n.id)).map((n) => n.id);
t.eq(hubIds.length, 17, '日常层一共 17 个 _hub 节点（第 2 天 4 + 第 3 天 4 + 第 4 天 4 + 第 5 天 3 + 第 6 天 2；'
  + '其中第 2 天夜晚那个 dy_d2_ni_hub 随重排下线 —— 活着的 16 个见下面 MENU_COUNTS 与收束 hub');
t.eq(
  liveDaily.filter((n) => /^dy_d\d+_(mo|nn|af|ev|ni)(_[a-z0-9]+)*_r$/.test(n.id)).map((n) => n.id),
  ['dy_d2_nn_hall_r', 'dy_d2_nn_yard_r', 'dy_d2_af_yard_r', 'dy_d2_mo_doc_r', 'dy_d2_mo_stable_r',
    'dy_d2_af_hil_r', 'dy_d3_nn_hall_r', 'dy_d4_nn_meal_r', 'dy_d4_ev_hill_r', 'dy_d5_nn_meal_r'],
  '处理选择 _r 只在作者写了「选择：」的地方落 —— 活的一共 10 个（第 2 天 6 + 第 3 天 1 + 第 4 天 2 + 第 5 天 1，'
  + '不再每个活动一个；另有 7 个随第二天重排下线留档）'
);
// 第一夜那两节是唯一的两处例外：它们写在日常层的文件里（作者新稿的正文不进 act1/act2
// 的原文核对），但节点名仍是第二幕的 b8_ —— 它们演的是第一夜，不是她的某一天。
t.empty(
  daily.nodes.filter((n) => !/^dy_d\d+_(mo|nn|af|ev|ni)(_[a-z0-9]+)*_(hub|arr|e|r|intro)$/.test(n.id))
    .filter((n) => ['b8_study_diary', 'b8_diary_writing'].indexOf(n.id) < 0).map((n) => n.id),
  '日常层的节点 id 全部符合 dy_d{天}_{时段}[_{地点}]_{类型} 的形状（时段含 ev 傍晚）——'
  + '只有第一夜那两节例外（b8_study_diary / b8_diary_writing）'
);
t.empty(daily.nodes.filter((n) => n._scaffold).map((n) => n.id),
  '脚手架一个不剩 —— _scaffold 只该存在于它被替换掉之前');

/* 菜单（有选项的 hub）：每一项都必须真的点得动；选项数目按当天稿子走，不再强求三选一。
   第二轮回填后第 2 天重排：午餐后 3 张、午后只剩 2 张（旧野外那两处下线），夜晚不再有菜单。 */
const MENU_COUNTS = {
  dy_d2_mo_hub: 3, dy_d2_nn_hub: 3, dy_d2_af_hub: 2,
  dy_d3_mo_hub: 2, dy_d3_nn_hub: 3, dy_d3_ev_hub: 2,
  dy_d4_mo_hub: 2, dy_d4_nn_hub: 3, dy_d4_ev_hub: 2,
  dy_d5_mo_hub: 2, dy_d5_nn_hub: 3,
  dy_d6_mo_hub: 2, dy_d6_nn_hub: 3,
};
const badMenus = [];
for (const [id, n] of Object.entries(MENU_COUNTS)) {
  const hub = nodeById.get(id);
  if (!hub) { badMenus.push(`${id} 不存在`); continue; }
  if (!hub.choices || hub.choices.length !== n) badMenus.push(`${id} 有 ${(hub.choices || []).length} 个选项，应当 ${n}`);
  if (hub.next) badMenus.push(`${id} 是菜单却写了 next —— 写了就再也回不到菜单`);
  for (const c of hub.choices || []) {
    if (c.if || c.lockedHint) badMenus.push(`${id}「${c.text}」带着 if / lockedHint —— 菜单项必须永远可点`);
    if (!nodeById.get(c.next)) badMenus.push(`${id}「${c.text}」指向不存在的 ${c.next}`);
  }
  const dests = (hub.choices || []).map((c) => c.next);
  if (new Set(dests).size !== dests.length) badMenus.push(`${id} 有两个选项通向同一处`);
}
t.empty(badMenus, '13 张时段菜单：选项数目按稿子、永远可点、各去各的地方');
t.empty(daily.nodes.flatMap((n) => (n.choices || [])
  .filter((c) => c.lockedHint).map((c) => `${n.id}「${c.text}」`)),
  '日常层一块 lockedHint 都没有 —— 没有灰着的选项');
t.empty(
  daily.nodes.filter((n) => /_hub$/.test(n.id) && !(n.choices || []).length && !n.next).map((n) => n.id),
  '没有选项的收束 hub 都要写 next（煎药完就该进下一天）'
);

/* 第 2 天早晨：主线是授课线（b12～b22，前半段是她的镜头），另两处标「没亲历」再走默认结算 */
const d2hub = nodeById.get('dy_d2_mo_hub');
const d2bad = [];
if (d2hub.choices[0].next !== 'b12_morning') d2bad.push('第一项应当直接进授课线开头 b12_morning');
for (const c of d2hub.choices.slice(1)) {
  if (c.skip !== 'b12_morning') d2bad.push(`「${c.text}」没写 skip: b12_morning`);
}
t.empty(d2bad, '第 2 天早晨：第一项进授课线，另两项把这一段标成默认结算（applySegmentDefaults）');
t.eq(nodeById.get('b20_lesson').next, 'b21_haier_calls', '授课线在 b19 的三选一之后接回原著：b20 → b21');
t.eq(nodeById.get('b22_after').next, 'dy_d2_nn_meal_e',
  '授课线整段演完（b22 是它的末节），直接汇进午餐那场固定戏 —— 这一天不再有「谁来收拾残局」那一问');

/* 周六夜：route（条件路由）分流 —— 继续进狩猎、取消走占位链。在玩家眼里不是一次选择。 */
const night = nodeById.get('dy_d6_ni_night_e');
t.ok(night && !(night.choices || []).length && !night.next && Array.isArray(night.route),
  '周六夜是 route 分流节点：没有台词、没有选项、没有 next');
t.eq((night.route || []).map((r) => r.next), ['dy_d6_ni_hunt_e', 'dy_d6_ni_cancel_e'],
  '第一条规定继续线去交付骑装，最后一条兜底走取消线');
t.eq(night.route[night.route.length - 1].if, undefined, 'route 的最后一条不留条件 —— 永远有出口');
t.eq(preds('dy_d6_ni_hunt_e'), ['dy_d6_ni_night_e'], '继续线只从周六夜的分流节点进来（没有旁路）');
t.eq(preds('dy_d6_ni_cancel_e'), ['dy_d6_ni_night_e'], '取消线也只从周六夜的分流节点进来');

// 原著段的入口入度恒为 1，且那条入边就是本时段的菜单 —— 这是「主线跳不过去」的真正保证。
// 入口是 b12_morning（第一夜新戏之后它接回了主线）；b16 → b17 那根是段**内部**的指针，
// 不算入口 —— 想上这条线只能从菜单走。
t.eq(preds('b12_morning').sort(), ['dy_d2_mo_hub'],
  '授课线唯一的入边来自本时段的菜单（主线跳不过去）');
t.eq(preds('h4_request').sort(), ['dy_d6_ni_hunt_e', 'h4_habit'],
  '狩猎的实质入口是周六夜的交付场景（h4_habit 那条是旧链的回边，旧链整条已脱链）');

// 第 2 天日终：新链一根 next（dy_d2_ni_end_e），旧「日终背景」链保留在文件里
t.eq(preds('b25_end').sort(), ['b24_change', 'dy_d2_ni_end_e'],
  '第 2 天日终接 b25_end：新链一条 + 旧「日终背景」链存档的一条');
// 旧第三幕链：内部接回，两个岔口都收在 c27_end（不再有日常层入口）
t.eq(preds('c27_end').sort(), ['c26a_refuse', 'c26b_meet'],
  '第三幕的旧链内部接回：c26 的两个岔口都收在 c27_end');
t.eq(preds('h4_knock'), ['c27_end'], '狩猎篇的旧整章入口只从 c27_end 进来（新时间线不走它）');
t.eq(preds('h5_dawn').length >= 1, true, '狩猎篇各章之间也接得上（第五章有入口）');

/* 每一天走一遍：从早晨菜单进，随便怎么选，最后都收在当天的收束处。
   第 2 天收 b25_end（穿过它进第 3 天开场）；第 3~5 天收第二天的早晨菜单；
   第 6 天收在夜晚分流节点（继续/取消从那里再分两头）。 */
const DAY_TERMINAL = { 2: 'b25_end', 3: 'dy_d4_mo_hub', 4: 'dy_d5_mo_hub', 5: 'dy_d6_mo_hub', 6: 'dy_d6_ni_night_e' };
const dayProblems = [];
for (const [day, terminal] of Object.entries(DAY_TERMINAL)) {
  const startId = day === '2' ? 'dy_d2_mo_intro' : `dy_d${day}_mo_hub`;
  const walk = (nodeId, depth) => {
    if (depth > 60) { dayProblems.push(`第 ${day} 天从 ${nodeId} 越走越深（成环？）`); return; }
    if (nodeId === terminal) return;
    const n = nodeById.get(nodeId);
    if (!n) { dayProblems.push(`第 ${day} 天走到不存在的 ${nodeId}`); return; }
    if (n.choices && n.choices.length) { for (const c of n.choices) walk(c.next, depth + 1); return; }
    if (n.route && n.route.length) { for (const r of n.route) walk(r.next, depth + 1); return; }
    if (n.next) { walk(n.next, depth + 1); return; }
    dayProblems.push(`第 ${day} 天走到 ${nodeId} 就断了（既不是收束 ${terminal}，也没有出口）`);
  };
  walk(startId, 0);
}
t.empty([...new Set(dayProblems)],
  '五天各走一遍：从早晨菜单进、随便怎么选，最后都收在当天的收束处（第 6 天收在夜晚分流节点）');

// 上面那条是结构性保证，这条是运行时的另一半：三项都真的点得动
const gate = new StoryEngine(story);
gate.enterNode('dy_d2_mo_hub');
const gateChoices = gate.availableChoices();
t.eq(gateChoices.map((c) => c.enabled), [true, true, true], '第 2 天早晨三项全能点 —— 没有锁着的选项');
t.eq(gate.choose(0).ok, true, '点课程线放行');
t.eq(gate.node.id, 'b12_morning', '选了教室就直接落进授课线开头（b12，第一夜新戏之后它接回了主线）');
// 授课线的前半段（b12～b16「她换好牧师服去上课」）是原著第二幕自己写的西比拉的镜头，
// 从菜单这一步走进去会弹一次横幅；b16 → b17（进教室、转成奥布里）再弹回来。
t.eq(gate.povSwitchInfo.from + '>' + gate.povSwitchInfo.to, '奥布里>西比拉',
  '从菜单走进授课线会弹一次「奥布里>西比拉」—— 前半段（b12～b16）是她的镜头，不是奥布里的');

// 另外两处：先落进那个时段的活动，同时把没亲历的原著段按默认走法结掉
// （「跳过的那一段用的是同一份数据」在 daily.test.cjs 里有逐项核对）
const aside = new StoryEngine(story);
aside.enterNode('dy_d2_mo_hub');
t.eq(aside.choose(1).ok, true, '第 2 天早晨的第二项也点得动');
t.eq(aside.node.id, 'dy_d2_mo_doc_e', '没亲历的时候直接落在本时段那处活动的**事件**节点上（不是处理选择）');
t.eq(aside.node.choices, undefined, '事件节点没有选项 —— 先演事件，再谈怎么处理');
// 默认走法把这一段落结了：它从 b12_morning 起一路走到下一个时段菜单，中途的决定点
// （b19 的授课方式三选一）按自己的 defaultPick 落值 —— 「照原来的节奏教下去」= 2。
// （旧稿记在 dy_d2_mo_r 上的那面「旗_第2天早晨」随它一起下线，现在没人再写它。）
t.eq(aside.getStat('旗_授课方式'), 2, '没亲历授课线时，默认走法（不插手）已经替她把这一段落结掉了');

// 一个时段的几拍：选地点 → 段子整段演完 → 一次处理选择 → 自动落到下一时段的菜单
const nextChoicePoint = (startId, pick) => {
  const e = new StoryEngine(story);
  e.enterNode(startId);
  e.choose(pick);
  for (let g = 0; g < 500; g++) {
    const v = e.advance();
    if (v.type === 'choices') return e.node.id;
    if (v.type === 'end') return 'END:' + e.node.id;
  }
  throw new Error(`${startId} 之后走不到下一个决定点`);
};
t.eq(nextChoicePoint('dy_d2_mo_hub', 0), 'b19_aubrey', '第 2 天早晨：授课线从中段起有一个三选一（b19）');
t.eq(nextChoicePoint('b19_aubrey', 1), 'dy_d2_nn_hub',
  'b19 选完（普通方式）继续演到段尾，穿过午餐那场固定戏，才落到午餐后的菜单');
t.eq(nextChoicePoint('dy_d2_mo_stable_r', 1), 'dy_d2_nn_hub', '处理选择做完，自动推进到下一时段的菜单（同样穿过午餐）');
t.eq(nextChoicePoint('dy_d2_mo_hub', 1), 'dy_d2_mo_doc_r', '书房活动：事件(_e)整段演完才落到处理选择(_r)');
t.eq(nextChoicePoint('dy_d2_mo_doc_r', 1), 'dy_d2_nn_hub', '处理选择做完，照样推进到下一时段的菜单');
t.eq(nextChoicePoint('dy_d3_nn_hub', 0), 'dy_d3_nn_hall_r', '第 3 天唯一一处处理选择在午餐后的大厅（洗衣房与外院没有选择，顺流而过）');
t.eq(nextChoicePoint('dy_d3_nn_hall_r', 1), 'dy_d3_ev_hub', '处理选择之后先走午后的固定账目，再落到傍晚菜单');


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

// 从起点能不能走到每一个节点（防「写了个节点忘了接上」）；route 的候选边也算边
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
  if (n.route) for (const r of n.route) queue.push(r.next);
  for (const c of n.choices || []) queue.push(c.next);
  for (const t2 of roamEdges(id)) queue.push(t2);
}

/* 旧稿的脱链节点：正文（含原著正文）一字不动地保留在文件里、也仍在原文核对的范围里，
   但新时间线没有任何一条活路径指向它们 ——「旧入口不得与新时间线重复触发」。
   它们是：第 2 天日终背景（b23、b24）、旧第三幕整条链（c1_door～c27_end）、
   狩猎篇被替换掉的两节开场（h4_knock、h4_habit）、第二天重排下线的 14 个日常层节点，
   以及【本轮：第一天幕间摘掉 + 台词对齐后重测】第一天的 17 个奥布里幕间节点 ——
   四条指针改直连（s1_castle → s2_arrive / s2_haier → s3_courtyard / s3_courtyard → s4_hall /
   s4_portrait → o4_end）之后它们没人再指得进来，但正文一字未删、全部留档。
   注意两件事：b12～b16 **不在**这个名单里（第一夜那场新戏把授课线旧开场接回了主线）；
   第三轮又把它自己那张收束屏（o4_end）也摘了 —— 用户要求「第一天的结束提示与『进入下一幕』删掉」，
   作者定稿也写着两段连续演出，所以 s4_portrait 直接接 b1_room。 */
const RETIRED_ACT1 = [
  'o1_wait', 'o1_door', 'o1_files', 'o1_isabelle',
  'o2_watch', 'o2_guard', 'o2_handkerchief', 'o2_haier',
  'o3_watch', 'o3_guard', 'o3_after',
  'o4_review', 'o4_r_a', 'o4_r_b', 'o4_r_c', 'o4_expect', 'o4_night',
  'o4_end',      // 第三天（本轮）连它自己那张收束屏也摘了：第一章直接接第一夜
];
const LEGACY = new Set([
  'b23_corridor', 'b24_change',
  ...act3.nodes.map((n) => n.id),
  'h4_knock', 'h4_habit',
  ...RETIRED_DAILY,
  ...RETIRED_ACT1,
]);
t.empty(
  story.nodes.map((n) => n.id).filter((id) => !reachable.has(id) && !LEGACY.has(id)),
  '除声明的脱链节点外，所有节点都能走到'
);
t.empty(
  story.nodes.map((n) => n.id).filter((id) => reachable.has(id) && LEGACY.has(id)),
  '脱链节点一条活路径都进不去（旧入口没有重新挂上）'
);
// 反向：活的节点也不许把边指进脱链集合
const intoLegacy = [];
for (const n of story.nodes) {
  if (!reachable.has(n.id)) continue;
  const outs = [n.next, n.continueTo, ...(n.choices || []).map((c) => c.next), ...(n.route || []).map((r) => r.next)];
  for (const o of outs) if (o && LEGACY.has(o)) intoLegacy.push(`${n.id} → ${o}`);
}
t.empty(intoLegacy, '活的节点一条边都不指向脱链集合');
t.eq(reachable.size, 351 - LEGACY.size, `可达节点数 = 总数 − 脱链集合（351 − ${LEGACY.size}）`);

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

t.eq(
  story.config.statOrder,
  ['西比拉_好感', '西比拉_健康', '西比拉_尊敬', '西比拉_亲密'],
  '面板上只有这四项关系（其余全部隐藏：警惕 / 力量 / 压力 / 埋怨 / 反抗 / 恨意 / 府里的名声…）'
);
t.eq(Object.keys(story.initialStats).length, 25, '初始数值有 25 项（原 23 项 + 奥布里_道德 / 伊莎贝尔_课程进度）');
// 标签比初始值多 —— 多出来的 9 面是日常层的「记录旗」（旗_…）与两个剧情旗
// （旗_授课方式 / 旗_狩猎继续 / 旗_狩猎取消）。它们不必进 initialStats：
// getStat() 读不到就是 0，0 就是「这一笔还没记上 / 还没决定」。
// 但**必须**进 statLabels：引擎的 knownStats 取的是 Object.keys(statLabels)，
// 写在 effects / if 里的数值不在里面，--validate 会拦。
t.eq(Object.keys(story.config.statLabels).length, 35,
  '标签 35 项 = 25 项数值 + 10 面记录/剧情旗（第二轮回填给午餐后的外院那一处补了「旗_第2天中午_外院」）');
t.empty(
  Object.keys(story.config.statLabels).filter((k) => !/^(旗_|决斗_)/.test(k))
    .filter((k) => !(k in story.initialStats)),
  '不在 initialStats 里的标签，只允许是记录旗'
);
t.empty(
  Object.keys(story.initialStats).filter((k) => !story.config.statLabels[k]),
  '每个数值都有中文标签'
);
// 面板上的四项必须都在初始数值里（否则面板会显示一个没人赋过值的空项）
t.empty(
  story.config.statOrder.filter((k) => !(k in story.initialStats)),
  '面板上的四项都在 initialStats 里'
);
// v2 的起点：好感 −10（被卖掉的人对买主不会有好脸）、警惕 80（戒备心极高）、力量 5
// v3 加的八项里，健康的 60（常年劳作、吃得不好）、反抗 20 / 恨意 10（没认命）、
// 府里名声的 50 是中性起点，其余从 0 起。
t.eq(
  Object.entries(story.initialStats).filter(([, v]) => v !== 0).sort().map(([k, v]) => `${k}=${v}`),
  ['奥布里_道德=50', '普里森堡_声誉=50', '普里森堡_秩序=50', '西比拉_健康=60', '西比拉_力量=5',
    '西比拉_反抗=20', '西比拉_好感=-10', '西比拉_尊敬=10', '西比拉_恨意=10', '西比拉_警惕=80'],
  '只有这十项不从 0 起（奥布里_道德 的起点 50 是暂定值，等作者定阈值与联动）'
);
// 警惕：v2 就在、语义是「对你的警惕」，这一轮只是退出面板，**没有改名也没有被「尊敬」顶替**
t.eq(story.config.statLabels['西比拉_警惕'], '西比拉 · 对你的警惕', '警惕的标签一个字没改');
t.eq(story.initialStats['西比拉_警惕'], 80, '警惕仍然从 80 起');
t.ok(!('西比拉_警惕' in story.config.statRanges), '警惕仍然不写区间（沿用默认 0~100，语义没变）');
t.ok(!story.config.statOrder.includes('西比拉_警惕'), '警惕退出面板 = 隐藏，不是删除');
t.ok(story.config.statLabels['西比拉_尊敬'] !== story.config.statLabels['西比拉_警惕'], '「尊敬」是另一项，与警惕不是同一个');
// 线索是 0/1 的开关，其余 [-100, 100]／默认 [0, 100]
const ranges = story.config.statRanges;
t.eq(ranges['线索_克莱尔旧事'], [0, 1], '线索按 0/1 记（面板上显示「0 / 1」）');
t.ok(ranges['伊莎贝尔_好感'][0] === -100, '好感类数值能掉到负数');
t.ok(ranges['佣兵_纪律'] && ranges['伊莎贝尔_礼仪成长'], '「佣兵_纪律 / 伊莎贝尔_礼仪成长」都在 statRanges 里');
// 新增八项的区间：健康 / 府里名声是 0~100（没有「负健康」），关系与心态类的能掉到负
t.eq(['西比拉_健康', '普里森堡_秩序', '普里森堡_声誉'].map((k) => ranges[k]), [[0, 100], [0, 100], [0, 100]],
  '健康与府里秩序 / 名声都是 0~100');
t.eq(['西比拉_尊敬', '西比拉_埋怨', '西比拉_反抗', '西比拉_恨意', '仆人_尊敬'].map((k) => ranges[k]),
  new Array(5).fill([-100, 100]), '尊敬 / 埋怨 / 反抗 / 恨意 / 下人敬重都能掉到负数');
t.empty(
  Object.entries(story.initialStats)
    .filter(([k, v]) => { const r = ranges[k] || [0, 100]; return v < r[0] || v > r[1]; })
    .map(([k]) => k),
  '初始值都在 statRanges 允许的区间里'
);

/* ===================================================================
 * 2. 分支
 * =================================================================== */

t.section('分支');

const choicePoints = story.nodes.filter((n) => n.choices && n.choices.length);
// 原著三幕的决定点一个都没有因为日常层而挪动或新增（b19 只是从「单线」变成三选一，正文未动）。
// 第二轮回填换掉一个：送别那场（b8_farewell）不再是决定点 —— 作者新稿把「捏枕头 / 备课文」
// 挪到写手记之后，成了 b8_diary_writing。它住在日常层的文件里，所以排在数组末尾（加载链的顺序）。
t.eq(
  choicePoints.filter((n) => n.id[0] !== 'd' && n.id[0] !== 'h').map((n) => n.id),
  ['o1_wait', 'o2_watch', 'o2_guard', 'o2_handkerchief', 'o2_haier',
    'o3_watch', 'o3_guard', 'o4_review', 'o4_expect', 'o4_night',
    'b2_haier_knock', 'b4_enter', 'b19_aubrey',
    'c5_lesson', 'c6_first', 'c26_invite',
    'b8_diary_writing'],
  '原著的决定点：第一幕 10 个 + 第二幕 3 个（第一夜的 2 个 = b2/b4，加 b19 的授课方式三选一）'
  + ' + 旧第三幕 3 个 + 第一夜新加的 b8_diary_writing（它演第一夜，但写在日常层的文件里）'
);
t.eq(choicePoints.length, 17 + 34 + 24,
  '加上日常层那 34 个 dy_ 节点（13 张菜单 + 10 个处理选择 + 查看笔记 + 狩猎决定 + 自带选项的厨房 _e'
  + ' + 8 个下线留档）与狩猎篇的 24 个');
t.eq(ACT1_PATHS.length, 1,
  '第一幕内部只剩 1 条直路 —— 第一天不设玩家选择（作者定稿：不设置奥布里幕间、不进行玩家选择），'
  + '原来的 10 个幕间决策点、4608 条分支一起下线');
t.eq(ACT2_NIGHT_PATHS.length, 8, '第二幕第一夜 2×2×2 = 8 条');
t.eq(ACT3_PICKS.length, 8, '旧第三幕 2×2×2 = 8 条（只用于使旧链保持完整，不再进入跨幕主链）');
t.ok(CROSS_PATHS.length >= ACT1_PATHS.length,
  `跨幕链路 ${CROSS_PATHS.length} 条：第一幕每条分支都配了一组第二/三幕走法，另加 24 条代表走满 8×8×2 组合`);

// 第二幕：选项原则上只决定「先看/先做原文里的哪一个动作」，不加减数值 ——
// 唯一的例外是 b19_aubrey 的授课方式三选一（旗_授课方式 1/2/3 + 课程进度/礼仪）。
t.empty(
  choicePoints.filter((n) => n.id[0] === 'b' && n.id !== 'b19_aubrey')
    .flatMap((n) => n.choices.filter((c) => c.effects && c.effects.length)
      .map((c) => `${n.id} 的「${c.text}」不该有效果`)),
  '第二幕的选项都不改数值（b19 的授课方式三选一是唯一例外）'
);
{
  const b19 = nodeById.get('b19_aubrey');
  const modeEff = (c) => (c.effects || []).find((e) => e.stat === '旗_授课方式');
  const modes = b19.choices.map((c) => modeEff(c) && modeEff(c).value);
  t.eq(modes, [1, 2, 3], 'b19 三项分别落 旗_授课方式 = 1（严格）/ 2（普通）/ 3（宽松）');
  t.eq(b19.defaultPick, 1, 'b19 的默认走法是「普通」（没亲历授课线时按它结算）');
  t.ok(b19.choices.every((c) => (modeEff(c) || {}).silent === true), '授课方式是记录性旗 —— 三项都静默');
}

// 第一幕：决策只在奥布里幕间里，动的每一项数值都得在 statLabels 里定义过
const badAct1 = [];
for (const n of choicePoints.filter((n) => n.id[0] === 'o')) {
  if (n.pov !== '奥布里') badAct1.push(`${n.id} 的视角是 ${n.pov}，第一幕的决策该在奥布里这边`);
  for (const c of n.choices) {
    for (const e of c.effects || []) {
      if (!story.config.statLabels[e.stat]) badAct1.push(`${n.id}「${c.text}」动的是没定义的 ${e.stat}`);
    }
  }
}
t.empty(badAct1, '第一幕的决策都在奥布里视角里，动的数值都有中文标签');
// 原文里写「无变化」的选项就是真的没有效果（o1_wait 的 D、o2_watch 的 C1 等）
t.ok(
  choicePoints.filter((n) => n.id[0] === 'o').some((n) => n.choices.some((c) => !(c.effects || []).length)),
  '「无变化」的选项照样允许存在（不给效果，也不编数值）'
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

// v2 的选项**不写 hint**：原文里那句「（警惕度 +2）」是制作注记，进不了选项文本
// （原文核对不许自编），数值变化靠选完之后的浮字提示讲，而浮字里不许出现数字。
t.empty(
  choicePoints.filter((n) => n.id[0] === 'o')
    .flatMap((n) => n.choices.filter((c) => c.hint).map((c) => `${n.id}「${c.text}」不该写 hint`)),
  '第一幕的选项不写数值 hint（改了数值靠浮字提示，不报数字）；第二/三幕那套老选项照旧'
);

/* ===================================================================
 * 3. 分支全跑：第一幕 4608 条单独全跑，跨幕链路逐条走
 * =================================================================== */

t.section(`第一幕内部 ${ACT1_PATHS.length} 条分支全跑一遍`);

const ranAct1 = [];
const a1Problems = { end: [], error: [], start: [], bg: [], povs: [] };
for (const p of ACT1_PATHS) {
  let r;
  try {
    r = replay(p.picks, 's4_portrait');
  } catch (err) {
    a1Problems.error.push(`分支 [${p.picks}] 跑挂了：${err.message}`);
    continue;
  }
  ranAct1.push(r);
  if (r.end !== 's4_portrait') a1Problems.end.push(`分支 [${p.picks}] 停在 ${r.end}`);
  if (r.nodes[0] !== 's1_rain') a1Problems.start.push(`分支 [${p.picks}] 起点是 ${r.nodes[0]}`);
  for (const b of r.bgs) if (!b.bg) a1Problems.bg.push(`分支 [${p.picks}] 节点 ${b.node} 没有背景`);
  if (r.nodes.some((id) => id[0] === 'b' || id[0] === 'c')) a1Problems.povs.push(`分支 [${p.picks}] 走出了第一幕`);
}
t.eq(ranAct1.length, ACT1_PATHS.length, `${ACT1_PATHS.length} 条分支全部跑完，没有一条崩`);
t.empty(a1Problems.error, '第一幕没有分支抛错');
t.empty(a1Problems.end, '每条分支都收在第一幕的最后一节 s4_portrait');
t.empty(a1Problems.start, '每条分支都从 s1_rain 开始');
t.empty(a1Problems.bg, '沿途每个节点都有背景（背景会一直沿用，不会空场）');
t.empty(a1Problems.povs, '第一幕单独跑时不越界（stopAt 真的拦住了 continueTo）');

// 第一幕跑完那一刻，每个数值能落在哪儿 —— 跑出来是什么就锁什么，改了剧本这里会红
const a1Bound = (key) => {
  const v = ranAct1.map((r) => r.stats[key]);
  return [Math.min(...v), Math.max(...v)];
};
/* 【本轮：第一天幕间摘掉后重测】第一幕里再没有玩家选择，所以每一项都落成**单值** ——
   区间退化成 [x, x]。那十一项原本由幕间写的数值（线索四面、佣兵_纪律、布朗／海尔／
   伊莎贝尔的好感、压力、自主性……）现在恒等于起点，改成 0~0 不是放宽，是照实。 */
const ACT1_RANGES = [
  ['西比拉_好感', -10, -10],     // 起点 −10，第一幕里没有一处再动它
  ['西比拉_警惕', 80, 80],       // 起点 80，同上
  ['西比拉_亲密', 0, 0],
  ['西比拉_力量', 5, 5],
  ['西比拉_压力', 0, 0],
  ['西比拉_自主性', 0, 0],
  ['佣兵_纪律', 0, 0],           // 只由「佣兵纪律」那个幕间写 —— 它下线了
  ['伊莎贝尔_好感', 0, 0],
  ['伊莎贝尔_礼仪成长', 0, 0],
  ['海尔_好感', 0, 0],
  ['布朗_好感', 0, 0],
  ['线索_克莱尔旧事', 0, 0],
  ['线索_观察西比拉', 0, 0],
  ['线索_初夜观察', 0, 0],
  ['线索_路上表现', 0, 0],
];
for (const [key, lo, hi] of ACT1_RANGES) {
  t.eq(a1Bound(key), [lo, hi], `第一幕终点「${key}」落在 ${lo}~${hi}`);
}

// 每条分支里的线索都只能是 0 / 1
const badClue = [];
for (const r of ranAct1) {
  for (const [k, v] of Object.entries(r.stats)) {
    if (k.indexOf('线索_') === 0 && v !== 0 && v !== 1) badClue.push(`${k}=${v}`);
    const rg = story.config.statRanges[k] || [0, 100];
    if (v < rg[0] || v > rg[1]) badClue.push(`${k}=${v} 超出 ${JSON.stringify(rg)}`);
  }
}
t.empty([...new Set(badClue)], '沿途所有数值都在 statRanges 里（线索只有 0/1）');

t.section(`跨幕 ${CROSS_PATHS.length} 条链路全跑一遍`);

const ran = [];
const problems = { end: [], stats: [], bg: [], error: [], start: [], intoAct2: [], decision: [], route: [] };
const tag = (p) => `第一幕[${p.a1}] 夜[${p.a2}] 日常路线${DAILY_PLANS.indexOf(p.plan) + 1}`;

for (const p of CROSS_PATHS) {
  let r;
  try {
    r = replay([], undefined, chooserFor(p.a1, p.a2, [], p.plan));
  } catch (err) {
    problems.error.push(`路径 ${tag(p)} 跑挂了：${err.message}`);
    continue;
  }
  ran.push(r);
  if (r.end !== 'h9_end') problems.end.push(`路径 ${tag(p)} 停在 ${r.end}`);
  // 第二幕的节点上一次都不许出现数值变化（唯一的例外是 b19 的授课方式三选一）。
  const changedInAct2 = r.statChanges.filter((c) => c.node[0] === 'b' && c.node !== 'b19_aubrey');
  if (changedInAct2.length) {
    problems.stats.push(`路径 ${tag(p)} 第二幕把数值改了：${changedInAct2.map((c) => `${c.node} ${c.stat} ${c.from}→${c.to}`).join('、')}`);
  }
  for (const b of r.bgs) if (!b.bg) problems.bg.push(`路径 ${tag(p)} 节点 ${b.node} 没有背景`);
  if (r.nodes[0] !== 's1_rain') problems.start.push(`路径 ${tag(p)} 起点是 ${r.nodes[0]}`);
  if (!r.nodes.includes('b1_room')) problems.intoAct2.push(`路径 ${tag(p)} 没走进第二幕`);
  // 唯一一次狩猎决定：每条路都要经过它，而且只经过一次
  if (r.nodes.filter((id) => id === 'dy_d5_af_decision_e').length !== 1) {
    problems.decision.push(`路径 ${tag(p)} 在狩猎决定节点上走了 ${r.nodes.filter((id) => id === 'dy_d5_af_decision_e').length} 次`);
  }
  // 周六夜分流以后，两条路各自的样子
  const inHunt = r.nodes.some((id) => /^h[4-8]_/.test(id));
  if (inHunt) {
    if (!r.nodes.includes('dy_d6_ni_hunt_e')) problems.route.push(`路径 ${tag(p)} 进了狩猎却没经过周六夜交付`);
    if (r.nodes.includes('dy_d6_ni_cancel_e') || r.nodes.includes('dy_d7_mo_care_e')) problems.route.push(`路径 ${tag(p)} 继续线里混进了取消段的节点`);
  } else {
    if (!r.nodes.includes('dy_d7_mo_care_e')) problems.route.push(`路径 ${tag(p)} 取消线没走到周日照料节点`);
    if (r.nodes.includes('dy_d6_ni_hunt_e')) problems.route.push(`路径 ${tag(p)} 取消线里混进了交付骑装的夜晚`);
    if (!r.nodes.includes('h9_stairs')) problems.route.push(`路径 ${tag(p)} 取消线没有并回第九章`);
  }
}

if (problems.error.length) console.log('DBG 前几条错误：\n' + problems.error.slice(0, 3).join('\n'));
t.eq(ran.length, CROSS_PATHS.length, `${CROSS_PATHS.length} 条链路全部跑完，没有一条崩`);
t.empty(problems.error, '没有路径抛错');
t.empty(problems.end, '每条路径都从第一幕一路走到第一幕的收束 h9_end（第二幕 → 日常层 → 狩猎/取消 → 第九章）');
t.empty(problems.stats, '第二幕（b 开头的节点）上一次都没有改过数值（b19 的授课方式是唯一例外）');
t.section('日常层的选择确实落到了数值上');
t.ok(ran[0].statChanges.some((c) => c.node[0] === 'd'),
  '整条链上确实有数值是被日常层改动的（新加的八项不是白登记的）');
t.ok(ran[0].statChanges.some((c) => '西比拉_健康' === c.stat) && ran[0].statChanges.some((c) => '仆人_尊敬' === c.stat),
  '日常层动的是它自己那几项（健康 / 下人敬重这些原著三幕不碰的数值）');
t.empty(problems.bg, '沿途每个节点都有背景（背景会一直沿用，不会空场）');
t.empty(problems.start, '每条路径都从 s1_rain 开始');
t.empty(problems.intoAct2, '每条路径都真的进过第二幕（免得 continueTo 断了却假性通过）');
t.empty(problems.decision, '唯一一次狩猎决定：每条路都恰好经过 dy_d5_af_decision_e 一次（不复问、不重开）');
t.empty(problems.route, '周六夜的两条路互斥：继续线不碰取消段、取消线不进狩猎、并且并回第九章');
// 「亲历授课线」与「没亲历、由默认走法代走」都覆盖到了
t.ok(ran.some((r) => r.nodes.includes('b17_scream')), '有人亲历了第 2 天早晨的授课线');
t.ok(ran.some((r) => !r.nodes.includes('b17_scream') && r.nodes.includes('dy_d2_mo_doc_e')),
  '也有人没亲历它 —— 那一段照样在数值上发生（默认走法），玩家去做了别的事');

// 第三幕那三处 ±1 之后，数值还能落在哪儿
const finalBound = (key) => {
  const v = ran.map((r) => r.stats[key]);
  return [Math.min(...v), Math.max(...v)];
};
t.ok(ran.every((r) => Object.values(r.stats).every((v) => v >= -100 && v <= 100)),
  '数值都没跑出 config.statRanges 的区间');

/**
 * 只要最终数值，不要沿途记录 —— 上面那个 replay() 又是 push 台词又是逐项比对数值变化，
 * 跑几千次的时候，开销全在这些记录上。这里只把链走完。
 * startId 给了就从那个节点进场（尾巴单独跑时用），不给就从剧本开头跑。
 */
function finalStats(chooser, startId) {
  const engine = new StoryEngine(story);
  if (startId) engine.enterNode(startId); else engine.start();
  for (;;) {
    const v = engine.advance();
    if (v.type === 'end') {
      const nextAct = v.node && v.node.continueTo;
      if (nextAct) { engine.enterNode(nextAct); continue; }
      return engine.stats;
    }
    if (v.type === 'choices') {
      const res = engine.choose(chooser(engine.node.id, engine.availableChoices()));
      if (!res.ok) throw new Error(`决定点 ${engine.node.id} 的选择被拒：${res.reason}`);
    }
  }
}

/* 全程的最终上下限。
 *
 * 直接全跑是 4608 × 3 × 2 = 27648 条从头到尾的链路 —— 一条 0.8ms 也要二十几秒。
 * 但**尾段（第二幕夜 → 第九章末）的增减跟第一幕走哪条无关**：第一幕的 4608 条
 * 只决定起点，尾巴上每一处选择动多少是写在数据里的（各区域的选项都不带 if，
 * 能点哪些与当前数值无关），第二幕里除了 b19 也一个字都不改。加上没有哪一项会在
 * 尾巴上顶到 statRanges 的边界，全程的最终值就是**起点 + 增量**，可以两边分开取极值：
 *
 *     最终值 = 第一幕跑完的数值 + 尾巴的增量
 *     极值   = min(起点) + min(增量)   /   max(起点) + max(增量)
 *
 * 这样只要 4608 条短短的第一幕 + 3 × 2 = 6 条尾巴（三条日常走法覆盖
 * 继续/取消两条路线，两条狩猎走法覆盖猎场里的选择）。
 * 下面还有一道抽样反查（见 SAMPLE）拿真链路对一遍，别让这个拆法悄悄算错。
 */
const ACT1_ENDS = ACT1_PATHS.map((p) => replay(p.picks, 's4_portrait').stats);

const TAIL_DELTAS = [];
for (const pd of DAILY_PLANS) {
  for (const ph of HUNT_PLANS) {
    const start = new StoryEngine(story);
    start.enterNode('b1_room');
    const from = Object.assign({}, start.stats);
    const to = finalStats(chooserFor([0], A2_PICKS[0], [], pd, ph), 'b1_room');
    const d = {};
    for (const k of Object.keys(to)) d[k] = to[k] - from[k];
    TAIL_DELTAS.push(d);
  }
}

const extent = (list, key) => {
  const v = list.map((x) => x[key] === undefined ? 0 : x[key]);
  return [Math.min(...v), Math.max(...v)];
};

// 分开取了极值之后还要**各自夹回 statRanges**：引擎是每加一笔就夹一次，
// 于是「警惕顶到 100 了、尾巴再往上加」在真链路里仍然是 100，而两边分开算会得到 105。
// 夹取是单调的，所以夹「起点极值 + 增量极值」跟逐笔夹到最后是同一个数。
const finalLo = {};
const finalHi = {};
for (const k of Object.keys(ACT1_ENDS[0])) {
  const rg = (story.config.statRanges && story.config.statRanges[k]) || [0, 100];
  const clamp = (v) => Math.min(rg[1], Math.max(rg[0], v));
  const a = extent(ACT1_ENDS, k);
  const b = extent(TAIL_DELTAS, k);
  finalLo[k] = clamp(a[0] + b[0]);
  finalHi[k] = clamp(a[1] + b[1]);
}

// 抽样反查：真链路跑一遍，结果必须落在上面那个包络里（越界就说明拆法算错了）
const SAMPLE = [];
const stride = Math.floor(CROSS_PATHS.length / 12) || 1;
for (let i = 0; i < CROSS_PATHS.length; i += stride) SAMPLE.push(CROSS_PATHS[i]);
const outside = [];
for (const p of SAMPLE) {
  for (const pd of DAILY_PLANS) {
    for (const ph of HUNT_PLANS) {
      const st = finalStats(chooserFor(p.a1, p.a2, [], pd, ph));
      for (const k of Object.keys(st)) {
        if (st[k] < finalLo[k] || st[k] > finalHi[k]) {
          outside.push(`${tag(p)} 的「${k}」= ${st[k]}，落在 ${finalLo[k]}~${finalHi[k]} 之外`);
        }
      }
    }
  }
}
t.empty(outside, `抽样反查（${SAMPLE.length} 条链 × 4 种走法）真的都落在算出来的上下限里`);
const FINAL_RANGES = [
  // 首轮回填后：日常层的选择从旧版的 120 个小格减到 ~30 个（v2 稿「减少没有实质区别的选择」），
  // 单格的幅度相应调大、总量维持在同一档。这里是**抽样路线的包络**（三条日常走法 ×
  // 两条狩猎走法），不是设计上限 —— 最佳路线另有目标，见下面「好感轴预算」。
  // 【本轮第二天重排后重测】—— 旧稿那批第 2 天的活动（尤其 dy_d2_mo_r「谁来收拾残局」，
  // 它一处就带 +10 好感 / +6 尊敬 / +5 反抗 / −5 健康 / +6 下人敬重）下线留档，
  // 包络跟着整体收窄；下面每一行的数字都是按现剧本重跑出来的。
  // 【本轮：第一天幕间摘掉后再重测一次】—— 第一幕的 10 个幕间决策点整批下线，那批数值
  // （线索、佣兵_纪律、第一幕那几笔好感与警惕）不再有人写，包络进一步收窄。
  ['西比拉_好感', 1, 23],         // 三条走法分别 +11 / +21 / +23（旧稿那条 +10 的已下线）
  ['西比拉_警惕', 80, 83],        // 起点 80；会往上顶的那几个幕间决策一并下线，现在只 +3
  ['西比拉_亲密', 0, 15],         // 第 2、4 天那几处「走近她」的选择在加
  ['西比拉_力量', 5, 7],          // 狩猎篇两处 +1（他被藤蔓缠住时开路、第六天之后还跟得上）
  ['西比拉_压力', -7, 8],         // 狩猎篇两头都动：孩子的话能卸，主人的话只能接着
  ['西比拉_自主性', 0, 5],        // 「不插手 / 让她自己开口」的那几处
  ['佣兵_纪律', 0, 0],            // 只由「佣兵纪律」那个幕间写 —— 它下线了，现在恒为起点
  ['伊莎贝尔_好感', -2, 11],      // b19 三选一（−1 / 0 / +1）+ 新稿的厨房偷吃、午后外院、午餐那几处
  ['伊莎贝尔_礼仪成长', -1, 0],   // 厨房那处「当作没看见」会 −1；会加它的幕间下线了
  ['海尔_好感', -2, 3],           // 托她教海尔认字那一件事，答应与推一晚会各走一头
  ['布朗_好感', -1, 1],
  ['线索_克莱尔旧事', 0, 1],      // 这条还有别处在写，没跟着幕间一起归零
  ['线索_观察西比拉', 0, 0],      // 只由 o4_review 写 —— 下线了
  ['线索_初夜观察', 0, 0],        // 只由 o4_night 写 —— 下线了
  ['线索_路上表现', 0, 0],        // 同上
  // 下面几项只有日常层与狩猎篇会动，起点见 act1/story.json 的 initialStats，
  // 每一处增减都写在 daily/story.json 的选择、hunt/ch4~ch8 各选项的 effects 里
  ['西比拉_健康', 55, 65],       // 起点 60；午后的「不打扰她」+5 把上限抬起来，狩猎篇那条鞭子往下拉
  ['西比拉_尊敬', 10, 12],        // 起点 10；活着的选择里只剩「就此离开」那类的 +2
  ['西比拉_埋怨', 0, 4],         // 起点 0；冷待她的那几笔会往上记（本轮重排后上限 6 → 4）
  ['西比拉_反抗', 20, 20],       // 起点 20；会加它的那一处（旧 dy_d2_mo_r）本轮下线，代表路线上它不动
  ['西比拉_恨意', 10, 16],       // 起点 10；恨意只增不减，记在哪儿全看玩家怎么待她
  ['普里森堡_秩序', 49, 53],     // 起点 50；活着的选择幅度比旧稿窄（旧稿能顶到 62）
  ['普里森堡_声誉', 47, 55],     // 起点 50；取消狩猎 −3、随行狩猎 +4、修桥 +4 是最粗的三笔
  ['仆人_尊敬', -6, 0],          // 起点 0；三条代表路线只碰到减它的那两处（把下人的杂务挪走）
];
for (const [key, lo, hi] of FINAL_RANGES) {
  t.eq([finalLo[key], finalHi[key]], [lo, hi], `全程跑完「${key}」落在 ${lo}~${hi}`);
}

/* ===================================================================
 * 3.5 好感轴：第一幕的预算
 * -------------------------------------------------------------------
 * 【第一幕最佳路线 ≈ 60】是**内容设计上的阶段目标**，不是属性上限。
 * 这里只验「走得到、到不了别处去」，不验上限 —— 上限永远是 statRanges 里的 100。
 * =================================================================== */

t.section('好感轴预算');

const diary = require(path.join(__dirname, '..', 'daily', 'diary.js'));
const AFF = '西比拉_好感';
const statOf = (res, k) => res.stats[k];

/** 从一个选项出发、限深找「后面还能拿到的最大好感」 */
const affMemo = new Map();
function affAhead(id, depth) {
  if (!id || depth <= 0) return 0;
  const key = id + '|' + depth;
  if (affMemo.has(key)) return affMemo.get(key);
  const n = nodeById.get(id);
  let best = 0;
  if (n) {
    if (n.choices && n.choices.length) {
      best = Math.max(...n.choices.map((c) => {
        const g = ((c.effects || []).find((e) => e.stat === AFF) || { value: 0 }).value;
        return g + affAhead(c.next, depth - 1);
      }));
    } else if (n.next) {
      best = affAhead(n.next, depth - 1);
    }
  }
  affMemo.set(key, best);
  return best;
}
const rawChoice = (c) => (c && c.choice) || c;
/** chooser 的形状和 chooserFor 一样：(nodeId, list) => 选第几项 */
const betterAff = (sign) => (nodeId, list) => {
  let bi = 0, bv = sign > 0 ? -Infinity : Infinity;
  list.forEach((c, i) => {
    if (c.enabled === false) return;
    const own = ((c.effects || []).find((e) => e.stat === AFF) || { value: 0 }).value;
    const v = own + affAhead(rawChoice(c).next, 12);
    if (sign > 0 ? v > bv : v < bv) { bv = v; bi = i; }
  });
  return bi;
};
const pickBestAff = betterAff(1);      // 每一步都挑对好感最有利的
const pickWorstAff = betterAff(-1);    // 反过来：每一步都躲着好感走
const bestAff = replay([], null, pickBestAff);
const worstAff = replay([], null, pickWorstAff);

const BEST_AFF = statOf(bestAff, AFF);
// 【本轮第二天重排后重测】实测 45 —— 原来的 56~68 窗口（内容设计上的阶段目标 ≈60）在现剧本下
// 已经够不到了：第 2 天早晨那处「不插手，这堂课怎么上，是她的事」（旧 dy_d2_mo_r，+10 好感）
// 随重排下线，活着的选择里最热的一条走完只到 45。这不是把断言放宽成恒真：45 是逐项跑出来的
// 值，动一位数这里就会红 —— 但「≈60 够得到」这一条**本轮起不再成立**，留给作者核定数值时回看。
t.ok(BEST_AFF >= 34 && BEST_AFF <= 38,
  `最佳路线的好感按现剧本落在 36 附近（设计目标 ≈60 暂时够不到，本轮第一天幕间摘掉后重测；实测 ${BEST_AFF}）`);
t.ok(statOf(worstAff, AFF) <= 10,
  `一路躲着好感走，第一幕走完也热不起来（实测 ${statOf(worstAff, AFF)}）`);

// 档位要真的跟着人走。
// 注意：第 4 档的门槛（好感 ≥60 且 亲密 ≥45）是照旧版「每天四个时段、每处一个选择」的
// 密经济标定的；首轮回填后选择数减到 ~30 个，第 4 档够不到 —— 与「≈60 的阶段目标」
// 一起留给作者统一核定数值时再回看（见报告「待作者决定」）。
// 第二轮回填（第二天重排）把这个缺口又拉大了一点：最佳路线实测 45（上面的窗口），
// 第 3 档仍然够得到、第 4 档更远 —— 这一条本轮没有变化，仍是「等作者定」。
const tierOfStats = (res) => diary.tierOf({ getStat: (k) => res.stats[k] });
/* 【本轮：第一天幕间摘掉后再重测】最佳路线落在**第 2 档**（实测：好感 36、亲密 25、埋怨 0、
   恨意 14）。第 3 档的门槛是「好感 ≥40 且 亲密 ≥25，或 埋怨 ≥30」—— 好感差 4 点，
   而第一幕那批会加好感的幕间选择（含蓄的 +2/+3 与几条线索）整批下线之后，这条路就够不到了。
   所以第 3、4 档的正文现在是**够不到的档位**；这是数值缺口不是测试问题，照实钉在这里，
   等作者核阈值或补数值（见报告「待作者决定」）。 */
t.eq(tierOfStats(bestAff), 2,
  '最佳路线够到日记第 2 档（第 3 档起本轮够不到 —— 好感差 4 点，留给作者定阈值或补数值）');
t.ok(tierOfStats(bestAff) > tierOfStats(worstAff), '档位真的跟着人走：最佳路线比最冷那条高一档以上');

// 好感**没有**被 60 封顶：区间还是它本来的样子，第二幕之后照常往上走
t.eq(story.config.statRanges[AFF], [-100, 100],
  '西比拉_好感的区间没被动过 —— 60 不在 statRanges 里');
t.ok(BEST_AFF > 0 && BEST_AFF < 100,
  '最佳路线是一个「到达得了、又不是顶格」的值（60 是阶段目标，不是上限）');

/* 面板只给当前值，不拿 100 当分母 —— 界面上不该出现「x / 100」这类东西 */
const freshEngine = new StoryEngine(story);
const affRows = freshEngine.statPanel();
t.empty(affRows.filter((s) => /\//.test(String(s.display)))
  .map((s) => `${s.label} 的 display 里有斜杠：${s.display}`),
  '数值面板给的 display 是纯当前值，没有「当前 / 上限」');
t.ok(story.config.statOrder.indexOf(AFF) >= 0, '好感仍然是面板上公开的那一项');

/* ===================================================================
 * 4. 视角切换
 * =================================================================== */

t.section('视角切换');

const switches = ran[0].povSwitches;      // ran[0] 走继续线（且从菜单亲历授课线）：含最后那次进狩猎篇
const SWITCH_SEQ = switches.map((s) => s.from + '>' + s.to).join(' | ');
/* 第二轮回填把第一天的奥布里幕间整批摘掉（作者定稿：不设置奥布里幕间、不进行玩家选择）。
   于是第一幕到第二幕前半段**全程西比拉**，一次都不切 —— 原先那七次幕间来回连同
   第八次跨进第二幕一起消失。整场只剩三处：
     · 从日常层的早晨菜单走进授课线：奥布里 → 西比拉（b12~b16 是她的镜头）；
     · b16 → b17：进教室，回到奥布里的调度；
     · 周六夜进狩猎篇：奥布里 → 西比拉。
   取消线并回 h9_stairs 是静默的（第九章的节点都带 silent），上了狩猎篇也不再切。 */
t.eq(switches.length, 3, '整场切三次视角（授课线一个来回 + 周六夜进狩猎篇一次）');
t.eq(SWITCH_SEQ, '奥布里>西比拉 | 西比拉>奥布里 | 奥布里>西比拉',
  '第一天到第二幕前半段全是西比拉，不再有幕间来回；剩下的三次都在第二天以后');
t.eq(switches[0].from + '>' + switches[0].to, '奥布里>西比拉', '第一次：从早晨菜单走进授课线');
t.eq(switches[1].from + '>' + switches[1].to, '西比拉>奥布里', '第二次：b16 → b17 进教室，回到奥布里的调度');
t.eq(switches[1].line, '西比拉 视角结束 —— 奥布里 视角开始', '这一次走的是默认横幅文案');
t.eq(switches[2].from + '>' + switches[2].to, '奥布里>西比拉', '第三次：从周六夜切进狩猎篇（转到西比拉）');
t.eq(switches[2].line, '接下来是狩猎篇 —— 一次较长的特殊事件，视角转到西比拉；主线方向已由周五的决定定下。',
  '最后一次（进狩猎篇）用自定义横幅，说明接下来是一段较长的特殊事件');
t.ok(switches.every((s) => !!s.line), '每次切换都有一行提示文字');
t.eq(replay(ACT1_PATHS[0].picks, 's4_portrait').povSwitches.length, 0,
  '第一幕自己一次都不切（全程西比拉 —— 幕间摘掉之后没有别人插进来）');

/* 整场的视角切换只由两件事决定：有没有走进教室、有没有进狩猎篇。
   取消线一次都不多（并回第九章是静默的）。四种走法逐个钉住。 */
const seqOf = (r) => r.povSwitches.map((s) => s.from + '>' + s.to).join(' | ');
const wantSeq = (r) => []
  .concat(r.nodes.includes('b12_morning') ? ['奥布里>西比拉', '西比拉>奥布里'] : [])
  .concat(r.nodes.some((id) => /^h[4-8]_/.test(id)) ? ['奥布里>西比拉'] : []);
t.empty(
  ran.filter((r) => seqOf(r) !== wantSeq(r).join(' | ')).map((r) => `[${r.a1}]`),
  '整场只剩进授课线那一个来回与进狩猎篇那一次 —— 没有第三种切法'
);
t.empty(
  ran.filter((r) => {
    const inHunt = r.nodes.some((id) => /^h[4-8]_/.test(id));
    const lesson = r.nodes.includes('b12_morning');
    const want = (lesson ? 2 : 0) + (inHunt ? 1 : 0);
    return r.povSwitches.length !== want;
  }).map((r) => `[${r.a1}]`),
  '继续线比取消线多一次（多出进狩猎篇那次），亲历授课线的再多两次（那一个来回）；取消线并回第九章是静默的'
);

// 前缀与视角的对应：s（第一幕西比拉线）/ c（旧第三幕留档）是西比拉；
// b 里除授课线的**后半段**（b17～b22）与 b25_end 之外也是西比拉 ——
// 前半段（b12～b16「她换好牧师服去上课」）是原著写的她的镜头，本轮起重新接回主线后仍是西比拉。
const O_POV_B = new Set(['b17_scream', 'b18_classroom', 'b19_aubrey', 'b20_lesson', 'b21_haier_calls', 'b22_after', 'b25_end']);
t.empty(
  story.nodes.filter((n) => (n.id[0] === 's' || n.id[0] === 'c') && n.pov !== '西比拉').map((n) => `${n.id} 的 pov 是 ${n.pov}`),
  's / c 开头的节点（第一幕西比拉线、旧第三幕留档）都是西比拉视角'
);
t.empty(
  story.nodes.filter((n) => n.id[0] === 'b' && !O_POV_B.has(n.id) && n.pov !== '西比拉').map((n) => `${n.id} 的 pov 是 ${n.pov}`),
  '第一夜（含新加的 b8 两节）与授课线前半段（b12～b16）是西比拉视角；'
  + '授课线从 b17 起与 b25_end 是奥布里视角（v2 的日程口径）'
);
t.empty(
  story.nodes.filter((n) => (n.id[0] === 'o' || n.id[0] === 'f' || n.id[0] === 'd')
    && n.id !== 'dy_d6_ni_hunt_e' && n.id !== 'o4_end' && n.pov !== '奥布里')
    .map((n) => `${n.id} 的 pov 是 ${n.pov}`),
  '留档的幕间（o）、自由活动（f）与日常层（d）都是奥布里视角 —— 两个例外：'
  + '周六夜进狩猎篇的 dy_d6_ni_hunt_e（西比拉），以及第一幕的收束屏 o4_end'
  + '（第二轮回填把幕间摘掉之后，第一天全程是西比拉的镜头，收束屏跟着她）'
);
// 反着也查一道：别的地方冒出个奥布里视角的节点，就是写串了
t.eq(
  Array.from(new Set(story.nodes.filter((n) => n.pov === '奥布里').map((n) => n.id[0]))).sort(),
  ['b', 'd', 'f', 'o'],
  '奥布里视角只出现在 o（第一幕幕间）、f（自由活动）、d（日常层）与第二天授课线那几个 b 节点里'
);

/* ---------------------------------------------------------------------
   第一天：全程西比拉、没有玩家选择、没有奥布里幕间、收在 o4_end
   ---------------------------------------------------------------------
   作者定稿（`01_第一天_普里森堡的阴雨_定稿.md` 第 12 行，新 docx 重申）：
     「第一天统一采用西比拉视角，不设置奥布里幕间，不进行玩家选择，不设置第一天结算。」

   这条是**结构**上的 —— 拿文本逐行核是对不出来的（幕间的正文在原著那一侧一直都对得上，
   首轮就是因此漏了它）。所以要照着「从 s1_rain 走进收束屏、沿途经过哪些节点」来钉：
   多插一节、少走一节、冒出一个选择点，这里都会红。
   --------------------------------------------------------------------- */
{
  const e = new StoryEngine(story);
  e.start();
  const walked = [e.node.id];
  const povs = new Set([e.node.pov]);
  let choices = 0;
  // 走到第一幕的最后一节就停：再往下是第二幕的 b1_room，而这一局只装了第一幕。
  for (let g = 0; g < 400 && e.node.id !== 's4_portrait'; g++) {
    const v = e.advance();
    if (v.type === 'end') break;
    if (v.type === 'choices') { choices++; break; }
    if (e.node.id !== walked[walked.length - 1]) { walked.push(e.node.id); povs.add(e.node.pov); }
  }
  t.eq(walked, ['s1_rain', 's1_forest', 's1_castle', 's2_arrive', 's2_bridge', 's2_haier',
    's3_courtyard', 's4_hall', 's4_recognize', 's4_teach', 's4_leave', 's4_portrait'],
  '第一天就是这十二节，一节不多 —— 幕间一个都不插进来');
  t.eq([...povs], ['西比拉'], '第一天全程西比拉视角');
  t.eq(choices, 0, '第一天没有任何玩家选择');
  // 第一章与第一夜是**连续演出**（作者定稿）—— 中间不许再有那张结束屏与「继续下一幕」
  t.eq(nodeById.get('s4_portrait').next, 'b1_room',
    '第一幕最后一节直接接第一夜（b1_room）—— 中间没有结束屏、没有「继续下一幕」');
  const oNodes = story.nodes.filter((n) => /^o[1-4]_/.test(n.id));
  t.eq(oNodes.length, 18, '十八个幕间节点都还在文件里 —— 正文留档，不是删掉');
  t.eq(oNodes.filter((n) => (n.choices || []).length).length, 10,
    '十个幕间决策点的选择数据原样留着（将来要用还在），只是没有一条活路径能走到');
  const o4end = nodeById.get('o4_end');
  t.eq([o4end.ending, o4end.continueTo, (o4end.dialogues || []).length], [true, 'b1_room', 0],
    '那张留档的收束屏自己没坏（ending / continueTo / endSub 原样），只是主线不再经过它');
  t.ok((o4end.endSub || '').length > 80, '它的 endSub 也一字未删（将来要用还在）');
}
// 日常层（奥布里那几天）的节点一律静默切视角 —— 唯一的例外是周六夜进狩猎篇那一个。
// 第一夜那两节（b8_study_diary / b8_diary_writing）也住在日常层的文件里，但它们是西比拉的镜头，
// 前后都是西比拉（b8_farewell 和 b9_pillow 都是），压根换不了视角，所以不写 silent 也不会弹横幅
// —— 上面那条「整场十一次」的走法核对已经把这一点走死了。
t.eq(
  daily.nodes.filter((n) => !(n.povSwitch && n.povSwitch.silent)).map((n) => n.id),
  ['b8_study_diary', 'b8_diary_writing', 'dy_d6_ni_hunt_e'],
  '日常层里只有周六夜的狩猎入口会弹视角提示（silent 只关提示，_prevPov 照常更新）'
);

// 第二幕的选项点：原则上是「重播型」，一条 effects 都不许有（b19 的授课方式除外，见「分支」一节）
t.empty(
  act2.nodes.filter((n) => n.choices && n.id !== 'b19_aubrey').flatMap((n) => n.choices.filter((c) => c.effects && c.effects.length)
    .map((c) => `${n.id} 的「${c.text}」不该有效果`)),
  '第二幕的选项一条 effects 都没写（b19 除外）'
);

// povSwitch.silent：只换视角、不出提示。
// 日常层（奥布里）和原著段（西比拉）每个时段都要来回切一次，不静默的话
// 玩家每换一个时段就吃一行系统提示。静默只关掉「提示」，_prevPov 照常更新，
// 所以下一次真正该弹的切换仍然认得出来。
const silentStory = api.composeStories([{
  meta: { title: '静默视角', version: '1.0.0', start: 'q_a' },
  config: { statLabels: {}, statRanges: {}, initialStats: {} },
  nodes: [
    { id: 'q_a', title: '甲', pov: '西比拉', dialogues: [{ speaker: '旁白', text: '甲。' }], next: 'q_b' },
    { id: 'q_b', title: '乙', pov: '奥布里', povSwitch: { silent: true }, dialogues: [{ speaker: '旁白', text: '乙。' }], next: 'q_c' },
    { id: 'q_c', title: '丙', pov: '西比拉', dialogues: [{ speaker: '旁白', text: '丙。' }], next: 'q_d' },
    { id: 'q_d', title: '丁', pov: '奥布里', povSwitch: { line: '◆ 换人了' }, dialogues: [{ speaker: '旁白', text: '丁。' }], ending: true, endSub: '完。' },
  ],
}]);

const silent = new StoryEngine(silentStory);
const povEvents = [];
silent.on('pov', (info) => povEvents.push(info));
silent.start();
t.eq(silent.povSwitchInfo, null, '开场不弹视角提示');

silent.enterNode('q_b');
t.eq(silent.pov, '奥布里', 'silent 节点照样把视角换过去');
t.eq(silent.povSwitchInfo, null, 'silent 节点不生成视角提示');
t.eq(povEvents.length, 0, 'silent 节点不发 pov 事件');

silent.enterNode('q_c');
t.eq(silent.povSwitchInfo.from, '奥布里', '静默之后下一次切换仍然认得出来（_prevPov 照常更新）');
t.eq(silent.povSwitchInfo.to, '西比拉', '静默之后切回西比拉');
t.eq(povEvents.length, 1, '这次照常发 pov 事件');

silent.enterNode('q_d');
t.eq(silent.povSwitchInfo.line, '◆ 换人了', '写了 line 的节点用自定义文案，不受 silent 影响');

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
locked.node = { id: 'x', pov: '西比拉', dialogues: [], choices: [{ text: '锁着的', next: 's1_rain', if: { stat: '西比拉_警惕', op: '>=', value: 99 } }] };
t.eq(locked.choose(0).ok, false, '锁住的选项选不了');
t.eq(locked.choose(0).reason, 'locked', '拒绝理由是 locked');
t.eq(locked.choose(99).reason, 'out-of-range', '越界的选项被拒');
t.eq(new StoryEngine(story).choose(0).reason, 'no-choices', '没 start() 时选择被拒');

// 幕间衔接：第一幕的结局屏上按「继续下一幕」
const bridge = new StoryEngine(story);
bridge.start();
bridge.enterNode('o4_end');
let endView = bridge.advance();
for (let i = 0; endView.type !== 'end' && i < 50; i++) endView = bridge.advance();
t.eq(endView.type, 'end', 'o4_end 仍然弹结局屏（不是直接溜进第二幕）');
t.eq(endView.node.id, 'o4_end', '结局视图里带着节点，界面才能读到 continueTo');
t.eq(endView.node.continueTo, 'b1_room', 'o4_end 的 continueTo 指向第二幕的开头');
// b25_end 已经退出「第二幕结算屏」身份：没有 ending、没有 continueTo，
// 只是一根通到日常层第 3 天早晨的 next（零台词，advance() 会直接穿过去）
t.eq(nodeById.get('b25_end').ending, undefined, 'b25_end 不再是结局节点');
t.eq(nodeById.get('b25_end').continueTo, undefined, 'b25_end 不再挂 continueTo —— 它只是一根过场指针');
t.eq(nodeById.get('b25_end').next, 'dy_d3_mo_intro', '第二幕演完穿过 b25_end 进日常层第 3 天的开场（查看笔记）');
t.eq(nodeById.get('b25_end').dialogues.length, 0, '过场节点零台词，玩家看不见它');
// 第一幕的收束点已经挪到第九章末尾：h8_end 不再弹结局屏，只留一根 next；
// 真正弹结局屏的是 h9_end，而且它后面**不写** continueTo（第一幕到头了）
t.eq(nodeById.get('c27_end').next, 'h4_knock', '旧第三幕的收束链保留原样（供旧稿追溯，不进入新主线）');
t.eq(nodeById.get('c27_end').ending, undefined, 'c27_end 已经不是结局节点了');
t.eq(nodeById.get('h8_end').ending, undefined, 'h8_end 不再弹结局屏（不显示「第一幕尾声」一类提示）');
t.eq(nodeById.get('h8_end').next, 'h9_start', 'h8_end 只留一根 next 接第九章');
t.eq(nodeById.get('h9_end').ending, true, '第九章末尾 h9_end 才是第一幕的收束');
t.eq(nodeById.get('h9_end').continueTo, undefined, 'h9_end 后面不写 continueTo —— 第一幕到此为止');

const intoAct2 = bridge.enterNode(endView.node.continueTo);
t.eq(intoAct2.id, 'b1_room', '从结局节点能直接走进第二幕');
const afterBridge = bridge.advance();
t.eq(afterBridge.type, 'line', '接上之后照常演第二幕的第一句（不需要新的引擎方法）');
t.eq(bridge.pov, '西比拉', '第二幕是西比拉视角');
/* 第一幕收束屏的视角这一轮改回了西比拉（幕间整批摘掉，第一天全程是她的镜头），
   所以跨进第二幕**视角并没有变** —— 不该再弹那行「…视角结束 —— …视角开始」。 */
t.eq(bridge.povSwitchInfo, null, '跨幕不再弹视角提示（两幕都是西比拉的镜头，视角没变）');
t.eq(nodeById.get('o4_end').pov, '西比拉', '第一幕收束屏也是西比拉视角');
t.eq(bridge.currentArt().bg, 'bg_sibylla_room', '第二幕开头换了新房间的背景');
t.eq(bridge.currentArt().portrait, 'chr_sibylla', '第二幕开头西比拉穿的是女仆装');

// 换装：只在换衣服那个节点上换个 art.portrait，没有别的机制
const teacherNodes = act2.nodes.filter((n) => n.art.portrait === 'chr_sibylla_teacher').map((n) => n.id);
const maidNodes = act2.nodes.filter((n) => n.art.portrait === 'chr_sibylla').map((n) => n.id);
t.eq(teacherNodes[0], 'b12_morning', '段30「换上了那身牧师服装」起换成牧师服立绘');
t.eq(teacherNodes[teacherNodes.length - 1], 'b23_corridor', '一直到回房前都还穿着牧师服');
t.eq(maidNodes[maidNodes.length - 1], 'b24_change', '段76 换回女仆装，立绘跟着换回来');
t.ok(maidNodes.indexOf('b11_sleep') < maidNodes.indexOf('b24_change'), '第二幕前半夜还是女仆装');
t.eq(nodeById.get('b25_end').art.portrait, 'chr_aubrey', '过场节点画的是奥布里那间房（玩家看不见，只为立绘不断档）');
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

// 数值面板：默认藏数字。面板上只有 statOrder 那四项关系
const panel = new StoryEngine(story);
panel.setStat('西比拉_亲密', 3);
t.eq(panel.statPanel().length, 4, '面板 4 项');
t.eq(panel.statPanel().map((s) => s.display), new Array(4).fill('?'), '默认只给「?」不给数字');
panel.toggleStats(true);
t.eq(panel.statPanel().map((s) => s.display),
  ['-10', '60', '10', '3'],
  '按 V 之后才显示真实数字（起点：好感 −10 / 健康 60 / 尊敬 10，亲密度另设成 3）');
// 隐藏的那批：数值照常算，只是不上面板 —— 面板收起时看不见，展开也不列
t.eq(panel.getStat('西比拉_警惕'), 80, '警惕照常有值（起点的 80）');
t.eq(panel.getStat('普里森堡_声誉'), 50, '府里名声照常有值');
t.empty(panel.statPanel().filter((s) => s.max === 1), '四条线索不再占面板的位置（仍然在 statRanges 里，见上文）');
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
t.eq(roam1.enterRoam('o4_end').ok, false, '结局节点本身不是自由活动的入口（要走 hubs[].after 反查）');
t.eq(roam1.roamAnchorAfter('o4_end'), 'fr_hub', '第一幕结局之后进 fr_hub');
// 第二幕那个中途自由活动入口（fr_end_hub）这一轮正式作废：
// b25_end 只是通往第 3 天的过场，背后没有 hub —— 反查必须是 null
t.eq(roam1.roamAnchorAfter('b25_end'), null, '第二幕收束之后不再有自由活动入口');
t.eq(story.freeRoam.hubs.fr_end_hub, undefined, 'fr_end_hub 已经从 hubs 里删掉');
t.eq(roam1.roamAnchorAfter('s1_rain'), null, '没安排自由活动的节点反查得到 null');

roam1.enterNode('o4_end');
t.eq(roam1.enterRoam(roam1.roamAnchorAfter('o4_end')).ok, true, '从第一幕结局进得了自由活动');
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
t.eq(roam1.getStat('西比拉_好感'), -10, '刚进来好感是 −10（第一章的起点，v1 是 0）');
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
hubEng.enterNode('o4_end');
hubEng.enterRoam(hubEng.roamAnchorAfter('o4_end'));
const hubTexts = textOf(runToMenu(hubEng).view.choices);
t.empty(
  invites.map((i) => i.room).filter((n) => hubTexts.includes('去' + n + '的房间')),
  'hub 上没有「去来访房间」的入口'
);
t.ok(hubTexts.includes('去西比拉的房间') && hubTexts.includes('去伊莎贝尔的房间'),
  '正常房间照旧列着');

const visit = new StoryEngine(story);
visit.start();
visit.enterNode('o4_end');
visit.enterRoam(visit.roamAnchorAfter('o4_end'));
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
tail.enterNode('o4_end');
tail.enterRoam(tail.roamAnchorAfter('o4_end'));
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
isa.enterNode('o4_end');
isa.enterRoam(isa.roamAnchorAfter('o4_end'));
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

/* --- 最后一个 hub（狩猎篇之后）：没有「进入下一幕」 --- */
const roam2 = new StoryEngine(story);
roam2.start();
roam2.enterNode('h9_end');
t.eq(roam2.enterRoam(roam2.roamAnchorAfter('h9_end')).ok, true, '第九章收束之后进得了自由活动');
t.eq(roam2.node.id, 'fr_act3_hub', '落在 fr_act3_hub 上');
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
t.eq(anchors.length, 13,
  '十三个自由活动锚点（2 个 hub + 4 个装束锚点 + 1 个房间锚点 + 5 个「请人过来」的落点 + 结束游戏的 fr_the_end）'
  + ' —— 原来的第三个 hub「fr_end_hub（第二幕结算之后的中途自由活动）」已从主流程移除');
t.ok(anchors.every(Boolean), 'anchors 里写 id 全都在节点表里');
t.eq(roamNodes.length, anchors.length + 1, '锚点之外只有一个 f 开头的节点：报仇的落点');
t.empty(anchors.filter((n) => n.next || n.choices).map((n) => n.id),
  '锚点一律不写 next / choices（写了 next 会盖过状态机）');
t.empty(anchors.filter((n) => !n.freeRoam).map((n) => n.id), '锚点都打了 freeRoam 标记');
t.eq(anchors.filter((n) => n.ending).map((n) => n.id), ['fr_the_end'],
  '锚点里只有 fr_the_end 是结局，别的都是菜单');
t.eq(roamNodes.filter((n) => !story.freeRoam.anchors.includes(n.id) && n.ending).map((n) => n.id),
  ['fr_revenge'], '不在锚点里的那个 f 节点就是报仇结局');
t.empty(
  report.warnings.filter((w) => !LEGACY.has(w.split(' ')[0])),
  '自检没有把这些锚点当成「走不到」或「结局」（留档节点的登记不算）'
);

// v1 那句「好感只在自由活动里动」随 v2 作废（第一幕的幕间决策本身就在动好感）。
// 现在守的是另一条：第二幕那套自由活动只认四个老数值，第一章新加的那些
// ——线索、佣兵纪律、礼仪成长、海尔/布朗好感——它一个都不碰。
const roamTouched = new Set();
const collect = (o) => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(collect); return; }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'effects' && Array.isArray(v)) v.forEach((e) => e.stat && roamTouched.add(e.stat));
    else collect(v);
  }
};
collect(story.freeRoam);
const ROAM_STATS = ['伊莎贝尔_好感', '西比拉_亲密', '西比拉_好感', '西比拉_警惕'];
t.empty(
  [...roamTouched].filter((k) => ROAM_STATS.indexOf(k) < 0).sort(),
  '自由活动只动那四个老数值（第一章新加的线索 / 纪律 / 礼仪成长等它不碰）'
);
// 阶段 2 挂的那张待接线名单到阶段 3 已经清空：那八项现在由**日常层的幕尾反应**驱动
// （daily/story.json 里 dy_d2_*_r / dy_d6_*_r 的 choices[].effects）。
// 名单空了就把机制本身撤掉，改成正面要求：登记过的每一个数值都得有人动过它。
const drivenBySomeNode = (k) => story.nodes.some((n) => n.id[0] !== 'f'
  && (n.choices || []).some((c) => (c.effects || []).some((e) => e.stat === k)));

t.empty(
  Object.keys(story.initialStats)
    .filter((k) => ROAM_STATS.indexOf(k) < 0 && !drivenBySomeNode(k))
    .sort(),
  '第一章那些数值全都由主线（幕间决策）或日常层的选择驱动，没有一个是白定义的'
);
// 日常层动的那几项，必须真的在 original 三幕之外 —— 三幕一个 effects 都没被改过
const DAILY_DRIVEN = ['西比拉_健康', '西比拉_尊敬', '西比拉_埋怨', '西比拉_反抗',
  '西比拉_恨意', '普里森堡_秩序', '普里森堡_声誉', '仆人_尊敬'];
t.empty(
  DAILY_DRIVEN.filter((k) => !daily.nodes.some((n) => (n.choices || []).some((c) => (c.effects || []).some((e) => e.stat === k)))),
  '这八项每一项都在日常层的选择里真的出现过（不是登记完就算数）'
);
t.empty(
  DAILY_DRIVEN.filter((k) => [act1, act2, act3].some((a) => a.nodes.some((n) => (n.choices || []).some((c) => (c.effects || []).some((e) => e.stat === k))))),
  '这八项只被日常层驱动，三幕正文里一处都没碰过它们'
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
  eng.enterNode(hub === 'fr_act3_hub' ? 'h9_end' : 'o4_end');
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

/* -------------------------------------------------------------------
 * 换装是侧厅，不是剧情
 *
 * 它能改数值（第一次换上某套，她会有反应），也**必须**写 history ——
 * 「她此刻穿着什么」正是靠 history 记的（engine 的 _roamOutfitId 沿它回看），
 * 那是存档的一部分，不是剧情流水。
 *
 * 但它不进剧情账：不写日记、不进当天的总结、不动任何剧情旗标。
 * （日记的取数位就是那几个「旗_…」，所以「旗子没动」＝「日记里不会多出一条」。）
 * ------------------------------------------------------------------- */

t.section('换装不进剧情账');
{
  const eng = freshRoom();
  const flagsBefore = {};
  for (const k of Object.keys(eng.stats)) if (k.indexOf('旗_') === 0) flagsBefore[k] = eng.stats[k];
  const diaryBefore = JSON.stringify(eng.stats);

  eng.choose(indexOfText(runToMenu(eng).view.choices, '换装'));
  eng.choose(indexOfText(runToMenu(eng).view.choices, '女仆装'));

  const flagsAfter = {};
  for (const k of Object.keys(eng.stats)) if (k.indexOf('旗_') === 0) flagsAfter[k] = eng.stats[k];
  t.eq(flagsAfter, flagsBefore, '换装一个剧情旗标都没动 —— 日记里不会因此多出一条');

  /* 日记正文是按天写死的，只有「今日事件」靠旗子与 visited 取。
     旗子没动 + 换装节点不在 dy_ 命名空间里，所以日记两边都不受影响。 */
  t.empty(
    Object.keys(eng.stats).filter((k) => k.indexOf('旗_') === 0 && eng.stats[k] !== flagsBefore[k])
      .map((k) => `${k} 被换装改了`),
    '换装之后没有哪面记录旗被写进去'
  );
  t.ok(eng.history.some((id) => /^fr/.test(id)),
    '换装确实走过节点（装束＝位置，history 就是记这个用的）');
  t.ok(diaryBefore.length > 0, '换装前确实有一份数值在这儿作对照');

  /* 结构上也堵死：日记的「今日事件」只从 choice.diary 取，
     自由活动那几个节点一个 diary 字段都不许有。 */
  t.empty(
    story.nodes.filter((n) => /^fr/.test(n.id))
      .flatMap((n) => (n.choices || []).filter((c) => c.diary)
        .map((c) => `${n.id} 上有 diary 字段 —— 自由活动不该进日记`)),
    '自由活动的节点一个日记字段都没有（结构上就进不了那本册子）'
  );

  /* 幕间自由活动整层也不在 daily 层的命名空间里（dy_），
     所以「今天的总结」按天取数时扫不到它。 */
  t.empty(
    story.nodes.filter((n) => /^fr/.test(n.id) && n.id.indexOf('dy_') === 0).map((n) => n.id),
    '自由活动的节点没有混进 dy_ 命名空间（按天取日记时扫不到它们）'
  );
}

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
  eng.enterNode('o4_end');
  eng.enterRoam(eng.roamAnchorAfter('o4_end'));
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
  eng.enterNode('o4_end');
  eng.enterRoam(eng.roamAnchorAfter('o4_end'));
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
done.enterNode('o4_end');
while (done.advance().type === 'line') { /* 一路播到底 */ }
t.eq(done.ended, true, '演完了');
t.eq(done.pauseToStory().ok, false, '结局之后不能再暂停');
t.eq(done.resumeFromStory().ok, false, '没暂停过也就回不去');

// 从结局卡片进的自由活动没有「原来的剧情」，不给暂停
const roaming = new StoryEngine(story);
roaming.start();
roaming.enterNode('o4_end');
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
ranged.setStat('西比拉_警惕', 0);
t.eq(ranged.applyEffects([{ stat: '西比拉_警惕', value: -1 }])[0].after, 0,
  '警惕没写进 statRanges，按默认 [0,100] 夹；压在 0 上就减不动了');
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

if (process.env.DBGRUN) {
  console.log('DBG=' + JSON.stringify({
    act1paths: ACT1_PATHS.length,
    reach: reachable.size,
    warnings: report.warnings,
    act1bounds: ACT1_RANGES.map(([k]) => [k, a1Bound(k)]),
    finals: Object.keys(finalLo).reduce((o, k) => { o[k] = [finalLo[k], finalHi[k]]; return o; }, {}),
    taildeltas_aff: TAIL_DELTAS.map((d) => d['西比拉_好感']),
    bestAff: BEST_AFF, worstAff: statOf(worstAff, AFF),
    bestTier: tierOfStats(bestAff), worstTier: tierOfStats(worstAff),
    bestStats: bestAff.stats, worstStats: worstAff.stats,
    switches: ran[0].povSwitches.map((s) => s.from + '>' + s.to),
  }, null, 1));
}

t.done();
