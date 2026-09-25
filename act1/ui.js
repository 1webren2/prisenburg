/**
 * 第一幕 · 网页渲染层
 * =====================================================================
 * 这一层只做一件事：把 StoryEngine 的事件画成 DOM，不碰任何剧情逻辑。
 * 剧情规则全在 game.js 里（那份代码不依赖 DOM，Node 里跑得动、测得了），
 * 这里换成 Canvas、或者换成别的排版，都不用动引擎。
 *
 * 三层结构：
 *   .bg-layer      背景：像素块网格 + 真实图片层（图片在就盖住网格）
 *   .portrait-layer 立绘：同上
 *   .dialogue-box  底部半透明对话框
 *   .choices       选项按钮
 *   .stats-panel   隐藏数值面板（按 V 切换）
 *
 * ---------------------------------------------------------------
 * 【将来替换真实图片】
 *   默认约定路径：act1/images/<素材key>.jpg
 *   例如 bg_hall  ->  act1/images/bg_hall.jpg
 *        chr_aubrey -> act1/images/chr_aubrey.jpg
 *   也可以直接在 story.json 里给该素材写 "src": "images/我的图.png" 覆盖。
 *   图片放上去就自动生效，不需要改代码：图片层盖在像素块网格上面，
 *   404 的时候浏览器不画任何东西，底下的像素块就露出来了。
 * ---------------------------------------------------------------
 */

