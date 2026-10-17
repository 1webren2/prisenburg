/**
 * 熬药系统测试（纯逻辑 + 一层无头界面）
 * =====================================================================
 *   node tests/brew.test.cjs
 *
 * 分六段：
 *   一、材料与药方（daily/alchemy.js）—— 目录自洽，需求清单是从阶段现算出来的
 *   二、制作引擎（daily/brew.js）—— 生命周期 / 三条工序处理器 / 评分 / 超时 / 结算
 *   三、府邸账目与固定采购（daily/story.json 的 pharmacy）
 *   四、存档 —— 库存住在 stats 里，所以跟着 snapshot 走
 *   五、物品资源 —— 六张图现在都是**占位**，测试盯着这件事别被说成正式素材
 *   六、界面层（daily/brew-ui.js + dom-stub）—— 接在剧情哪一下、键盘不串台、
 *       结算只写一次、料不够也有出路
 *
 * **时钟全是假的**（注入 now()），所以「超时」是推出来的，不是等出来的。
 */

const fs = require('fs');
const path = require('path');
const { loadDom } = require('./dom-stub.cjs');
const { suite } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const api = require(path.join(ROOT, 'act1', 'engine.js'));
const A = require(path.join(ROOT, 'daily', 'alchemy.js'));
const B = require(path.join(ROOT, 'daily', 'brew.js'));
const I = require(path.join(ROOT, 'daily', 'item-icons.js'));

const act1 = require(path.join(ROOT, 'act1', 'story.json'));
const story2 = require(path.join(ROOT, 'act2', 'story.json'));
const story3 = require(path.join(ROOT, 'act3', 'story.json'));
const daily = require(path.join(ROOT, 'daily', 'story.json'));
const hunt = [4, 5, 6, 7, 8, 9].map((n) => require(path.join(ROOT, 'hunt', `ch${n}.json`)));
const story = api.composeStories([act1, story2, story3, daily, ...hunt]);

const { StoryEngine } = api;
const t = suite('熬药');

const RECIPE = A.recipeById('recipe_daily_decoction_01');
const PHARM = daily.pharmacy;

/* =====================================================================
   假时钟 + 假库存。引擎只认注入进去的两个函数 —— 这一层就是那两个。
   ===================================================================== */

function env(stock) {
  const stats = Object.assign({}, stock || {});
  let clock = 0;
  return {
    stats,
    getStat: (k) => Number(stats[k]) || 0,
    now: () => clock,
    advance(ms) { clock += ms; return clock; },
    put(stat, n) { stats[stat] = (Number(stats[stat]) || 0) + n; },
  };
}

/** StoryEngine.getStat 是个方法，脱开实例传出去 this 就没了 —— 包一道再传 */
const readOf = (engine) => (name) => engine.getStat(name);

/** 按初始库存起一套（与 act1/story.json 的 initialStats 同值） */
function fullStock(extra) {
  const s = {};
  A.INGREDIENTS.forEach((it) => { s[A.statOf(it.id)] = it.id === 'ing_mustard_seed' ? 2 : 3; });
  A.PRODUCTS.forEach((it) => { s[A.statOf(it.id)] = 0; });
  return Object.assign(s, extra || {});
}

function makeBrew(stock, recipe) {
  const e = env(stock || fullStock());
  const be = new B.BrewEngine(recipe || RECIPE, { getStat: e.getStat, now: e.now });
  return { e, be };
}

/**
 * 一个「手很稳的玩家」：火候贴着目标带心，药按册子的次序下，
 * 指针一进命中区就按确认。dt 是现实里的一帧。
 */
function playSkilled(be, e, dt) {
  let guard = 0;
  while (be.state !== B.STATE.COMPLETED && guard++ < 40000) {
    if (be.state === B.STATE.STAGE_RESULT) { be.next(); continue; }
    if (be.state !== B.STATE.RUNNING) break;

    const st = be.stage;
    const band = st.heat.band;
    const center = (band[0] + band[1]) / 2;
    be.holdHeat(be.heat < center);
    if (be.state !== B.STATE.RUNNING) continue;

    const want = be.expectedPicks();
    if (be.picksLeft() > 0) be.pick(want[be.picks.length]);

    const pos = be.sweepPos();
    const sb = st.sweep.band;
    /* 手稳的人不是「进了带子就按」—— 他等火候贴到带心、指针也进了命中区才动手 */
    const settled = Math.abs(be.heat - center) <= (band[1] - band[0]) * 0.08;
    if (settled && pos >= sb[0] && pos <= sb[1] && be.picksLeft() === 0) {
      be.confirm();
      continue;
    }
    e.advance(dt);
    be.tick();
  }
  return be;
}

/** 一个「不管不顾的玩家」：火一直不添，药全下错，指针扫到最偏处才按 */
function playSloppy(be, e, dt) {
  let guard = 0;
  while (be.state !== B.STATE.COMPLETED && guard++ < 40000) {
    if (be.state === B.STATE.STAGE_RESULT) { be.next(); continue; }
    if (be.state !== B.STATE.RUNNING) break;

    be.holdHeat(false);
    if (be.state !== B.STATE.RUNNING) continue;

    const want = be.expectedPicks();
    if (be.picksLeft() > 0) {
      const other = A.INGREDIENTS.map((x) => x.id).find((id) => id !== want[be.picks.length]);
      be.pick(other);
    }
    const pos = be.sweepPos();
    const st = be.stage;
    const sb = st.sweep.band;
    const hb = st.heat.band;
    const inHeat = be.heat >= hb[0] && be.heat <= hb[1];
    /* 火候要等它自己落到带外，指针也要偏到最远处才按 —— 手潮是「不管不顾」，
       不是「一进这一段立刻交卷」。 */
    if (be.picksLeft() === 0 && !inHeat && (pos < sb[0] - 0.3 || pos > sb[1] + 0.3)) {
      be.confirm();
      continue;
    }
    e.advance(dt);
    be.tick();
  }
  return be;
}

/* =====================================================================
   一、材料与药方
   ===================================================================== */

t.section('材料与药方');

t.eq(RECIPE.id, 'recipe_daily_decoction_01', '第一剂方子的 id 是定死的那个');
t.eq(RECIPE.name, '日常调养煎剂', '显示名');
t.eq(RECIPE.category, 'medical', '类别是 medical');
t.eq(RECIPE.stages.length, 4, '四道工序：预热 / 根皮 / 银脉草 / 收药');
t.eq(RECIPE.stages.map((s) => s.id), ['preheat', 'add_roots', 'add_silverleaf', 'finish'],
  '工序的次序与 id');
t.eq(RECIPE.durationMin, 30, '游戏内固定耗时 30 分钟（与玩家手快手慢无关）');
t.eq(RECIPE.weights, { material: 40, heat: 30, timing: 30 }, '评分权重：材料与顺序 40 / 火候 30 / 时机 30');
t.eq(Object.values(RECIPE.weights).reduce((a, b) => a + b, 0), 100, '三项权重加起来正好 100');
t.eq(RECIPE.skipScore, 60, '跳过按 60 分（普通）结算');

