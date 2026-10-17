/**
 * 极简 DOM 替身 —— 只实现 ui.js 真正用到的那点 API。
 * =====================================================================
 * 目的：不开浏览器就能把 Act1UI 跑起来。
 * 元素不是手写的，而是从 act1/index.html 里扫 id="…" 建出来的，
 * 所以 index.html 和 ui.js 的 mount() 清单一旦对不上，测试会立刻报「页面缺少这些元素：…」。
 *
 * 用法：
 *   const { loadDom, fire, fireKey } = require('./dom-stub.cjs');
 *   const { doc, win } = loadDom();          // 默认读 ../act1/index.html
 */

const fs = require('fs');
const path = require('path');

const INDEX_HTML = path.join(__dirname, '..', 'act1', 'index.html');

/* ---------------- 元素 ---------------- */

function makeClassList(el) {
  return {
    add(...names) { for (const n of names) el._class.add(n); },
    remove(...names) { for (const n of names) el._class.delete(n); },
    toggle(name, force) {
      const on = force === undefined ? !el._class.has(name) : !!force;
      if (on) el._class.add(name); else el._class.delete(name);
      return on;
    },
    contains(name) { return el._class.has(name); },
  };
}

function makeEl(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _class: new Set(),
    _text: '',
    children: [],
    parentNode: null,
    attrs: {},
    listeners: {},
    style: {},
    disabled: false,
    _doc: doc,
  };

  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._class).join(' '); },
    set(v) { el._class.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((n) => el._class.add(n)); },
  });

  // textContent 一写就把子节点清掉，和真 DOM 一致（ui.js 靠这个清空浮字）
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = v == null ? '' : String(v); el.children.length = 0; },
  });

  Object.defineProperty(el, 'firstChild', { get() { return el.children[0] || null; } });
  Object.defineProperty(el, 'childNodes', { get() { return el.children; } });

  el.classList = makeClassList(el);

  el.appendChild = (child) => { child.parentNode = el; el.children.push(child); return child; };
  el.insertBefore = (child, ref) => {
    const i = ref ? el.children.indexOf(ref) : -1;
    child.parentNode = el;
    if (i < 0) el.children.push(child); else el.children.splice(i, 0, child);
    return child;
  };
  el.removeChild = (child) => {
    const i = el.children.indexOf(child);
    if (i >= 0) el.children.splice(i, 1);
    child.parentNode = null;
    return child;
  };
  /** 后代里所有带这个类的元素（只按 _class 这一份账找，够 daily.js 用） */
  el.getElementsByClassName = (cls) => {
    const want = String(cls).trim();
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child._class && child._class.has(want)) out.push(child);
        walk(child);
      }
    };
    walk(el);
    return out;
  };
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  el.removeAttribute = (k) => { delete el.attrs[k]; };
  el.addEventListener = (type, fn) => { (el.listeners[type] || (el.listeners[type] = [])).push(fn); };
  el.removeEventListener = (type, fn) => {
    const list = el.listeners[type];
    if (list) el.listeners[type] = list.filter((f) => f !== fn);
  };
  el.blur = () => {};
  el.focus = () => {};
  /* 只认两种最简选择器：`.类名` 与 `#id`（#id 是给 daily.js / brew-ui.js 那两处
     「点对话框那一下」用的 —— 它们写的就是 closest('#dialogue-box')）。 */
  el.closest = (sel) => {
    const raw = String(sel).trim();
    const byId = raw.charAt(0) === '#';
    const want = byId ? raw.slice(1) : raw.replace(/^\./, '');
    let cur = el;
    while (cur) {
      if (byId ? cur.id === want : (cur._class && cur._class.has(want))) return cur;
      cur = cur.parentNode;
    }
    return null;
  };
  /** 给测试用的派发器（真 DOM 里是浏览器干的） */
  el.dispatch = (type, ev) => {
    const payload = Object.assign({
      type, target: el,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
    }, ev || {});
    for (const fn of el.listeners[type] || []) fn(payload);
    return payload;
  };
  return el;
}

/* ---------------- document ---------------- */