(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Act1UI = api;
    api.boot();          // 浏览器里自动接管当前页面
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ===================================================================
   * 0. 配置
   * =================================================================== */

  const CONFIG = {
    /** 真实图片放这里（相对 index.html），文件名 = 素材 key + 扩展名 */
    imageDir: 'images/',
    imageExt: '.jpg',
    /** 打字机速度（毫秒/字）。系统设了「减少动画」会自动跳过 */
    typeSpeed: 24,
    /** 存档接口：同源时用相对路径，file:// 打开时回落到本地服务器 */
    apiBase: (typeof location !== 'undefined' && location.protocol === 'file:') ? 'http://localhost:3000' : '',
    endpoints: { save: '/api/act1/save', load: '/api/act1/load', health: '/api/health' },
    /** 存档写回的文件名，仅用于提示文案 */
    saveLabel: 'act1/save.json',

    /* ---------- 立绘 ---------- */

    /** 剧本里的主角 key。只有这个角色说话时，立绘才是亮的（其余时候后缩 + 压暗） */
    leadCharacter: '西比拉',
    /**
     * 其他角色的立绘还没画好，先一律借用主角那一张。
     * 等各角色的立绘到位之后，把这里改成 null，引擎就会去用
     * story.json 里 characters[].portrait 指定的那张。
     */
    portraitOverride: 'chr_sibylla',
    /** 没有指定立绘的节点（比如旁白）兜底用哪张 —— 保证立绘常驻，不会空场 */
    fallbackPortrait: 'chr_sibylla',

    /* ---------- 开始界面 ---------- */

    /** 开始界面用哪个素材当背景（马车图） */
    titleBackground: 'bg_carriage',
  };

  /** 某个素材该去哪个路径找真实图片 */
  function imageSrc(key, asset) {
    if (asset && asset.src) return asset.src;        // story.json 里显式指定的优先
    return CONFIG.imageDir + key + CONFIG.imageExt;
  }

  /* ===================================================================
   * 1. 小工具
   * =================================================================== */

  function setChildren(el, node) {
    while (el.firstChild) el.removeChild(el.firstChild);
    if (node) el.appendChild(node);
  }

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function prefersReducedMotion(win) {
    try {
      return !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) { return false; }
  }

  /* ===================================================================
   * 2. 像素块网格
   * =================================================================== */

  /**
   * 把一个素材画成 CSS Grid 的格子。每个格子一个 <i>，
   * 背景色来自引擎生成的矩阵；null 的格子留空（透明）。
   */
  function buildPixelGrid(engine, key, doc) {
    const art = engine.pixelArt(key);
    if (!art) return null;

    const grid = el(doc, 'div', 'pixel-grid pixel-grid--' + (art.kind === 'portrait' ? 'portrait' : 'bg'));
    grid.setAttribute('data-asset', key);
    grid.setAttribute('data-cols', String(art.cols));
    grid.setAttribute('data-rows', String(art.rows));
    // 用 1fr 让整块图自适应容器大小，格子本身不设死宽高
    grid.style.gridTemplateColumns = 'repeat(' + art.cols + ', 1fr)';
    grid.style.gridTemplateRows = 'repeat(' + art.rows + ', 1fr)';

    for (let y = 0; y < art.matrix.length; y++) {
      const row = art.matrix[y];
      for (let x = 0; x < row.length; x++) {
        const color = row[x];
        const cell = doc.createElement('i');
        if (color) {
          cell.style.background = color;
        } else {
          cell.className = 'empty';        // 留空：让底下的背景透出来
        }
        grid.appendChild(cell);
      }
    }
    return grid;
  }

  /* ===================================================================
   * 3. 渲染器
   * =================================================================== */

  class Act1UI {
    /**
     * @param {object} engine  StoryEngine 实例
     * @param {object} [options]
     * @param {object} [options.doc]   document（测试时可注入替身）
     * @param {object} [options.win]   window（拿 matchMedia / fetch / setTimeout）
     * @param {object} [options.hooks] { onState } 状态变化回调，方便外部扩展
     */
    constructor(engine, options) {
      const opts = options || {};
      this.engine = engine;
      this.doc = opts.doc || (typeof document !== 'undefined' ? document : null);
      this.win = opts.win || (typeof window !== 'undefined' ? window : null);
      this.hooks = opts.hooks || {};
      if (!this.doc) throw new Error('Act1UI 需要一个 document（可以注入替身）');

      this.reducedMotion = prefersReducedMotion(this.win);
      this.els = {};
      this._bgKey = null;
      this._portraitKey = null;
      this._speaking = null;
      this._typing = null;          // 打字机定时器
      this._pending = null;         // 打字中还没播完的那一行
      this.view = null;
      this.locked = false;          // 打字未完成时锁住推进
      this.serverOnline = null;
    }

    /* ---------------- 挂载 ---------------- */

    /** 抓取页面上的元素；页面里缺哪个就报哪个，方便定位 */
    mount() {
      const doc = this.doc;
      const need = [
        'bg-layer', 'bg-grid-host', 'bg-image',
        'portrait-layer', 'portrait-grid-host', 'portrait-image',
        'pov-banner', 'title-bar', 'dialogue-box', 'speaker-plate',
        'dialogue-text', 'next-hint', 'choices', 'stats-panel', 'stats-body',
        'stats-toggle', 'save-btn', 'load-btn', 'restart-btn', 'server-dot',
        'toast', 'end-screen', 'end-stats',
        'title-screen', 'title-bg', 'title-start',
      ];
      const missing = [];
      for (const id of need) {
        this.els[id] = doc.getElementById(id);
        if (!this.els[id]) missing.push(id);
      }
      if (missing.length) throw new Error('页面缺少这些元素：' + missing.join(', '));

      // 引擎事件 -> 渲染
      this.engine.on('pov', (info) => this.showPovBanner(info));
      this.engine.on('node', () => { this.showPovBanner(this.engine.povSwitchInfo); });

      this.bindInput();
      return this;
    }

    /* ---------------- 背景 / 立绘 ---------------- */

    /**
     * 把真实图片铺到某一层上，并且等它**真加载出来了**再把底下的像素块收掉。
     *
     * 为什么必须收：立绘是透明背景的 PNG，像素占位那一层就在它下面，
     * 透明的地方会原样透出彩色方格 —— 看上去就是人物背后糊了一块马赛克，
     * 也就是「立绘和场景之间有边界感」。图片 404 时走 onerror，
     * 像素块照旧留着，占位功能不受影响。
     */
    applyImageLayer(imgEl, gridEl, key, asset) {
      gridEl.style.display = '';              // 先亮着：图没到之前总得有东西看

      if (!key) {
        imgEl.removeAttribute('data-src');
        imgEl.style.backgroundImage = 'none';
        return;
      }

      const url = imageSrc(key, asset);
      imgEl.setAttribute('data-src', url);
      imgEl.style.backgroundImage = 'url("' + url + '")';

      // 无头测试环境没有 Image，就保持像素块（那正是没有真图时的样子）
      const win = this.win;
      if (!win || typeof win.Image !== 'function') return;

      // 换图换得比加载还快时，回调回来要能认出「这已经不是当前那张了」
      const stillCurrent = () => imgEl.getAttribute('data-src') === url;
      const probe = new win.Image();
      probe.onload = () => { if (stillCurrent()) gridEl.style.display = 'none'; };
      probe.onerror = () => { if (stillCurrent()) gridEl.style.display = ''; };
      probe.src = url;
    }

    setBackground(key) {
      if (key === this._bgKey) return;         // 没变就别重建（几百个格子呢）
      this._bgKey = key;
      const asset = key ? this.engine.assets[key] : null;
      setChildren(this.els['bg-grid-host'], key ? buildPixelGrid(this.engine, key, this.doc) : null);
      this.applyImageLayer(this.els['bg-image'], this.els['bg-grid-host'], key, asset);
    }

    /** 立绘到底画哪一张：override（其他立绘还没画好时的临时统一）> 指定的 > 兜底 */
    resolvePortrait(key) {
      return CONFIG.portraitOverride || key || CONFIG.fallbackPortrait;
    }

    setPortrait(key) {
      key = this.resolvePortrait(key);
      if (key === this._portraitKey) return;
      this._portraitKey = key;
      const asset = key ? this.engine.assets[key] : null;
      setChildren(this.els['portrait-grid-host'], key ? buildPixelGrid(this.engine, key, this.doc) : null);
      this.applyImageLayer(this.els['portrait-image'], this.els['portrait-grid-host'], key, asset);
    }

    /** 立绘的「亮着 / 后缩压暗」两态，样式在 style.css 的 #portrait-layer 那条 */
    setSpeaking(on) {
      on = !!on;
      if (on === this._speaking) return;
      this._speaking = on;
      this.els['portrait-layer'].classList.toggle('speaking', on);
    }

    /* ---------------- 开始界面 ---------------- */

    /** 开始界面开着的时候，剧情不该被推进（否则空格会把第一句跳过去） */
    get titleOpen() {
      const s = this.els['title-screen'];
      return !!(s && s.classList.contains('on'));
    }

    showTitleScreen() {
      const s = this.els['title-screen'];
      if (!s) return this;
      // 背景用 story.json 里 titleBackground 指向的那张（马车图）
      const bg = this.els['title-bg'];
      if (bg) {
        const asset = this.engine.assets[CONFIG.titleBackground];
        bg.style.backgroundImage = asset
          ? 'url("' + imageSrc(CONFIG.titleBackground, asset) + '")'
          : 'none';
      }
      s.classList.add('on');
      return this;
    }

    hideTitleScreen() {
      const s = this.els['title-screen'];
      if (s) s.classList.remove('on');
      return this;
    }

    /* ---------------- 顶部提示 ---------------- */

    showPovBanner(info) {
      const box = this.els['pov-banner'];
      if (!info) { box.textContent = ''; box.classList.remove('on'); return; }
      box.textContent = '';
      box.appendChild(el(this.doc, 'div', 'pov-line', '◆ ' + info.line));
      const hint = (info.pov && info.pov.hint) || '';
      if (hint) box.appendChild(el(this.doc, 'div', 'pov-hint', hint));
      box.classList.add('on');
    }

    showTitle() {
      const t = this.engine.currentTitle();
      this.els['title-bar'].textContent = t;
      const pov = this.engine.povInfo.displayName || this.engine.pov || '';
      const mode = this.engine.povInfo.mode === 'observer' ? '观察者' : '扮演';
      this.els['title-bar'].setAttribute('data-pov', pov + '（' + mode + '）');
    }

    /* ---------------- 台词 ---------------- */

    showLine(view) {
      const e = this.engine;
      this.setBackground((view.context || e.currentArt()).bg);
      const art = view.context || e.currentArt();
      const portraitKey = (!view.narration && view.portrait) || art.portrait;
      this.setPortrait(portraitKey);
      // 只有西比拉自己在说话时立绘是亮的；旁白和别的人开口都后缩压暗
      this.setSpeaking(!view.narration && view.speaker === CONFIG.leadCharacter);

      const plate = this.els['speaker-plate'];
      if (view.narration) {
        plate.textContent = '';
        plate.classList.add('narration');
      } else {
        plate.textContent = view.name;
        plate.classList.remove('narration');
        if (view.color) plate.style.color = view.color;
      }

      this.els['dialogue-box'].classList.remove('choices-open');
      this.typeText(view.line.text, view);
    }

    /** 打字机。系统开了「减少动画」就直接出全文 */
    typeText(text, view) {
      this.stopTyping();
      const target = this.els['dialogue-text'];
      target.textContent = '';

      if (this.reducedMotion || !this.win || !this.win.setInterval) {
        target.textContent = text;
        this.finishTyping(view);
        return;
      }

      let i = 0;
      this.locked = true;
      this._pending = { text, view };
      this._typing = this.win.setInterval(() => {
        i += 1;
        target.textContent = text.slice(0, i);
        if (i >= text.length) this.finishTyping(view);
      }, CONFIG.typeSpeed);
    }

    /** 打字完成（或玩家点击跳过）：解锁推进 */
    finishTyping(view) {
      this.stopTyping();
      this.locked = false;
      const v = view || (this._pending && this._pending.view);
      this.els['dialogue-text'].textContent = v && v.line ? v.line.text : this.els['dialogue-text'].textContent;
      if (v && v.total) {
        this.els['next-hint'].textContent = v.index + 1 >= v.total ? '继续 ▶' : (v.index + 1) + ' / ' + v.total;
      }
      this._pending = null;
      this.notify();
    }

    stopTyping() {
      if (this._typing && this.win && this.win.clearInterval) this.win.clearInterval(this._typing);
      this._typing = null;
    }

    /* ---------------- 选项 ---------------- */

    showChoices(view) {
      const e = this.engine;
      this.setBackground((view.context || e.currentArt()).bg);
      const art = view.context || e.currentArt();
      this.setPortrait(art.portrait);
      // 选项是「玩家替当前视角角色做决定」：序章替西比拉，主场替奥布里
      this.setSpeaking(e.pov === CONFIG.leadCharacter);

      const host = this.els.choices;
      while (host.firstChild) host.removeChild(host.firstChild);

      for (const c of view.choices) {
        const btn = this.doc.createElement('button');
        btn.className = 'choice-btn' + (c.enabled ? '' : ' locked');
        btn.setAttribute('data-index', String(c.index));
        btn.disabled = !c.enabled;

        btn.appendChild(el(this.doc, 'span', 'choice-key', String(c.index + 1)));
        btn.appendChild(el(this.doc, 'span', 'choice-text', c.text));
        if (c.hint) btn.appendChild(el(this.doc, 'span', 'choice-hint', c.hint));
        if (!c.enabled) btn.appendChild(el(this.doc, 'span', 'choice-lock', '🔒 ' + c.lockedHint));

        // click 会被下面的统一事件代理接管，这里只负责把焦点丢掉，
        // 免得按钮留着焦点、空格键又触发一次点击
        btn.addEventListener('click', () => { btn.blur(); });
        host.appendChild(btn);
      }
      this.els['dialogue-box'].classList.add('choices-open');
      this.els['next-hint'].textContent = '';
      this.notify();
    }

    /* ---------------- 结局 ---------------- */

    showEnd() {
      const host = this.els['end-screen'];
      host.classList.add('on');
      const body = this.els['end-stats'];
      while (body.firstChild) body.removeChild(body.firstChild);
      for (const s of this.engine.statPanel()) {
        const row = el(this.doc, 'div', 'end-stat-row');
        row.appendChild(el(this.doc, 'span', 'end-stat-label', s.label));
        row.appendChild(el(this.doc, 'span', 'end-stat-value', s.value + ' / 100'));
        body.appendChild(row);
      }
      this.notify();
    }

    hideEnd() {
      this.els['end-screen'].classList.remove('on');
    }

    /* ---------------- 数值面板 ---------------- */

    renderStats() {
      const e = this.engine;
      const body = this.els['stats-body'];
      while (body.firstChild) body.removeChild(body.firstChild);

      if (e.showStats) {
        for (const s of e.statPanel()) {
          const row = el(this.doc, 'div', 'stat-row');
          row.appendChild(el(this.doc, 'span', 'stat-label', s.label));
          row.appendChild(el(this.doc, 'span', 'stat-value', s.display));
          const track = el(this.doc, 'div', 'stat-track');
          const fill = el(this.doc, 'div', 'stat-fill');
          fill.style.width = Math.min(100, s.value) + '%';
          track.appendChild(fill);
          row.appendChild(track);
          body.appendChild(row);
        }
        this.els['stats-panel'].classList.add('revealed');
      } else {
        body.appendChild(el(this.doc, 'div', 'stat-hidden', '数值已隐藏 —— 按 V 查看真实数字'));
        this.els['stats-panel'].classList.remove('revealed');
      }
      this.els['stats-toggle'].setAttribute('data-on', e.showStats ? '1' : '0');
      this.els['stats-toggle'].textContent = e.showStats ? '收起数值 (V)' : '查看数值 (V)';
      this.notify();
    }

    toggleStats() {
      const on = this.engine.toggleStats();
      this.renderStats();
      this.showToast(on ? '显示真实数值' : '隐藏数值（只看感觉）');
    }

    /* ---------------- 浮字提示 ---------------- */

    showToast(text) {
      const host = this.els.toast;
      const node = el(this.doc, 'div', 'toast-item', text);
      host.appendChild(node);
      if (this.win && this.win.setTimeout) {
        this.win.setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 2600);
      }
    }

    setServerState(online, text) {
      const dot = this.els['server-dot'];
      dot.classList.toggle('online', !!online);
      dot.classList.toggle('offline', !online);
      dot.textContent = text || (online ? '存档服务器已连接' : '存档服务器未连接');
    }

    notify() {
      if (this.hooks.onState) this.hooks.onState(this.engine, this.view);
    }

    /* ===================================================================
     * 主循环：advance -> 渲染
     * =================================================================== */

    render(view) {
      this.view = view;
      if (!view) return this;
      this.hideEnd();

      if (view.type === 'line') {
        this.showTitle();
        this.showLine(view);
      } else if (view.type === 'choices') {
        this.showTitle();
        this.showChoices(view);
      } else if (view.type === 'end') {
        this.showTitle();
        this.els['dialogue-box'].classList.add('choices-open');
        this.showEnd();
      }
      return this;
    }

    /** 推进一格。打字没完成时，先把当前这行补全 */
    step() {
      if (this.locked) {
        this.finishTyping(this._pending && this._pending.view);
        return;
      }
      if (this.view && this.view.type === 'end') return;
      this.render(this.engine.advance());
    }

    start() {
      this.hideEnd();
      this.hideTitleScreen();
      this.engine.start();
      this.renderStats();
      this.render(this.engine.advance());
    }

    restart() {
      this.stopTyping();
      this.locked = false;
      this.hideEnd();
      this.start();
      // 重来一次 -> 退回开始界面（story 已经 reset 到开头，点「开始游戏」就继续）
      this.showTitleScreen();
    }

    /** 从开始界面进场：剧情其实已经在第一句上了，只要把那一层收掉 */
    begin() {
      this.hideTitleScreen();
    }

    choose(index) {
      const res = this.engine.choose(index);
      if (!res.ok) {
        this.showToast(res.reason === 'locked' ? '还不能选：' + res.lockedHint : '选不了这个选项');
        return false;
      }
      for (const note of res.notes || []) this.showToast(note);
      this.renderStats();          // 数值可能变了
      this.render(this.engine.advance());
      return true;
    }

    /* ===================================================================
     * 输入
     * =================================================================== */

    bindInput() {
      const doc = this.doc;
      const win = this.win;

      doc.addEventListener('keydown', (ev) => this.onKeyDown(ev));

      // 点对话框推进（点选项按钮不算）。开始界面开着时不算——
      // 真浏览器里那层会挡住点击，替身 DOM 没有命中测试，所以这里显式挡一下。
      this.els['dialogue-box'].addEventListener('click', () => {
        if (this.titleOpen) return;
        if (this.view && this.view.type === 'line') this.step();
      });

      // 选项用事件代理：将来动态加按钮也不用重新绑
      this.els.choices.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('.choice-btn') : null;
        if (!btn || btn.disabled) return;
        const idx = Number(btn.getAttribute('data-index'));
        if (Number.isInteger(idx)) this.choose(idx);
      });

      this.els['title-start'].addEventListener('click', () => this.begin());
      this.els['stats-toggle'].addEventListener('click', () => this.toggleStats());
      this.els['restart-btn'].addEventListener('click', () => this.restart());
      this.els['save-btn'].addEventListener('click', () => this.save());
      this.els['load-btn'].addEventListener('click', () => this.load());

      if (win) {
        win.addEventListener('resize', () => { /* 网格用 1fr 自适应，不需要重算 */ });
      }
    }

    onKeyDown(ev) {
      const key = ev.key;
      const mod = ev.ctrlKey || ev.metaKey;

      // 组合键优先处理并 return，否则 Ctrl+R 会顺手把游戏重开
      if (mod) {
        if (key === 's' || key === 'S') { ev.preventDefault(); this.save(); return; }
        if (key === 'l' || key === 'L') { ev.preventDefault(); this.load(); return; }
        return;
      }

      // 开始界面开着的时候只认「开始」这一件事，免得空格把第一句跳过去
      if (this.titleOpen) {
        if (key === ' ' || key === 'Enter') { ev.preventDefault(); this.begin(); }
        return;
      }

      if (key === 'v' || key === 'V') { this.toggleStats(); return; }
      if (key === 'r' || key === 'R') { this.restart(); return; }

      if (key === ' ' || key === 'Enter') {
        ev.preventDefault();               // 免得滚页 / 二次触发按钮
        this.step();
        return;
      }

      if (key >= '1' && key <= '9') {
        const idx = Number(key) - 1;
        if (this.view && this.view.type === 'choices' && idx < this.view.choices.length) this.choose(idx);
      }
    }

    /* ===================================================================
     * 存档：直接把 engine.snapshot() 发给服务器
     * =================================================================== */

    request(path, options) {
      const win = this.win;
      const fetchFn = (win && win.fetch) || (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetchFn) throw new Error('这个环境没有 fetch');

      const url = CONFIG.apiBase + path;
      return fetchFn(url, options).then((res) =>
        res.json().then(
          (body) => ({ ok: res.ok, status: res.status, body }),
          () => ({ ok: false, status: res.status, body: { message: '服务器返回的不是 JSON' } })
        )
      ).catch((err) => {
        throw Object.assign(new Error('连不上服务器'), { offline: true, cause: err });
      });
    }

    save() {
      const snap = this.engine.snapshot();
      return this.request(CONFIG.endpoints.save, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snap),
      }).then((r) => {
        if (!r.ok || !r.body.ok) throw new Error((r.body && r.body.message) || '保存失败');
        this.setServerState(true);
        this.showToast('已保存到 ' + CONFIG.saveLabel + '（第 ' + (this.engine.history.length) + ' 步）');
        return r.body;
      }).catch((err) => {
        if (err.offline) this.setServerState(false);
        this.showToast('保存失败：' + err.message);
        return null;
      });
    }

    load() {
      return this.request(CONFIG.endpoints.load, { method: 'GET' }).then((r) => {
        if (!r.ok || !r.body.ok) throw new Error((r.body && r.body.message) || '读取失败');
        const snap = r.body.save.snapshot || r.body.save;
        this.stopTyping();
        this.locked = false;
        this.hideEnd();
        this.hideTitleScreen();       // 读档直接进场，不要停在开始界面
        this.engine.restore(snap);
        this.renderStats();
        this.render(this.engine.advance());
        this.setServerState(true);
        this.showToast('已读取存档（回到 ' + this.engine.currentTitle() + '）');
        return r.body;
      }).catch((err) => {
        if (err.offline) this.setServerState(false);
        this.showToast('读取失败：' + err.message);
        return null;
      });
    }

    checkServer() {
      return this.request(CONFIG.endpoints.health, { method: 'GET' }).then((r) => {
        this.setServerState(!!(r.ok && r.body.ok));
        return r.ok;
      }).catch(() => { this.setServerState(false); return false; });
    }
  }

  /* ===================================================================
   * 4. 浏览器引导：拿到剧本 -> 建引擎 -> 挂上界面
   * =================================================================== */

  function boot() {
    const doc = document;
    const win = window;

    function fail(msg, detail) {
      const box = doc.getElementById('boot-error');
      if (box) { box.style.display = 'block'; box.textContent = msg + (detail ? '\n' + detail : ''); }
      if (win.console) console.error(msg, detail || '');
    }

    // 剧本用 fetch 读 story.json。用 file:// 直接双击打开的话 fetch 会被拦，
    // 那种情况下请起服务器：node server.js 然后访问 http://localhost:3000/act1
    win.fetch('story.json', { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then((story) => {
        const engine = new win.Act1Story.StoryEngine(story);
        const report = engine.validate();
        if (!report.ok) throw new Error('剧本有错：' + report.errors.join(' / '));

        const ui = new Act1UI(engine, { doc: doc, win: win });
        ui.mount();
        // 必须走 ui.start()：它会 renderStats() 再 render(engine.advance())。
        // 别写成 render(engine.start())——start() 返回的是节点对象不是视图对象，
        // render() 里三个分支一个都不匹配，页面会一片空白。
        ui.start();
        ui.showTitleScreen();     // 开场先停在开始界面，点「开始游戏」再进正片
        ui.checkServer();

        // 暴露给控制台，方便调试
        win.act1 = { engine, ui, story, report };
        if (doc.body) doc.body.classList.add('ready');
      })
      .catch((err) => {
        fail('第一幕加载失败：' + err.message,
          '如果地址栏是 file:// 开头，请改用服务器打开：node server.js 然后访问 http://localhost:3000/act1');
      });
  }

  return {
    Act1UI,
    CONFIG,
    imageSrc,
    buildPixelGrid,
    boot,
  };
});