t.empty(
  RECIPE.stages.filter((s) => !(s.timeLimitMs >= 10000 && s.timeLimitMs <= 12000)).map((s) => s.id),
  '每个限时阶段都在 10~12 秒之间'
);
t.empty(
  RECIPE.stages.filter((s) => !(s.heat && s.heat.band && s.sweep && s.sweep.band)).map((s) => s.id),
  '每一段都配了火候目标带与火条命中区（第二张方子照这个形状写就行）'
);
t.eq(RECIPE.stages.map((s) => (s.materials ? s.materials.order.length : 0)), [0, 2, 1, 1],
  '每一段投几味药：预热不投 / 根皮两味 / 银脉草一味 / 收药添蜜');
t.empty(RECIPE.stages.filter((s) => !s.confirmLabel).map((s) => s.id),
  '每一段都写了这一步动作用的那个词（封盖 / 投入 / 添蜜收药）');

/* 需求清单是从阶段现算的 —— 不是手写的第二份真值 */
const req = A.requiredMaterials(RECIPE);
t.eq(req.map((r) => r.id), ['ing_willow_bark', 'ing_bitter_root', 'ing_silverleaf', 'ing_honey'],
  '这一锅要的四味药（按投放次序）');
t.eq(req.map((r) => r.qty), [1, 1, 1, 1], '每味各一份');
t.eq(req, RECIPE.requires, '方子上手写的 requires 与从阶段现算出来的完全一致（不许各说各的）');
t.ok(!req.some((r) => r.id === 'ing_mustard_seed'),
  '芥籽这一轮不用它（备选材料 + 投错药的靶子）');
t.ok(!!A.itemById('ing_mustard_seed'), '但芥籽在目录里，是正经的一味药');

t.eq(A.statOf('ing_willow_bark'), '药材_ing_willow_bark',
  '库存键 = 药材_ + 物品 id（逻辑 ID 与显示名分开，判断一律不拿中文名当身份）');
t.eq(A.itemIdOfStat('药材_ing_honey'), 'ing_honey', '库存键还原得回物品 id');
t.ok(!A.isInventoryStat('西比拉_好感'), '别家的数值不会被当成库存');
t.eq(A.itemById('ing_willow_bark').name, '柳树皮', '显示名只给人看');
t.empty(A.INGREDIENTS.concat(A.PRODUCTS).map((it) => it.id).filter((id) => !it_id_ok(id)),
  '每一件物品的 id 都是 ASCII 的逻辑 id，不是中文名');
function it_id_ok(id) { return /^[a-z][a-z0-9_]*$/.test(id); }

/* 品质分档 */
t.eq([100, 90, 89, 75, 74, 60, 59, 0].map((n) => A.qualityOf(n).label),
  ['优秀', '优秀', '良好', '良好', '普通', '普通', '欠佳', '欠佳'], '品质分档的四个档口');
t.eq(A.qualityOf(60).key, 'fair', '60 分是「普通」那一档的 key');

/* 料够 / 不够 */
{
  const e = env(fullStock());
  t.eq(A.checkMaterials(RECIPE, e.getStat).ok, true, '初始库存够熬一剂');
  t.eq(A.checkMaterials(RECIPE, e.getStat).missing, [], '够的时候没有缺口');

  const poor = env(fullStock({ 药材_ing_honey: 0, 药材_ing_silverleaf: 0 }));
  const chk = A.checkMaterials(RECIPE, poor.getStat);
  t.eq(chk.ok, false, '少一味就报不够');
  t.eq(chk.missing.map((m) => m.name), ['银脉草', '蜂蜜'], '缺口里写的是哪两味（界面上照这个画提示）');
  t.eq(chk.missing.map((m) => m.need), [1, 1], '缺的每一味都报出「要几份」');
  t.eq(chk.missing.map((m) => m.have), [0, 0], '……以及「手上有几份」');

  /* 要两份只有一份：算缺，并且报出的「有几份」是真的数 */
  const need2 = { stages: [{ materials: { order: ['ing_honey', 'ing_honey'] } }] };
  t.eq(A.checkMaterials(need2, env(fullStock({ 药材_ing_honey: 1 })).getStat).missing,
    [{ id: 'ing_honey', name: '蜂蜜', need: 2, have: 1 }],
    '要两份、手上只有一份 → 算缺，缺口的三个数都对');
  t.eq(A.checkMaterials(need2, env(fullStock({ 药材_ing_honey: 2 })).getStat).ok, true,
    '正好两份 → 够（是 < 不是 <=）');

  const rows = A.inventoryRows(RECIPE, e.getStat);
  t.eq(rows.length, A.INGREDIENTS.length, '材料栏把目录里每一味都摆出来（包括现下不用的芥籽）');
  t.eq(rows.filter((r) => r.used).map((r) => r.id),
    ['ing_willow_bark', 'ing_bitter_root', 'ing_silverleaf', 'ing_honey'], '标出这一锅会用到的四味');
  t.eq(rows.filter((r) => r.need > 0).map((r) => r.need), [1, 1, 1, 1], '每一味的「这一锅要用几份」');
  t.eq(rows.map((r) => r.have), [3, 3, 3, 3, 2], '每一味的现存量');
}

/* 第二张方子：不碰引擎代码，只加数据 */
t.section('方子是数据驱动的（加第二张不用改引擎）');

{
  const RECIPE2 = {
    id: 'recipe_test_salve',
    name: '测试用药膏',
    category: 'medical',
    desc: '只为验证「加方子 = 加数据」而写的一条，不进 story.json。',
    durationMin: 12,
    weights: { material: 50, heat: 50 },       // 只有两维 —— 时机的权重该被摘掉
    skipScore: 60,
    requires: [{ id: 'ing_mustard_seed', qty: 2 }],
    product: { id: 'item_daily_decoction', qty: 1 },
    manualIntro: '——',
    stages: [
      {
        id: 's1', label: '下料', brief: '——', manual: '——',
        timeLimitMs: 10000,
        heat: { start: 40, band: [40, 60], decayPerSec: 5, risePerSec: 20 },
        sweep: { periodMs: 2000, band: [0.4, 0.6] },
        confirmLabel: '下', materials: { order: ['ing_mustard_seed', 'ing_mustard_seed'] },
      },
      {
        id: 's2', label: '再下料', brief: '——', manual: '——',
        timeLimitMs: 10000,
        heat: { start: 50, band: [50, 70], decayPerSec: 5, risePerSec: 20 },
        sweep: { periodMs: 2000, band: [0.4, 0.6] },
        confirmLabel: '下', materials: null,
      },
    ],
  };

  t.eq(A.requiredMaterials(RECIPE2), [{ id: 'ing_mustard_seed', qty: 2 }],
    '新方子的需求清单也是从阶段现算的（同一味下两次 = 两份）');

  const { be, e } = makeBrew(fullStock(), RECIPE2);
  t.eq(be.start().ok, true, '新方子直接能开锅 —— 引擎里没有一行是为第一剂写死的');
  playSkilled(be, e, 50);

  const res = be.result();
  t.eq(res.completed, true, '新方子也能走完');
  t.eq(res.recipeId, 'recipe_test_salve', '结果里记的是新方子的 id');
  t.eq(res.durationMin, 12, '游戏内耗时取方子自己的');
  t.eq(res.stages.length, 2, '阶段数也取方子自己的（不是写死的 4）');
  t.eq(res.dimensions.timing.weight, 0, '这张方子没给「时机」写权重……');
  const w = RECIPE2.weights;
  const expect = Math.round(
    (w.material * res.dimensions.material.score + w.heat * res.dimensions.heat.score) /
    (w.material + w.heat) * 100);
  t.eq(res.score, expect, '……分数就只按写了权重的那两维算，其余按比例归一（不拿没考的当满分）');
  t.ok(res.score >= 90, '手稳照样能拿高分（实测 ' + res.score + ' 分）');
  t.eq(res.consumed, [{ id: 'ing_mustard_seed', qty: 2 }], '扣的是新方子自己那两味');
  t.eq(B.settlementPlan(res).map((p) => [p.stat, p.delta]),
    [['药材_ing_mustard_seed', -2], ['药材_item_daily_decoction', 1]], '结算也照它的清单走');
}

