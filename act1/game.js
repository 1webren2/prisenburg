/**
 * 第一幕 · 剧情引擎（story.json 的配套逻辑）
 * =====================================================================
 * 这一版刻意不碰 DOM：引擎只负责「剧情怎么走」，不负责「画在哪里」。
 *   - 浏览器里：window.Act1Story 暴露 StoryEngine，将来写 index.html 时套一层渲染器即可
 *   - Node 里：  node act1/game.js 直接在终端里玩（用 ANSI 真彩色画像素块）
 *
 * 负责四件事：
 *   1. 视角切换  —— 相邻两个节点 pov 不同就触发 pov 事件（序章 西比拉 → 主场 奥布里）
 *   2. 数值系统  —— 隐藏数值：伊莎贝尔_好感 / 西比拉_警惕
 *                    默认不显示数字，只给一句「感觉」；按 V 才显示真实数值
 *   3. 剧情跳转  —— 节点、台词（支持 if 条件行）、选项（支持 if 解锁 / 锁定提示）
 *   4. 像素块占位 —— 没有立绘素材，用确定性随机数（同一个 asset 每次画出来一模一样）生成像素图
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
    if (typeof require === 'function' && require.main === module) {
      api.main(process.argv.slice(2));
    }
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
   * 4. 引擎本体
   * =================================================================== */

  const EVENTS = ['start', 'pov', 'node', 'line', 'choices', 'effect', 'stats', 'end'];

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
        const result = {
          stat: eff.stat,
          label: this.statLabels[eff.stat] || eff.stat,
          delta: after - before,
          before,
          after,
          note: eff.note || this.noteFor(eff.stat, after - before),
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
      return !!(this.node && this.node.choices && this.node.choices.length);
    }

    /**
     * 当前节点的选项列表。被 if 挡住的照样返回，但 enabled=false，
     * 这样界面可以显示成灰掉的「🔒 …」（当前剧本没有用到，见闻闸门已删）。
     */
    availableChoices() {
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
      if (!this.hasChoices()) return { ok: false, reason: 'no-choices' };
      const list = this.availableChoices();
      const item = list[index];
      if (!item) return { ok: false, reason: 'out-of-range' };
      if (!item.enabled) return { ok: false, reason: 'locked', lockedHint: item.lockedHint };

      const effects = this.applyEffects(item.choice.effects);
      this.enterNode(item.choice.next);
      return { ok: true, choice: item, effects, node: this.node, notes: effects.map((e) => e.note) };
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

        // 结局节点要显式写 "ending": true，否则没接上就是写漏了
        const hasChoices = node.choices && node.choices.length;
        if (!hasChoices && !node.next && !node.ending) {
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

        // 走不到的节点提示一下（可能是忘了接上）
        if (id !== startId) {
          const referenced = this.nodeOrder.some((other) => {
            const o = this.nodes[other];
            if (o.next === id) return true;
            return (o.choices || []).some((c) => c.next === id);
          });
          if (!referenced) warnings.push(`${id} 没有任何节点指向它，走不到`);
        }
      }

      // 有没有结局（没有 next / choices 的节点）
      const endings = this.nodeOrder.filter((id) => {
        const n = this.nodes[id];
        return !n.next && !(n.choices && n.choices.length);
      });
      if (endings.length === 0) warnings.push('没有任何结局节点（剧情会一直走下去）');

      return {
        ok: errors.length === 0,
        errors,
        warnings,
        stats: { nodes: this.nodeOrder.length, endings, povs: Object.keys(this.povs) },
      };
    }
  }

  /* ===================================================================
   * 5. 终端渲染器（ANSI 真彩色画像素块）
   * =================================================================== */

  const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
  };

  const RAMP = ' .:-=+*#%@';   // 关掉颜色时的替代方案

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
  }

  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  class ConsoleRenderer {
    constructor(engine, options) {
      const opts = options || {};
      this.engine = engine;
      this.color = opts.color !== undefined ? !!opts.color : true;
      this.clear = opts.clear !== false;
      this.boxWidth = opts.boxWidth || 58;
      this.out = opts.out || ((s) => process.stdout.write(s));
      this.last = null;         // 最近一次的错误 / 提示
      this.dataPath = opts.dataPath || null;
    }

    /* ---- 绘制像素块 ---- */
    paint(art, indent) {
      if (!art) return '';
      if (!Array.isArray(art.matrix)) {
        // 传进来的多半是 story.json 里的素材定义，忘了过 pixelArt()
        throw new Error('paint() 需要 buildPixelArt() 生成的图（要有 matrix），请用 engine.pixelArt(key)');
      }
      const lines = [];
      const pad = indent || '';
      for (const row of art.matrix) {
        let s = pad;
        if (this.color) {
          let current = null;
          for (const cell of row) {
            if (cell === null || cell === undefined) {
              if (current !== null) { s += ANSI.reset; current = null; }
              s += ' ';
              continue;
            }
            if (cell !== current) {
              const [r, g, b] = hexToRgb(cell);
              s += `\x1b[38;2;${r};${g};${b}m`;
              current = cell;
            }
            s += '█';
          }
          s += ANSI.reset;
        } else {
          for (const cell of row) {
            if (cell === null || cell === undefined) { s += ' '; continue; }
            s += RAMP[clamp(Math.round(luminance(cell) * (RAMP.length - 1)), 0, RAMP.length - 1)];
          }
        }
        lines.push(s);
      }
      return lines.join('\n') + '\n';
    }

    box(lines, opts) {
      const width = this.boxWidth;
      const title = (opts && opts.title) || '';
      const top = title
        ? '┌─ ' + title + ' ' + '─'.repeat(Math.max(0, width - displayWidth(title) - 4)) + '┐'
        : '┌' + '─'.repeat(width) + '┐';
      const body = lines.map((l) => '│ ' + padTo(l, width - 2) + ' │').join('\n');
      return top + '\n' + body + '\n' + '└' + '─'.repeat(width) + '┘';
    }

    /* ---- 主渲染 ---- */
    render(view) {
      const e = this.engine;

      // 背景：line 视图自带 context，choices / end 视图没有，就现取。
      // 注意 currentArt() 给的是 story.json 里的素材定义（key + 尺寸 + 调色板），
      // 真正的像素矩阵要用 pixelArt(key) 生成。
      const art = view.context || e.currentArt();
      const bgArt = art.bg ? e.pixelArt(art.bg) : null;
      // 立绘：说话人有立绘就换（同一节点里换人说话就换脸），旁白沿用节点立绘
      const portraitArt =
        (view.type === 'line' && !view.narration && view.portrait && e.pixelArt(view.portrait)) ||
        (art.portrait ? e.pixelArt(art.portrait) : null);

      const parts = [];
      if (this.clear) parts.push('\x1b[2J\x1b[H');
      parts.push(this.paint(bgArt, '  '));

      // 标题条
      const title = e.currentTitle();
      const povName = e.povInfo.displayName || e.pov || '';
      parts.push(
        '  ' + ANSI.bold + title + ANSI.reset +
        '   ' + ANSI.dim + '视角：' + povName + ANSI.reset +
        '   ' + ANSI.dim + `${e.history.length} 步` + ANSI.reset
      );

      // 视角提示：只在刚切换的那一个节点显示
      if (e.povSwitchInfo) {
        parts.push('');
        parts.push('  ' + ANSI.bold + '◆ ' + e.povSwitchInfo.line + ANSI.reset);
        const hint = (e.povInfo && e.povInfo.hint) || '';
        if (hint) parts.push('  ' + ANSI.dim + '  ' + wrapCJK(hint, this.boxWidth + 4).join('\n    ') + ANSI.reset);
      }

      // 数值面板
      if (e.showStats) parts.push('', this.statsBox());

      // 立绘 + 对话框
      parts.push('');
      if (portraitArt) parts.push(this.paint(portraitArt, '  '));

      if (view.type === 'line') {
        const speaker = view.narration ? '' : view.name;
        const text = wrapCJK(view.line.text, this.boxWidth - 2);
        parts.push(this.box(text, { title: speaker }));
        parts.push('  ' + ANSI.dim + `[${view.index + 1}/${view.total}]` + ANSI.reset);
      } else if (view.type === 'choices') {
        parts.push('  ' + ANSI.bold + '你的选择：' + ANSI.reset);
        for (const c of view.choices) {
          const num = `[${c.index + 1}]`;
          if (c.enabled) {
            parts.push(`    ${ANSI.bold}${num}${ANSI.reset} ${c.text}${c.hint ? '  ' + ANSI.dim + c.hint + ANSI.reset : ''}`);
          } else {
            parts.push(`    ${ANSI.dim}${num} ${c.text}  🔒 ${c.lockedHint}${ANSI.reset}`);
          }
        }
      } else if (view.type === 'end') {
        parts.push(this.box(wrapCJK('第一幕 · 完。', this.boxWidth - 2), { title: '完' }));
        parts.push(this.statsBox());
      }

      // 隐藏数值时，把「感觉」显示在最下面
      if (view.notes && view.notes.length) {
        parts.push('');
        for (const n of view.notes) parts.push('  ' + ANSI.italic + ANSI.dim + '· ' + n + ANSI.reset);
      }

      if (this.last) parts.push('  ' + ANSI.bold + this.last + ANSI.reset);

      parts.push('');
      parts.push('  ' + ANSI.dim + this.helpText(view) + ANSI.reset);
      this.out(parts.join('\n') + '\n');
    }

    statsBox() {
      const e = this.engine;
      const lines = [];
      if (!e.showStats) {
        lines.push('数值已隐藏 —— 按 V 查看');
      } else {
        for (const s of e.statPanel()) {
          lines.push(padTo(s.label, 30) + ' ' + padTo(s.display, 4) + ' ' + s.bar);
        }
      }
      return this.box(lines, { title: '内心' });
    }

    helpText(view) {
      if (view.type === 'choices') return '输入数字选择   V=查看数值   R=重来   Q=退出';
      if (view.type === 'end') return 'R=重来   Q=退出';
      return '回车=继续   V=查看数值   R=重来   Q=退出';
    }
  }

  /* ===================================================================
   * 6. Node 命令行入口
   * =================================================================== */

  function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--no-color') out.color = false;
      else if (a === '--no-clear') out.clear = false;
      else if (a === '--stats') out.showStats = true;
      else if (a === '--validate') out.validate = true;
      else if (a === '--auto') out.auto = argv[++i];
      else if (a === '--story') out.story = argv[++i];
      else out._.push(a);
    }
    return out;
  }

  function main(argv) {
    /* eslint-disable global-require */
    const fs = require('fs');
    const path = require('path');
    const readline = require('readline');
    /* eslint-enable global-require */

    const args = parseArgs(argv);
    const storyPath = args.story || path.join(__dirname, 'story.json');

    let story;
    try {
      story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
    } catch (err) {
      console.error(`[错误] 读不出剧本 ${storyPath}：${err.message}`);
      process.exit(1);
    }

    const engine = new StoryEngine(story, { showStats: !!args.showStats });

    // ---- 自检模式 ----
    if (args.validate) {
      const r = engine.validate();
      console.log(`剧本：${storyPath}`);
      console.log(`节点 ${r.stats.nodes} 个，结局 ${r.stats.endings.length} 个，视角 ${r.stats.povs.join(' / ')}`);
      if (r.warnings.length) {
        console.log(`\n提醒（${r.warnings.length}）：`);
        for (const w of r.warnings) console.log('  · ' + w);
      }
      if (r.errors.length) {
        console.log(`\n错误（${r.errors.length}）：`);
        for (const e of r.errors) console.log('  ✗ ' + e);
        process.exit(1);
      }
      console.log('\n自检通过 ✅');
      return;
    }

    // ---- 自动跑一遍（用来验证分支，不交互）----
    if (args.auto !== undefined) {
      runAuto(engine, args.auto, { quiet: true });
      return;
    }

    // ---- 交互模式 ----
    const renderer = new ConsoleRenderer(engine, {
      color: args.color !== false,
      clear: args.clear !== false,
      dataPath: path.join(__dirname, 'save_snapshot.json'),
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdout.isTTY });

    let view = null;
    let notes = [];

    function step() {
      const e = engine;
      if (!e.node) { e.start(); notes = []; }
      let r = e.advance();

      if (r.type === 'end') {
        view = r;
        renderer.render(view);
        return;
      }
      if (r.type === 'choices') {
        view = r;
        renderer.render(view);
        return;
      }
      view = r;
      renderer.render(view);
    }

    rl.on('line', (raw) => {
      const input = String(raw).trim();
      const lower = input.toLowerCase();
      renderer.last = null;

      if (lower === 'q') { rl.close(); return; }

      if (lower === 'v') {
        const on = engine.toggleStats();
        renderer.last = on ? '显示真实数值' : '隐藏数值（只看感觉）';
        renderer.render(view || { type: 'line', line: { text: '' }, index: 0, total: 0 });
        return;
      }

      if (lower === 'r') {
        engine.start();
        notes = [];
        view = engine.advance();
        renderer.render(view);
        return;
      }

      if (lower === 's') {
        try {
          fs.writeFileSync(renderer.dataPath, JSON.stringify(engine.snapshot(), null, 2), 'utf8');
          renderer.last = `已存档到 act1/${path.basename(renderer.dataPath)}`;
        } catch (err) { renderer.last = '存档失败：' + err.message; }
        renderer.render(view);
        return;
      }

      if (lower === 'l') {
        try {
          const snap = JSON.parse(fs.readFileSync(renderer.dataPath, 'utf8'));
          engine.restore(snap);
          notes = [];
          view = engine.advance();
          renderer.render(view.type ? view : { type: 'line', line: { text: '' }, index: 0, total: 0 });
        } catch (err) { renderer.last = '读档失败：' + err.message; renderer.render(view); }
        return;
      }

      if (view && view.type === 'choices') {
        const n = Number(input);
        if (!Number.isInteger(n) || n < 1 || n > view.choices.length) {
          renderer.last = `请输入 1~${view.choices.length}`;
          renderer.render(view);
          return;
        }
        const res = engine.choose(n - 1);
        if (!res.ok) {
          renderer.last = res.reason === 'locked' ? `还不能选：${res.lockedHint}` : '选不了这个';
          renderer.render(view);
          return;
        }
        notes = res.notes || [];
        view = engine.advance();
        renderer.render(view);
        return;
      }

      // 台词推进
      if (view && view.type === 'end') { renderer.render(view); return; }
      view = engine.advance();
      if (view.type !== 'choices' && view.type !== 'end') notes = [];
      renderer.render(view);
    });

    rl.on('close', () => { process.stdout.write('\n'); process.exit(0); });

    console.log('第一幕 · 沃伯爵的府邸');
    console.log(engine.validate().ok ? '' : '(剧本自检有错误，见 --validate)');
    console.log('回车继续，数字选择，V 看数值，Q 退出。\n');
    step();
  }

  /** 自动跑：choices 形如 "1,2,1,3"，空位自动选第一个可用项 */
  function runAuto(engine, script, opts) {
    const quiet = !opts || opts.quiet !== false;
    const picks = String(script).split(',').map((s) => s.trim()).filter((s) => s !== '');
    let pickIndex = 0;
    let guard = 0;
    const log = [];

    engine.start();
    for (;;) {
      if (guard++ > 2000) throw new Error('剧情跑了 2000 步还没结束，可能有环');
      const r = engine.advance();

      if (r.type === 'line') {
        log.push({ pov: engine.pov, line: r.line.text });
        continue;
      }
      if (r.type === 'choices') {
        let idx = pickIndex < picks.length ? Number(picks[pickIndex]) - 1 : -1;
        pickIndex++;
        const usable = r.choices.filter((c) => c.enabled);
        if (idx < 0 || !r.choices[idx] || !r.choices[idx].enabled) {
          // 指定的选项被锁或没指定 -> 退而求其次，选第一个可用的
          const fallback = r.choices.findIndex((c) => c.enabled);
          log.push({ choose: `(指定 ${idx + 1} 不可用，改选 ${fallback + 1}) ${r.choices[fallback].text}` });
          idx = fallback;
        } else {
          log.push({ choose: r.choices[idx].text });
        }
        const res = engine.choose(idx);
        if (res.notes && res.notes.length) log.push({ notes: res.notes });
        continue;
      }
      if (r.type === 'end') {
        log.push({ end: engine.node.id, stats: Object.assign({}, engine.stats) });
        break;
      }
    }

    if (!quiet) return log;

    // 精简输出：只打印选择、视角切换、效果和结局
    let pov = null;
    for (const entry of log) {
      if (entry.pov && entry.pov !== pov) {
        pov = entry.pov;
        console.log(`\n【视角 → ${pov}】`);
      }
      if (entry.choose) console.log(`  ▶ ${entry.choose}`);
      for (const n of entry.notes || []) console.log(`      · ${n}`);
      if (entry.end) {
        console.log(`\n【结局节点 ${entry.end}】`);
        for (const [k, v] of Object.entries(entry.stats)) console.log(`      ${k} = ${v}`);
      }
    }
    console.log('');
    return log;
  }

  /* ===================================================================
   * 7. 导出
   * =================================================================== */

  return {
    StoryEngine,
    ConsoleRenderer,
    buildPixelArt,
    evaluateCondition,
    hashString,
    mulberry32,
    wrapCJK,
    displayWidth,
    main,
    runAuto,
  };
});
