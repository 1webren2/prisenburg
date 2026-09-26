/**
 * 第一幕 · 剧情引擎（story.json 的配套规则）
 * =====================================================================
 * 纯逻辑：只回答「剧情怎么走」，不碰 DOM，也不碰 Node。所以同一个文件既能被
 * index.html 当普通 <script> 加载（挂到 window.Act1Story），也能在 Node 里直接
 * require 进来跑测试。

 *   engine.js  ← 这个文件：规则、数值、状态机
 *   ui.js      ← 网页渲染层：把引擎吐出的事件画成 DOM
 *   game.js    ← Node 终端入口：命令行 + ANSI 像素块渲染

 * 负责五件事：
 *   1. 视角切换  —— 相邻两个节点 pov 不同就触发 pov 事件（序章 西比拉 → 主场 奥布里）
 *   2. 数值系统  —— 隐藏数值：伊莎贝尔_好感 / 西比拉_警惕 / 西比拉_好感
 *                    默认不显示数字，只给一句「感觉」；按 V 才显示真实数值
 *   3. 剧情跳转  —— 节点、台词（支持 if 条件行）、选项（支持 if 解锁 / 锁定提示）
 *   4. 幕间自由活动 —— 结局之后那一段「侧厅」：房间、互动、换装（freeRoam 数据块驱动）
 *   5. 像素块占位 —— 没有立绘素材，用确定性随机数（同一个 asset 每次画出来一模一样）生成像素图
 *
 * 节点数据结构（story.json 里每个 nodes[i]）：
 *   {
 *     id:        "a1_meeting",                 // 唯一标识，跳转靠它
 *     pov:       "奥布里",                      // 当前视角（必须是 povs 的键）
 *     title:     "第一幕 · 主座之上",            // 可选，转场时显示
 *     art:       { bg: "bg_hall", portrait: "chr_aubrey" },   // 指向 art.assets
 *     povSwitch: { line: "…" },               // 可选，切视角时额外显示的一行
 *     dialogues: [ { speaker, text, if? } ],   // 台词；if 不满足就跳过这一行
 *     choices:   [ { text, hint, next, if?, lockedHint?, effects? } ],
 *     next:      "a2_returned"                 // 没有 choices 时用 next 直接跳
 *   }
 *
 * 效果 / 条件里出现的 stat，必须先在 config.statLabels 里定义过，否则自检会报错：
 *   effects: [ { stat: "伊莎贝尔_好感", value: 1, note: "…" } ]
 *   if:      { stat: "西比拉_警惕", op: ">=", value: 3 }
 */