/* =====================================================================
   二、制作引擎
   ===================================================================== */

t.section('引擎 · 生命周期');

{
  const { be } = makeBrew();
  t.eq(be.state, 'READY', '刚建出来是 READY');
  t.eq(be.snapshot().remainingMs, 0, 'READY 时没有倒计时');
  t.eq(be.start().ok, true, '料够，开锅');
  t.eq(be.state, 'RUNNING', '开锅后进 RUNNING');
  t.eq(be.stage.id, 'preheat', '从第一道工序开始');
  t.eq(be.snapshot().remainingMs, 11000, '倒计时按这一段的限时起表');
  t.eq(be.start().ok, false, '再开一次会被拒（一次制作只开一次）');
}

{
  const { be } = makeBrew(fullStock({ 药材_ing_honey: 0 }));
  const r = be.start();
  t.eq(r.ok, false, '少一味就开不了锅');
  t.eq(r.reason, 'no-materials', '拒绝的理由是没料');
  t.eq(r.missing.map((m) => m.name), ['蜂蜜'], '并且把缺口一起报出来');
  t.eq(be.state, 'READY', '被拒之后还停在 READY，不是坏掉的中间态');
}

t.section('引擎 · 三条工序处理器');

t.eq(B.judge.heat(57.5, [45, 70]), 1, '火候落在带心：满分');
t.ok(B.judge.heat(45, [45, 70]) > 0.6 && B.judge.heat(45, [45, 70]) < 0.75,
  '压在带边上：掉到带内那一档的下限');
t.ok(B.judge.heat(20, [45, 70]) < 0.3, '离带子远了就快掉没了');
t.eq(B.judge.heat(0, [45, 70]), 0, '火灭了就是 0');
t.eq(B.judge.heat(100, [45, 70]), 0, '烧过头了也是 0');
t.eq(B.judge.timing(0.5, [0.44, 0.62]), 1, '指针在命中区里：满分');
t.eq(B.judge.timing(0.2, [0.44, 0.62]), 0, '偏出 falloff 之外：0 分');
t.ok(B.judge.timing(0.4, [0.44, 0.62]) > 0 && B.judge.timing(0.4, [0.44, 0.62]) < 1,
  '擦着边：给部分分');
t.eq(B.judge.material([{ picked: 'a' }, { picked: 'b' }], ['a', 'b']), 1, '两味都对：满分');
t.eq(B.judge.material([{ picked: 'b' }, { picked: 'a' }], ['a', 'b']), 0, '次序反了：0 分');
t.eq(B.judge.material([{ picked: 'a' }], ['a', 'b']), 0.5, '只下了一味：一半');
t.eq(B.judge.material([{ picked: 'a' }, { picked: 'c' }], ['a', 'b']), 0.5, '错一味：一半');
t.eq(B.judge.material([], ['a', 'b']), 0, '一味都没下：0 分');

t.section('引擎 · 手稳的一锅');

{
  const { be, e } = makeBrew();
  be.start();
  playSkilled(be, e, 50);

  const res = be.result();
  t.eq(be.state, 'COMPLETED', '四段走完就 COMPLETED');
  t.eq(res.completed, true, '结果是「做成了」');
  t.eq(res.skipped, false, '不是跳过的');
  t.ok(res.score >= 90, '手稳 = 优秀（实测 ' + res.score + ' 分）');
  t.eq(res.quality.label, '优秀', '品质落在优秀那一档');
  t.eq(res.stages.length, 4, '四段的成绩都记着');
  t.empty(res.stages.filter((s) => s.timedOut).map((s) => s.stageId), '没有一段是超时结束的');
  t.eq(res.stages[1].picks.map((p) => p.ok), [true, true], '根皮那一段两味都对、次序也对');
  t.eq(res.stages.map((s) => s.materialScore), [null, 1, 1, 1], '材料那一维：预热不考，其余三段满分');
  t.eq(res.stages.map((s) => s.heatScore >= 0.9), [true, true, true, true], '火候四段都稳');
  t.eq(res.stages.map((s) => s.timingScore), [1, 1, 1, 1], '时机四段全中');
  t.ok(res.stages.every((s) => s.feedback && s.feedback.length >= 2),
    '每一段都留了一句给玩家看的反馈');
  t.eq(res.durationMin, 30, '游戏内耗时照方子写的那一个（跟玩家手快没关系）');
  t.eq(res.consumed, [{ id: 'ing_willow_bark', qty: 1 }, { id: 'ing_bitter_root', qty: 1 },
    { id: 'ing_silverleaf', qty: 1 }, { id: 'ing_honey', qty: 1 }], '结算要扣的就是这四味各一份');
  t.eq(res.product, { id: 'item_daily_decoction', qty: 1 }, '成品是那一碗煎剂');
  t.eq(res.dimensions.material.samples, 3, '材料那一维统计了 3 段（预热没有材料，不算进来）');
  t.eq(res.dimensions.heat.samples, 4, '火候统计了 4 段');
  t.eq(res.dimensions.timing.samples, 4, '时机统计了 4 段');

  /* 结算计划：**只算不写**。扣什么、发什么只在这一处出现 */
  t.eq(B.settlementPlan(res).map((p) => [p.stat, p.delta]), [
    ['药材_ing_willow_bark', -1], ['药材_ing_bitter_root', -1],
    ['药材_ing_silverleaf', -1], ['药材_ing_honey', -1],
    ['药材_item_daily_decoction', 1],
  ], '结算计划：四味各扣一份、成品发一份');
  t.eq(B.settlementPlan(null), null, '没结果就没有结算计划');
  t.ok(!B.settlementPlan(res).some((p) => p.stat === '药材_ing_mustard_seed'),
    '没用的那味一根都不动');
}

t.section('引擎 · 手潮的一锅');

