/* =====================================================================
   日常层的界面（加在 act1/ui.js 后面加载）
   ---------------------------------------------------------------------
   做两件事（设计稿 §5）：

     1. HUD 左上角那行「第 X 天 · 早晨」（§5.1，全天显示）
     2. HUD 上的【日记】按钮 + 摊开的那本册子（§5.2 / §6）

   **没有改 act1/ui.js，也没有接管它的点击。** 这里造的每一块 DOM 都是运行时
   createElement 出来的，`act1/index.html` 里一个新 id 都没加 —— tests/dom-stub.cjs
   是正则扫 index.html 的 id 的，不碰它就不必动 ui.js 的 mount() 清单和
   ui.test.cjs 里的计数。

   日记那一页写什么，规则在 daily/diary.js 里（纯逻辑，不碰 DOM）。
   这里只负责把它画进那本书。

   **两个入口都在了**（设计稿 §4）：第 1 天是剧情 —— dy_d2_mo_intro 的最后一句
   播完之后，这里在捕获阶段把册子摊开（判据是 diary.js 的 atLastLine）；第 2 天起
   是 HUD 上那颗【日记】按钮。两者共用同一本书、同一套渲染，只是翻开的是哪一天
   不同：剧情入口翻的是**第 1 日**（她刚写下的第一笔），按钮翻的是**当前这天**。

   第 1 天没有 HUD：天/时段是从 daily/story.json 那套 dy_ 节点 id 里读的，
   日常层最早的节点就是 dy_d2_mo_intro，所以牌子与按钮都天然从第 2 天起。
   ===================================================================== */
