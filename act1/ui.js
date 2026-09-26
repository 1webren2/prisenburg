/**
 * 第一幕 · 网页渲染层
 * =====================================================================
 * 这一层只做一件事：把 StoryEngine 的事件画成 DOM，不碰任何剧情逻辑。
 * 剧情规则全在 engine.js 里（那份代码不依赖 DOM，Node 里跑得动、测得了），
 * 这里换成 Canvas、或者换成别的排版，都不用动引擎。
 * 引擎在浏览器里挂在 window.Act1Story 上（见 engine.js 末尾的 UMD 包装）。
 *
 * 结构：
 *   .bg-layer       背景：像素块网格 + 真实图片层（图片在就盖住网格）
 *   .portrait-slot  立绘，左右两个槽位，每个都是同样的两层
 *   .dialogue-box   底部半透明对话框（出选项 / 到结局时收起来）
 *   .choices        选项按钮
 *   .stats-panel    隐藏数值面板（按 V 切换）
 *
 * ---------------------------------------------------------------
 * 【立绘怎么摆】
 *   左槽 = 主视角角色此刻的样子   —— 节点的 art.portrait
 *   右槽 = 正在说话的那一位       —— characters[speaker].portrait
 *   主视角角色自己开口时右槽留空，左槽由压暗变亮。
 *   换装不需要额外机制：给换衣服的那个节点写一个不同的 art.portrait 就行。
 *
 * 【替换真实图片】
 *   素材在 story.json 的 art.assets 里写 "src": "images/我的图.png"。
 *   没写 src 就按约定找 act1/images/<素材key>.png。
 *   图片放上去就自动生效，不需要改代码：图片层盖在像素块网格上面，
 *   404 的时候浏览器不画任何东西，底下的像素块就露出来了（占位）。
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
    imageExt: '.png',
    /** 打字机速度（毫秒/字）。系统设了「减少动画」会自动跳过 */
    typeSpeed: 24,
    /** 存档接口：同源时用相对路径，file:// 打开时回落到本地服务器 */
    apiBase: (typeof location !== 'undefined' && location.protocol === 'file:') ? 'http://localhost:3000' : '',
    endpoints: { save: '/api/act1/save', load: '/api/act1/load', health: '/api/health' },
    /** 存档写回的文件名，仅用于提示文案 */
    saveLabel: 'act1/save.json',

    /* ---------- 立绘 ---------- */

    /**
     * 立绘一律用 story.json 里指定的那张（characters[].portrait /
     * 节点的 art.portrait）。这里是 null —— 早先各角色的立绘还没画好时，
     * 这里曾经写死成 'chr_sibylla' 让大家借西比拉的脸，现在都画好了。
     */
    portraitOverride: null,
    /** 节点没写 art.portrait 时兜底用哪张 —— 保证左槽不空场 */
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

  /**
   * 把 rel 拼到 base（一个文件路径）所在目录后面，处理 . 和 ..。
   * 用来顺着 meta.continues 找后面几幕的剧本。
   *
   * 返回的是**相对当前页面**的路径（fetch 会拿页面地址去解），不是绝对路径 ——
   * 页面就和入口剧本在同一个目录里，所以两者等价。
   *
   * 注意开头的 .. 要留着：base 是 'story.json' 时它没有目录部分，
   * 而 '../act2/story.json' 正是靠这个 .. 从 /act1/ 上到根再进 /act2/ 的。
   * 这里如果把栈底的 .. 弹掉（早先就是这么写的），路径会悄悄变成
   * 'act2/story.json'，浏览器就去 /act1/act2/ 找 —— 第二幕整个载入不了。
   */
  function resolvePath(rel, base) {
    if (/^[a-z][a-z0-9+.-]*:|^\//i.test(rel)) return rel;    // 绝对地址 / 绝对路径，原样用
    const dir = base.slice(0, base.lastIndexOf('/') + 1);    // '' 或 'a/b/'
    const stack = [];
    for (const p of (dir + rel).split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
        else stack.push('..');                              // 没得弹了就把 .. 留着
      } else stack.push(p);
    }
    return stack.join('/');
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
      this._portraitKeys = { left: undefined, right: undefined };
      this._speaking = { left: false, right: false };
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
        'portrait-layer-r', 'portrait-grid-host-r', 'portrait-image-r',
        'pov-banner', 'title-bar', 'dialogue-box', 'speaker-plate',
        'dialogue-text', 'next-hint', 'choices', 'stats-panel', 'stats-body',
        'stats-toggle', 'save-btn', 'load-btn', 'restart-btn', 'server-dot', 'pause-btn',
        'toast', 'end-screen', 'end-stats', 'end-title', 'end-sub', 'end-continue',
        'title-screen', 'title-bg', 'title-start',
        'end-roam',
        'outfit-screen', 'outfit-veil', 'outfit-portrait', 'outfit-grid-host',
        'outfit-image', 'outfit-line', 'outfit-choices',
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

    /** 立绘到底画哪一张：override（早先的临时统一）> 指定的 > 兜底 */
    resolvePortrait(key) {
      return CONFIG.portraitOverride || key || CONFIG.fallbackPortrait;
    }

    /** 左槽 / 右槽的三个元素 */
    slotEls(side) {
      return side === 'right'
        ? {
          slot: this.els['portrait-layer-r'],
          grid: this.els['portrait-grid-host-r'],
          img: this.els['portrait-image-r'],
        }
        : {
          slot: this.els['portrait-layer'],
          grid: this.els['portrait-grid-host'],
          img: this.els['portrait-image'],
        };
    }

    /**
     * 给某个槽位换图。side = 'left'（默认，主视角角色）| 'right'（说话人）
     *
     * key 传 null 表示这个槽位这一格没人：**整个槽位要藏起来**。
     * 不能只是不画图 —— applyImageLayer 在没有 key 的时候会把像素占位网格放出来，
     * 右槽没人时就会多出一块马赛克方块，等于把「边界感」搬到了右边。
     */
    setPortrait(key, side) {
      side = side === 'right' ? 'right' : 'left';
      key = key ? this.resolvePortrait(key) : null;
      const els = this.slotEls(side);

      els.slot.classList.toggle('empty', !key);
      if (key === this._portraitKeys[side]) return;
      this._portraitKeys[side] = key;

      els.grid.style.display = '';
      setChildren(els.grid, key ? buildPixelGrid(this.engine, key, this.doc) : null);
      this.applyImageLayer(els.img, els.grid, key, key ? this.engine.assets[key] : null);
    }

    /** 立绘的「亮着 / 后缩压暗」两态，样式在 style.css 的 .portrait-slot 那几条 */
    setSpeaking(side, on) {
      side = side === 'right' ? 'right' : 'left';
      on = !!on;
      if (on === this._speaking[side]) return;
      this._speaking[side] = on;
      this.slotEls(side).slot.classList.toggle('speaking', on);
    }

    /**
     * 两个槽位这一格各放谁 —— showLine / showChoices / 结局屏共用一份，
     * 免得三处逻辑各写一遍、日子久了走样。
     *
     *   左槽：主视角角色此刻的样子（节点 art.portrait，换装就是换它）
     *   右槽：正在说话的那一位；旁白不说话、主视角角色自己开口时右槽留空
     *   左槽亮不亮：主视角角色在说话，或者正在出选项（＝玩家替 TA 做决定）
     *
     * 「两槽是同一个人就把右槽收掉」必须按**角色身份**判，不能按素材 key 判 ——
     * 换装之后 chr_sibylla 和 chr_sibylla_teacher 是两个 key，
     * 按 key 比会让西比拉穿着两套衣服同时站在左右两边。
     */
    resolveSlots(view) {
      const e = this.engine;
      const art = (view && view.context) || e.currentArt();
      const left = art.portrait || null;

      const speaker = (view && view.type === 'line' && !view.narration) ? view.speaker : null;
      const povSpeaking = !!speaker && speaker === e.pov;
      const right = (speaker && !povSpeaking) ? (view.portrait || null) : null;

      if (view && view.type === 'choices') {
        // 房间里是「你来做客」：左槽是奥布里（他不说话），右槽是房间里那个人
        // 此刻的样子（＝她当前穿的那套），亮着。view.room 由引擎的状态机填。
        const room = view.room;
        if (room && room.portrait) {
          return { left, right: room.portrait, leftLit: false, rightLit: true };
        }
        return { left, right: null, leftLit: true, rightLit: false };
      }

      // 自由活动里站在房间里的时候，旁白不该把她从画面里抹掉 ——
      // 台词一句一句播，人一直站在那儿（不亮，但不下场）
      if (view && view.type === 'line' && view.roam) {
        const room = e._roamRoomView ? e._roamRoomView() : null;
        if (room && room.portrait && !povSpeaking) {
          const r = right || room.portrait;
          return { left, right: r, leftLit: false, rightLit: !!r };
        }
      }

      return { left, right, leftLit: povSpeaking, rightLit: !!right };
    }

    /**
     * 对话框的开/收。出选项、走到结局时收起来 —— 不再让上一句话以半透明状态
     * 赖在屏幕底部。样式挂在 #dialogue-box.collapsed 上（用 transform 收，
     * 不收 display，这样它仍然占着原来的高度，上面的选项不会往下跳）。
     */
    setDialogueOpen(on) {
      on = !!on;
      this.els['dialogue-box'].classList.toggle('collapsed', !on);
      if (!on) this.stopTyping();       // 收起时别留着打字机自己跑
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
      this.syncPauseBtn(this.view);   // 开始界面开着时没有「暂停」这一说
      return this;
    }

    hideTitleScreen() {
      const s = this.els['title-screen'];
      if (s) s.classList.remove('on');
      this.syncPauseBtn(this.view);
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
      const slots = this.resolveSlots(view);
      this.setPortrait(slots.left, 'left');
      this.setPortrait(slots.right, 'right');
      this.setSpeaking('left', slots.leftLit);
      this.setSpeaking('right', slots.rightLit);

      const plate = this.els['speaker-plate'];
      if (view.narration) {
        plate.textContent = '';
        plate.classList.add('narration');
      } else {
        plate.textContent = view.name;
        plate.classList.remove('narration');
        if (view.color) plate.style.color = view.color;
      }

      this.setDialogueOpen(true);
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

    /**
     * 把按钮填进某个容器。选项栏和换装浮层里的那排衣服共用这一份 ——
     * 「点一下就没了」之外，两边长得也该一样。
     */
    fillChoiceButtons(host, choices) {
      while (host.firstChild) host.removeChild(host.firstChild);
      for (const c of choices) {
        const btn = this.doc.createElement('button');
        btn.className = 'choice-btn' + (c.enabled ? '' : ' locked') + (c.worn ? ' worn' : '');
        btn.setAttribute('data-index', String(c.index));
        btn.disabled = !c.enabled;

        btn.appendChild(el(this.doc, 'span', 'choice-key', String(c.index + 1)));
        btn.appendChild(el(this.doc, 'span', 'choice-text', c.text));
        if (c.hint) btn.appendChild(el(this.doc, 'span', 'choice-hint', c.hint));
        if (c.worn) btn.appendChild(el(this.doc, 'span', 'choice-worn', '✔ 现在穿着'));
        if (!c.enabled) btn.appendChild(el(this.doc, 'span', 'choice-lock', '🔒 ' + c.lockedHint));

        // click 会被下面的统一事件代理接管，这里只负责把焦点丢掉，
        // 免得按钮留着焦点、空格键又触发一次点击
        btn.addEventListener('click', () => { btn.blur(); });
        host.appendChild(btn);
      }
    }

    /**
     * 把选项栏清空。点完任何一个选项都要立刻收掉 ——
     * 否则按钮会一直挂在屏幕下半截，正好压在立绘的裙摆上。
     * 只清子节点、不加类、不动布局，所以对话框的收放不会让选项跳动。
     */
    hideChoices() {
      const host = this.els.choices;
      if (host) while (host.firstChild) host.removeChild(host.firstChild);
    }

    showChoices(view) {
      const e = this.engine;
      this.setBackground((view.context || e.currentArt()).bg);
      // 选项是「玩家替当前视角角色做决定」：左槽是 TA，亮着；右槽没人。
      // 不过在自由活动的房间里，右槽要站着房间里那个人（见 resolveSlots）。
      const slots = this.resolveSlots(view);
      this.setPortrait(slots.left, 'left');
      this.setPortrait(slots.right, 'right');
      this.setSpeaking('left', slots.leftLit);
      this.setSpeaking('right', slots.rightLit);

      this.fillChoiceButtons(this.els.choices, view.choices);
      this.setDialogueOpen(false);         // 上一句话让位，收起来
      this.els['next-hint'].textContent = '';
      this.notify();
    }

    /* ---------------- 换装浮层 ---------------- */

    get outfitOpen() {
      const s = this.els['outfit-screen'];
      return !!(s && s.classList.contains('on'));
    }

    hideOutfit() {
      const s = this.els['outfit-screen'];
      if (s) s.classList.remove('on');
      return this;
    }

    /**
     * 换装浮层：对话框收起、全身立绘居中、背景交给 #outfit-veil 糊掉。
     * 全身图**不能**走 setPortrait —— 那套是左右两栏的槽位（有 .speaking 缩放和
     * --portrait-lift 定位），居中是另一回事，所以这里自己一层。
     */
    showOutfit(view) {
      const host = this.els['outfit-screen'];
      if (!host) return this;

      host.classList.add('on');
      this.setDialogueOpen(false);       // 浮层里没有对话框，收起来最干净
      this.stopTyping();                 // 免得打字机在收起的框里继续跑

      const key = view.full || null;
      const asset = key ? this.engine.assets[key] : null;
      const grid = this.els['outfit-grid-host'];
      grid.style.display = '';
      setChildren(grid, key ? buildPixelGrid(this.engine, key, this.doc) : null);
      this.applyImageLayer(this.els['outfit-image'], grid, key, asset);

      const box = this.els['outfit-line'];
      while (box.firstChild) box.removeChild(box.firstChild);
      const line = view.line;
      if (line) {
        const who = this.engine.characters[line.speaker] || {};
        if (!who.narration) box.appendChild(el(this.doc, 'span', 'outfit-speaker', who.displayName || line.speaker));
        box.appendChild(el(this.doc, 'span', 'outfit-text', line.text || ''));
      }

      this.fillChoiceButtons(this.els['outfit-choices'], view.choices);
      this.els['next-hint'].textContent = '';
      this.notify();
      return this;
    }

    /* ---------------- 结局 ---------------- */

    showEnd(view) {
      const host = this.els['end-screen'];
      host.classList.add('on');

      // 标题和副题跟着结局节点走 —— 第二幕之后就不再是「第一幕 · 完」了
      const node = (view && view.node) || this.engine.node || {};
      this.els['end-title'].textContent = node.title || '完';
      this.els['end-sub'].textContent = node.endSub || '';

      // 只有写了 continueTo、而且那一幕真的载入了的结局节点才有「继续下一幕」
      // （单独打开第一幕的 story.json 时后面那一幕不在，按钮就不该点得动）
      const next = (node.continueTo && this.engine.nodes[node.continueTo]) ? node.continueTo : null;
      const cont = this.els['end-continue'];
      cont.style.display = next ? '' : 'none';
      cont.setAttribute('data-next', next || '');
      cont.textContent = next
        ? ('继续' + ((this.engine.nodes[next] || {}).title || '下一幕').split(' · ')[0] + ' ▶')
        : '继续下一幕 ▶';

      // 「自由活动 ▶」：这个结局之后有没有安排自由活动，由剧本里的
      // freeRoam.hubs[].after 说了算（第二幕是最后一幕，它那个 hub 里就没有下一幕）
      const anchor = this.engine.roamAnchorAfter ? this.engine.roamAnchorAfter(node.id) : null;
      const roam = this.els['end-roam'];
      if (roam) {
        roam.style.display = anchor ? '' : 'none';
        roam.setAttribute('data-anchor', anchor || '');
      }

      const body = this.els['end-stats'];
      while (body.firstChild) body.removeChild(body.firstChild);
      for (const s of this.engine.statPanel()) {
        const row = el(this.doc, 'div', 'end-stat-row');
        row.appendChild(el(this.doc, 'span', 'end-stat-label', s.label));
        row.appendChild(el(this.doc, 'span', 'end-stat-value', s.value + ' / ' + s.max));
        body.appendChild(row);
      }
      this.notify();
    }

    hideEnd() {
      this.els['end-screen'].classList.remove('on');
    }

    /**
     * 从结局画面接着演下一幕：走进 continueTo 指的那个节点。
     * 不需要新的引擎方法 —— enterNode() 内部本来就会把 ended 清掉；
     * 而且它拿的是上一个节点的 pov，从奥布里跨到西比拉时会照常弹视角提示。
     */
    continueNextAct() {
      const node = (this.view && this.view.node) || this.engine.node || {};
      const next = node.continueTo;
      if (!next || !this.engine.nodes[next]) return false;
      this.stopTyping();
      this.locked = false;
      this.hideEnd();
      this.engine.enterNode(next);
      this.renderStats();
      this.render(this.engine.advance());
      return true;
    }

    /**
     * 从结局卡片进「幕间自由活动」。落点是 showEnd() 写在 data-anchor 上的
     * 那个 hub —— 走的是引擎的 enterRoam()，之后的菜单全由状态机生成。
     */
    enterRoamFromEnd() {
      const btn = this.els['end-roam'];
      const anchor = btn && btn.getAttribute('data-anchor');
      if (!anchor) return false;
      const res = this.engine.enterRoam(anchor);
      if (!res.ok) { this.showToast('这里还进不去自由活动'); return false; }
      this.stopTyping();
      this.locked = false;
      this.hideEnd();
      this.renderStats();
      this.render(this.engine.advance());
      return true;
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
          fill.style.width = Math.round(s.ratio * 100) + '%';   // 按区间缩放，负数才画得出来
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
      // 兜底：任何一次重画都不该留着上一轮的按钮
      // （真正「点一下就消失」是在 choose() 里，那里更快）
      this.hideChoices();

      if (view.type === 'line') {
        this.hideOutfit();
        this.showTitle();
        this.showLine(view);
      } else if (view.type === 'choices') {
        this.hideOutfit();
        this.showTitle();
        this.showChoices(view);
      } else if (view.type === 'outfit') {
        this.showTitle();
        this.showOutfit(view);
      } else if (view.type === 'end') {
        this.hideOutfit();
        this.showTitle();
        // 结局屏上主视角角色留在左槽、压暗；右槽没人；对话框收起
        this.setPortrait(((view.node && view.node.art) || {}).portrait, 'left');
        this.setPortrait(null, 'right');
        this.setSpeaking('left', false);
        this.setSpeaking('right', false);
        this.setDialogueOpen(false);
        this.showEnd(view);
      }
      this.syncPauseBtn(view);
      return this;
    }

    /**
     * 「暂停 (P)」/「回到剧情 (P)」按钮的显隐与字面。
     *
     * 标题屏 / 结局屏 / 从结局卡片进的自由活动都不显示 —— 那几种情况下没有
     * 「原来的剧情」可回，按了也没意义。放在 render() 末尾而不是 renderStats()
     * 里，是因为 render() 各分支并不都调 renderStats()。
     */
    syncPauseBtn(view) {
      const btn = this.els['pause-btn'];
      if (!btn) return;
      const e = this.engine;
      const inRoam = e.isFreeRoamNode(e.node);
      const storyView = !!view && (view.type === 'line' || view.type === 'choices');
      const canPause = e.paused || (storyView && !inRoam && !e.ended && !this.titleOpen);
      btn.style.display = canPause ? '' : 'none';
      btn.textContent = e.paused ? '回到剧情 (P)' : '暂停 (P)';
    }

    /** 暂停 / 回来：两个薄封装，和 continueNextAct() 同构 */
    togglePause() {
      return this.engine.paused ? this.resumeFromStory() : this.pauseToStory();
    }

    pauseToStory() {
      const res = this.engine.pauseToStory();
      if (!res.ok) return false;   // 不可用就静默忽略，玩家可能只是误按
      this.stopTyping();
      this.locked = false;
      this.hideEnd();
      this.renderStats();
      this.render(this.engine.advance());
      return true;
    }

    resumeFromStory() {
      const res = this.engine.resumeFromStory();
      if (!res.ok) return false;
      this.stopTyping();
      this.locked = false;
      this.hideEnd();
      this.renderStats();
      this.render(this.engine.advance());
      return true;
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
      // 立刻收掉按钮：点下去到下一句画出来之间还有 toast / 数值面板两拍，
      // 那两拍里按钮要是还挂着，就正好压在立绘上（这就是之前那个遮挡）
      this.hideChoices();
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
      const onChoiceClick = (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('.choice-btn') : null;
        if (!btn || btn.disabled) return;
        const idx = Number(btn.getAttribute('data-index'));
        if (Number.isInteger(idx)) this.choose(idx);
      };
      this.els.choices.addEventListener('click', onChoiceClick);
      // 换装浮层里那排衣服走同一个 choose()，只是按钮在另一层
      this.els['outfit-choices'].addEventListener('click', onChoiceClick);

      this.els['title-start'].addEventListener('click', () => this.begin());
      this.els['end-continue'].addEventListener('click', () => this.continueNextAct());
      this.els['end-roam'].addEventListener('click', () => this.enterRoamFromEnd());
      this.els['stats-toggle'].addEventListener('click', () => this.toggleStats());
      this.els['pause-btn'].addEventListener('click', () => this.togglePause());
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
      if (key === 'p' || key === 'P') { this.togglePause(); return; }   // 用不上时它自己会拒绝

      if (key === ' ' || key === 'Enter') {
        ev.preventDefault();               // 免得滚页 / 二次触发按钮
        this.step();
        return;
      }

      if (key >= '1' && key <= '9') {
        const idx = Number(key) - 1;
        const v = this.view;
        // 换装浮层里的那排衣服也认数字键（都是 view.choices）
        if (v && (v.type === 'choices' || v.type === 'outfit') && idx < v.choices.length) this.choose(idx);
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
        // 用去过的节点数而不是 history.length：中途暂停会额外压两条进去，那样步数会虚高
        this.showToast('已保存到 ' + CONFIG.saveLabel + '（第 ' + (this.engine.visited.size) + ' 步）');
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

    /** 读一份剧本 */
    function fetchStory(url) {
      return win.fetch(url, { cache: 'no-cache' }).then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status + '：' + url);
        return res.json();
      });
    }

    /**
     * 顺着 meta.continues 把后面几幕的剧本也读进来。
     * 单一事实来源就是第一幕 meta 里那串路径 —— Node 那边（按幕合并自检）
     * 和这里用的是同一个字段，不会两边各记一份。
     */
    function loadAllStories(entryUrl, entryStory) {
      const stories = [entryStory];
      const pending = [{ url: entryUrl, story: entryStory }];
      const done = new Set([entryUrl]);

      function drain() {
        if (!pending.length) return Promise.resolve(stories);
        const cur = pending.shift();
        const rels = (cur.story.meta && cur.story.meta.continues) || [];
        return rels.reduce((chain, rel) => chain.then(() => {
          const url = resolvePath(rel, cur.url);
          if (done.has(url)) return null;
          done.add(url);
          return fetchStory(url).then((s) => { stories.push(s); pending.push({ url, story: s }); });
        }), Promise.resolve()).then(drain);
      }
      return drain();
    }

    // 剧本用 fetch 读 story.json。用 file:// 直接双击打开的话 fetch 会被拦，
    // 那种情况下请起服务器：node server.js 然后访问 http://localhost:3000/act1
    fetchStory('story.json')
      .then((first) => loadAllStories('story.json', first))
      .then((stories) => {
        const story = stories.length > 1 ? win.Act1Story.composeStories(stories) : stories[0];
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
        fail('剧本加载失败：' + err.message,
          '如果地址栏是 file:// 开头，请改用服务器打开：node server.js 然后访问 http://localhost:3000/act1');
      });
  }

  return {
    Act1UI,
    CONFIG,
    imageSrc,
    buildPixelGrid,
    resolvePath,
    boot,
  };
});
