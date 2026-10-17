/* =====================================================================
   熬药 · 物品目录与药方（纯数据 + 纯函数：不碰 DOM，也不碰 Node）
   ---------------------------------------------------------------------
   这一份只回答三个问题：

     1. **世界上有哪几味药、它们长什么样**（INGREDIENTS / PRODUCTS / ITEMS）
     2. **有哪几张方子、每张方子怎么熬**（RECIPES）
     3. **分数算什么档**（QUALITY_TIERS / qualityOf）

   制作过程本身不在这里 —— 那是 daily/brew.js（状态机、判定、结算）。
   界面在 daily/brew-ui.js（DOM 与按键）。三份的分工与 act1 那边一样：
   **数据 → 引擎 → 渲染**。

   =====================================================================
   一、库存住在哪儿：stats
   ---------------------------------------------------------------------
   引擎的 snapshot() 只存 nodeId + stats + lineIndex，仓库里没有独立的背包系统。
   所以「治病药材库存」就用**引擎自己的数值表**记 —— 每一味药一项，值是份数。
   这一处借用是有意为之，也是 CLAUDE.md 里记着的那笔技术债：
   flag（0/1 的记事标记）与真正的数值现在共用一个 stats 字典。

   好处是白拿三件事，不用动 act1/engine.js 的存档、也不用动 server.js 的
   校验白名单：
     · 存档 / 读档天然带上库存（snapshot 存的就是 stats）
     · 服务器校验天然认（statLabels / statRanges 里登记过就放行）
     · 旧存档天然兼容（restore() 先铺 initialStats，缺的键自动补上初始值）

   **逻辑 ID 与库存键分开**：item 的 id 是 ing_willow_bark，库存键是
   药材_ing_willow_bark（statOf() 拼出来的）。显示名只用于给人看，
   任何判断都不许拿它当身份。

   =====================================================================
   二、为什么不许别人随便动这份库存
   ---------------------------------------------------------------------
   这几味药是「治病药材」：只由固定采购发放（daily/story.json 的 pharmacy 块）、
   只在熬药结算时扣除。将来真做自由炼金系统时，它要用的是**另一套**
   通用材料库存 —— 不能拿这份来抵。medical: true 就是给未来的那个开关。
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlchemyData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 库存键的前缀。**所有**读写药材份数的地方都得走 statOf()，
     不许在这里之外拼字符串 —— 改前缀只该改这一个常量。 */
  const STAT_PREFIX = '药材_';

  function statOf(itemId) {
    return STAT_PREFIX + String(itemId || '');
  }

  function isInventoryStat(statName) {
    return String(statName || '').indexOf(STAT_PREFIX) === 0;
  }

  /** 库存键 → 物品 id。不是库存键就给空串。 */
  function itemIdOfStat(statName) {
    const s = String(statName || '');
    return isInventoryStat(s) ? s.slice(STAT_PREFIX.length) : '';
  }

  /* ---------------------------------------------------------------------
     药材。顺序就是「材料栏」里的排列顺序（先用的排前面）。
     —— 这五味与它们的分工是**游戏设定**，不是历史医学配方；界面与文案
        都不该把它说成现实里管用的东西。
     --------------------------------------------------------------------- */
  const INGREDIENTS = [
    {
      id: 'ing_willow_bark',
      name: '柳树皮',
      desc: '深灰褐色的树皮条，干得卷起来了。掰开时有一点涩味。',
      icon: 'item_willow_bark',
      kind: 'bark',
      medical: true,
      usage: '第一剂调养煎剂 · 先下',
    },
    {
      id: 'ing_bitter_root',
      name: '苦根片',
      desc: '淡褐色的根茎切片，断面能看见一层层的纤维。',
      icon: 'item_bitter_root',
      kind: 'root',
      medical: true,
      usage: '第一剂调养煎剂 · 随柳树皮下',
    },
    {
      id: 'ing_silverleaf',
      name: '银脉草',
      desc: '灰绿色的叶片，叶脉发白。揉过之后手上留着一股草腥。',
      icon: 'item_silverleaf',
      kind: 'leaf',
      medical: true,
      usage: '第一剂调养煎剂 · 根皮之后下',
    },
    {
      id: 'ing_honey',
      name: '蜂蜜',
      desc: '一小罐琥珀色的蜜，罐口结着一圈干掉的蜜壳。',
      icon: 'item_honey',
      kind: 'food',
      medical: true,
      usage: '第一剂调养煎剂 · 收药时下',
    },
    {
      id: 'ing_mustard_seed',
      name: '芥籽',
      desc: '一小把红褐色的种子，粒小、圆，闻着冲。',
      icon: 'item_mustard_seed',
      kind: 'seed',
      medical: true,
      usage: '现下不用 —— 备着的另一味',
    },
  ];

  /* ---------------------------------------------------------------------
     成品。熬出来的东西不进「药材」那一栏的口径里，但一样用 stats 记份数
     （产品也是物品，statOf 一套到底）。
     --------------------------------------------------------------------- */
  const PRODUCTS = [
    {
      id: 'item_daily_decoction',
      name: '日常调养煎剂',
      desc: '深色的一碗药汤，还温着。表面上浮着一点细沫。',
      icon: 'item_daily_decoction',
      kind: 'decoction',
      medical: true,
      usage: '奥布里每晚要喝的那一碗',
    },
  ];

  /* 目录：按 id 查物品（药材与成品都在里面）。 */
  const ITEMS = {};
  INGREDIENTS.concat(PRODUCTS).forEach((it) => { ITEMS[it.id] = it; });

  function itemById(id) {
    return ITEMS[id] || null;
  }

  /** 某一味药最多能存几份。区间写在 act1/story.json 的 config.statRanges 里
      （药材_… 一律 [0, 99]），这里只是同一个数字的另一处引用，给上面板用。 */
  const STOCK_MAX = 99;

  /* =====================================================================
     药方
     ---------------------------------------------------------------------
     一张方子 = 一串**阶段**（ProcessStageDefinition）。每个阶段自己带：
       限时（现实秒） / 火候的目标区间与升降速度 / 进度条扫一次的周期与命中区
       / 这一步要投哪几味药、什么顺序
     加一张新方子 = 往 RECIPES 里加一条，引擎与界面一行都不用改。
     ===================================================================== */

  /* 火候与进度条这两套判定的兜底参数。具体数值优先取阶段自己的配置。 */
  const DEFAULT_JUDGE = {
    /** 火候落在目标带正中给 1 分，落在带边上给 0.7，出了带按这个斜率掉到 0 */
    heatBandFloor: 0.7,
    /** 进度条指针偏出命中区多少（占整条的比例）就算彻底错过 */
    timingFalloff: 0.22,
  };

  const RECIPES = {
    recipe_daily_decoction_01: {
      id: 'recipe_daily_decoction_01',
      name: '日常调养煎剂',
      category: 'medical',
      desc: '奥布里每晚照旧方煎的那一剂。四味药、四道工序，先武后文，最后以蜜收。',
      /** 游戏内固定耗时（分钟）。**与玩家操作快慢无关** —— 现实里手快手慢，
          这锅药都要熬这么久。界面上照抄这一个数。 */
      durationMin: 30,
      /** 评分权重（合计 100）。缺哪一维，剩下的按比例重新归一。 */
      weights: { material: 40, heat: 30, timing: 30 },
      /** 中途跳过（「交给厨房代煎」）按这一档结算 —— 有成品，但只是普通。 */
      skipScore: 60,
      /** 方子要的料，按投放顺序汇总一遍。**是 stages 的汇总，不是第二份真值** ——
          自检（tests/brew.test.cjs）会拿它跟各阶段的材料表对账。 */
      requires: [
        { id: 'ing_willow_bark', qty: 1 },
        { id: 'ing_bitter_root', qty: 1 },
        { id: 'ing_silverleaf', qty: 1 },
        { id: 'ing_honey', qty: 1 },
      ],
      product: { id: 'item_daily_decoction', qty: 1 },
      manualIntro: '册子上写着：先武后文，四道工序。次序错了，药性就散了。',
      stages: [
        {
          id: 'preheat',
          label: '预热',
          brief: '空锅上炉，把火候提到该到的地方。',
          manual: '炉子先烧起来，火候要停在册子划的那一段里，再封盖。',
          timeLimitMs: 11000,
          heat: { start: 18, band: [45, 70], decayPerSec: 7, risePerSec: 28 },
          sweep: { periodMs: 2800, band: [0.44, 0.62] },
          confirmLabel: '封上炉盖',
          materials: null,
        },
        {
          id: 'add_roots',
          label: '加入根皮材料',
          brief: '按册子上的次序，把两味根皮投下去。',
          manual: '先柳树皮，再苦根片 —— 反了就要重来。',
          timeLimitMs: 12000,
          heat: { start: 40, band: [52, 74], decayPerSec: 7, risePerSec: 28 },
          sweep: { periodMs: 2400, band: [0.40, 0.56] },
          confirmLabel: '投入',
          materials: {
            order: ['ing_willow_bark', 'ing_bitter_root'],
            hint: '先下柳树皮，再下苦根片。',
          },
        },
        {
          id: 'add_silverleaf',
          label: '加入银脉草',
          brief: '水色转深了，这时候下银脉草。',
          manual: '银脉草要等根皮出味之后再下，火不能大。',
          timeLimitMs: 10000,
          heat: { start: 50, band: [58, 80], decayPerSec: 8, risePerSec: 28 },
          sweep: { periodMs: 2000, band: [0.38, 0.52] },
          confirmLabel: '投入',
          materials: {
            order: ['ing_silverleaf'],
            hint: '下银脉草。',
          },
        },
        {
          id: 'finish',
          label: '收药',
          brief: '撤火，用蜜收住这一锅。',
          manual: '收药时火要压下去，末了添一勺蜜。',
          timeLimitMs: 12000,
          heat: { start: 55, band: [38, 60], decayPerSec: 9, risePerSec: 28 },
          sweep: { periodMs: 2200, band: [0.42, 0.58] },
          confirmLabel: '添蜜收药',
          materials: {
            order: ['ing_honey'],
            hint: '末段添蜜。',
          },
        },
      ],
    },
  };

  function recipeById(id) {
    return RECIPES[id] || null;
  }

  function recipeList() {
    return Object.keys(RECIPES).map((k) => RECIPES[k]);
  }

  /* ---------------------------------------------------------------------
     一张方子总共要哪几味、各几份。按 stages 现算（不是读 requires），
     这样往阶段里加一味药，需求清单自己就跟着变了。
     --------------------------------------------------------------------- */
  function requiredMaterials(recipe) {
    if (!recipe) return [];
    const order = [];
    const need = {};
    for (const st of recipe.stages || []) {
      const m = st.materials;
      if (!m || !m.order) continue;
      for (const id of m.order) {
        if (need[id] === undefined) { need[id] = 0; order.push(id); }
        need[id] += 1;
      }
    }
    return order.map((id) => ({ id, qty: need[id] }));
  }

  /**
   * 料够不够。
   *
   * @param {object} recipe
   * @param {function(string):number} getStat  读一份库存（通常是 engine.getStat）
   * @returns {{ok:boolean, missing:Array<{id,name,need,have}>}}
   */
  function checkMaterials(recipe, getStat) {
    const read = typeof getStat === 'function' ? getStat : () => 0;
    const missing = [];
    for (const req of requiredMaterials(recipe)) {
      const have = Number(read(statOf(req.id))) || 0;
      if (have < req.qty) {
        missing.push({
          id: req.id,
          name: (ITEMS[req.id] || {}).name || req.id,
          need: req.qty,
          have,
        });
      }
    }
    return { ok: missing.length === 0, missing };
  }

  /** 材料栏要用的一份清单：每一味药的名称 / 图标 / 现存量 / 这一锅要几份。 */
  function inventoryRows(recipe, getStat) {
    const read = typeof getStat === 'function' ? getStat : () => 0;
    const need = {};
    requiredMaterials(recipe).forEach((r) => { need[r.id] = r.qty; });
    return INGREDIENTS.map((it) => ({
      id: it.id,
      name: it.name,
      desc: it.desc,
      icon: it.icon,
      kind: it.kind,
      have: Number(read(statOf(it.id))) || 0,
      need: need[it.id] || 0,
      used: !!need[it.id],
    }));
  }

  /* =====================================================================
     品质分档
     ---------------------------------------------------------------------
     90–100 优秀 / 75–89 良好 / 60–74 普通 / <60 欠佳。
     阈值只在这一处出现 —— 要调档，改这里，别去改引擎。
     ===================================================================== */
  const QUALITY_TIERS = [
    { key: 'excellent', label: '优秀', min: 90 },
    { key: 'good', label: '良好', min: 75 },
    { key: 'fair', label: '普通', min: 60 },
    { key: 'poor', label: '欠佳', min: 0 },
  ];

  function qualityOf(score) {
    const s = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    for (const tier of QUALITY_TIERS) {
      if (s >= tier.min) return { key: tier.key, label: tier.label, min: tier.min };
    }
    return { key: 'poor', label: '欠佳', min: 0 };
  }

  return {
    STAT_PREFIX, STOCK_MAX, DEFAULT_JUDGE,
    INGREDIENTS, PRODUCTS, ITEMS, RECIPES, QUALITY_TIERS,
    statOf, isInventoryStat, itemIdOfStat, itemById,
    recipeById, recipeList, requiredMaterials, checkMaterials, inventoryRows,
    qualityOf,
  };
});