(function () {
  'use strict';

  var D = window.DailyDiary;
  if (!D) return;                                  // diary.js 没加载就别画了

  /* ---------- 造 DOM（不用 innerHTML 拼结构，都是 createElement） ---------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildClock() {
    var box = el('div', 'dy-clock');
    box.appendChild(el('span', 'dy-clock-day'));
    box.appendChild(el('span', 'dy-clock-sep', ' · '));
    box.appendChild(el('span', 'dy-clock-slot'));
    return box;
  }

  function buildDiaryBook() {
    var screen = el('div', 'dy-diary-screen');

    var veil = el('div', 'dy-diary-veil');

    var book = el('div', 'dy-diary-book');
    var page = el('div', 'dy-diary-page');

    var title = el('div', 'dy-diary-title');
    var meta = el('div', 'dy-diary-meta');
    var day = el('span', 'dy-diary-day');
    var sep = el('span', 'dy-diary-meta-sep', '·');
    var weather = el('span', 'dy-diary-weather');
    meta.appendChild(day);
    meta.appendChild(sep);
    meta.appendChild(weather);

    var events = el('ul', 'dy-diary-events');
    var rule = el('div', 'dy-diary-rule');
    var ruleSoft = el('div', 'dy-diary-rule dy-diary-rule--soft');
    var note = el('p', 'dy-diary-note');

    page.appendChild(title);
    page.appendChild(meta);
    page.appendChild(rule);
    page.appendChild(events);
    page.appendChild(ruleSoft);
    page.appendChild(note);

    book.appendChild(page);
    book.appendChild(el('div', 'dy-diary-cover'));

    var close = el('button', 'hud-btn dy-diary-close', '合上');

    screen.appendChild(veil);
    screen.appendChild(book);
    screen.appendChild(close);

    return {
      screen: screen, veil: veil, title: title, day: day, weather: weather,
      events: events, rule: rule, ruleSoft: ruleSoft, note: note, close: close,
    };
  }

  /* 日记的**剧情入口**（设计稿 §4 的第一个入口）。挂在 act2 的 b11_sleep.next 上：
     第一夜睡下 → 这一场（她敲门把册子递上来）→ dy_d2_mo_hub。
     它翻开来的是**第 1 日**那一页 —— 她刚领到册子写下的第一笔。 */
  var INTRO_NODE = 'dy_d2_mo_intro';
  var INTRO_DAY = 1;

  var clockEl = null;
  var diaryBtn = null;
  var book = null;
  var mounted = false;

  /* 剧情入口那一轮的锁：idle（还没摊开）→ open（书开着）→ done（这一轮过去了）。
     见 shouldOpenIntroHere() 上头那段 —— 它同时是防重复和防卡死。 */
  var introPhase = 'idle';
  var lastNodeId = null;

  function mount(api) {
    if (mounted) return;
    mounted = true;

    clockEl = buildClock();
    document.body.appendChild(clockEl);

    book = buildDiaryBook();
    document.body.appendChild(book.screen);

    /* 【日记】按钮放进现有的 #hud（设计稿 §5.2：它是 HUD 上的一颗按钮）。
       放最前面 —— 它是这一层唯一「要玩家主动去点」的东西。 */
    diaryBtn = el('button', 'hud-btn dy-diary-btn', '日记');
    diaryBtn.type = 'button';
    var hud = document.getElementById('hud');
    if (hud) hud.insertBefore(diaryBtn, hud.firstChild);
    else document.body.appendChild(diaryBtn);

    diaryBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      openDiary();
    });
    book.close.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closeDiary();
    });
    book.veil.addEventListener('click', closeDiary);

    /* 书开着的时候，输入不能漏到背后那条对话上去。
       ui.js 的 keydown 挂在 document 上（冒泡阶段）；这里挂**捕获阶段**，
       用 stopImmediatePropagation 把它拦住 —— 同一个 document 节点上，
       光 stopPropagation 是拦不住同节点的其它监听器的。

       同一支监听器还管另一件事：**该摊开册子的那一下**。它也得在捕获阶段
       先下手，不然 ui.js 会先把台词推过去，那一场就没了。 */
    document.addEventListener('keydown', onKeydownCapture, true);
    document.addEventListener('click', onClickCapture, true);

    /* 页面刚换了一帧的节拍：#dialogue-box 每画一行台词就被 ui.js 重写一次，
       #choices 在选项出现/消失时变，#title-screen 在开始界面收起时换 class。
       （跟 stage0.js 盯的是同样三处。） */
    var box = document.getElementById('dialogue-box');
    if (box) {
      new MutationObserver(tick).observe(box, {
        childList: true, subtree: true, characterData: true,
      });
    }
    var choicesEl = document.getElementById('choices');
    if (choicesEl) new MutationObserver(tick).observe(choicesEl, { childList: true });
    var titleScreenEl = document.getElementById('title-screen');
    if (titleScreenEl) {
      new MutationObserver(tick).observe(titleScreenEl, {
        attributes: true, attributeFilter: ['class'],
      });
    }

    api.engine.on('node', tick);
    api.engine.on('stats', tick);
    tick();
  }

  /* ---------- 现在第几天、什么时辰 ---------- */

  function currentStamp(api) {
    return D.stampFromHistory(api.engine && api.engine.history);
  }

  function dayTitle(day) {
    return '第 ' + day + ' 天';
  }

  /* ---------- HUD 时间显示（§5.1） ---------- */

  var lastClock = null;

  function renderClock(api) {
    if (!clockEl) return;

    // 开始界面收掉之前不显。它不是铺满的一层不透明底，左上角那块可能透出来。
    var titleScreenEl = document.getElementById('title-screen');
    var onTitle = !!(titleScreenEl && titleScreenEl.classList.contains('on'));

    var stamp = currentStamp(api);
    if (!stamp) {                                   // 第 1 天：还没进日常层
      clockEl.classList.remove('on');
      lastClock = null;
      return;
    }
    clockEl.classList.add('on');

    var text = stamp.day + '|' + stamp.slot;
    if (text !== lastClock) {
      lastClock = text;
      clockEl.getElementsByClassName('dy-clock-day')[0].textContent = dayTitle(stamp.day);
      clockEl.getElementsByClassName('dy-clock-slot')[0].textContent = stamp.slot;
    }
    clockEl.classList.toggle('dy-hidden', onTitle);
  }

  /* ---------- 【日记】按钮（§5.2） ---------- */

  /**
   * 按钮什么时候在、什么时候亮。
   *   - 第 2 天起才有这颗按钮（第 1 天没进日常层，currentStamp 给 null）
   *   - 当天还没有记录时是暗的（disabled）——「有记录」= 今天至少记下过一条，
   *     门槛挂在「今天有没有记过」这个事实本身，不挂在任何剧情节点上
   */
  function renderDiaryBtn(api) {
    if (!diaryBtn) return;
    var stamp = currentStamp(api);
    if (!stamp) {
      diaryBtn.style.display = 'none';
      return;
    }
    diaryBtn.style.display = '';
    var lines = D.eventTexts(api.story, api.engine, stamp.day) || [];
    var ready = lines.length > 0;
    diaryBtn.disabled = !ready;
    diaryBtn.title = ready ? '' : '今天还没有记下什么';
    diaryBtn.classList.toggle('dy-ready', ready);
  }

  function currentNodeId() {
    var api = window.act1;
    var node = api && ((api.engine && api.engine.node) ||
      (api.ui && api.ui.view && api.ui.view.node));
    return (node && node.id) || '';
  }

  function tick() {
    var api = window.act1;
    if (!api || !api.engine || !api.story) return;

    /* 「一次性触发锁」认的是**边沿**（节点 id 变了），不是电平：DOM 多刷一拍
       也不会把册子开了又开。书开着的时候不重置 —— 那会儿本来就没有节点变化，
       真变了（读档）也要等书合上。 */
    var id = currentNodeId();
    if (id !== lastNodeId) {
      lastNodeId = id;
      if (introPhase !== 'open') introPhase = 'idle';
    }

    renderClock(api);
    renderDiaryBtn(api);
  }

  /* ---------- 日记本（§6：一页式手记） ---------- */

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  /** 把这一天的内容填进书里。规则来自 daily/diary.js。 */
  function fillDiary(api, day) {
    var entry = D.entryFor(api.story, day);
    if (!entry) return false;

    var block = D.blockOf(api.story);
    setText(book.title, block.title);
    setText(book.day, entry.date || dayTitle(day));
    setText(book.weather, entry.weather || '');
    book.weather.setAttribute('data-weather', entry.weather || '');

    // 今日事件：今天记了哪几条，由 diary.js 从各个选项的 diary 字段算出来。
    // 一条都没有的时候**整块不画**（连两条分隔线一起收掉）—— 第 1 日那页就是
    // 这样：她刚领到册子，那天还什么都没有，一页纸上只有她自己的字。
    var host = book.events;
    while (host.firstChild) host.removeChild(host.firstChild);
    var lines = D.eventTexts(api.story, api.engine, day) || [];
    var hasEvents = lines.length > 0;
    for (var i = 0; i < lines.length; i++) host.appendChild(el('li', null, lines[i]));
    show(host, hasEvents);
    show(book.rule, hasEvents);
    show(book.ruleSoft, hasEvents);

    // 「她写的」：这一天那一页的正文，按关系分档（规则在 diary.js 的 tierOf）。
    // 档位一个字都不显示 —— 玩家读到的是一整页人写的话。
    // **不是节点台词** —— 自编文本一律不进 dialogues，这是这个项目的红线。
    var body = D.bodyFor(api.story, api.engine, day) || [];
    setText(book.note, body.join('\n\n'));
    return true;
  }

  function show(node, on) {
    if (node) node.style.display = on ? '' : 'none';
  }

  function isOpen() {
    return !!book && book.screen.classList.contains('on');
  }

  /** 把书摊开在第 day 页。摊不成返回 false（数据缺了就不开 —— 调用方据此决定要不要拦输入）。 */
  function showBook(api, day) {
    if (!book || isOpen()) return false;
    if (!fillDiary(api, day)) return false;
    book.screen.classList.add('on');
    return true;
  }

  /* ---------- 入口一：剧情（第 1 天的册子，设计稿 §4） ---------- */

  /**
   * 现在这一下输入，是不是「该把册子摊开了」？
   *
   * 三个条件（跟 stage0 那场戏同一套判据）：
   *   1. 引擎停在 dy_d2_mo_intro 上、**最后一句已经播完** —— 判据是 diary.js 的
   *      atLastLine()。早一句摊开，屏幕上最后那两句就被书盖住了：人还没把册子
   *      递上来，书先开了。
   *   2. 此刻没在打字（ui.locked）—— 那一下该交给 ui.js 把字补全，
   *      玩家的第一下空格永远只是「别磨蹭，快打完」。
   *   3. 这一轮还没摊开过（introPhase 是 idle）。
   *
   * 第 3 条不只是防重复，它还是**防卡死**的：万一 fillDiary 失败（数据缺了、
   * diary.js 没加载），openIntroDiary 会把 phase 标成 done，于是这一下输入不再被拦、
   * 照常落到 ui.js 上，玩家还能往下走。少了它，这边开书失败、那边把输入吃掉，
   * 人就永远卡在最后一句上了。
   */
  function shouldOpenIntroHere() {
    if (introPhase !== 'idle') return false;
    var api = window.act1;
    if (!api || !api.engine) return false;
    if (api.ui && api.ui.locked) return false;
    return !!(D.atLastLine && D.atLastLine(api.engine, INTRO_NODE));
  }

  function openIntroDiary() {
    var api = window.act1;
    if (!api || !api.engine || !api.story) return false;
    introPhase = 'open';
    if (!showBook(api, INTRO_DAY)) { introPhase = 'done'; return false; }
    return true;
  }

  /* ---------- 入口二：HUD 上那颗按钮（第 2 天起） ---------- */

  function openDiary() {
    // book 为空 = 还没 mount（ui.js 的 boot() 是异步的，这个脚本只是先排好队）。
    // 无头截图脚本会在 boot 完的那一瞬间就去点这个把手，两头差着最多 30ms，
    // 少了这一句就是一个 null.title。
    if (!book || isOpen()) return;
    var api = window.act1;
    if (!api || !api.engine || !api.story) return;
    var stamp = currentStamp(api);
    if (!stamp) return;

    // 「合上」这颗按钮点不动的时候，书也别开 —— 两边的判据必须是同一个
    var lines = D.eventTexts(api.story, api.engine, stamp.day) || [];
    if (!lines.length) return;

    showBook(api, stamp.day);
  }

  /**
   * 合上就回到原来的地方：不推进剧情、不消耗时段。
   *
   * **不像 stage0 那样把节点剩下的行走完**：stage0 的 d1_diary_intro 背后是个
   * 要跳掉的日终旁白，这里背后是 dy_d2_mo_hub —— 那是要念给玩家听的。
   */
  function closeDiary() {
    if (!isOpen()) return;
    book.screen.classList.remove('on');
    if (introPhase === 'open') introPhase = 'done';
  }

  function onKeydownCapture(ev) {
    if (isOpen()) {
      // 回车 / 空格 / Esc 也能合上，不然只剩鼠标一条路
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape') closeDiary();
      ev.stopImmediatePropagation();
      ev.preventDefault();
      return;
    }
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    if (!shouldOpenIntroHere()) return;
    if (!openIntroDiary()) return;                  // 开不成就不拦，输入照常往下走
    ev.stopImmediatePropagation();
    ev.preventDefault();
  }

  /* 点对话框那一下也一样：ui.js 的监听挂在 #dialogue-box 上（目标是它自己，
     属于冒泡的最内层），document 的捕获阶段仍然先跑。 */
  function onClickCapture(ev) {
    if (isOpen()) return;                           // 书开着时点外面不动它，得按「合上」
    if (!shouldOpenIntroHere()) return;
    var t = ev.target;
    if (!t || !t.closest || !t.closest('#dialogue-box')) return;
    if (!openIntroDiary()) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
  }

  /* ---------- 等 ui.js 把 window.act1 挂上 ---------- */

  /* ui.js 的 boot() 是异步的（要先 fetch 剧本），而它到最后一刻才
     `win.act1 = {…}`。这个脚本排在它后面加载，那时 act1 还不存在，
     所以等着 —— 不轮询节点数，只等这一个全局。 */
  (function waitForAct1(tries) {
    var api = window.act1;
    if (api && api.engine && api.story) { mount(api); return; }
    if (tries <= 0) return;                         // 剧本没载入，界面上什么都不加
    setTimeout(function () { waitForAct1(tries - 1); }, 30);
  })(600);                                          // 600 × 30ms = 18 秒

  // 给控制台和测试留一个把手
  window.DailyUI = {
    tick: tick, openDiary: openDiary, openIntroDiary: openIntroDiary,
    closeDiary: closeDiary, isOpen: isOpen,
    introPhase: function () { return introPhase; },
  };
})();