{
  const { be, e } = makeBrew();
  be.start();
  playSloppy(be, e, 50);

  const res = be.result();
  t.eq(res.completed, true, '手潮也照样做得完 —— 最低品质也是一条能走通的路');
  t.eq(res.quality.label, '欠佳', '分数低就是欠佳（实测 ' + res.score + ' 分）');
  t.ok(res.score < 60, '分数确实落在 60 以下');
  t.eq(res.stages.map((s) => s.materialScore), [null, 0, 0, 0], '下错药那三段材料分是 0');
  /* 火一直没添 —— 四段都没把火候留在目标区间里。带外最多也只拿得到带内下限
     那一档的七折，所以「不在带里」这条判据是 <= 0.7（不是「一定 0 分」）。 */
  t.eq(res.stages.map((s) => s.heatScore <= 0.7), [true, true, true, true],
    '火候四段全在目标区间之外，全按带外打折');
  t.eq(res.stages.map((s) => s.timingScore), [0, 0, 0, 0], '全按在最偏处，时机分是 0');
  t.eq(res.consumed.length, 4, '**但扣的还是方子上写的那四味各一份**');
  t.eq(res.consumed.map((c) => c.qty), [1, 1, 1, 1], '投错了不额外多扣 —— 扣料跟着方子走，不跟手的走');
  t.ok(!!res.product, '欠佳也有成品（只是品质差），不是「白做一场」');
  /* 剧情后果：最低品质**不**动别的数值 —— 不许因为熬坏了就让腿疾恶化 */
}

t.section('引擎 · 超时');

{
  const { be, e } = makeBrew();
  be.start();
  t.eq(be.stage.id, 'preheat', '第一段是预热');

  e.advance(4000);
  be.tick();
  t.eq(be.snapshot().remainingMs, 7000, '推了 4 秒，表上还剩 7 秒');
  t.eq(be.state, 'RUNNING', '还没到线');

  e.advance(20000);                                 // 一口气越过限时（切标签页就是这个形状）
  be.tick();
  t.eq(be.state, 'STAGE_RESULT', '越过限时：这一段自己结了，停在成绩屏上');
  t.eq(be.stageResult.timedOut, true, '成绩上记着「是超时结束的」');
  t.eq(be.stageResult.materialScore, null, '预热那一段本来就不考材料');
  t.eq(be.stageResult.picks, [], '一味药都没投（超时之前没投）');
  t.ok(be.stageResult.feedback.some((f) => f.dim === 'timing' && f.level === 'bad'),
    '反馈里明说了「时间到了」');

  t.eq(be.next().ok, true, '推一下走下一段 —— 超时不会把制作卡死');
  t.eq(be.stage.id, 'add_roots', '进了第二道工序');
  t.eq(be.snapshot().remainingMs, 12000, '新一段的表重新起');

  /* 把剩下三段全部放超时 */
  for (let i = 0; i < 3; i++) {
    e.advance(40000);
    be.tick();
    if (be.state === 'STAGE_RESULT') be.next();
  }
  const res = be.result();
  t.eq(res.completed, true, '四段全放超时，制作仍然走到了 COMPLETED');
  t.eq(res.stages.map((s) => s.timedOut), [true, true, true, true], '四段都记着超时');
  t.eq(res.reason, 'completed', '结果类型是「做完了」，不是别的');
  t.eq(res.consumed.length, 4, '超时也照样按方子扣料');
}

t.section('引擎 · 跳过');

{
  const { be } = makeBrew();
  be.start();
  const r = be.skip();
  t.eq(r.ok, true, 'RUNNING 里点跳过：认');
  const res = be.result();
  t.eq(res.skipped, true, '结果里记着是跳过的');
  t.eq(res.score, 60, '跳过按 60 分结算');
  t.eq(res.quality.label, '普通', '60 分落在普通那一档');
  t.ok(res.score < 90, '跳过拿不到最高品质');
  t.eq(res.consumed.length, 4, '跳过照样扣料 —— 不是「免费拿一份成品」');
  t.ok(!!res.product, '有成品，只是普通');
  t.eq(be.skip().ok, false, '已经结算过就不许再跳一次');
}

{
  const { be } = makeBrew();
  const r = be.skip();                              // READY 上直接跳
  t.eq(r.ok, true, '还没起火也能跳过（玩家不想玩这一小段）');
  t.eq(be.result().score, 60, '一样按 60 分算');
}

{
  const { be } = makeBrew(fullStock({ 药材_ing_honey: 0 }));
  const r = be.skip();
  t.eq(r.ok, false, '料不够时连跳都不认 —— 没米下锅就是没米下锅');
  t.eq(r.reason, 'no-materials', '理由还是没料');
  t.eq(be.state, 'READY', '停在 READY 上，等着界面把它引到「回主线」那条路');
}

t.section('引擎 · 连点与乱序');

{
  const { be } = makeBrew();
  be.start();
  t.eq(be.pick('ing_willow_bark').ok, false, '预热那一段没有药可投，点了也不认');
  t.eq(be.snapshot().picks.length, 0, '……也没记下这一下');

  be.confirm();                                     // 预热本来就不投药，直接结
  t.eq(be.state, 'STAGE_RESULT', '确认把这一段收了');
  be.next();
  t.eq(be.stage.id, 'add_roots', '进到要投药的那一段');

  t.eq(be.pick('ing_willow_bark').ok, true, '投第一味：柳树皮');
  t.eq(be.pick('ing_willow_bark').ok, true, '连点同一味：算一次错投（它顶的是第二格），不是第二次消耗');
  t.eq(be.pick('ing_bitter_root').reason, 'already-full', '这一段的格子满了，再点直接被拒');
  t.eq(be.picks.length, 2, '一共就记了两次投放');
  t.eq(be.confirm().ok, true, '确认收下这一段');
  t.eq(be.stageResult.materialScore, 0.5, '一格对一格错，这一段材料拿一半');

  t.eq(be.pick('ing_willow_bark').ok, false, '成绩屏上再点投药：不认');
  t.eq(be.holdHeat(true).ok, false, '成绩屏上再按添柴：不认');
  t.eq(be.confirm().ok, false, '成绩屏上再按确认：也不认（要走 next）');
}

{
  /* 没投完药就按确认：应当被拒，并且给出理由（界面拿它抖一下） */
  const { be } = makeBrew();
  be.start();
  be.confirm();
  be.next();
  const r = be.confirm();
  t.eq(r.ok, false, '一味都没投就按确认：拒');
  t.eq(r.reason, 'need-more-picks', '理由写着「还有药没下」');
  t.eq(r.left, 2, '并且说清楚还差几味');
  t.eq(be.state, 'RUNNING', '拒了之后这一段还开着，时间照走');
}

{
  /* 一串连点只结算一次 */
  const { be, e } = makeBrew();
  be.start();
  playSkilled(be, e, 50);
  const one = be.result();
  t.eq(one.completed, true, '先正常走完一锅');
  for (let i = 0; i < 8; i++) { be.next(); be.skip(); be.confirm(); be.holdHeat(true); be.pick('ing_honey'); }
  t.eq(be.result(), one, '成了之后再怎么点，结果对象还是同一个（不重算、不重发）');
  t.eq(be.state, 'COMPLETED', '状态也不会被点回去');
}

t.section('引擎 · 取消');

{
  const { be } = makeBrew();
  be.start();
  t.eq(be.cancel('closed').ok, true, '可以收摊（材料不够时走的就是它）');
  t.eq(be.state, 'CANCELLED', '状态进 CANCELLED');
  t.eq(be.result(), null, '取消没有结果对象');
  t.eq(B.settlementPlan(be.result()), null, '……也就算不出结算计划（一克料都不动）');
  t.eq(be.skip().ok, false, '取消之后不许再跳');
  t.eq(be.confirm().ok, false, '取消之后也不许再确认');
}

