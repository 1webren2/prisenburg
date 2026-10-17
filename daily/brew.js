/* =====================================================================
   熬药 · 制作执行引擎（纯逻辑：不碰 DOM，也不碰 Node）
   ---------------------------------------------------------------------
   管**一次制作的完整生命周期**，一行台词、一个 DOM 都不碰：

     检查材料 → 建实例 → 进阶段并起表 → 收玩家操作 → 判定
       → 记阶段成绩 → 算最终品质 → 结算材料、耗时与产物

   界面（daily/brew-ui.js）只负责把 state 画出来、把点击翻译成这几个方法；
   数据（daily/alchemy.js）提供药方与判定参数的兜底值。**判定规则一条都不许
   写进界面的事件回调里** —— 那样就没法在 Node 里推，也没法给第二张方子复用。

   =====================================================================
   一、两种时间必须分开
   ---------------------------------------------------------------------
     · **现实操作倒计时**：每个阶段自己的 timeLimitMs（10~12 秒那一段）。
       按**真实经过的时间**判 —— 每次 tick 拿注入的时钟算 elapsed，
       不是「定时器回调一次就减一格」。浏览器把定时器压到 1 秒一次、
       切走标签页、掉帧，都不影响判定：下一次 tick 一定看得见真实时间。
     · **游戏内固定耗时**：recipe.durationMin（这一剂暂定 30 分钟）。
       它**不随玩家手快手慢改变**，只是结算信息里的一句话。
       本轮不接日程系统，只把这个数存进结果里（见 §7.4 的预留接口）。

   切标签页的后果是明确的：计时照走，回来时早已过线 → 那一阶段按时超
   自动结算，制作继续往下走，绝不卡在中间。

   =====================================================================
   二、状态机
   ---------------------------------------------------------------------
      READY ──start()──► RUNNING ──confirm()/超时──► STAGE_RESULT
        │                   ▲                            │
        │                   └──────── next() ────────────┤ 还有下一阶段
        │                                                │
        └────────── skip() ──────────────────────► COMPLETED（末阶段走完）
                              cancel() ──► CANCELLED

   · COMPLETED 只结算一次：_result 一旦算出来就锁住（settle 也是幂等的，
     见 settlementPlan）。连点、重复点、读档重进，都拿不到第二份成品。
   · CANCELLED 是「这一锅没做成」：不发成品、不扣材料，主线照走。
     材料不够时走的就是它（缺口在 canStart() 里就报出来了）。
   · 没有 PAUSED：**翻开熬药手册不停表**（那是设计要求），所以不存在
     「暂停」这个态；把手册摊开只是界面上盖一层，引擎这边一无所知。

   =====================================================================
   三、扣材料只发生在结算，一次，且与玩家点错无关
   ---------------------------------------------------------------------
   投错料**不额外扣**、也不锁定 —— 它只影响这一阶段的成绩。真正扣的是
   recipe 上写的那几味、各几份（requiredMaterials()），在 COMPLETED 时
   一次性算出来（settlementPlan）。这样「材料什么时候少的」永远只有一个
   答案：这一锅做完的那一刻。
   ===================================================================== */
