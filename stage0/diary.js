/* =====================================================================
   日记本的**规则**（纯逻辑：不碰 DOM，也不碰 Node）
   ---------------------------------------------------------------------
   stage0/stage0.js（浏览器）和 stage0/walkthrough.cjs（走查）都 require 这一份，
   所以「今天该记哪几条」这句话只有一个实现，改一处两边都动。

   设计见 stage0/日记系统设计.md v3.1。这里只重复最要紧的一条：

     静态那一半在选项上 —— choice.diary，一个固定字符串，只读。
     运行时那一半在 stats 里 —— 那几个「记录」旗，会被改、会被存档。
     一条记事成不成立，就看**这个选项写的记录旗，此刻是不是全都对得上**。

     一个时段可以记多条（v3.2）：先按时段（早晨→中午→午后→夜晚），
     同一时段里再按**她今天走过的先后**接起来 —— 见下面的 collect()。
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Stage0Diary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 1;

  /* HUD 左上角「第 X 天」里的那个天数。现在只有一天，先占位 ——
     等接上真正的时间系统，把这里换掉就行（别的地方都不用动）。 */
  const DAY_PLACEHOLDER = 'X';

  /* 一天里的四个时段。**数组顺序就是日记里事件的排列顺序**。
     hub 是那个时段的菜单节点 —— 「这条记事属于哪个时段」全靠它推出来。 */
  const SLOTS = [
    { hub: 'h_morning', label: '早晨' },
    { hub: 'h_noon', label: '中午' },
    { hub: 'h_afternoon', label: '午后' },
    { hub: 'h_night', label: '夜晚' },
  ];

  /* 「记录」那一类数值的前缀。它们不是好感那种真数值，是 0/1 的记事旗
     （statLabels 里一律叫「记录 · …」）。日记靠它们判断「今天记不记得这一条」，
     所以带 diary 的选项**必须**至少挂一个这样的旗，否则无从判断。 */
  const RECORD_PREFIXES = ['旗_', '决斗_'];

  function isRecordStat(name) {
    return RECORD_PREFIXES.some((p) => String(name).indexOf(p) === 0);
  }

  function blockOf(story) {
    const d = (story && story.diary) || {};
    return { title: d.title || '日记', entries: d.entries || [] };
  }

  function entryFor(story, day) {
    const want = day === undefined ? DAY : day;
    return blockOf(story).entries.find((e) => e.day === want) || null;
  }

  /**
   * 每个节点落在哪个时段。
   *
   * 从开头顺着 next / choices[].next 走一遍，队列里带着「上一个路过的时段」；
   * 路过哪个 hub，之后的东西就算哪个时段。这样 d1_plan（在 h_morning 之前）
   * 也会被算进「早晨」，而 e_duel_fight（从 h_noon 走进去的）算「中午」——
   * 不用在剧本里手写任何时段字段。
   */
  function slotMap(story) {
    const nodes = {};
    for (const n of story.nodes || []) nodes[n.id] = n;

    const byHub = {};
    SLOTS.forEach((s) => { byHub[s.hub] = s.label; });

    const first = (story.nodes && story.nodes[0]) || {};
    const start = (story.meta && story.meta.start) || first.id;

    const slotOf = {};
    const seen = new Set();
    const queue = [[start, SLOTS[0].label]];
    while (queue.length) {
      const [id, inherited] = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const node = nodes[id];
      if (!node) continue;

      const slot = byHub[id] || inherited;
      slotOf[id] = slot;

      const outs = [];
      if (node.next) outs.push(node.next);
      if (node.continueTo) outs.push(node.continueTo);
      for (const c of node.choices || []) if (c.next) outs.push(c.next);
      for (const nx of outs) queue.push([nx, slot]);
    }
    return slotOf;
  }

  /**
   * 今天记下来的那几条（先按时段，再按她走过的先后）。
   *
   * 一条记事成立 ⇔ 它挂的那个选项写的**记录旗**，此刻全都对得上。
   * 例：早晨两个选项 —— 「停课」写的是 旗_今日停课 == 1，「照常」写的是 == 0，
   * 玩家只能走一条，所以两条里永远只有一条成立。
   *
   * **同一个时段可以记多条**（v3.2）：早晨既有「课照常 / 停课」那一笔，
   * 课上出了插曲时又有那一笔。几条不是并排的几个格子，而是**按她今天走过的
   * 先后拼成一段** —— 顺序取引擎的 visited（Set，迭代顺序就是进入顺序，也存了档），
   * 拿不到的时候退回剧本里的先后（Array#sort 是稳定的）。
   *
   * 带 diary 却没挂记录旗的选项会被跳过（无从判断）—— 这是脏数据，
   * walkthrough.cjs 里有一道核对专门盯着它。
   */
  function collect(story, engine) {
    const slotOf = slotMap(story);
    const rank = {};
    SLOTS.forEach((s, i) => { rank[s.label] = i; });

    /* 她今天先走过哪个节点。visited 是个 Set：迭代顺序 = 进入顺序。
       没有它（袖珍剧本、假引擎）就不给序号 —— 排序会退回剧本顺序。 */
    const seq = new Map();
    const visited = engine && engine.visited;
    if (visited && typeof visited.forEach === 'function') {
      let i = 0;
      visited.forEach((id) => { if (!seq.has(id)) seq.set(id, i++); });
    }
    const orderKey = (id) => (seq.has(id) ? seq.get(id) : Number.MAX_SAFE_INTEGER);

    const out = [];
    for (const node of story.nodes || []) {
      const slot = slotOf[node.id] || SLOTS[0].label;
      for (const c of node.choices || []) {
        if (typeof c.diary !== 'string' || !c.diary) continue;

        const keys = (c.effects || []).filter((e) => isRecordStat(e.stat));
        if (!keys.length) continue;

        const hit = keys.every((e) =>
          engine.checkCondition({ stat: e.stat, op: '==', value: e.value }));
        if (hit) out.push({ slot, node: node.id, text: c.diary });
      }
    }
    // 先按时段，同一时段里按她走过的先后
    out.sort((a, b) =>
      (rank[a.slot] - rank[b.slot]) || (orderKey(a.node) - orderKey(b.node)));
    return out;
  }

  function eventTexts(story, engine) {
    return collect(story, engine).map((x) => x.text);
  }

  /**
   * 引擎停在 nodeId 上，而且这个节点的台词**一句不剩**了？
   *
   * 日记本摊开的时机就是这个 —— 她敲完门、话都说完，书才翻开。
   * 早一句摊开，屏幕上那句「门又被敲响了」就被书盖住了（人还没进来，书先开了）。
   *
   * 判据是 lineIndex：引擎里它是**下一句**的下标，所以「播完了」= `>= 总数`，
   * 写成 `>= 总数 - 1` 会整整早一句。这条边距是走查里盯着的一处
   * （walkthrough.cjs「日记本 · 节点形状」那一段的 00001）。
   *
   * 打字还没打完（ui.locked）不归这里管：那是界面的事，第一下空格
   * 永远该是「别磨蹭，快打完」。
   */
  function atLastLine(engine, nodeId) {
    if (!engine || !engine.node) return false;
    if (nodeId !== undefined && engine.node.id !== nodeId) return false;
    const lines = engine.visibleLines() || [];
    return engine.lineIndex >= lines.length;
  }

  return {
    DAY, DAY_PLACEHOLDER, SLOTS, RECORD_PREFIXES,
    isRecordStat, blockOf, entryFor, slotMap, collect, eventTexts, atLastLine,
  };
});