/* =====================================================================
   三、府邸账目与固定采购
   ===================================================================== */

t.section('府邸账目');

t.ok(!!PHARM, 'daily/story.json 里有 pharmacy 块（账目与固定采购的家）');
t.eq(PHARM.currency, '银币', '账面用的货币单位（暂定，原著里没有这一项）');
t.eq(PHARM.ledger.groups.map((g) => g.key),
  ['onetime', 'kitchen', 'wages', 'upkeep', 'medical'],
  '五栏：一次性 / 饮食与厨房 / 仆人薪酬 / 府邸维护 / 医疗与药材');
t.eq(Array.from(new Set(PHARM.ledger.groups.map((g) => g.key))).length, PHARM.ledger.groups.length,
  '每一栏的 key 不重复');

{
  const groups = PHARM.ledger.groups;
  const bad = [];
  for (const g of groups) {
    if (!g.label) bad.push(`${g.key} 没写 label`);
    if (!g.entries || !g.entries.length) bad.push(`${g.key} 是空的`);
    for (const en of g.entries || []) {
      if (!en.name) bad.push(`${g.key} 有一条没写名字`);
      if (!Number.isInteger(en.amount) || en.amount <= 0) bad.push(`${g.key}.${en.name} 的金额不是正整数`);
    }
  }
  t.empty(bad, '每一条支出都有名字、有金额、有类别，金额是正整数');

  const computed = groups.reduce(
    (sum, g) => sum + g.entries.reduce((s, en) => s + en.amount, 0), 0);
  t.eq(computed, PHARM.ledger.total, `总支出 = 各支出项目之和（${computed}）`);
  t.eq(PHARM.ledger.total, 820, '总支出就是正文里那一句写的数');
}

{
  /* 正文里那几个数**必须**跟数据对上 —— 两边各说各的才是最要命的 */
  const ledgerNode = story.nodes.find((n) => n.id === PHARM.ledger.node);
  t.ok(!!ledgerNode, '账册节点就在剧本里');
  const text = (ledgerNode.dialogues || []).map((d) => d.text).join('');

  const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const cn = (n) => {
    if (n < 10) return CN[n];
    if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '');
    return CN[Math.floor(n / 100)] + '百' + (n % 100 ? cn(n % 100) : '');
  };

  const groups = PHARM.ledger.groups;
  const sub = groups.map((g) => g.entries.reduce((s, en) => s + en.amount, 0));
  t.ok(text.indexOf(cn(sub[1])) >= 0, '正文里写着「饮食与厨房」那一栏的合计 ' + cn(sub[1]));
  t.ok(text.indexOf(cn(sub[2])) >= 0, '正文里写着「仆人薪酬」那一栏的合计 ' + cn(sub[2]));
  t.ok(text.indexOf(cn(sub[3])) >= 0, '正文里写着「府邸维护」那一栏的合计 ' + cn(sub[3]));
  t.ok(text.indexOf(cn(sub[4])) >= 0, '正文里写着「医疗与药材」那一栏的合计 ' + cn(sub[4]));
  t.ok(text.indexOf(cn(PHARM.ledger.total)) >= 0, '正文里写着总支出 ' + cn(PHARM.ledger.total));
  t.ok(text.indexOf('银币') >= 0, '正文里点明了单位');
  t.ok(text.indexOf('购置马匹') >= 0, '原来就有的那两笔（马匹）一字未动地留着');
  t.ok(text.indexOf('送入酒窖的酒') >= 0, '原来就有的那两笔（酒）一字未动地留着');
  t.ok(text.indexOf('你核对了一遍数目，又把账册合上。') >= 0,
    '原文那句收尾原样留着（只是挪到了新增内容之后）');
  t.ok(text.indexOf('药房') >= 0 && text.indexOf('蜂蜜') >= 0,
    '药房那一条点着名写了是哪几味（它就是固定采购的出处）');

  const lines = groups.reduce((n, g) => n + g.entries.length, 0);
  t.ok(lines >= 15, '账面上有十几条 —— 看得出府邸是**持续**在花钱（实测 ' + lines + ' 条）');
}

t.section('固定采购');

{
  const e = env(fullStock());
  const before = A.INGREDIENTS.map((it) => e.getStat(A.statOf(it.id)));

  const first = B.purchasePlan(PHARM, PHARM.ledger.node, e.getStat);
  t.eq(first.length, 1, '走到账册那一个节点：该结一笔');
  t.eq(first[0].id, 'purchase_pharmacy_d2', '采购记录有自己的 id');
  t.eq(first[0].amount, 96, '固定金额与账册上那一条一致');
  t.eq(first[0].flag, '旗_账册药材结算', '结算过没有，认的是这一面旗');
  t.eq(first[0].currency, '银币', '金额用的还是账面上那个单位');

  /* 界面层就是这么落地的：把 items 加进库存 + 落旗 */
  first[0].items.forEach((op) => e.put(op.stat, op.delta));
  e.put(first[0].flag, 1);

  const after = A.INGREDIENTS.map((it) => e.getStat(A.statOf(it.id)));
  t.eq(after, before.map((n, i) => (i === 4 ? n + 1 : n + 2)),
    '五味的库存各加：柳树皮 / 苦根片 / 银脉草 / 蜂蜜 各 +2，芥籽 +1（量要够熬，也要够试）');
  t.eq(after, [5, 5, 5, 5, 3], '发完之后是 5 / 5 / 5 / 5 / 3');
  t.eq(A.checkMaterials(RECIPE, e.getStat).ok, true, '发完料，这一剂怎么也够熬了');
  t.ok(after[0] >= 3, '就算操作错了再错，也远不至于把主线缺死');

  const second = B.purchasePlan(PHARM, PHARM.ledger.node, e.getStat);
  t.eq(second, [], '再翻一次账册：**一笔都不再发**（查看账本不是一次新的购买）');

  /* 转一圈回来 */
  t.eq(B.purchasePlan(PHARM, 'dy_d2_mo_hub', e.getStat), [],
    '别的节点上不结算 —— 认的是 purchase.node');
  t.eq(B.purchasePlan(null, PHARM.ledger.node, e.getStat), [], '没有 pharmacy 块就什么都不做');
  t.eq(B.purchasePlan({ purchases: PHARM.purchases }, PHARM.ledger.node, e.getStat), [],
    '旗亮着的时候，同一笔无论问多少遍都是空');
}

{
  /* 采购发的是**治病药材**那一套键，跟别家的数值不打架 */
  const ids = PHARM.purchases[0].items.map((it) => it.id);
  t.empty(ids.filter((id) => !A.itemById(id)), '采购清单里每一味都在材料目录里');
  t.empty(ids.filter((id) => !A.statOf(id).startsWith(A.STAT_PREFIX)),
    '发的都是治病药材那一栏的库存键');
  t.ok(PHARM.purchases.every((p) => p.settledFlag), '每一笔采购都写了「结算过没有」认哪面旗');
  t.ok(!('price' in PHARM.purchases[0]) && !('editable' in PHARM.purchases[0]),
    '采购里没有「可编辑 / 玩家定价」这类字段 —— 固定采购就是固定的');
}