function loadDom(htmlPath) {
  const file = htmlPath || INDEX_HTML;
  const html = fs.readFileSync(file, 'utf8');

  const byId = new Map();
  const docListeners = {};

  /* document 上的监听按 {fn, capture} 记 —— 捕获阶段要先跑，而且
     stopImmediatePropagation() 真的能截住后面的人（daily.js 就是靠这个
     把空格/回车拦住，不让它漏到背后的对话上去的）。 */
  const doc = {
    createElement: (tag) => makeEl(tag, doc),
    getElementById: (id) => byId.get(id) || null,
    addEventListener: (type, fn, opts) => {
      const capture = !!(opts === true || (opts && opts.capture));
      (docListeners[type] || (docListeners[type] = [])).push({ fn, capture });
    },
    removeEventListener: (type, fn) => {
      const list = docListeners[type];
      if (list) docListeners[type] = list.filter((l) => l.fn !== fn);
    },
  };

  doc.body = makeEl('body', doc);

  // 从 index.html 里把页面上的元素造出来（顺序无关）
  const ids = new Set();
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  for (const id of ids) {
    const el = makeEl('div', doc);
    el.id = id;
    byId.set(id, el);
  }

  /** 从 index.html 里扫出来的 id 全集，测试拿它做覆盖检查 */
  doc.__ids = ids;

  const timers = [];
  const intervals = [];        // 排过队的那几个 setInterval（清掉之后不再排回来）
  let timerId = 0;

  // 假的 Image：ui.js 用它探测「这张图到底存不存在」。
  // 加载成功/失败都排进定时器（和真浏览器一样是异步的），测试用 runTimers() 推一下。
  const imageState = { load: true };
  function FakeImage() {
    const probe = { onload: null, onerror: null, _src: '' };
    Object.defineProperty(probe, 'src', {
      get() { return probe._src; },
      set(value) {
        probe._src = value;
        const id = ++timerId;
        timers.push({
          id,
          fn() { if (imageState.load) { if (probe.onload) probe.onload(); } else if (probe.onerror) probe.onerror(); },
        });
      },
    });
    return probe;
  }

  /* 假的 MutationObserver：只记下「谁在盯谁」，不会自己触发。
     真浏览器是异步回调，测试里用 pokeObservers() 手摇 —— 等价于「页面换了一帧」。 */
  const observers = [];
  function FakeMutationObserver(cb) {
    this.cb = cb;
    this.targets = [];
    observers.push(this);
  }
  FakeMutationObserver.prototype.observe = function (target, opts) {
    this.targets.push({ target, opts });
  };
  FakeMutationObserver.prototype.disconnect = function () { this.targets.length = 0; };
  FakeMutationObserver.prototype.takeRecords = function () { return []; };

  /** 手摇所有观察者（daily.js 靠这个把 HUD 跟着剧情重画） */
  function pokeObservers() {
    for (const o of observers) o.cb([], o);
  }

  const win = {
    // matches:true -> 引擎判定「系统设了减少动画」，打字机直接跳过，测试里文本一次到位
    matchMedia: () => ({ matches: true, addListener() {}, removeListener() {} }),
    setTimeout: (fn) => { const id = ++timerId; timers.push({ id, fn }); return id; },
    clearTimeout: () => {},
    /* setInterval 与 setTimeout 的区别只有一个：**它排回来**。
       runTimers() 每摇一次 = 真浏览器里走过一个间隔（brew-ui.js 的熬药循环
       就是靠这个推时间的）。清了之后不再排回来 —— 和真浏览器一致。 */
    setInterval: (fn) => {
      const id = ++timerId;
      const rec = { id, fn, repeat: true, cleared: false };
      intervals.push(rec);
      timers.push(rec);
      return id;
    },
    clearInterval: (id) => {
      const rec = intervals.find((t) => t.id === id);
      if (rec) rec.cleared = true;
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    addEventListener: () => {},
    console,
    Image: FakeImage,
    MutationObserver: FakeMutationObserver,
    fetch: null,          // 测试按需覆盖
  };

  /** 让接下来的 FakeImage 全部加载失败（模拟图片 404，退回像素占位） */
  function setImagesLoad(ok) { imageState.load = !!ok; }

  /** 手摇定时器：跑掉所有排队中的回调（打字机、熬药的每帧循环都靠它）。
      摇一次 = 走一个间隔：setInterval 那些跑完再排回队尾，setTimeout 跑完就没了。 */
  function runTimers(rounds) {
    for (let n = 0; n < (rounds || 1); n++) {
      const snapshot = timers.splice(0, timers.length);
      for (const t of snapshot) {
        t.fn();
        if (t.repeat && !t.cleared) timers.push(t);
      }
    }
  }

  /** 在某个元素上派发事件 */
  function fire(el, type, ev) {
    if (!el) throw new Error('fire: 元素不存在');
    return el.dispatch(type, ev);
  }

  /** 敲键盘（走 document 上的全局监听：先捕获，再冒泡） */
  function fireKey(key, opts) {
    const ev = Object.assign({
      key,
      ctrlKey: false,
      metaKey: false,
      target: doc.body,
      preventDefault() { ev.__prevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() { ev.__stopped = true; },
    }, opts || {});
    const list = docListeners.keydown || [];
    for (const phase of [true, false]) {
      for (const l of list) {
        if (!!l.capture !== phase) continue;
        l.fn(ev);
        if (ev.__stopped) return ev;      // 真 DOM：同一个节点上后面的监听器不再跑
      }
    }
    return ev;
  }

  return { doc, win, fire, fireKey, runTimers, setImagesLoad, pokeObservers, html };
}

module.exports = { loadDom, makeEl };