(function (root, factory) {
  const A = (typeof module === 'object' && module.exports)
    ? require('./alchemy.js')
    : root.AlchemyData;
  const api = factory(A);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BrewEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (A) {
  'use strict';

  if (!A) throw new Error('brew.js 需要 alchemy.js（物品与药方目录）先加载');

  const STATE = {
    READY: 'READY',
    RUNNING: 'RUNNING',
    STAGE_RESULT: 'STAGE_RESULT',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
  };

  const CONFIG = {
    /** 火候条的上下限（0~100 的一根条） */
    heatMin: 0,
    heatMax: 100,
    /** 判定分与品质分都取整到这一位小数以内 */
    scoreDecimals: 0,
  };

  function clamp(n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
  }

  /* ---------------------------------------------------------------------
     三条工序处理器（§7.3）。
     各自只回答「这一下做得怎么样」，0~1，不认识阶段也不认识回合。
     将来加研磨 / 搅拌 / 过滤 / 蒸馏，就在这里再加一个同名形状的处理器。
     --------------------------------------------------------------------- */

  const judge = {
    /** adjust_heat：火候落在目标带里给高分，越出带子按同样的坡度掉到 0 */
    heat(value, band) {
      if (!band || band.length !== 2) return null;
      const ideal = (band[0] + band[1]) / 2;
      const half = Math.max(1, (band[1] - band[0]) / 2);
      const d = Math.abs(Number(value) - ideal);
      if (d <= half) return clamp(1 - (1 - A.DEFAULT_JUDGE.heatBandFloor) * (d / half), 0, 1);
      return clamp(A.DEFAULT_JUDGE.heatBandFloor * (1 - (d - half) / half), 0, 1);
    },

    /** timing_action：指针落在命中区就是满分，偏出去按 falloff 往下掉 */
    timing(pos, band, falloff) {
      if (!band || band.length !== 2) return null;
      const p = Number(pos);
      if (p >= band[0] && p <= band[1]) return 1;
      const d = p < band[0] ? band[0] - p : p - band[1];
      const f = Number(falloff) > 0 ? Number(falloff) : A.DEFAULT_JUDGE.timingFalloff;
      return clamp(1 - d / f, 0, 1);
    },

    /** add_ingredient：一次投放。对了 1 分，错了 0 分 —— 顺序也算在里面 */
    material(picks, expected) {
      if (!expected || !expected.length) return null;
      let ok = 0;
      for (let i = 0; i < expected.length; i++) {
        const got = picks[i];
        if (got && got.picked === expected[i]) ok += 1;
      }
      return ok / expected.length;
    },
  };

  /** 进度条指针在整条上的位置：来回扫（三角波），periodMs 是一次来回。 */
  function sweepAt(elapsedMs, periodMs) {
    const period = Number(periodMs) > 0 ? Number(periodMs) : 2000;
    const e = elapsedMs > 0 ? elapsedMs : 0;
    const p = ((e % period) + period) % period / period;
    return p < 0.5 ? p * 2 : 2 - p * 2;
  }

  /* =====================================================================
     引擎本体
     ===================================================================== */

  class BrewEngine {
    /**
     * @param {object} recipe  alchemy.js 里的一张方子
     * @param {object} [options]
     * @param {function(string):number} [options.getStat] 读库存（通常是 engine.getStat）
     * @param {function():number}       [options.now]     读时钟（毫秒）。测试里塞假的进来
     */
    constructor(recipe, options) {
      if (!recipe || !recipe.stages || !recipe.stages.length) {
        throw new Error('BrewEngine 需要一张带 stages 的药方');
      }
      const opts = options || {};
      this.recipe = recipe;
      this.getStat = typeof opts.getStat === 'function' ? opts.getStat : () => 0;
      this._now = typeof opts.now === 'function' ? opts.now : () => Date.now();

      this.state = STATE.READY;
      this.stageIndex = -1;
      this.heat = 0;
      this.holding = false;
      this.picks = [];
      this.stageResults = [];
      this.stageResult = null;
      this.skipped = false;
      this._stageStartAt = 0;
      this._lastSyncAt = 0;
      this._elapsedMs = 0;
      this._result = null;
      this._cancelReason = '';
    }

    /* ---------------- 只读状态 ---------------- */

    get stage() {
      return this.stageIndex >= 0 ? this.recipe.stages[this.stageIndex] : null;
    }

    get stageCount() {
      return this.recipe.stages.length;
    }

    /** 还能不能开火。缺料时把缺口一并报出来 —— 界面照它画提示。 */
    canStart() {
      return A.checkMaterials(this.recipe, this.getStat);
    }

    /** 这一阶段还剩多少毫秒（已经停表的阶段给 0）。 */
    remainingMs() {
      if (this.state !== STATE.RUNNING || !this.stage) return 0;
      const limit = Number(this.stage.timeLimitMs) || 0;
      return Math.max(0, limit - this._elapsedMs);
    }

    /** 这一阶段已经走了多少毫秒（0~限时）。 */
    elapsedMs() {
      return this._elapsedMs;
    }

    /** 进度条指针此刻在哪儿（0~1）。READY 时停在起点。 */
    sweepPos() {
      if (this.state !== STATE.RUNNING || !this.stage || !this.stage.sweep) return 0;
      return sweepAt(this._elapsedMs, this.stage.sweep.periodMs);
    }

    /** 这一阶段要投的药（按顺序），没有材料的阶段给空数组。 */
    expectedPicks() {
      const m = this.stage && this.stage.materials;
      return m && m.order ? m.order.slice() : [];
    }

    /** 还能投几下 —— 投满了就该按确认了。 */
    picksLeft() {
      return Math.max(0, this.expectedPicks().length - this.picks.length);
    }

    /* ---------------- 生命周期 ---------------- */

    /** 开火。料不够就拒绝（返回 canStart() 的那份报告）。 */
    start() {
      if (this.state !== STATE.READY) return { ok: false, reason: 'bad-state', state: this.state };
      const chk = this.canStart();
      if (!chk.ok) return { ok: false, reason: 'no-materials', missing: chk.missing };

      const t = this._now();
      this._stageStartAt = t;
      this._lastSyncAt = t;
      this._enterStage(0);
      return { ok: true, stage: this.stage, state: this.state };
    }

    /** 推进时间。界面每帧（或每次可见性变化）调一次就够。 */
    tick() {
      this._sync();
      return this.snapshot();
    }

    /**
     * adjust_heat：按住就添火，松开就让它自己落。
     * 火候是按**真实时间**积出来的（见文件头「两种时间」）。
     */
    holdHeat(on) {
      if (this.state !== STATE.RUNNING) return { ok: false, reason: 'bad-state' };
      /* 先把时间推到此刻再改「按没按住」：_sync 用的是**旧的** holding，
         积的是上一段 dt 的火 —— 物理上正好（按住/松开作用在之后的时间里）。
         顺手也让 sweepPos() / snapshot() 读出来的是新鲜的。 */
      this._sync();
      if (this.state !== STATE.RUNNING) return { ok: false, reason: 'timeout' };
      this.holding = !!on;
      return { ok: true, holding: this.holding, heat: this.heat };
    }

    /** add_ingredient：投一味药。投错了不额外扣料，只记账。 */
    pick(ingredientId) {
      if (this.state !== STATE.RUNNING) return { ok: false, reason: 'bad-state' };
      this._sync();
      if (this.state !== STATE.RUNNING) return { ok: false, reason: 'timeout' };

      const expected = this.expectedPicks();
      if (!expected.length) return { ok: false, reason: 'no-materials-stage' };
      if (this.picks.length >= expected.length) return { ok: false, reason: 'already-full' };

      const want = expected[this.picks.length];
      const rec = { expected: want, picked: String(ingredientId), ok: want === ingredientId };
      this.picks.push(rec);
      return { ok: true, pick: rec, left: this.picksLeft() };
    }

    /** timing_action：把这一步做定。材料没投完就先别按（界面会照 reason 提示）。 */
    confirm() {
      if (this.state !== STATE.RUNNING) return { ok: false, reason: 'bad-state' };
      this._sync();
      if (this.state !== STATE.RUNNING) return { ok: false, reason: 'timeout' };
      if (this.picksLeft() > 0) return { ok: false, reason: 'need-more-picks', left: this.picksLeft() };

      this._finishStage(false);
      return { ok: true, stage: this.stageResult, state: this.state };
    }

    /** 阶段成绩看完了，走下一段（末阶段之后就是 COMPLETED）。 */
    next() {
      if (this.state !== STATE.STAGE_RESULT) return { ok: false, reason: 'bad-state' };
      if (this.stageIndex + 1 < this.stageCount) {
        this._enterStage(this.stageIndex + 1);
        return { ok: true, stage: this.stage, state: this.state, done: false };
      }
      this._complete();
      return { ok: true, stage: null, state: this.state, done: true };
    }

    /**
     * 跳过：按 skipScore 结算成**普通**品质。
     *
     * 「不获得免费成品或最高品质」按这一条读：跳过**照样扣料**（这一锅是真
     * 熬出来了，只是没盯着），成品只有普通；也给不了优秀。
     */
    skip() {
      if (this.state === STATE.COMPLETED || this.state === STATE.CANCELLED) {
        return { ok: false, reason: 'already-done', state: this.state };
      }
      if (this.state === STATE.READY) {
        const chk = this.canStart();
        if (!chk.ok) return { ok: false, reason: 'no-materials', missing: chk.missing };
      }
      this.skipped = true;
      this.holding = false;
      this._complete();
      return { ok: true, state: this.state, result: this._result };
    }

    /** 收摊：这一锅没做成。不发成品、不扣料。 */
    cancel(reason) {
      if (this.state === STATE.COMPLETED) return { ok: false, reason: 'already-done' };
      this._cancelReason = String(reason || 'cancelled');
      this.holding = false;
      this.state = STATE.CANCELLED;
      return { ok: true, state: this.state, reason: this._cancelReason };
    }

    /* ---------------- 结果 ---------------- */

    /** 阶段成绩（刚做完那一段）或最终结果（COMPLETED / CANCELLED）。 */
    result() {
      return this._result || this.stageResult || null;
    }

    snapshot() {
      return {
        state: this.state,
        stageIndex: this.stageIndex,
        stageCount: this.stageCount,
        stage: this.stage,
        heat: this.heat,
        holding: this.holding,
        sweep: this.sweepPos(),
        remainingMs: this.remainingMs(),
        elapsedMs: this._elapsedMs,
        picks: this.picks.slice(),
        picksLeft: this.picksLeft(),
        skipped: this.skipped,
      };
    }

    /* ---------------- 内部 ---------------- */

    _enterStage(index) {
      const st = this.recipe.stages[index];
      this.stageIndex = index;
      this.state = STATE.RUNNING;
      this.picks = [];
      this.stageResult = null;
      this.holding = false;
      this._elapsedMs = 0;
      const t = this._now();
      this._stageStartAt = t;
      this._lastSyncAt = t;
      this.heat = clamp(Number((st.heat || {}).start) || 0, CONFIG.heatMin, CONFIG.heatMax);
    }

    /**
     * 把时钟推到现在：先积火候，再判超时。
     *
     * 时钟倒退（dt < 0，比如系统对时）按 0 算 —— 不能让它把倒计时推回去。
     */
    _sync() {
      if (this.state !== STATE.RUNNING) return;
      const t = this._now();
      let dt = t - this._lastSyncAt;
      if (!(dt > 0)) { this._lastSyncAt = t; return; }
      this._lastSyncAt = t;
      this._elapsedMs = Math.max(0, t - this._stageStartAt);

      const st = this.stage;
      const h = st.heat || {};
      const rate = this.holding ? (Number(h.risePerSec) || 0) : -(Number(h.decayPerSec) || 0);
      this.heat = clamp(this.heat + rate * (dt / 1000), CONFIG.heatMin, CONFIG.heatMax);

      const limit = Number(st.timeLimitMs) || 0;
      if (limit > 0 && this._elapsedMs >= limit) {
        this._elapsedMs = limit;
        this._finishStage(true);          // 超时自动结算，制作照常往下走
      }
    }

    /** 这一段做定了。timedOut 只记「是不是没来得及按」。 */
    _finishStage(timedOut) {
      const st = this.stage;
      const expected = this.expectedPicks();
      const sweepBand = (st.sweep || {}).band;
      const heatBand = (st.heat || {}).band;

      const materialScore = judge.material(this.picks, expected);
      const heatScore = judge.heat(this.heat, heatBand);
      const timingScore = judge.timing(this.sweepPos(), sweepBand, (st.sweep || {}).falloff);

      this.stageResult = {
        stageId: st.id,
        label: st.label,
        index: this.stageIndex,
        timedOut: !!timedOut,
        materialScore,
        heatScore,
        timingScore,
        heatAt: this.heat,
        sweepAt: this.sweepPos(),
        picks: this.picks.slice(),
        expected,
        feedback: feedbackOf({
          timedOut: !!timedOut,
          materialScore, heatScore, timingScore,
          heatAt: this.heat, heatBand, picks: this.picks, expected,
        }),
      };
      this.stageResults.push(this.stageResult);
      this.holding = false;
      this.state = STATE.STAGE_RESULT;
    }

    /** 全部阶段走完（或者中途跳过）：算总分、算成品，锁住结果。 */
    _complete() {
      if (this._result) return this._result;
      this.state = STATE.COMPLETED;

      const dims = { material: [], heat: [], timing: [] };
      for (const sr of this.stageResults) {
        if (sr.materialScore !== null && sr.materialScore !== undefined) dims.material.push(sr.materialScore);
        if (sr.heatScore !== null && sr.heatScore !== undefined) dims.heat.push(sr.heatScore);
        if (sr.timingScore !== null && sr.timingScore !== undefined) dims.timing.push(sr.timingScore);
      }

      const w = this.recipe.weights || { material: 40, heat: 30, timing: 30 };
      const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

      let score;
      let used;
      if (this.skipped) {
        // 跳过 = 交给厨房代煎：不看阶段成绩，直接按方子上写的这一档结算
        score = Number(this.recipe.skipScore);
        if (!Number.isFinite(score)) score = 60;
        used = { material: null, heat: null, timing: null };
      } else {
        /* 哪一维这一锅压根没考（比如某张方子没有材料阶段），**把它的权重摘掉、
           其余的按比例归一** —— 不能拿「没考」当满分，也不能当零分。 */
        used = { material: avg(dims.material), heat: avg(dims.heat), timing: avg(dims.timing) };
        let wsum = 0;
        let acc = 0;
        for (const k of Object.keys(w)) {
          if (used[k] === null) continue;
          wsum += Number(w[k]) || 0;
          acc += (Number(w[k]) || 0) * used[k];
        }
        score = wsum > 0 ? (acc / wsum) * 100 : 0;
      }
      score = clamp(Math.round(score), 0, 100);

      const consumed = A.requiredMaterials(this.recipe).map((r) => ({ id: r.id, qty: r.qty }));
      const prod = this.recipe.product || null;

      this._result = {
        recipeId: this.recipe.id,
        recipeName: this.recipe.name,
        completed: true,
        skipped: !!this.skipped,
        cancelled: false,
        score,
        quality: A.qualityOf(score),
        dimensions: {
          material: { score: used.material, weight: Number(w.material) || 0, samples: dims.material.length },
          heat: { score: used.heat, weight: Number(w.heat) || 0, samples: dims.heat.length },
          timing: { score: used.timing, weight: Number(w.timing) || 0, samples: dims.timing.length },
        },
        stages: this.stageResults.slice(),
        consumed,
        durationMin: Number(this.recipe.durationMin) || 0,
        product: prod ? { id: prod.id, qty: Number(prod.qty) || 1 } : null,
        reason: this.skipped ? 'skipped' : 'completed',
      };
      return this._result;
    }
  }

  /* ---------------------------------------------------------------------
     阶段反馈：给玩家看的一句话。**这是玩法反馈，不是台词** ——
     它不进 story.json 的任何 dialogues，原文核对不会（也不该）管它。
     全部按「哪一维怎么判的」现算，界面只管画。
     --------------------------------------------------------------------- */
  function feedbackOf(o) {
    const out = [];
    const picks = o.picks || [];
    const expected = o.expected || [];

    if (expected.length) {
      const wrongOrder = picks.length === expected.length &&
        picks.some((p) => !p.ok) &&
        picks.slice().sort((a, b) => (a.picked < b.picked ? -1 : 1))
          .map((p) => p.picked).join() === expected.slice().sort().join();
      if (o.materialScore >= 1) out.push({ dim: 'material', level: 'good', text: '药下对了，次序也对。' });
      else if (wrongOrder) out.push({ dim: 'material', level: 'bad', text: '次序反了。' });
      else if (picks.length < expected.length) {
        out.push({ dim: 'material', level: 'bad', text: '还有一味没来得及下。' });
      } else out.push({ dim: 'material', level: 'bad', text: '下错了一味。' });
    }

    const hb = o.heatBand || [0, 0];
    const ideal = (hb[0] + hb[1]) / 2;
    if (o.heatScore >= 0.95) out.push({ dim: 'heat', level: 'good', text: '火候正好。' });
    else if (o.heatAt < ideal) {
      out.push({ dim: 'heat', level: o.heatScore > 0 ? 'ok' : 'bad', text: '火偏小，药没怎么翻。' });
    } else {
      out.push({ dim: 'heat', level: o.heatScore > 0 ? 'ok' : 'bad', text: '火偏大，锅边上有点焦味。' });
    }

    if (o.timedOut) out.push({ dim: 'timing', level: 'bad', text: '时间到了，你只得收手。' });
    else if (o.timingScore >= 1) out.push({ dim: 'timing', level: 'good', text: '火口拿得准。' });
    else out.push({ dim: 'timing', level: o.timingScore > 0 ? 'ok' : 'bad', text: '迟了一点，气跑掉一些。' });

    return out;
  }

  /* =====================================================================
     结算
     ---------------------------------------------------------------------
     **纯函数**：只算「该扣什么、该发什么」，一个数都不写。
     真正落到 stats 上是界面层的事（它才拿得到 engine）——
     但扣什么、扣几份这条规则只在这里出现一次。

     调用方要先自己看「结算过没有」（旗_熬药结算）。
     多一道闸的原因是：**这一步会写库存**，而它可能因为读档、连点被重复调到。
     --------------------------------------------------------------------- */
  function settlementPlan(result) {
    if (!result || !result.completed || result.cancelled) return null;
    const items = (result.consumed || []).map((c) => ({
      id: c.id,
      stat: A.statOf(c.id),
      delta: -Number(c.qty || 0),
    }));
    const out = items.slice();
    if (result.product) {
      out.push({
        id: result.product.id,
        stat: A.statOf(result.product.id),
        delta: Number(result.product.qty) || 1,
      });
    }
    return out;
  }

  /* =====================================================================
     固定采购的结算计划
     ---------------------------------------------------------------------
     账册那一条「药房常例」是**固定采购**（daily/story.json 的 pharmacy 块）：
     玩家不能改清单、不能改数量、不能改价钱。它在这里只回答一件事 ——
     「走到这个节点时，该不该发料、发哪几味、各几份」。

     两条闸门，缺一不可：
       · **节点对不对**（purchase.node）。不是那个节点，什么都不发。
       · **这一笔结算过没有**（purchase.settledFlag）。翻开账册看一眼就把料
         再发一遍，那是把固定采购当成了可反复领取的奖励。
     所以账册翻第二遍、读档跳回那个节点、来回进出，都只会发第一次那一份。

     金额也一并带出来（amount），好让测试拿它跟账册正文里那句话对账；
     但**钱不进 stats**：账册是叙事展示的历史支出，不是每次查看都再扣一次的资金。
     --------------------------------------------------------------------- */
  function purchasePlan(pharmacy, nodeId, getStat) {
    const read = typeof getStat === 'function' ? getStat : () => 0;
    const list = (pharmacy && pharmacy.purchases) || [];
    const out = [];
    for (const p of list) {
      if (!p || !p.id || p.node !== nodeId) continue;
      const flag = p.settledFlag || '';
      if (flag && Number(read(flag)) > 0) continue;      // 已经结算过，不再发
      out.push({
        id: p.id,
        node: p.node,
        label: p.label || '',
        amount: Number(p.amount) || 0,
        currency: (pharmacy && pharmacy.currency) || '',
        items: (p.items || []).map((it) => ({
          id: it.id,
          stat: A.statOf(it.id),
          delta: Number(it.qty) || 0,
        })),
        flag,
      });
    }
    return out;
  }

  return {
    BrewEngine, STATE, CONFIG, judge, sweepAt, settlementPlan, purchasePlan,
  };
});