/* =====================================================================
   四、存档
   ===================================================================== */

t.section('存档');

{
  /* 库存与两面旗都住在 stats 里 —— snapshot() 存的就是 stats，
     所以「她此刻手上有几味药」天然跟着存档走，不用给引擎加字段。 */
  const e = new StoryEngine(story);
  e.start();
  e.enterNode(PHARM.ledger.node);
  const plan = B.purchasePlan(PHARM, PHARM.ledger.node, readOf(e));
  plan[0].items.forEach((op) => e.setStat(op.stat, e.getStat(op.stat) + op.delta));
  e.setStat(plan[0].flag, 1);

  const snap = JSON.parse(JSON.stringify(e.snapshot()));
  t.eq(snap.stats['药材_ing_willow_bark'], 5, '存档里带着柳树皮的份数');
  t.eq(snap.stats['旗_账册药材结算'], 1, '……也带着「这一笔结过了」');

  const back = new StoryEngine(story);
  back.restore(snap);
  t.eq(back.getStat('药材_ing_willow_bark'), 5, '读档读回来还是 5 份');
  t.eq(back.getStat('旗_账册药材结算'), 1, '旗也读回来了');
  t.eq(B.purchasePlan(PHARM, PHARM.ledger.node, readOf(back)), [],
    '读档之后再走到账册那里：不会再发一份');
}

{
  /* 旧存档（这一轮之前存的）里根本没有这些键 —— restore() 先铺 initialStats，
     缺的自动补上初始值，不能因为多了一套库存就把老档读坏。 */
  const old = {
    version: 1, nodeId: 'dy_d2_mo_hub', pov: '奥布里',
    stats: { 西比拉_好感: 12, 西比拉_警惕: 60 },
    lineIndex: 0, history: [], visited: [], showStats: false,
  };
  const e = new StoryEngine(story);
  e.restore(old);
  t.eq(e.getStat('西比拉_好感'), 12, '老存档里有的数值照旧用老存档的');
  t.eq(e.getStat('药材_ing_willow_bark'), 3, '老存档里没有的库存补上初始值（不炸、不是 undefined）');
  t.eq(e.getStat('旗_账册药材结算'), 0, '旗补成 0 = 还没结过 —— 走到账册时照常发料');
  t.eq(B.purchasePlan(PHARM, PHARM.ledger.node, readOf(e)).length, 1, '所以老档也能正常领到那一笔');
}

{
  /* 库存落在 [0, 99] 里：出了 bug 也不可能把药做成负数 */
  const e = new StoryEngine(story);
  const name = A.statOf('ing_willow_bark');
  e.setStat(name, -50);
  t.eq(e.getStat(name), 0, '往负里写会被区间夹回 0');
  e.setStat(name, 5000);
  t.eq(e.getStat(name), A.STOCK_MAX, '往上也夹得住');
  t.eq(act1.config.statRanges[name], [0, 99], '区间就写在第一幕的 config.statRanges 里');
}

/* =====================================================================
   五、物品资源
   ===================================================================== */

t.section('物品资源');

const ICON_KEYS = ['item_willow_bark', 'item_bitter_root', 'item_silverleaf',
  'item_honey', 'item_mustard_seed', 'item_daily_decoction'];

t.eq(A.INGREDIENTS.concat(A.PRODUCTS).map((it) => it.icon).sort(), ICON_KEYS.slice().sort(),
  '目录里六件物品各指向一个图标 key（图标是在数据里映射的，不硬编码在按钮上）');
t.empty(ICON_KEYS.filter((k) => !I.has(k)), '六个 key 在 item-icons.js 里都画得出来');
t.empty(ICON_KEYS.filter((k) => !story.art.assets[k]), '六个 key 都在素材表里登记过');

{
  /* **占位必须明说**：这一轮一张正式图都没有，谁也别把它当成品 */
  const stillPlaceholder = ICON_KEYS.filter((k) => I.isPlaceholder(k, story.art.assets));
  t.eq(stillPlaceholder.length, 6, '六张全是占位 —— 正式图这一轮没做');
  t.eq(I.placeholderList(story.art.assets).length, 6, 'placeholderList() 报出来的也是六张');
  t.ok(!!I.PLACEHOLDER_TAG, '占位图上有一枚角标，明写着「' + I.PLACEHOLDER_TAG + '」');
  t.empty(ICON_KEYS.filter((k) => (story.art.assets[k] || {}).src),
    '六条素材里一条 src 都没写 = item-icons.js 一张都不会当成正式图');
  t.eq(story.art.assets.item_honey.placeholder, true, '素材条目上明写着 placeholder: true');
  t.eq(story.art.assets.item_honey.kind, 'item', 'kind 标成 item（不是 background / portrait）');

  /* 作者交图之后要有明确的一步可走 */
  const withArt = { item_honey: { src: '../images/item_honey.webp' } };
  t.eq(I.isPlaceholder('item_honey', withArt), false, '补上 src 的那一天，占位就自动让位');
  t.eq(I.urlOf('item_honey', withArt), '../images/item_honey.webp', '用的就是 src 里那条路径');
  t.eq(I.urlOf('item_honey', story.art.assets), '', '没写 src 时不拼路径 —— 不去试一个必定 404 的地址');
}

{
  const marks = ICON_KEYS.map((k) => I.svgMarkup(k));
  t.ok(marks.every((m) => m.indexOf('<svg') >= 0), '六张都画得出一段 SVG');
  t.eq(new Set(marks).size, 6, '六张图案两两不同（不然材料栏里认不出谁是谁）');
  t.eq(I.svgMarkup('不存在的 key'), '', '没有这一张就给空串，不炸');
  /* 占位图不许动到人物立绘那一套资源 */
  t.empty(Object.keys(story.art.assets).filter((k) => k.indexOf('chr_') === 0 || k.indexOf('full_') === 0)
    .filter((k) => k.indexOf('item_') === 0), '物品图标没有混进立绘的命名里');
}

/* 素材表跟着拼好的剧本走（日常层写的那六条，composeStories 之后还在） */
t.ok(!!story.art.assets.item_willow_bark, '拼完之后素材表里还有这六条（写在 daily 那一份里也带得出来）');
t.ok(!!story.pharmacy, '拼完之后 pharmacy 块也在（引擎不认识它，只是别把它弄丢）');
t.eq(story.pharmacy.ledger.total, PHARM.ledger.total, '拼过来的是同一份账目');
t.eq(story.pharmacy.brew.node, 'dy_d2_ev_brew_e', '熬药的入口写在数据里，不是写死在界面代码里');
t.eq(story.pharmacy.brew.recipe, RECIPE.id, '熬的是目录里那张方子');

/* =====================================================================
   六、界面层（无头）
   ---------------------------------------------------------------------
   用 dom-stub 把 brew-ui.js 真跑起来。它是个 IIFE，认的是全局的 window /
   document，所以先把替身挂上去再 require —— 一个进程里只装一次。
   ===================================================================== */

t.section('界面层');