(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Act1Story = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ===================================================================
   * 1. 小工具
   * =================================================================== */

  /** 字符串 -> 32 位整数（FNV-1a 变体）。同一个 asset 名字永远得到同一个种子。 */
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /** mulberry32：短小、确定性的伪随机数发生器 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(n, min, max) {
    return n < min ? min : n > max ? max : n;
  }

  function deepClone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /** 中日韩字符按两个字符宽计算，终端里排版才不会歪 */
  function displayWidth(str) {
    let w = 0;
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      const wide =
        (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6);
      w += wide ? 2 : 1;
    }
    return w;
  }

  function padTo(str, width) {
    return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
  }

  /** 按显示宽度折行（中英混排也不会撑破框） */
  function wrapCJK(text, width) {
    const out = [];
    let line = '';
    let w = 0;
    for (const ch of String(text)) {
      if (ch === '\n') { out.push(line); line = ''; w = 0; continue; }
      const cw = displayWidth(ch);
      if (w + cw > width) { out.push(line); line = ''; w = 0; }
      line += ch;
      w += cw;
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  }

  /* ===================================================================
   * 2. 条件与效果
   * =================================================================== */

  const OPS = {
    '>=': (a, b) => a >= b,
    '>': (a, b) => a > b,
    '<=': (a, b) => a <= b,
    '<': (a, b) => a < b,
    '==': (a, b) => a === b,
    '=': (a, b) => a === b,
    '!=': (a, b) => a !== b,
  };

  /**
   * 条件求值。支持：
   *   { stat, op, value }        —— 单个数值判断
   *   { all: [cond, ...] }       —— 全部满足
   *   { any: [cond, ...] }       —— 任一满足
   *   { not: cond }              —— 取反
   *   null / undefined           —— 视为满足
   */
  function evaluateCondition(cond, getStat) {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => evaluateCondition(c, getStat));

    if (cond.all) return cond.all.every((c) => evaluateCondition(c, getStat));
    if (cond.any) return cond.any.some((c) => evaluateCondition(c, getStat));
    if (cond.not) return !evaluateCondition(cond.not, getStat);

    if (cond.stat !== undefined) {
      const op = OPS[cond.op || '>='];
      if (!op) throw new Error(`不认识的条件运算符：${cond.op}`);
      return op(Number(getStat(cond.stat)) || 0, Number(cond.value));
    }

    throw new Error(`无法识别的条件：${JSON.stringify(cond)}`);
  }

  /* ===================================================================
   * 3. 像素块占位图
   * -------------------------------------------------------------------
   * 没有插画立绘素材，先用像素块代替。同一个 asset 名字 + 同样的行列数
   * 永远生成同一张图（种子化随机），所以「城堡」不会每帧换个样子。
   * 返回一个颜色矩阵，谁来画都行：终端画成色块，网页画成 div 网格。
   * =================================================================== */

  function buildPixelArt(asset) {
    if (!asset) return null;

    const cols = asset.cols || 40;
    const rows = asset.rows || 12;
    const palette = (asset.palette && asset.palette.length ? asset.palette : ['#111', '#333', '#666', '#999']).slice();
    const rand = mulberry32(hashString(asset.label || asset.kind || 'art'));

    const matrix = [];
    const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];

    if (asset.kind === 'portrait') {
      // ---- 立绘：头 + 肩的剪影 ----
      const headR = cols * 0.30;
      const headCx = cols / 2;
      const headCy = rows * 0.30;
      // 肩膀必须从脑袋里「接」出来：起点定在 headCy + headR*0.55，
      // 否则头底和肩顶之间会空一行，看起来像脑袋浮在半空
      const shoulderTop = headCy + headR * 0.55;

      for (let y = 0; y < rows; y++) {
        const row = [];
        for (let x = 0; x < cols; x++) {
          const dx = x + 0.5 - headCx;
          const dy = (y + 0.5 - headCy) * 1.12; // 让脑袋略呈椭圆
          const inHead = dx * dx + dy * dy <= headR * headR;
          const inBody = y >= shoulderTop &&
            Math.abs(x + 0.5 - headCx) <= ((y - shoulderTop) / (rows - shoulderTop)) * (cols * 0.46) + cols * 0.10;

          let color;
          if (inHead) {
            // 头顶几行算头发，剩下的算脸
            color = y < headCy - headR * 0.25 ? palette[0] : palette[2];
            if (rand() < 0.18) color = palette[1];
          } else if (inBody) {
            color = y < shoulderTop + 2 ? palette[0] : palette[1];
            if (rand() < 0.22) color = palette[Math.min(palette.length - 1, 2)];
          } else {
            color = null; // 透明
          }
          row.push(color);
        }
        matrix.push(row);
      }

      // 眼睛：两颗浅色点，让人一眼能认出「这是个人」
      const eyeY = Math.round(headCy + headR * 0.12);
      const eyeDx = Math.max(1, Math.round(headR * 0.42));
      const eyeColor = palette[palette.length - 1];
      const ex = Math.round(headCx);
      if (matrix[eyeY]) {
        if (ex - eyeDx >= 0) matrix[eyeY][ex - eyeDx] = eyeColor;
        if (ex + eyeDx < cols) matrix[eyeY][ex + eyeDx] = eyeColor;
      }
    } else {
      // ---- 背景：地平线 + 起伏 + 噪点 ----
      const horizon = Math.round(rows * (asset.horizon || 0.62));
      const base = palette[0];
      const ground = palette[1];
      const far = palette[Math.min(palette.length - 1, 2)];
      const highlight = palette[palette.length - 1];

      for (let y = 0; y < rows; y++) {
        const row = [];
        for (let x = 0; x < cols; x++) {
          let color;
          if (y < horizon) {
            color = y < horizon * 0.35 ? base : ground;
            if (rand() < 0.10) color = far;                   // 云 / 树冠
          } else {
            color = ground;
            if (rand() < 0.16) color = base;
          }
          row.push(color);
        }
        matrix.push(row);
      }

      // 地平线：一条亮线，让画面有「远处」的感觉
      for (let x = 0; x < cols; x++) {
        if (rand() < 0.85) matrix[horizon][x] = highlight;
      }

      // 几个竖立的「建筑」：塔楼、树、旗杆
      const towers = 2 + Math.floor(rand() * 3);
      for (let t = 0; t < towers; t++) {
        const tw = 2 + Math.floor(rand() * 3);
        const tx = Math.floor(rand() * Math.max(1, cols - tw));
        const th = Math.floor((rows - horizon) * (0.45 + rand() * 0.75));
        const ty = Math.max(0, horizon - th);
        for (let y = ty; y < horizon; y++) {
          for (let x = tx; x < Math.min(cols, tx + tw); x++) {
            matrix[y][x] = y === ty ? highlight : far;
          }
        }
      }
    }

    return { label: asset.label || '', kind: asset.kind, cols, rows, matrix };
  }

  /* ===================================================================
   * 3.5 多幕合并
   * =================================================================== */

  /**
   * 把几幕剧本合成一个 story 对象。
   * ---------------------------------------------------------------------
   * 一幕一个 story.json，各自写自己的 nodes 和新增素材；引擎只认一个 story，
   * 所以载入之后先用这个拼起来，再交给 new StoryEngine()。
   *
   * 合并规则：
   *   nodes                    按幕顺序拼接。顺序有意义 —— 章节标题沿 history
   *                            回溯、原文核对按节点顺序拼接正文，都依赖它
   *   art.assets / characters / povs
   *                            浅合并。同一个键两幕都定义了就必须一模一样，
   *                            不一样直接抛错：宁可当场炸，也不要静默覆盖
   *                            （覆盖出来的 bug 查不出来）
   *   meta / config / initialStats
   *                            取第一幕的。meta.acts 记下每一幕的 act/title/start
   *
   * @param {object[]} acts 已经是解析好的 story 对象，按幕顺序
   */
  function composeStories(acts) {
    if (!Array.isArray(acts) || acts.length === 0) throw new Error('composeStories 至少要一幕');
    const list = acts.map((a) => ((a && a.story) ? a.story : a));
    for (const s of list) {
      if (!s || typeof s !== 'object') throw new Error('composeStories 收到了不是 story 的东西');
    }

    const first = list[0];
    const nodes = [];
    const ids = new Set();
    const assets = {};
    const characters = {};
    const povs = {};
    const actsMeta = [];
    let roamData = null;      // 幕间自由活动：整块合并，不做深合并

    const mergeTable = (target, src, label, actNo) => {
      for (const key of Object.keys(src || {})) {
        const val = src[key];
        if (!(key in target)) { target[key] = val; continue; }
        if (JSON.stringify(target[key]) !== JSON.stringify(val)) {
          throw new Error(`第 ${actNo} 幕的${label}「${key}」和前面那一幕定义得不一样`);
        }
      }
    };

    list.forEach((story, i) => {
      const actNo = i + 1;
      for (const node of story.nodes || []) {
        if (ids.has(node.id)) throw new Error(`节点 id 在两幕里重了：${node.id}`);
        ids.add(node.id);
        nodes.push(node);
      }
      mergeTable(assets, story.art && story.art.assets, '素材', actNo);
      mergeTable(characters, story.characters, '角色', actNo);
      mergeTable(povs, story.povs, '视角', actNo);
      // 自由活动只在写了一幕时生效；两幕都写且不一样就是写重了。
      // 它内部有 rooms/hubs 两层，深合并只会制造歧义，所以整块认。
      if (story.freeRoam) {
        if (roamData && JSON.stringify(roamData) !== JSON.stringify(story.freeRoam)) {
          throw new Error(`第 ${actNo} 幕的幕间自由活动和前面那一幕定义得不一样`);
        }
        roamData = story.freeRoam;
      }
      const m = story.meta || {};
      actsMeta.push({ act: m.act || null, title: m.title || null, start: m.start || null });
    });

    const meta = Object.assign({}, first.meta);
    delete meta.continues;              // 已经拼完了，这个字段不能再往下传
    meta.acts = actsMeta;

    const composed = Object.assign({}, first, {
      meta,
      art: Object.assign({}, first.art, { assets }),
      characters,
      povs,
      nodes,
    });
    if (roamData) composed.freeRoam = roamData;
    return composed;
  }

  /* ===================================================================
   * 4. 引擎本体
   * =================================================================== */

  const EVENTS = ['start', 'pov', 'node', 'line', 'choices', 'outfit', 'effect', 'stats', 'end'];

  class StoryEngine {
    /**
     * @param {object} story  story.json 解析出来的对象
     * @param {object} [options]
     * @param {boolean} [options.showStats=false] 是否直接显示真实数值（默认隐藏）
     * @param {object}  [options.stats]  覆盖初始数值（读档用）
     */
    constructor(story, options) {
      if (!story || typeof story !== 'object') throw new Error('StoryEngine 需要一个 story 对象');
      const opts = options || {};

      this.story = story;
      this.meta = story.meta || {};
      this.config = story.config || {};
      this.povs = story.povs || {};
      this.characters = story.characters || {};
      this.assets = (story.art && story.art.assets) || {};
      this.roamData = story.freeRoam || null;   // 幕间自由活动的数据（没有就是 null）
      this.nodes = {};
      this.nodeOrder = [];

      for (const node of story.nodes || []) {
        this.nodes[node.id] = node;
        this.nodeOrder.push(node.id);
      }

      // 显示设置由 story.json 的 config 定，代码里只提供开关
      this.showStats = opts.showStats !== undefined ? !!opts.showStats : !!this.config.showStats;

      this.initialStats = Object.assign({}, story.initialStats || {}, opts.stats || {});
      this.statLabels = this.config.statLabels || {};
      this.statOrder = this.config.statOrder || Object.keys(this.statLabels);
      this.statNotes = this.config.statNotes || {};

      this._listeners = {};
      this._cache = new Map();  // 像素图缓存

      this.reset();
    }

    /* ---------------- 事件 ---------------- */

    on(event, fn) {
      (this._listeners[event] || (this._listeners[event] = [])).push(fn);
      return this;
    }

    off(event, fn) {
      const list = this._listeners[event];
      if (list) this._listeners[event] = list.filter((f) => f !== fn);
      return this;
    }

    emit(event, payload) {
      const list = this._listeners[event];
      if (!list) return;
      for (const fn of list.slice()) fn(payload, this);
    }

    /* ---------------- 状态 ---------------- */

    reset() {
      this.stats = deepClone(this.initialStats);
      this.node = null;
      this.lineIndex = 0;
      this.history = [];
      this.visited = new Set();
      this.ended = false;
      this._prevPov = null;
      this.povSwitchInfo = null;
      this.roam = null;          // 幕间自由活动的运行时状态，见 roamAdvance()
    }

    getStat(name) {
      const v = this.stats[name];
      return v === undefined ? 0 : v;
    }

    /** 仅供调试/读档：直接设置数值（会夹在 0~100） */
    setStat(name, value) {
      this.stats[name] = clamp(Math.round(Number(value) || 0), 0, 100);
      this.emit('stats', { stats: this.stats, reason: 'set' });
      return this.stats[name];
    }

    toggleStats(force) {
      this.showStats = force === undefined ? !this.showStats : !!force;
      this.emit('stats', { stats: this.stats, reason: 'toggle', show: this.showStats });
      return this.showStats;
    }

    /** 数值面板：showStats 为真给真实数字，否则只给一句感觉 */
    statPanel() {
      return this.statOrder.map((name) => {
        const value = this.getStat(name);
        return {
          name,
          label: this.statLabels[name] || name,
          value,
          display: this.showStats ? String(value) : '?',
          bar: this.showStats ? '#'.repeat(clamp(Math.round(value / 2), 0, 50)) : '',
        };
      });
    }

    /** 某个数值最近一次变化时给玩家的「感觉」，用于隐藏数值时的反馈 */
    noteFor(stat, delta) {
      const key = stat + (delta >= 0 ? '+' : '-');
      if (this.statNotes[key]) return this.statNotes[key];
      return delta >= 0 ? `${this.statLabels[stat] || stat} 上升了。` : `${this.statLabels[stat] || stat} 下降了。`;
    }

    /* ---------------- 条件 ---------------- */

    checkCondition(cond) {
      return evaluateCondition(cond, (name) => this.getStat(name));
    }

    /** 结算一组效果，返回人话描述（隐藏数值时用 note 代替数字） */
    applyEffects(effects) {
      if (!effects || !effects.length) return [];
      const results = [];
      for (const eff of effects) {
        const before = this.getStat(eff.stat);
        const after = clamp(before + Number(eff.value || 0), 0, 100);
        this.stats[eff.stat] = after;
        const delta = after - before;
        const result = {
          stat: eff.stat,
          label: this.statLabels[eff.stat] || eff.stat,
          delta,
          before,
          after,
          changed: delta !== 0,
          // 已经到底了就没变化 —— 这时候给一句「她软了一点」是骗人的，索性不出提示
          note: delta === 0 ? '' : (eff.note || this.noteFor(eff.stat, delta)),
        };
        results.push(result);
        this.emit('effect', result);
      }
      this.emit('stats', { stats: this.stats, reason: 'effect' });
      return results;
    }

    /* ---------------- 剧情跳转 ---------------- */

    /** 从起始节点开始 */
    start() {
      this.reset();
      this.emit('start', { meta: this.meta });
      this.enterNode(this.meta.start);
      return this.node;
    }

    enterNode(nodeId) {
      const node = this.nodes[nodeId];
      if (!node) throw new Error(`找不到节点：${nodeId}`);

      const prevPov = this._prevPov;
      this.node = node;
      this.lineIndex = 0;
      this.ended = false;
      this.history.push(nodeId);
      this.visited.add(nodeId);

      // ---- 视角切换：相邻两个节点的 pov 不一样就切 ----
      this.povSwitchInfo = null;
      if (prevPov && prevPov !== node.pov) {
        this.povSwitchInfo = {
          from: prevPov,
          to: node.pov,
          line: (node.povSwitch && node.povSwitch.line) || `${prevPov} 视角结束 —— ${node.pov} 视角开始`,
          pov: this.povs[node.pov] || null,
        };
        this.emit('pov', this.povSwitchInfo);
      }
      this._prevPov = node.pov;

      this.emit('node', { node, povSwitch: this.povSwitchInfo });
      return node;
    }

    get pov() { return this.node ? this.node.pov : null; }

    /**
     * 当前该显示的章节标题。分支节点（观察/仔细听/顺从那些）通常不写 title，
     * 这时沿来路回溯最近一个有标题的节点，而不是退回作品名——
     * 否则每进一个分支都会像是换了一章。
     */
    currentTitle() {
      for (let i = this.history.length - 1; i >= 0; i--) {
        const n = this.nodes[this.history[i]];
        if (n && n.title) return n.title;
      }
      return this.meta.title || '';
    }

    get povInfo() { return this.povs[this.pov] || {}; }

    /** 当前节点里条件满足的台词（if 不满足的直接跳过） */
    visibleLines() {
      if (!this.node || !this.node.dialogues) return [];
      return this.node.dialogues.filter((d) => this.checkCondition(d.if));
    }

    /**
     * 推进一行。返回：
     *   { type: 'line',    line, index, total }
     *   { type: 'choices', choices }
     *   { type: 'end',     node }
     */
    advance() {
      if (!this.node) throw new Error('还没 start()，没有当前节点');

      // 自由活动的锚点没有 dialogues/next/choices，整段交给状态机
      if (this._roamHasMenu()) return this.roamAdvance();

      const lines = this.visibleLines();
      if (this.lineIndex < lines.length) {
        const line = lines[this.lineIndex];
        const index = this.lineIndex;
        this.lineIndex += 1;
        const payload = {
          type: 'line',
          line,
          index,
          total: lines.length,
          speaker: line.speaker,
          name: (this.characters[line.speaker] || {}).displayName || line.speaker,
          color: (this.characters[line.speaker] || {}).color || null,
          narration: !!(this.characters[line.speaker] || {}).narration,
          portrait: (this.characters[line.speaker] || {}).portrait || null,
          context: this.currentArt(),
        };
        this.emit('line', payload);
        return payload;
      }

      // 台词播完了
      if (this.node.next) {
        this.enterNode(this.node.next);
        return this.advance();
      }
      if (this.hasChoices()) {
        const payload = { type: 'choices', choices: this.availableChoices() };
        this.emit('choices', payload);
        return payload;
      }

      this.ended = true;
      const payload = { type: 'end', node: this.node, stats: this.stats };
      this.emit('end', payload);
      return payload;
    }

    hasChoices() {
      // 自由活动的菜单是生成的，但永远至少有一项（最不济还有个「离开」）
      if (this._roamHasMenu()) return true;
      return !!(this.node && this.node.choices && this.node.choices.length);
    }

    /**
     * 当前节点的选项列表。被 if 挡住的照样返回，但 enabled=false，
     * 这样界面可以显示成灰掉的「🔒 …」（当前剧本没有用到，见闻闸门已删）。
     */
    availableChoices() {
      if (this._roamHasMenu()) {
        return this.roamMode() === 'outfit' ? this.outfitMenu() : this.roamMenu();
      }
      if (!this.hasChoices()) return [];
      return this.node.choices.map((choice, index) => {
        const enabled = this.checkCondition(choice.if);
        return {
          index,
          text: choice.text,
          hint: choice.hint || '',
          enabled,
          lockedHint: enabled ? '' : (choice.lockedHint || '条件不足'),
          effects: choice.effects || [],
          choice,
        };
      });
    }

    /** 选择。绕过界面直接调用被锁的选项也会被拒绝。 */
    choose(index) {
      if (this._roamHasMenu()) return this.roamChoose(index);
      if (!this.hasChoices()) return { ok: false, reason: 'no-choices' };
      const list = this.availableChoices();
      const item = list[index];
      if (!item) return { ok: false, reason: 'out-of-range' };
      if (!item.enabled) return { ok: false, reason: 'locked', lockedHint: item.lockedHint };

      const effects = this.applyEffects(item.choice.effects);
      this.enterNode(item.choice.next);
      return { ok: true, choice: item, effects, node: this.node, notes: effects.map((e) => e.note).filter(Boolean) };
    }

    /* ==================================================================
     * 幕间自由活动
     * ------------------------------------------------------------------
     * 它不是一条支线，而是一个「侧厅」：结局卡片上按「自由活动 ▶」进来，
     * 主线（含 enumeratePaths 枚举的那些路径）一个字节都不受影响。
     *
     * 位置还是用节点表示 —— 每个房间一个锚点节点、西比拉的每套装束各一个，
     * 所以「人在哪儿、此刻穿着什么」天然被 snapshot/restore/服务器存档记住，
     * 一句持久化代码都不用写。
     *
     * 菜单是运行时生成的（「离开」要回你从哪个 hub 进来的、「换装」要换到哪张
     * 立绘，都是运行时才知道的），但生成的形状和普通 choices 一模一样，
     * 所以界面那套灰显/数字键/点击的逻辑一行都不用改。
     *
     * 台词从 freeRoam 数据块里来（占位文本），不进节点 dialogues。
     * ================================================================== */

    /** 这个节点是不是自由活动的锚点 */
    isFreeRoamNode(node) {
      return !!(this.roamData && node && node.freeRoam);
    }

    /**
     * 锚点里也有「不是操作界面」的：`fr_the_end` 挂在 anchors 里（会被校验、
     * 也要能 enterRoam 进来），但它是「结束游戏」的落点，该走结局屏而不是弹菜单。
     * hub 和房间才是真的有界面。
     */
    _roamHasMenu() {
      if (!this.isFreeRoamNode(this.node)) return false;
      if (this._roamRoomName()) return true;
      return !!(this.roamData.hubs || {})[this.node.id];
    }

    /** 自由活动当前在「菜单」还是「换装浮层」 */
    roamMode() {
      return (this.roam && this.roam.mode) || 'menu';
    }

    /** 当前锚点属于哪个房间（不在任何房间里就是 null，即在 hub 上） */
    _roamRoomName() {
      const rooms = (this.roamData && this.roamData.rooms) || {};
      const id = this.node && this.node.id;
      for (const name of Object.keys(rooms)) {
        const r = rooms[name];
        if (r.anchor === id) return name;
        for (const oid of Object.keys(r.outfits || {})) {
          if (r.outfits[oid].node === id) return name;
        }
      }
      return null;
    }

    /** 这个房间里的人此刻穿着哪一套（按当前所在锚点反查） */
    _roamOutfitId(roomName) {
      const r = ((this.roamData || {}).rooms || {})[roomName];
      if (!r || !r.outfits) return null;
      const id = this.node && this.node.id;
      for (const oid of Object.keys(r.outfits)) {
        if (r.outfits[oid].node === id) return oid;
      }
      return r.defaultOutfit || Object.keys(r.outfits)[0] || null;
    }

    /** 这个房间此刻该在右槽显示哪张半身像（＝她当前的状态） */
    _roamRoomPortrait(roomName) {
      const r = ((this.roamData || {}).rooms || {})[roomName];
      if (!r) return null;
      if (r.outfits) {
        const o = r.outfits[this._roamOutfitId(roomName)] || {};
        return o.half || null;
      }
      return r.portrait || null;
    }

    /**
     * 读档直接落在锚点上、或从结局卡片以外的地方进来时，
     * 需要猜一下「离开房间」该回哪个 hub。锚点本身不记这件事，
     * 但 hub 上写了它是「哪个结局之后」（after），而 visited 是存了档的 —— 够准。
     */
    _roamGuessHub() {
      const hubs = (this.roamData && this.roamData.hubs) || {};
      const keys = Object.keys(hubs);
      if (!keys.length) return null;
      for (let i = keys.length - 1; i >= 0; i--) {
        const after = hubs[keys[i]].after;
        if (after && this.visited.has(after)) return keys[i];
      }
      return keys[0];
    }

    /** 「去某人的房间」该落到哪个锚点：没有 outfits 的房间直接用 anchor */
    _roamRoomEntry(roomName) {
      const r = ((this.roamData || {}).rooms || {})[roomName];
      if (!r) return null;
      if (r.anchor) return r.anchor;
      const outfits = r.outfits || {};
      const id = r.defaultOutfit || Object.keys(outfits)[0];
      return (outfits[id] || {}).node || null;
    }

    /** 现在的房间 / 该回哪个 hub（纯查，不改状态） */
    _roamState() {
      const room = this._roamRoomName();
      let hub = (this.roam && this.roam.hub) || null;
      if (!hub) hub = this._roamGuessHub();
      return { room, hub, isHub: !room };
    }

    /**
     * 每次吐菜单/台词前对一次表：换锚点了就把开场白重新排上、退出换装浮层。
     * `entryNode` 记着「这份 queue 是哪儿的」，所以同一句话不会被重复排两遍。
     */
    _roamSync() {
      const st = this._roamState();
      if (!this.roam) {
        this.roam = { hub: st.hub, room: st.room, entryNode: null, queue: [], queueIndex: 0,
                      mode: 'menu', outfit: null, outfitLine: null };
      }
      if (this.roam.entryNode === this.node.id) return;
      const d = this.roamData;
      const src = (st.room ? (d.rooms || {})[st.room] : (d.hubs || {})[this.node.id]) || {};
      this.roam.hub = st.hub;
      this.roam.room = st.room;
      this.roam.entryNode = this.node.id;
      this.roam.queue = (src.lines || []).slice();
      this.roam.queueIndex = 0;
      this.roam.mode = 'menu';
      this.roam.outfit = null;
      this.roam.outfitLine = null;
    }

    /** 这个结局之后该进哪个 hub（hubs 里写了 after = 这个节点 id 的那个）。没有就返回 null。 */
    roamAnchorAfter(nodeId) {
      const hubs = (this.roamData && this.roamData.hubs) || {};
      for (const key of Object.keys(hubs)) {
        if (hubs[key].after === nodeId) return key;
      }
      return null;
    }

    /** 进自由活动（结局卡片上「自由活动 ▶」按的那个）。anchorId 必须是声明过的锚点。 */
    enterRoam(anchorId) {
      const d = this.roamData;
      if (!d) return { ok: false, reason: 'no-free-roam' };
      const anchors = d.anchors || [];
      if (anchors.indexOf(anchorId) < 0 || !this.nodes[anchorId]) {
        return { ok: false, reason: 'not-an-anchor', anchorId };
      }
      const hubs = d.hubs || {};
      this.roam = {
        hub: hubs[anchorId] ? anchorId : this._roamGuessHub(),
        room: null, entryNode: null, queue: [], queueIndex: 0,
        mode: 'menu', outfit: null, outfitLine: null,
      };
      this.enterNode(anchorId);
      return { ok: true, node: this.node, roam: this.roam };
    }

    /** 自由活动里的一行台词：形状和 advance() 里那条完全一致，界面照旧能用 */
    _roamLineView(line, index, total) {
      const ch = this.characters[line.speaker] || {};
      let portrait = ch.portrait || null;
      // 房间里说话的人要是「她」，立绘得跟着当前装束走，不能退回默认那张
      const room = (this.roamData.rooms || {})[this.roam && this.roam.room];
      if (room && line.speaker === room.speaker) {
        portrait = this._roamRoomPortrait(this.roam.room) || portrait;
      }
      return {
        type: 'line',
        line,
        index,
        total,
        speaker: line.speaker,
        name: ch.displayName || line.speaker,
        color: ch.color || null,
        narration: !!ch.narration,
        portrait,
        context: this.currentArt(),
        roam: true,
      };
    }

    /** 右槽该画谁：在房间里就是房间里那个人此刻的样子 */
    _roamRoomView() {
      if (!this.roam || !this.roam.room) return null;
      const r = (this.roamData.rooms || {})[this.roam.room] || {};
      return {
        name: this.roam.room,
        speaker: r.speaker || null,
        portrait: this._roamRoomPortrait(this.roam.room),
      };
    }

    /**
     * 自由活动的心跳。顺序有讲究：换装浮层排在最前 ——
     * 浮层里没有对话框，她的那句话挂在浮层自己身上（outfitLine），
     * 不能走 line 视图，否则对话框会同时冒出来。
     */
    roamAdvance() {
      this._roamSync();

      if (this.roam.mode === 'outfit') {
        const payload = this._outfitView();
        this.emit('outfit', payload);
        return payload;
      }

      if (this.roam.queueIndex < this.roam.queue.length) {
        const line = this.roam.queue[this.roam.queueIndex];
        const index = this.roam.queueIndex;
        this.roam.queueIndex += 1;
        const payload = this._roamLineView(line, index, this.roam.queue.length);
        this.emit('line', payload);
        return payload;
      }

      const payload = { type: 'choices', choices: this.roamMenu(), room: this._roamRoomView() };
      this.emit('choices', payload);
      return payload;
    }

    /** 把一条菜单项摆成和 availableChoices() 一样的形状 */
    _roamItem(items, text, hint, roam, opts) {
      items.push(Object.assign({
        index: items.length,
        text,
        hint: hint || '',
        enabled: true,
        lockedHint: '',
        effects: [],
        roam,
      }, opts || {}));
      return items;
    }

    /** 当前该显示的菜单（在 hub 上和在房间里不一样） */
    roamMenu() {
      const d = this.roamData || {};
      const st = this._roamState();
      const items = [];

      if (!st.room) {
        for (const name of Object.keys(d.rooms || {})) {
          const r = d.rooms[name] || {};
          this._roamItem(items, `去${name}的房间`, r.hint || '', { kind: 'goto', room: name });
        }
        for (const l of d.locked || []) {
          this._roamItem(items, l.label, '', { kind: 'locked' }, { enabled: false, lockedHint: l.hint || '还没做' });
        }
        const hub = (d.hubs || {})[this.node.id] || {};
        if (hub.nextAct && this.nodes[hub.nextAct]) {
          this._roamItem(items, (d.labels || {}).nextAct || '进入下一幕', '', { kind: 'goto', node: hub.nextAct });
        }
        if (hub.endNode && this.nodes[hub.endNode]) {
          this._roamItem(items, (d.labels || {}).endGame || '结束游戏', '', { kind: 'goto', node: hub.endNode });
        }
        return items;
      }

      const room = (d.rooms || {})[st.room] || {};
      for (const a of room.actions || []) {
        this._roamItem(items, a.label, a.hint || '', { kind: 'action', action: a.id });
      }
      if (room.canChangeOutfit && room.outfits) {
        this._roamItem(items, (d.labels || {}).changeOutfit || '换装', '', { kind: 'outfitOpen' });
      }
      this._roamItem(items, (d.labels || {}).leave || '离开', '', { kind: 'goto', node: st.hub });
      return items;
    }

    /** 换装浮层里的菜单：四套衣服 + 退出 + （有的话）下一幕 / 结束游戏 */
    outfitMenu() {
      const d = this.roamData || {};
      const st = this._roamState();
      const room = (d.rooms || {})[st.room] || {};
      const worn = this._roamOutfitId(st.room);
      const labels = d.labels || {};
      const items = [];

      for (const id of Object.keys(room.outfits || {})) {
        const o = room.outfits[id] || {};
        this._roamItem(items, o.label || id, o.hint || '', { kind: 'wear', outfit: id }, {
          worn: id === worn,
          effects: o.effects || [],
        });
      }
      this._roamItem(items, labels.outfitExit || '退出换装', '', { kind: 'outfitClose' });

      const hub = (d.hubs || {})[st.hub] || {};
      if (hub.nextAct && this.nodes[hub.nextAct]) {
        this._roamItem(items, labels.nextAct || '进入下一幕', '', { kind: 'goto', node: hub.nextAct });
      }
      if (hub.endNode && this.nodes[hub.endNode]) {
        this._roamItem(items, labels.endGame || '结束游戏', '', { kind: 'goto', node: hub.endNode });
      }
      return items;
    }

    /** 换装浮层要画的：居中的全身立绘 + 她此刻那句话 */
    _outfitView() {
      const d = this.roamData || {};
      const st = this._roamState();
      const room = (d.rooms || {})[st.room] || {};
      const worn = this._roamOutfitId(st.room);
      const o = (room.outfits || {})[worn] || {};
      return {
        type: 'outfit',
        node: this.node,
        title: (d.labels || {}).outfitTitle || '换装',
        roomName: st.room,
        speaker: room.speaker || null,
        outfit: worn,
        outfitLabel: o.label || '',
        full: o.full || null,
        fullAsset: o.full ? this.assets[o.full] || null : null,
        line: this.roam.outfitLine || null,
        choices: this.outfitMenu(),
        context: this.currentArt(),
      };
    }

    /** 自由活动里的选择。菜单项的形状和普通选项一样，靠 item.roam 分派。 */
    roamChoose(index) {
      if (this._roamHasMenu()) this._roamSync();
      const list = this.availableChoices();
      const item = list[index];
      if (!item) return { ok: false, reason: 'out-of-range' };
      if (!item.enabled) return { ok: false, reason: 'locked', lockedHint: item.lockedHint };

      const r = item.roam || {};
      if (r.kind === 'goto') {
        // 「去某人的房间」只报了房间名，落到哪个锚点由数据决定（有 outfits 的房间默认穿第一套）
        const target = r.node || this._roamRoomEntry(r.room);
        if (!target || !this.nodes[target]) return { ok: false, reason: 'no-such-room', room: r.room };
        this.enterNode(target);
        return { ok: true, choice: item, effects: [], node: this.node, notes: [] };
      }
      if (r.kind === 'action') return this._roamDoAction(r.action, item);
      if (r.kind === 'outfitOpen') {
        this.roam.mode = 'outfit';
        this.roam.outfit = this._roamOutfitId(this.roam.room);
        this.roam.outfitLine = this.roamData.outfitOpening || null;
        this.roam.queue = [];
        this.roam.queueIndex = 0;
        return { ok: true, choice: item, effects: [], node: this.node, notes: [] };
      }
      if (r.kind === 'outfitClose') {
        this.roam.mode = 'menu';
        this.roam.outfit = null;
        this.roam.outfitLine = null;
        this.roam.queue = [];
        this.roam.queueIndex = 0;
        return { ok: true, choice: item, effects: [], node: this.node, notes: [] };
      }
      if (r.kind === 'wear') return this._roamWear(r.outfit, item);
      return { ok: false, reason: 'unknown-roam-item' };
    }

    /**
     * 称赞 / 普通对话 / 触摸。触摸那类写了 branches 的，第一条条件命中的就用它，
     * 最后一条通常不写 if，是兜底 —— 这就是「好感低就警惕上升」的判定。
     */
    _roamDoAction(actionId, item) {
      const st = this._roamState();
      const room = ((this.roamData.rooms || {})[st.room]) || {};
      const action = (room.actions || []).filter((a) => a.id === actionId)[0];
      if (!action) return { ok: false, reason: 'no-such-action', action: actionId };

      let picked = null;
      for (const br of action.branches || []) {
        if (!br.if || this.checkCondition(br.if)) { picked = br; break; }
      }
      if (!picked) picked = action;      // 没有 branches，或者 branches 全都没命中

      const effects = this.applyEffects(picked.effects);
      this.roam.queue = (picked.lines || []).slice();
      this.roam.queueIndex = 0;
      return {
        ok: true,
        choice: item,
        effects,
        node: this.node,
        notes: effects.map((e) => e.note).filter(Boolean),
        roam: { kind: 'action', action: actionId, branch: picked === action ? null : (picked.if || null) },
      };
    }

    /** 换一身。反复穿同一套不重复加好感（否则来回切就能刷）。 */
    _roamWear(outfitId, item) {
      const st = this._roamState();
      const room = ((this.roamData.rooms || {})[st.room]) || {};
      const outfit = (room.outfits || {})[outfitId];
      if (!outfit) return { ok: false, reason: 'no-such-outfit', outfit: outfitId };

      const wasWearing = this._roamOutfitId(st.room);
      const changed = wasWearing !== outfitId;
      const effects = changed ? this.applyEffects(outfit.effects) : [];

      this.enterNode(outfit.node);            // 装束＝位置，存档天然记住她此刻穿什么
      this.roam.room = st.room;
      this.roam.entryNode = outfit.node;      // 别让 _roamSync 把浮层状态冲掉
      this.roam.mode = 'outfit';
      this.roam.outfit = outfitId;
      this.roam.outfitLine = outfit.line || null;
      this.roam.queue = [];
      this.roam.queueIndex = 0;

      return {
        ok: true, choice: item, effects, node: this.node, changed,
        notes: effects.map((e) => e.note).filter(Boolean),
      };
    }

    /* ---------------- 画面素材 ---------------- */

    /** 当前该画什么背景 / 立绘（没写 art 就沿用上一个节点的） */
    currentArt() {
      if (!this.node) return { bg: null, portrait: null };
      const art = this.node.art || {};
      const bgKey = art.bg || this._lastBg || (this.meta.start && this.nodes[this.meta.start] && (this.nodes[this.meta.start].art || {}).bg) || null;
      const portraitKey = art.portrait || null;
      this._lastBg = bgKey;
      return {
        bg: bgKey,
        bgAsset: bgKey ? this.assets[bgKey] : null,
        portrait: portraitKey,
        portraitAsset: portraitKey ? this.assets[portraitKey] : null,
      };
    }

    /** 取像素块图（带缓存，同一个 asset 只算一次） */
    pixelArt(key) {
      const asset = this.assets[key];
      if (!asset) return null;
      if (!this._cache.has(key)) this._cache.set(key, buildPixelArt(asset));
      return this._cache.get(key);
    }

    /* ---------------- 存档 ---------------- */

    snapshot() {
      return {
        version: 1,
        nodeId: this.node ? this.node.id : this.meta.start,
        pov: this.pov,
        stats: deepClone(this.stats),
        lineIndex: this.lineIndex,
        visited: Array.from(this.visited),
        history: this.history.slice(),
        showStats: this.showStats,
        savedAt: new Date().toISOString(),
      };
    }

    /** 和快照配套的恢复；返回被恢复到的节点 */
    restore(snap) {
      if (!snap || !snap.nodeId) throw new Error('存档里没有 nodeId');
      this.showStats = snap.showStats !== undefined ? !!snap.showStats : this.showStats;
      this.stats = Object.assign(deepClone(this.initialStats), snap.stats || {});
      this.visited = new Set(snap.visited || []);
      this._prevPov = null;                 // 读档时不算「切换视角」，避免开场就弹提示
      // 存档的 history 末尾就是当前节点，而 enterNode() 还会再压一次，
      // 所以先把那条摘掉，否则每读一次档来路就多一节（「第 N 步」会越读越大）。
      this.history = (snap.history || []).slice();
      if (this.history[this.history.length - 1] === snap.nodeId) this.history.pop();
      this.enterNode(snap.nodeId);
      this.lineIndex = clamp(Number(snap.lineIndex) || 0, 0, this.visibleLines().length);
      this.emit('stats', { stats: this.stats, reason: 'restore' });
      return this.node;
    }

    /* ---------------- 自检 ---------------- */

    /** 检查 story.json 有没有写错（悬空跳转、未知角色、未定义数值等） */
    validate() {
      const errors = [];
      const warnings = [];
      const ids = new Set();

      const startId = this.meta.start;
      if (!startId) errors.push('meta.start 没有写');
      else if (!this.nodes[startId]) errors.push(`meta.start 指向不存在的节点：${startId}`);

      if (this.nodeOrder.length === 0) errors.push('nodes 是空的');

      const knownStats = new Set(Object.keys(this.statLabels));
      const checkStats = (obj, where) => {
        if (obj && obj.stat && !knownStats.has(obj.stat)) {
          errors.push(`${where} 用了未定义的数值：${obj.stat}`);
        }
      };

      // 自由活动锚点是从结局卡片进去的，没有节点指向它们也算走得到。
      // 顺带把 hubs 里的 nextAct/endNode 也算成「有人指向」。
      const roamRefs = new Set();
      if (this.roamData) {
        const d = this.roamData;
        for (const a of d.anchors || []) roamRefs.add(a);
        for (const key of Object.keys(d.hubs || {})) {
          const h = d.hubs[key] || {};
          if (h.nextAct) roamRefs.add(h.nextAct);
          if (h.endNode) roamRefs.add(h.endNode);
        }
        for (const name of Object.keys(d.rooms || {})) {
          const r = d.rooms[name] || {};
          if (r.anchor) roamRefs.add(r.anchor);
          for (const oid of Object.keys(r.outfits || {})) roamRefs.add(r.outfits[oid].node);
        }
      }

      for (const id of this.nodeOrder) {
        const node = this.nodes[id];
        if (ids.has(id)) errors.push(`节点 id 重复：${id}`);
        ids.add(id);

        if (!node.pov) errors.push(`${id} 没有写 pov`);
        else if (!this.povs[node.pov]) errors.push(`${id} 的 pov「${node.pov}」不在 povs 里`);

        const art = node.art || {};
        for (const k of ['bg', 'portrait']) {
          if (art[k] && !this.assets[art[k]]) errors.push(`${id} 的 art.${k} 指向不存在的素材：${art[k]}`);
        }

        for (const d of node.dialogues || []) {
          if (!d.speaker) errors.push(`${id} 有一行台词没写 speaker`);
          else if (!this.characters[d.speaker]) warnings.push(`${id} 的说话人「${d.speaker}」不在 characters 里`);
          if (!d.text) errors.push(`${id} 有一行台词是空的`);
          checkStats(d.if, `${id} 的台词条件`);
        }

        // 结局节点要显式写 "ending": true，否则没接上就是写漏了。
        // 自由活动的锚点例外：它们的菜单是引擎生成的，本来就不写 choices/next。
        const hasChoices = node.choices && node.choices.length;
        if (!hasChoices && !node.next && !node.ending && !this.isFreeRoamNode(node)) {
          errors.push(`${id} 既没有 choices 也没有 next，剧情会卡死（是结局就写 "ending": true）`);
        }

        for (const c of node.choices || []) {
          if (!c.text) errors.push(`${id} 有一个选项没写 text`);
          if (!c.next) errors.push(`${id} 的选项「${c.text}」没写 next`);
          else if (!this.nodes[c.next]) errors.push(`${id} 的选项「${c.text}」指向不存在的节点：${c.next}`);
          checkStats(c.if, `${id} 的选项条件`);
          if (!c.if && c.lockedHint) warnings.push(`${id} 的选项「${c.text}」写了 lockedHint 但没有 if，永远不会锁`);
          for (const eff of c.effects || []) {
            if (!eff.stat) errors.push(`${id} 的选项「${c.text}」有个效果没写 stat`);
            else if (!knownStats.has(eff.stat)) errors.push(`${id} 的选项「${c.text}」影响了未定义的数值：${eff.stat}`);
            if (typeof eff.value !== 'number') errors.push(`${id} 的选项「${c.text}」的效果 value 不是数字：${eff.value}`);
          }
        }

        if (node.next && !this.nodes[node.next]) errors.push(`${id} 的 next 指向不存在的节点：${node.next}`);

        // continueTo：结局屏上「继续下一幕」按的那个按钮往哪走
        if (node.continueTo) {
          if (!this.nodes[node.continueTo]) {
            errors.push(`${id} 的 continueTo 指向不存在的节点：${node.continueTo}`);
          }
          if (!node.ending) {
            errors.push(`${id} 写了 continueTo 却不是结局节点（continueTo 只在结局屏上用，要配 "ending": true）`);
          }
        }

        // 走不到的节点提示一下（可能是忘了接上）
        if (id !== startId && !roamRefs.has(id)) {
          const referenced = this.nodeOrder.some((other) => {
            const o = this.nodes[other];
            if (o.next === id) return true;
            if (o.continueTo === id) return true;      // 跨幕的入口也是入口
            return (o.choices || []).some((c) => c.next === id);
          });
          if (!referenced) warnings.push(`${id} 没有任何节点指向它，走不到`);
        }
      }

      // 有没有结局（没有 next / choices 的节点）。
      // 自由活动的锚点也「没有 next 也没有 choices」，但它们是菜单不是结局，得排除 ——
      // 除非它自己写了 "ending": true（`fr_the_end` 就是「结束游戏」的落点）。
      const endings = this.nodeOrder.filter((id) => {
        const n = this.nodes[id];
        if (this.isFreeRoamNode(n) && !n.ending) return false;
        return !n.next && !(n.choices && n.choices.length);
      });
      if (endings.length === 0) warnings.push('没有任何结局节点（剧情会一直走下去）');

      this.validateRoam(errors, warnings, knownStats);

      return {
        ok: errors.length === 0,
        errors,
        warnings,
        stats: { nodes: this.nodeOrder.length, endings, povs: Object.keys(this.povs) },
      };
    }

    /** 自检幕间自由活动那一块：锚点、房间、装束、菜单跳转、数值，都要能落到实处 */
    validateRoam(errors, warnings, knownStats) {
      const d = this.roamData;
      if (!d) return;

      const checkEffects = (effects, where) => {
        for (const eff of effects || []) {
          if (!eff.stat) errors.push(`${where} 有个效果没写 stat`);
          else if (!knownStats.has(eff.stat)) errors.push(`${where} 影响了未定义的数值：${eff.stat}`);
          if (typeof eff.value !== 'number') errors.push(`${where} 的效果 value 不是数字：${eff.value}`);
        }
      };
      const checkLines = (lines, where) => {
        if (!lines || !lines.length) { warnings.push(`${where} 一句话都没有`); return; }
        for (const l of lines) {
          if (!l.speaker) errors.push(`${where} 有一行没写 speaker`);
          else if (!this.characters[l.speaker]) warnings.push(`${where} 的说话人「${l.speaker}」不在 characters 里`);
          if (!l.text) errors.push(`${where} 有一行是空的`);
        }
      };

      const anchors = d.anchors || [];
      if (!anchors.length) errors.push('freeRoam.anchors 是空的');
      for (const a of anchors) {
        if (!this.nodes[a]) errors.push(`freeRoam.anchors 指向不存在的节点：${a}`);
        else if (!this.nodes[a].freeRoam) errors.push(`freeRoam.anchors 里的 ${a} 没有写 "freeRoam": true`);
      }

      if (d.affinity) {
        if (!knownStats.has(d.affinity.stat)) {
          errors.push(`freeRoam.affinity 用了未定义的数值：${d.affinity.stat}`);
        }
        if (typeof d.affinity.threshold !== 'number') {
          errors.push(`freeRoam.affinity.threshold 不是数字：${d.affinity.threshold}`);
        }
      } else {
        warnings.push('freeRoam 没写 affinity，分支条件里的好感阈值只能靠节点自己写');
      }

      const hubs = d.hubs || {};
      if (!Object.keys(hubs).length) errors.push('freeRoam.hubs 是空的，进自由活动会没有落脚点');
      for (const key of Object.keys(hubs)) {
        const h = hubs[key] || {};
        if (!this.nodes[key]) errors.push(`freeRoam.hubs 的「${key}」不是节点`);
        else if (!this.nodes[key].freeRoam) errors.push(`freeRoam.hubs 的「${key}」没有写 "freeRoam": true`);
        if (h.nextAct && !this.nodes[h.nextAct]) errors.push(`freeRoam.hubs.${key}.nextAct 指向不存在的节点：${h.nextAct}`);
        if (h.endNode && !this.nodes[h.endNode]) errors.push(`freeRoam.hubs.${key}.endNode 指向不存在的节点：${h.endNode}`);
        if (h.after && !this.nodes[h.after]) warnings.push(`freeRoam.hubs.${key}.after 指向不存在的节点：${h.after}`);
        checkLines(h.lines, `freeRoam.hubs.${key}`);
      }

      const rooms = d.rooms || {};
      if (!Object.keys(rooms).length) errors.push('freeRoam.rooms 是空的，没地方可去');
      for (const name of Object.keys(rooms)) {
        const r = rooms[name] || {};
        const at = `freeRoam.rooms.${name}`;
        if (!r.speaker) errors.push(`${at} 没写 speaker`);
        checkLines(r.lines, at);

        if (r.anchor) {
          if (!this.nodes[r.anchor]) errors.push(`${at}.anchor 指向不存在的节点：${r.anchor}`);
          else if (!this.nodes[r.anchor].freeRoam) errors.push(`${at}.anchor 的 ${r.anchor} 没有写 "freeRoam": true`);
        } else if (!r.outfits) {
          errors.push(`${at} 既没有 anchor 也没有 outfits，进不去`);
        }

        for (const oid of Object.keys(r.outfits || {})) {
          const o = r.outfits[oid] || {};
          if (!o.label) errors.push(`${at}.outfits.${oid} 没写 label`);
          if (!this.nodes[o.node]) errors.push(`${at}.outfits.${oid}.node 指向不存在的节点：${o.node}`);
          else if (!this.nodes[o.node].freeRoam) errors.push(`${at}.outfits.${oid}.node 的 ${o.node} 没有写 "freeRoam": true`);
          if (!o.half) errors.push(`${at}.outfits.${oid} 没写 half（房间里右槽要用的半身像）`);
          else if (!this.assets[o.half]) errors.push(`${at}.outfits.${oid}.half 指向不存在的素材：${o.half}`);
          if (!o.full) errors.push(`${at}.outfits.${oid} 没写 full（换装浮层要用的全身像）`);
          else if (!this.assets[o.full]) errors.push(`${at}.outfits.${oid}.full 指向不存在的素材：${o.full}`);
          if (o.line) checkLines([o.line], `${at}.outfits.${oid}.line`);
          checkEffects(o.effects, `${at}.outfits.${oid}`);
        }
        if (r.canChangeOutfit && !r.outfits) errors.push(`${at} 说了能换装却没有 outfits`);
        if (r.outfits && r.defaultOutfit && !r.outfits[r.defaultOutfit]) {
          errors.push(`${at}.defaultOutfit 指向不存在的装束：${r.defaultOutfit}`);
        }

        const acts = r.actions || [];
        if (!acts.length) warnings.push(`${at} 一个可做的事都没有`);
        for (const a of acts) {
          if (!a.id) errors.push(`${at} 有个动作没写 id`);
          if (!a.label) errors.push(`${at} 的动作「${a.id}」没写 label`);
          if (a.branches && a.branches.length) {
            a.branches.forEach((br, i) => {
              checkLines(br.lines, `${at}.${a.id} 第 ${i + 1} 条分支`);
              checkEffects(br.effects, `${at}.${a.id} 第 ${i + 1} 条分支`);
            });
            const last = a.branches[a.branches.length - 1];
            if (last.if) {
              warnings.push(`${at}.${a.id} 最后一条分支也写了 if，条件都不满足时会没有反应（留一条不写 if 的兜底）`);
            }
          } else {
            checkLines(a.lines, `${at}.${a.id}`);
            checkEffects(a.effects, `${at}.${a.id}`);
          }
        }
      }

      for (const l of d.locked || []) {
        if (!l.label) errors.push('freeRoam.locked 里有一项没写 label');
      }

      const labels = d.labels || {};
      for (const k of ['leave', 'changeOutfit', 'outfitExit', 'nextAct', 'endGame']) {
        if (!labels[k]) warnings.push(`freeRoam.labels 没写 ${k}，界面上会退回默认中文`);
      }
      if (d.outfitOpening) checkLines([d.outfitOpening], 'freeRoam.outfitOpening');
    }
  }


  /* ===================================================================
   * 5. 导出
   * =================================================================== */

  /* 只导出纯逻辑。终端渲染器 / 命令行在 game.js，网页渲染在 ui.js。
     clamp 和 padTo 是给终端渲染器用的排版小工具。 */
  return {
    StoryEngine,
    buildPixelArt,
    composeStories,
    evaluateCondition,
    hashString,
    mulberry32,
    wrapCJK,
    displayWidth,
    clamp,
    padTo,
  };
});
