/* =====================================================================
   日记本的**规则**（纯逻辑：不碰 DOM，也不碰 Node）
   ---------------------------------------------------------------------
   从 stage0/diary.js 移植过来，为正式第一幕改了三处：

     1. **天与时段从节点 id 里读**，不再靠「路过哪个 hub 就继承哪个」。
        日常层的每个节点都叫 dy_d{天}_{时段}_…（天/时段就编在 id 里），
        所以「现在第几天、什么时辰」是从 id 直接解析出来的，
        不用顺着剧本走一遍，也不用把天数写死在常量里（stage0 的 DAY = 1）。

     2. **原著段落在哪个时段，靠历史回溯**。第 2 天和第 6 天的原著段
        （b12_morning…、c1_door…）不是 dy_ 节点，自己的 id 里没有天/时段。
        它们的时段从**来路**上取 —— 引擎的 history 里最后那个 dy_ 节点，
        就是它们所属的那个时段。history 进了 snapshot()，也进了服务器
        的存档白名单，所以读档之后天/时段照样认得出来。

        狩猎篇五章（h4_knock…h8_end）不走这条回溯 —— 它们的 id 自带章号，
        按 HUNT_STAMP 那张表直接读（日期是原文自己写的，见下面那张表）。
        不这么做的话，牌子会停在进狩猎篇之前的第 6 天不动。

     3. **一条记事成不成立 = 那个选项走过的痕迹**：它挂的记录旗此刻对得上，
        **并且**它所在的节点进过（engine.visited）、**并且**她现在不站在这
        个节点的岔路口上。后两句是必须的 —— 旗是 0/1，没做过的选项旗也是 0：
        · 少了「进过」，日记会把还没轮到的时段当成「已经选过 A」；
        · 少了「不站在岔路口」，玩家一进幕尾反应节点、还没点，日记里就已经
          写着 A 的做法了（旗是 0，和「选了 A」长得一模一样）。
        （stage0 一天走满、旗是逐条累加，两个问题都碰不上。）

   静态那一半在选项上 —— choice.diary，一个固定字符串，只读。
   运行时那一半在 stats 里 —— 那几个「记录」旗，会被改、会被存档。

   另外两件也在这一层（都是纯函数，走查和单测能直接推）：

     4. **「她写的」那一页分四档**（设计稿附录 A）。档位由 好感 / 亲密 /
        埋怨 / 恨意 当天算出来，数据里 body 是档 1，tiers[2..4] 是高出的那几档。
        阈值写死在 tierOf() 里一处，界面上一个字都不显示。
     5. **第一天那场日记摊开在哪一下**（atLastLine）。早一句摊开，屏幕上最后
        那两句就被书盖住了 —— 这条边距只有用真引擎逐句推才看得见。
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DailyDiary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 一天里的时段。**数组顺序就是日记里事件的排列顺序。**
     key 是节点 id 里那一段（dy_d2_**mo**_hub），label 是显示用的。
     第三、四天起，一天里多出一格「傍晚」（drafts 里的 `dy_d3_ev_*`），
     排在午后与夜晚之间 —— 顺序就是这个世界一天实际经过的顺序。 */
  const SLOTS = [
    { key: 'mo', label: '早晨' },
    { key: 'nn', label: '中午' },
    { key: 'af', label: '午后' },
    { key: 'ev', label: '傍晚' },
    { key: 'ni', label: '夜晚' },
  ];

  /* dy_d{天}_{时段}_… —— 日常层节点 id 的形状。
     天和时段编进 id，就是存档能记住「现在是第几天、什么时辰」的全部原因。 */
  const NODE_RE = /^dy_d(\d+)_(mo|nn|af|ev|ni)(?:_|$)/;

  const SLOT_LABEL = {};
  SLOTS.forEach((s) => { SLOT_LABEL[s.key] = s.label; });

  /* 狩猎篇五章各在第几天、什么时辰 —— **原文自己把日子写在那里的**，
     这一张表就是照着它填的，没有别的机制：

       第四章  「明天一早，你再来我的房间一趟」→ 当夜，仍是第 6 天的夜晚
       第五章  「第二天，太阳还未从山边出来之时」→ 第 7 天早晨
       第六章  狩猎开始、日头高照        → 第 7 天中午（四时段里没有「上午」这一格）
       第七章  猎场中段、玛格丽特的鞭子    → 第 7 天午后
       第八章  「午后的阳光」「太阳西下」「夜的寂静」→ 第 7 天夜晚

     h4_knock…h8_end 的 id 里没有天/时段（它们本来就是原著正文，不是日常层），
     所以这里的映射只干一件事：让 HUD 左上角那块牌子在狩猎篇里显示对的日期。
     日记那边不受影响 —— 狩猎节点上一条 diary 都没有。 */
  const HUNT_STAMP = {
    4: { day: 6, key: 'ni' },
    5: { day: 7, key: 'mo' },
    6: { day: 7, key: 'nn' },
    7: { day: 7, key: 'af' },
    8: { day: 7, key: 'ni' },
  };
  const HUNT_RE = /^h([45678])_/;

  /* 「记录」那一类数值的前缀。它们不是好感那种真数值，是 0/1 的记事旗
     （statLabels 里一律叫「记录 · …」）。日记靠它们判断「今天记不记得这一条」，
     所以带 diary 的选项**必须**至少挂一个这样的旗，否则无从判断。 */
  const RECORD_PREFIXES = ['旗_', '决斗_'];

  function isRecordStat(name) {
    return RECORD_PREFIXES.some((p) => String(name).indexOf(p) === 0);
  }

  /** 节点自己写的 stamp（20 个 hub 与那个 intro 上都有）。没有就给 null。 */
  function explicitStamp(node) {
    const s = node && node.stamp;
    if (!s || !s.day || !SLOT_LABEL[s.slot]) return null;
    return { day: Number(s.day), slot: SLOT_LABEL[s.slot], key: s.slot };
  }

  function nodeById(story, id) {
    const list = (story && story.nodes) || [];
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /**
   * 节点（或节点 id）→ { day, slot, key }。
   *
   * 三条路，按可信度排：
   *   1. **节点自己写的 `stamp`** —— 显式的，不靠任何猜。hub 与 intro 上有。
   *   2. **id 的形状** —— dy_d{天}_{时段}_…，日常层每个节点都带着。
   *   3. **HUNT_STAMP 那张表** —— 狩猎篇五章，日子是小说原文自己写的。
   * 三条都落空（第 1 天的序章与第一夜）就给 null。
   *
   * 第一个参数既可以是一个节点对象，也可以是 id 字符串；字符串要查第 1 条
   * 就得把 story 传进来。
   */
  function stampOf(nodeOrId, story) {
    if (nodeOrId && typeof nodeOrId === 'object') {
      return explicitStamp(nodeOrId) || stampOf(nodeOrId.id);
    }
    const id = String(nodeOrId || '');
    if (story) {
      const s = explicitStamp(nodeById(story, id));
      if (s) return s;
    }
    const m = NODE_RE.exec(id);
    if (m) {
      const key = m[2];
      return { day: Number(m[1]), slot: SLOT_LABEL[key], key };
    }
    const h = HUNT_RE.exec(id);
    if (h) {
      const s = HUNT_STAMP[Number(h[1])];
      if (s) return { day: s.day, slot: SLOT_LABEL[s.key], key: s.key };
    }
    return null;
  }

  /**
   * 从来路上回头找最近一个日常层节点，拿它的天/时段。
   *
   * 原著段（b12_morning…、c1_door…）自己不说是第几天，但它是**从某个时段的
   * 菜单走进来的**，所以往回找第一个 dy_ 节点就是答案。
   * 找不到（第 1 天：序章和第一夜都还没有日常层）就是 null —— 界面上不显示
   * 时间牌子，【日记】按钮也不出现。这就是「日常模式从第二天开始」这条口径。
   */
  function stampFromHistory(history, story) {
    const list = history || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const s = stampOf(list[i], story);
      if (s) return s;
    }
    return null;
  }

  function blockOf(story) {
    const d = (story && story.diary) || {};
    return { title: d.title || '日记', entries: d.entries || [], offstage: d.offstage || {} };
  }

  function entryFor(story, day) {
    return blockOf(story).entries.find((e) => e.day === day) || null;
  }

  /* ---------------------------------------------------------------------
     附录 A 的四档。「她写下来的语气」随关系走，跟天的关系不大。
     **阈值只在这一处出现**，界面层一个字都不显示 —— 玩家看到的永远是
     一整页人写的话，不是「好感 +5」这种东西。

       档 1  事件记录        默认，开局就在这档
       档 2  少量主观观察    好感 ≥ 20 或 亲密 ≥ 10
       档 3  个人情绪        好感 ≥ 40 且 亲密 ≥ 25；或 埋怨 ≥ 30
       档 4  真正私密        好感 ≥ 60、亲密 ≥ 45，且 恨意 未越线

     恨意那条线设计稿没给数，取 30（跟「埋怨 ≥ 30」同一根尺子）：过了线就
     落回档 3。设计稿还留了一句「同样够亲密、恨意高，会是另一种私密」——
     那是第五种正文，这一轮不做（一天四份），先记在这里。

     档位**当天算、当天用，不留历史**：玩家把她推远了，第二天翻开来就冷回去了。
     --------------------------------------------------------------------- */
  const HATE_LINE = 30;

  function tierOf(engine) {
    const s = (name) => {
      const v = engine && typeof engine.getStat === 'function' ? engine.getStat(name) : 0;
      return Number(v) || 0;
    };
    const 好感 = s('西比拉_好感');
    const 亲密 = s('西比拉_亲密');
    const 埋怨 = s('西比拉_埋怨');
    const 恨意 = s('西比拉_恨意');

    if (好感 >= 60 && 亲密 >= 45 && 恨意 < HATE_LINE) return 4;
    if ((好感 >= 40 && 亲密 >= 25) || 埋怨 >= 30) return 3;
    if (好感 >= 20 || 亲密 >= 10) return 2;
    return 1;
  }

  /**
   * 这一天这一页「她写的」那一段。
   *
   * 数据里 `body` 就是**档 1**（默认那一段），`tiers[n]` 只写高出档 1 的那几档：
   *   · 第 1 天只有 body —— 那天她刚到，还谈不上语气，哪一档读到的都是它
   *   · 第 2 天、第 6 天 body + tiers 2/3/4，四档齐全
   * 哪一档缺了就往下回落到**低于它的最高那一档**，再没有才用 body。
   * 所以往 tiers 里少写一档不会开天窗，只是那一档听起来像上一档。
   */
  function bodyFor(story, engine, day) {
    const e = entryFor(story, day);
    if (!e) return [];
    const tiers = e.tiers || {};
    for (let k = tierOf(engine); k >= 2; k--) {
      if (Array.isArray(tiers[k]) && tiers[k].length) return tiers[k];
    }
    return e.body || [];
  }

  /**
   * 「这个节点的最后一句已经播完了吗」。
   *
   * 第一天那场日记（她敲门把册子递上来）就挂在**这一下**上：早一句摊开，
   * 屏幕上最后那两句就被书盖住了 —— 人还没进来，书先开了。
   * lineIndex 是「下一条要播的」，播完最后一条之后它等于总条数。
   *
   * 放在这里而不是界面层，是为了能被走查/单测用真引擎逐句推：界面那一层
   * 拦输入的东西，光看代码是看不出边距的。
   */
  function atLastLine(engine, nodeId) {
    if (!engine || !engine.node) return false;
    if (nodeId !== undefined && engine.node.id !== nodeId) return false;
    const lines = engine.visibleLines() || [];
    return engine.lineIndex >= lines.length;
  }

  /**
   * 今天记下来的那几条（先按时段，同一时段里按她走过的先后）。
   *
   * 一条记事成立 ⇔ 四件事同时成立：
   *   ① 这个选项写了 choice.diary
   *   ② 它挂了至少一个「记录」旗，而那个旗此刻**对得上**
   *   ③ 它所在的节点**进过**（visited）—— 旗是 0/1，没走到过的时段旗也是 0，
   *      少了这条，日记会在玩家还没玩到那个时段时就把它写上去
   *   ④ 她**不是此刻正站在这个节点的选项上**——同上的道理：还没迈步，
   *      「选了 A」和「还没选」在数值上一模一样。选完就离开了这个节点，
   *      这一条就自动放行
   *
   * 顺序取引擎的 visited（Set，迭代顺序就是进入顺序，也存了档），
   * 拿不到的时候退回剧本里的先后（Array#sort 是稳定的）。
   *
   * **没有亲历的原著段另算一类**：条件不是旗，而是「那个段落的入口没进过
   * visited」—— 亲历没亲历，visited 说了算，比旗可靠（旗是 0/1，没做过也是 0）。
   * 再加上「那个时段已经过去」，就是 diary.offstage 收进来的全部条件。
   */
  function collect(story, engine, day) {
    const rank = {};
    SLOTS.forEach((s, i) => { rank[s.label] = i; });

    /* 她先走过哪个节点。visited 是个 Set：迭代顺序 = 进入顺序。
       没有它（袖珍剧本、假引擎）就不给序号 —— 排序会退回剧本顺序。 */
    const seq = new Map();
    const visited = engine && engine.visited;
    if (visited && typeof visited.forEach === 'function') {
      let i = 0;
      visited.forEach((id) => { if (!seq.has(id)) seq.set(id, i++); });
    }
    const orderKey = (id) => (seq.has(id) ? seq.get(id) : Number.MAX_SAFE_INTEGER);
    const went = (id) => !!(visited && typeof visited.has === 'function' && visited.has(id));

    /* 她此刻站在哪儿。站在某个节点的选项上 = 这一步还没走 —— 见上面 ④ */
    const standingOn = (engine && engine.node && engine.node.id) || null;

    /* 她此刻走到哪一刻了。用来判「那个没亲历的时段过去了没有」——
       同一天里，还没到的时段不该提前出现在日记上。 */
    const here = (engine && engine.node && stampOf(engine.node, story)) ||
      stampFromHistory(engine && engine.history, story) || null;
    const rankOf = (s) => (s ? s.day * 10 + rank[s.slot] : -1);
    const hereRank = rankOf(here);

    const out = [];
    for (const node of story.nodes || []) {
      const stamp = stampOf(node, story);
      if (!stamp) continue;                       // 原著段的选项不记日记
      if (day !== undefined && stamp.day !== day) continue;
      if (!went(node.id)) continue;               // ③ 还没走到这个时段
      if (node.id === standingOn) continue;       // ④ 站在这儿，还没迈步

      for (const c of node.choices || []) {
        if (typeof c.diary !== 'string' || !c.diary) continue;

        const keys = (c.effects || []).filter((e) => isRecordStat(e.stat));
        if (!keys.length) continue;               // ② 没挂记录旗，无从判断

        const hit = keys.every((e) =>
          engine.checkCondition({ stat: e.stat, op: '==', value: e.value }));
        if (hit) out.push({ day: stamp.day, slot: stamp.slot, node: node.id, text: c.diary, ord: orderKey(node.id) });
      }
    }

    /* 没有亲历的原著段：原著不会因为没人看就不发生。那一整段照常演完
       （数值沿默认走法落，见 act1/engine.js 的 applySegmentDefaults），
       只是她这边要自己把它记下来 —— diary.offstage 就是那份补记。
       收进来的两个条件：
         · 那个段落的入口**没进过** visited（亲历了就轮不到补记，除非她正好
           站在入口上还没迈步 —— 那也还没亲历，但更不该现在写，所以一并排除）
         · 那个时段**已经过去**（同一天里，还没到的时段不许提前写）
       排序的序号给 -1：同一时段里，原著段总是发生在那处活动之前。 */
    const off = blockOf(story).offstage;
    for (const entryId of Object.keys(off)) {
      const rec = off[entryId];
      if (!rec || !rec.text || !SLOT_LABEL[rec.slot]) continue;
      if (day !== undefined && Number(rec.day) !== day) continue;
      if (went(entryId) || entryId === standingOn) continue;
      if (rankOf({ day: Number(rec.day), slot: SLOT_LABEL[rec.slot] }) >= hereRank) continue;
      out.push({
        day: Number(rec.day), slot: SLOT_LABEL[rec.slot], node: entryId,
        text: rec.text, ord: -1, offstage: true,
      });
    }

    // 先按天，再按时段，同一时段里按她走过的先后
    out.sort((a, b) =>
      (a.day - b.day) ||
      (rank[a.slot] - rank[b.slot]) ||
      (a.ord - b.ord));
    return out;
  }

  function eventTexts(story, engine, day) {
    return collect(story, engine, day).map((x) => x.text);
  }

  /** 这一天里哪几段是「没有亲历、由她自己补记」的。给测试和界面用。 */
  function offstageFor(story, engine, day) {
    return collect(story, engine, day).filter((x) => x.offstage);
  }

  return {
    SLOTS, NODE_RE, RECORD_PREFIXES, HATE_LINE,
    isRecordStat, stampOf, stampFromHistory, blockOf, entryFor,
    tierOf, bodyFor, collect, eventTexts, atLastLine, offstageFor,
  };
});