const dom = loadDom();
const uiApi = require(path.join(ROOT, 'act1', 'ui.js'));
const engine = new StoryEngine(story);
const ui = new uiApi.Act1UI(engine, { doc: dom.doc, win: dom.win });
ui.mount();

/* 时钟捏在自己手里：引擎那边的 now() 读的就是 Date.now */
const realNow = Date.now;
let clock = 1000000;
Date.now = () => clock;

/* 浏览器里这几个模块是同一张 window 上的邻居（四个 <script> 挨着加载）。
   Node 里它们是各自的模块对象，UMD 挂到了 globalThis 上 —— 所以搬一份到
   代身 window 上，摆成浏览器里那个样子，再引界面层。 */
dom.win.AlchemyData = A;
dom.win.BrewEngine = B;
dom.win.ItemIcons = I;
dom.win.act1 = { engine, ui, story };
global.window = dom.win;
global.document = dom.doc;
require(path.join(ROOT, 'daily', 'brew-ui.js'));

const BrewUI = dom.win.BrewUI;
t.ok(!!BrewUI, 'brew-ui.js 挂上了 window.BrewUI（act1 一就位它就自己装好）');
t.ok(!!BrewUI.nodes(), '浮层的 DOM 全是运行时造出来的');

const panel = (key) => BrewUI.nodes()[key];
const click = (el) => { if (!el) throw new Error('click: 元素不存在'); return el.dispatch('click', {}); };
const stock = () => A.INGREDIENTS.map((it) => engine.getStat(A.statOf(it.id)));

{
  /* ---- 走到账册：固定采购当场结掉 ---- */
  t.eq(stock(), [3, 3, 3, 3, 2], '开档时是初始库存');
  engine.enterNode(PHARM.ledger.node);
  BrewUI.tick();
  t.eq(stock(), [5, 5, 5, 5, 3], '走到账册那一个节点：料发下来了');
  t.eq(engine.getStat('旗_账册药材结算'), 1, '同时落了旗');

  engine.enterNode('dy_d2_af_hub');
  BrewUI.tick();
  engine.enterNode(PHARM.ledger.node);
  BrewUI.tick();
  t.eq(stock(), [5, 5, 5, 5, 3], '来回进出账册：一份都不多发');
}

{
  /* ---- 接在熬药那一场：**最后一句之前** ---- */
  const BREW_NODE = PHARM.brew.node;
  t.eq(BREW_NODE, 'dy_d2_ev_brew_e', '熬药的入口还是原来那个节点');

  engine.enterNode(BREW_NODE);
  BrewUI.tick();
  const lines = engine.visibleLines().length;
  t.eq(lines, 5, '正文还是五句');
  t.eq(BrewUI.shouldOpenHere(), false, '刚进节点：一句都还没播，不摊浮层');

  /* 一句一句推到最后一句**之前** */
  for (let i = 0; i < lines - 2; i++) { engine.advance(); BrewUI.tick(); }
  t.eq(engine.lineIndex, lines - 2, '推到第四句为止');
  t.eq(BrewUI.shouldOpenHere(), false, '第四句刚出来时不摊浮层');

  engine.advance();                                  // 第四句上屏
  BrewUI.tick();
  t.eq(engine.lineIndex, lines - 1, '现在停在「最后一句还没播」的那一点上');
  t.eq(BrewUI.shouldOpenHere(), true, '就在这一下摊开熬药浮层');

  const before = engine.lineIndex;
  dom.fireKey(' ');
  t.eq(BrewUI.isActive(), true, '空格把那口锅推开了');
  t.eq(engine.lineIndex, before, '**键盘没漏到 ui.js 去** —— 最后一句还等着');
  t.eq(BrewUI.readyPhase(), 'open', '这一场记成「已经在演了」');

  /* 界面上该有的几块 */
  t.ok(!!panel('title').textContent, '画了方子名');
  t.ok(!!panel('desc').textContent, '画了方子简介');
  t.eq(panel('mats').children.length, A.INGREDIENTS.length, '材料栏把五味药都摆出来了');
  t.eq(panel('manualList').children.length, RECIPE.stages.length, '手册里四道工序一条不落');
  t.eq(panel('readyNeed').children.length, 4, '「要用到的药」列出四味');
  t.ok(panel('ready').style.display !== 'none', '先开在「照旧方煎」那一屏上');
  t.ok(panel('meta').textContent.indexOf('分钟') >= 0, '小字里写着方子的时限与耗时');

  /* 材料栏里那几张小图现在是占位，而且**带标记** */
  const arts = panel('mats').getElementsByClassName('dy-brew-art');
  t.eq(arts.length, A.INGREDIENTS.length, '每一味药都配了一张图');
  t.eq(arts.map((a) => a.getAttribute('data-art')), new Array(A.INGREDIENTS.length).fill('placeholder'),
    '六张现在全是占位（data-art="placeholder"）');
  t.eq(arts[0].getElementsByClassName('dy-brew-art-tag').length, 1, '占位图上挂着那枚「占位」角标');
}

{
  /* ---- 手册：翻开**不停表** ---- */
  dom.fireKey('m');
  t.eq(BrewUI.isManualOpen(), true, 'M 能把手册翻出来');
  t.eq(BrewUI.isActive(), true, '翻手册不会把这一锅关掉');
  t.eq(panel('manual').style.display, 'flex', '手册摊开了');
  dom.fireKey('Escape');
  t.eq(BrewUI.isManualOpen(), false, 'Esc 合上手册');
  t.eq(BrewUI.isActive(), true, '……但人还在锅前面（Esc 没有漏到系统菜单去）');
}

{
  /* ---- 起火 → 跑几帧 → 跳过 → 结算 ---- */
  const before = stock();
  click(panel('readyStart'));
  t.eq(BrewUI.engine().state, 'RUNNING', '点「起火」就进 RUNNING');

  for (let i = 0; i < 20; i++) { clock += 50; dom.runTimers(); }
  t.ok(BrewUI.engine().elapsedMs() >= 1000, '帧一跑，表就按真实时间在走');
  t.ok(panel('timerText').textContent.indexOf('秒') >= 0, '倒计时画在屏幕上');

  click(panel('skipBtn'));
  t.eq(BrewUI.engine().state, 'COMPLETED', '点跳过：这一锅结掉');
  t.ok(panel('resultBox').style.display !== 'none', '浮层翻到结算那一片');
  t.ok(panel('resultTitle').textContent.length > 0, '结算上写着品质');
  t.ok(panel('resultRows').children.length >= 5, '结算里把那几行都摆出来（总分 / 三维 / 用掉的药 / 收下）');

  const after = stock();
  t.eq(after, before.map((n, i) => (i === 4 ? n : n - 1)), '结算扣了四味各一份（芥籽没动）');
  t.eq(engine.getStat(A.statOf('item_daily_decoction')), 1, '成品发下来了，一件');
  t.eq(engine.getStat('旗_熬药结算'), 1, '落了「这一锅结过了」的旗');

  click(panel('resultClose'));
  click(panel('resultClose'));
  click(panel('resultClose'));
  t.eq(stock(), after, '连点「收好」不会重复结算');
  t.eq(engine.getStat(A.statOf('item_daily_decoction')), 1, '成品还是一份');
}

{
  /* ---- 浮层关掉之后，输入还给剧情 ---- */
  t.eq(BrewUI.isActive(), false, '浮层收了');
  const before = engine.lineIndex;
  dom.fireKey(' ');
  t.eq(engine.lineIndex, before + 1, '空格照常推进 —— 最后一句接着播');
  t.eq(engine.node.id, PHARM.brew.node, '还在原来那个节点上，剧情顺序没被打乱');
}

{
  /* ---- 再来一次也不会重复 ----
     （先离开这个节点再回来：一场戏只在**进门**那一次演，「一直在原地」
       是另一种情形，不该混在一起测） */
  engine.enterNode('dy_d2_af_hub');
  BrewUI.tick();
  engine.enterNode(PHARM.brew.node);
  BrewUI.tick();
  for (let i = 0; i < 4; i++) { engine.advance(); BrewUI.tick(); }
  t.eq(BrewUI.shouldOpenHere(), false, '旗已经亮了：读档跳回这一句也不会再演一遍');
  const before = engine.lineIndex;
  dom.fireKey(' ');
  t.eq(BrewUI.isActive(), false, '按空格不会把浮层又推出来');
  t.eq(engine.lineIndex, before + 1, '而是照常推进剧情');
}

{
  /* ---- 料不够：有一条明确的出路，不卡死 ---- */
  A.INGREDIENTS.forEach((it) => engine.setStat(A.statOf(it.id), 0));
  engine.setStat('旗_熬药结算', 0);
  engine.enterNode('dy_d2_af_hub');
  BrewUI.tick();
  engine.enterNode(PHARM.brew.node);
  BrewUI.tick();
  for (let i = 0; i < 4; i++) { engine.advance(); BrewUI.tick(); }
  t.eq(BrewUI.shouldOpenHere(), true, '料不够也照样摊开 —— 得让玩家看见「缺什么」');
  dom.fireKey(' ');
  t.eq(BrewUI.isActive(), true, '浮层开着');
  t.ok(panel('readyTitle').textContent.indexOf('不够') >= 0, '开在「手边的药不够」那一屏上');
  t.ok(panel('readyBody').textContent.indexOf('柳树皮') >= 0, '缺口里点着名（缺哪几味）');
  t.eq(panel('readyStart').disabled, true, '起火那颗是灰的');
  t.eq(panel('readySkip').disabled, false, '**出路那颗必须是亮的**（不然人锁在浮层里）');
  t.ok(panel('readySkip').textContent.indexOf('回房去') >= 0, '那颗写着「回房去」');

  const held = { willow: engine.getStat(A.statOf('ing_willow_bark')), flag: engine.getStat('旗_熬药结算') };
  click(panel('readySkip'));
  t.eq(BrewUI.isActive(), false, '按了就回主线');
  t.eq(engine.getStat(A.statOf('ing_willow_bark')), held.willow, '没料可熬时一克都不扣');
  t.eq(engine.getStat('旗_熬药结算'), held.flag, '旗也不动（往后真凑齐了还能熬）');

  const line = engine.lineIndex;
  dom.fireKey(' ');
  t.eq(engine.lineIndex, line + 1, '剧情照常往下走 —— 熬不成也绝不断线');
}

Date.now = realNow;

/* 界面不许往页面里加元素：act1/index.html 里一个 id 都没多 */
{
  const html = fs.readFileSync(path.join(ROOT, 'act1', 'index.html'), 'utf8');
  const ids = new Set();
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  t.empty(Array.from(ids).filter((id) => id.indexOf('brew') >= 0 || id.indexOf('dy-') >= 0),
    'index.html 里没有为熬药加过 id（DOM 全是运行时造的）');
  t.ok(html.indexOf('../daily/brew-ui.js') >= 0, '页面上挂上了 brew-ui.js');
  t.ok(html.indexOf('../daily/brew.css') >= 0, '也挂上了 brew.css');
  t.ok(html.indexOf('../daily/alchemy.js') >= 0, '目录 / 引擎也排上了队');

  /* CSS 里混进一个全角字符（比如 ＃ 或 ７）不会报错，只会让**那一条规则静默失效**。
     注释里写中文是正经事，所以先把注释剥掉，再查剩下那部分语法。 */
  const css = fs.readFileSync(path.join(ROOT, 'daily', 'brew.css'), 'utf8');
  const syntaxOnly = css.replace(/\/\*[\s\S]*?\*\//g, '');
  t.eq(syntaxOnly.match(/[＀-￯一-鿿]/g) || [], [],
    'brew.css 的语法部分没有全角字符（那会让那一条规则静默失效）');
}

/* =====================================================================
   七、回归：别的东西没被动过
   ===================================================================== */

t.section('回归 · 别的东西没被动过');

{
  t.eq(act1.nodes.filter((n) => n.id === 'dy_d2_ev_brew_e').length, 0,
    '熬药节点住在日常层，不在第一幕里');
  const brewNode = story.nodes.find((n) => n.id === PHARM.brew.node);
  t.eq(brewNode.dialogues.length, 5, '熬药那一场的正文还是五句，一句没改');
  t.ok(!brewNode.choices, '**没有给它加任何选项** —— 不新增影响主线的必选分支');
  t.eq(brewNode.next, 'dy_d2_ni_end_e', '结束之后照旧回 dy_d2_ni_end_e');
  t.ok(!!brewNode.next, '出口仍在 —— 熬药失败 / 跳过都拦不住剧情');
  /* 「火候」不算 —— 那是作者原文里本来就有的词（「旁边标注的火候」）。
     这里挡的是**玩法**那一路的词：分数 / 品质 / 评分 / 倒计时 / 进度条。 */
  const jargon = ['分数', '品质', '评分', '倒计时', '进度条', '材料与顺序', '阶段'];
  const bad = brewNode.dialogues.map((d) => d.text)
    .filter((x) => jargon.some((w) => x.indexOf(w) >= 0));
  t.eq(bad, [], '玩法那些词一个都没写进正文（正文还是那五句）');
}

{
  /* 库存那一类数值不上面板：面板只列 statOrder 里那四项 */
  const e = new StoryEngine(story);
  t.empty(e.statPanel().filter((x) => A.isInventoryStat(x.name)).map((x) => x.name),
    '「内心」面板不会把药材列出来（statOrder 是显式写的四项）');
  t.eq(e.statPanel().length, 4, '面板还是四项');
}

{
  /* 面板上那几项数值也没被熬药碰到（熬药的库存是另一套 key） */
  const e = new StoryEngine(story);
  const before = JSON.parse(JSON.stringify(e.stats));
  const plan = B.settlementPlan({ completed: true, consumed: A.requiredMaterials(RECIPE), product: RECIPE.product });
  plan.forEach((op) => e.setStat(op.stat, e.getStat(op.stat) + op.delta));
  const touched = Object.keys(e.stats).filter((k) => e.stats[k] !== before[k]);
  t.eq(touched.sort(), ['药材_ing_bitter_root', '药材_ing_honey', '药材_ing_silverleaf',
    '药材_ing_willow_bark', '药材_item_daily_decoction'].sort(),
    '熬药只动药材那一栏，别人的数值一根汗毛都没碰');
}

t.done();
