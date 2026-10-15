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

   **三个入口**（设计稿 §4）：
     1. 第 1 天是剧情 —— dy_d2_mo_intro 的最后一句播完之后，这里在捕获阶段把
        册子摊开（判据是 diary.js 的 atLastLine），翻在**第 1 日**那一页。
     2. 第 2 天起是 HUD 上那颗【日记】按钮。**全天可用、不禁用**，可以往前翻
        已经写完的每一天；当前这天翻开只看得见她**已经形成的记录**（她自己
        那一页要等夜里写完）。
     3. **进新一天第一个 hub 时**，先把「上一日总结」摊开一次（合上才看得见
        当天的菜单）—— 那一页是她夜里写下的，总结就是它第一次露面的地方。

   三者共用同一本书、同一套渲染，只是翻开的是哪一天、带不带「总结」页眉不同。

   **时段菜单**：20 个 hub 的选项画成右下角那三张活动卡（从 stage0 移植，
   图标、悬停提示、时段小字都照搬），别的节点仍是竖排列表。

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

    /* 翻页：只有一天可看的时候整条不画。压在纸上、书的下沿外面一点，
       z-index 压在封面(2)之上，掀封面的那 0.85 秒里也不会被盖住。 */
    var nav = el('div', 'dy-diary-nav');
    var prev = el('button', 'dy-diary-navbtn dy-diary-prev', '‹');
    var pageNo = el('span', 'dy-diary-pageno');
    var next = el('button', 'dy-diary-navbtn dy-diary-next', '›');
    prev.type = 'button';
    next.type = 'button';
    prev.setAttribute('aria-label', '前一天');
    next.setAttribute('aria-label', '后一天');
    nav.appendChild(prev);
    nav.appendChild(pageNo);
    nav.appendChild(next);
    book.appendChild(nav);

    var empty = el('p', 'dy-diary-empty', '今天还没有记下什么。');
    page.appendChild(empty);

    var close = el('button', 'hud-btn dy-diary-close', '合上');

    screen.appendChild(veil);
    screen.appendChild(book);
    screen.appendChild(close);

    return {
      screen: screen, veil: veil, title: title, day: day, weather: weather,
      events: events, rule: rule, ruleSoft: ruleSoft, note: note,
      nav: nav, prev: prev, next: next, pageNo: pageNo, empty: empty,
      close: close,
    };
  }

  /* 日记的**剧情入口**（设计稿 §4 的第一个入口）。第二轮回填之后挂在
     b11_sleep → b8_study_diary（书房里的吩咐）→ **b8_diary_writing** 上：
     她领到册子、回房写下第一笔，这一节的最后一句播完，书当场摊开。
     它翻开来的是**第 1 日**那一页 —— 她刚写下的那一笔。
     （首轮这场戏在第 2 天早晨的 dy_d2_mo_intro 里；作者的新稿把它挪回第一夜，
     所以入口跟着挪 —— 第 2 天早晨不再交代写日记。） */
  var INTRO_NODE = 'b8_diary_writing';
  var INTRO_DAY = 1;

  var clockEl = null;
  var diaryBtn = null;
  var book = null;
  var mounted = false;

  var choicesEl = null;
  var slotLabelEl = null;

  /* =====================================================================
     时段菜单：右下角那三张活动卡（移植自 stage0/stage0.js，一处不打折）
     ---------------------------------------------------------------------
     只有 20 个 hub 用这套卡片；幕尾反应节点、序章、结局仍旧是竖排列表。
     按钮还是 ui.js 画的那个 <button class="choice-btn">，点击走的还是 ui.js
     挂在 #choices 上的事件代理 —— 这里只加一个类、塞一个 SVG，交互一行不写。
     ===================================================================== */

  var ICONS = {
    '教室':        /* 摊开的书 */
      '<path d="M12 7.4v11"/>' +
      '<path d="M12 7.4C10.2 6 7.9 5.6 4.8 5.8v10.7c3.1-.2 5.4.2 7.2 1.6"/>' +
      '<path d="M12 7.4c1.8-1.4 4.1-1.8 7.2-1.6v10.7c-3.1-.2-5.4.2-7.2 1.6"/>',
    '大厅':        /* 门廊：山墙 + 两根柱子 + 地坪 */
      '<path d="M4.2 9.6 12 4.6l7.8 5"/>' +
      '<path d="M6.8 9.6v9.4M17.2 9.6v9.4"/>' +
      '<path d="M4.2 19h15.6"/>',
    '外院':        /* 一棵树 */
      '<path d="M12 14.6v5.6"/>' +
      '<path d="M12 5.4 5.8 14.6h12.4z"/>',
    '书房':        /* 架子上三本高低不一的书 */
      '<rect x="4.8" y="7.6" width="3.6" height="11.4" rx="1"/>' +
      '<rect x="10" y="5.2" width="4.2" height="13.8" rx="1"/>' +
      '<rect x="15.8" y="8.4" width="3.6" height="10.6" rx="1"/>',
    '后坡':        /* 坡 + 太阳 */
      '<path d="M3.4 19.2h17.2"/>' +
      '<path d="M5.8 19.2c1.6-5.4 5.6-7.4 12-7.6"/>' +
      '<circle cx="17.6" cy="6.2" r="2.4"/>',
    '洗衣房':      /* 洗衣盆 */
      '<path d="M3.8 10.2h16.4v4.6a5.6 5.6 0 0 1-5.6 5.6H9.4a5.6 5.6 0 0 1-5.6-5.6z"/>' +
      '<path d="M6.8 14.8h10.4"/>',
    '马厩':        /* 马蹄铁 */
      '<path d="M6.8 20.2v-5a5.2 5.2 0 0 1 10.4 0v5"/>' +
      '<path d="M6.8 20.2h3M14.2 20.2h3"/>',
    '西比拉的房间': /* 蜡烛 */
      '<rect x="9.4" y="9.8" width="5.2" height="10.4" rx="1"/>' +
      '<path d="M12 3.8c1.7 1.9 1.7 3.5 0 4.6-1.7-1.1-1.7-2.7 0-4.6z"/>',
    '账房':        /* 账本：方框里打格 */
      '<rect x="5" y="4.4" width="14" height="15.2" rx="1.2"/>' +
      '<path d="M5 9.4h14M5 14.6h14M12 4.4v15.2"/>',
    '伊莎贝尔': /* 一张小床 —— 菜单上写成「伊莎贝尔的房间」和
                   「伊莎贝尔小姐的房间」两种，指同一处，用一个图标 */
      '<path d="M3.6 19.4V9.4"/>' +
      '<path d="M3.6 19.4h16.8"/>' +
      '<path d="M3.6 14.4h16.8"/>' +
      '<path d="M3.6 11.4h5.4v3"/>',
    '伊莎贝尔小姐门前': /* 门前：一扇关着的门 + 门楣上那盏灯 */
      '<rect x="7.4" y="8.6" width="9.2" height="11" rx="1"/>' +
      '<path d="M12 6.4v2.2"/>' +
      '<circle cx="12" cy="5" r="1.4"/>' +
      '<path d="M9.9 12.8h4.2"/>',
    '走廊':        /* 走廊：两道收进去的墙 + 尽头一盏灯 */
      '<path d="M3.4 20.4 9.4 8.6M20.6 20.4 14.6 8.6"/>' +
      '<path d="M5.6 20.4h12.8"/>' +
      '<circle cx="12" cy="6.4" r="2"/>',
    '餐桌':        /* 盘子 + 两副餐具 */
      '<circle cx="12" cy="13.4" r="5"/>' +
      '<path d="M4.4 4.4v7.4M19.6 4.4v7.4"/>',
    '绿荫':        /* 树冠 + 树干（府外那片绿荫） */
      '<path d="M12 20.4v-6.6"/>' +
      '<path d="M4.8 14.6a7.2 7.2 0 0 1 14.4 0z"/>',
    '门':          /* 一扇门 */
      '<rect x="6.4" y="4.2" width="11.2" height="15.6" rx="1"/>' +
      '<path d="M14.6 12.4v.1"/>',
    '厨房':        /* 一口吊锅 + 灶上的火 */
      '<path d="M4.4 11.6h15.2v4.2a4.6 4.6 0 0 1-4.6 4.6H9a4.6 4.6 0 0 1-4.6-4.6z"/>' +
      '<path d="M2.6 11.6h3.4M18 11.6h3.4"/>' +
      '<path d="M12 3.4c1.5 1.7 1.5 2.9 0 3.8-1.5-.9-1.5-2.1 0-3.8z"/>',
    '会客厅':      /* 茶几上的两只杯盏 */
      '<path d="M4.6 13.6h14.8"/>' +
      '<path d="M6.4 13.6v6M17.6 13.6v6"/>' +
      '<path d="M8.8 10.6h2.4v3H8.8zM12.8 10.6h2.4v3h-2.4z"/>',
    '档案室':      /* 三层的抽屉柜 */
      '<rect x="5" y="4.6" width="14" height="15" rx="1.2"/>' +
      '<path d="M5 9.6h14M5 14.6h14"/>' +
      '<path d="M10.4 7.1h3.2M10.4 12.1h3.2M10.4 17.1h3.2"/>',
    '城墙':        /* 带垛口的砖墙 */
      '<path d="M4.4 19.4V7.6h2.8v1.8h3V7.6h3.6v1.8h3V7.6h2.8v11.8z"/>' +
      '<path d="M4.4 13.2h15.2"/>' +
      '<path d="M9 16.4h6"/>',
    '休息':        /* 床头的烛台与枕头 */
      '<path d="M3.8 18.6V9.4M3.8 18.6h16.4M3.8 14.6h16.4"/>' +
      '<path d="M6.6 14.6v-3h4.2v3"/>' +
      '<path d="M17.4 6.2c1.4 1.6 1.4 2.9 0 3.8-1.4-.9-1.4-2.2 0-3.8z"/>',
    '文书':        /* 一页纸与一支笔 */
      '<path d="M7 4.4h7.2l3.4 3.4v11.8H7z"/>' +
      '<path d="M14.2 4.4v3.4h3.4"/>' +
      '<path d="M9.4 12.2h5.2M9.4 15.4h5.2"/>',
  };

  /* 匹配顺序：**具体的排在笼统的前面**。菜单上写的是「一楼的大厅」这种
     带前缀的长名字，所以这里按「谁的名字更特别」排，第一个命中的就是它。
     这里的每一个名字都必须在 ICONS 里有对应的一条 —— 少一条，那张卡就空着顶。
     「伊莎贝尔小姐门前」必须排在「伊莎贝尔」前面，不然门前那张会拿到小床。 */
  var ICON_ORDER = [
    '伊莎贝尔小姐门前',
    '伊莎贝尔', '西比拉的房间', '洗衣房', '账房',
    '教室', '走廊', '马厩', '厨房', '大厅', '外院', '书房', '后坡', '绿荫', '餐桌', '门',
    '会客厅', '档案室', '城墙', '休息', '文书',
  ];

  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';

  function iconFor(text) {
    var t = String(text || '').trim();
    for (var i = 0; i < ICON_ORDER.length; i++) {
      if (t.indexOf(ICON_ORDER[i]) >= 0) return ICONS[ICON_ORDER[i]];
    }
    return null;
  }

  /* 时段菜单的 id 形状：dy_d{天}_{时段}_hub（时段 mo/nn/af/ev/ni）。
     **不能只看 `_hub` 结尾** —— 第二幕那个自由活动锚点叫 fr_hub，
     它六项菜单是竖排列表，不是三张活动卡（曾经被这条判据误当成时段菜单，
     六项里有两项被硬塞了图标）。所以照着 diary.js 的 NODE_RE 形状来认。 */
  var HUB_RE = /^dy_d\d+_(mo|nn|af|ev|ni)_hub$/;

  /** 只有 20 个时段菜单是卡片菜单。判据是 id 形状，不是「有没有选项」——
      幕尾反应节点也有选项，但它该是竖排列表。 */
  function isHubNode(node) {
    return !!(node && node.id && HUB_RE.test(node.id));
  }

  function decorateChoices(api) {
    if (!choicesEl) return;
    var node = api.engine && api.engine.node;
    var on = isHubNode(node) && choicesEl.children.length > 0;
    choicesEl.classList.toggle('dy-cards', on);

    if (slotLabelEl) {
      var stamp = on ? currentStamp(api) : null;
      if (stamp) slotLabelEl.textContent = stamp.slot + ' · 选择去向';
      slotLabelEl.classList.toggle('on', !!stamp);
    }
    if (!on) return;

    /* 选项的文字点不出地点时（第 6 天早晨那两项写的是「去教室看看。／先处理府里的事。」），
       退一步看这一项**去哪儿**：目的地节点的标题写的是「书房 · 清单」，按它取图标。
       图标许诺的是「你会去到一个什么样的地方」，不是「按钮上印了什么字」。 */
    var items = api.engine.availableChoices ? api.engine.availableChoices() : [];
    for (var i = 0; i < choicesEl.children.length; i++) {
      var btn = choicesEl.children[i];
      if (btn.getElementsByClassName('dy-icon').length) continue;   // 已经塞过了
      var textEl = btn.getElementsByClassName('choice-text')[0];
      var inner = textEl ? iconFor(textEl.textContent) : null;
      if (!inner) {
        var item = items[i];
        var dest = item && item.choice && api.engine.nodes[item.choice.next];
        if (dest && dest.title) inner = iconFor(dest.title);
      }
      if (!inner) continue;                                          // 没图标就保持原样
      var icon = el('span', 'dy-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = SVG_OPEN + inner + '</svg>';
      btn.insertBefore(icon, btn.firstChild);
    }
  }

  /* 剧情入口那一轮的锁：idle（还没摊开）→ open（书开着）→ done（这一轮过去了）。
     见 shouldOpenIntroHere() 上头那段 —— 它同时是防重复和防卡死。 */
  var introPhase = 'idle';
  var lastNodeId = null;

  function mount(api) {
    if (mounted) return;
    mounted = true;

    clockEl = buildClock();
    document.body.appendChild(clockEl);

    /* 时段提示那行小字（「早晨 · 选择去向」）。选项一亮出来对话框就整个收起来了，
       这时候屏幕上看不见「早晨」那几个字 —— 这一行是补回「现在是几点」的。
       id 是运行时加的，act1/index.html 里没有它，所以 tests/dom-stub.cjs 那个
       扫 id 的正则和 ui.test.cjs 的计数都不受影响。 */
    slotLabelEl = el('div', 'dy-slot-label');
    slotLabelEl.id = 'dy-slot-label';
    document.body.appendChild(slotLabelEl);

    choicesEl = document.getElementById('choices');

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
    book.prev.addEventListener('click', function (ev) {
      ev.stopPropagation();
      goDay(-1);
    });
    book.next.addEventListener('click', function (ev) {
      ev.stopPropagation();
      goDay(1);
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
    /* 变量名不能叫 choicesEl —— mount() 里再声明一个 var choicesEl 会把上面
       那个模块级的挡住（var 是函数作用域），decorateChoices 就永远看不见它。 */
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

  /**
   * 现在第几天、什么时辰。
   *
   * 先看**引擎此刻停的那个节点**自己写的 stamp（20 个 hub 与那个 intro 上都有，
   * 是显式的、不靠 id 猜）；它没有（原著段 b12_morning…、dy_…_r 这类）才
   * 顺着来路往回找最近一个说得清天/时段的节点。
   */
  function currentStamp(api) {
    var eng = api.engine;
    if (!eng) return null;
    return D.stampOf(eng.node, api.story) ||
      D.stampFromHistory(eng.history, api.story);
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
   * 按钮什么时候在。
   *   - 第 2 天起才有这颗按钮（第 1 天没进日常层，currentStamp 给 null）
   *   - **全天都亮着，不禁用**。册子在她手上：今天记了什么可以翻，前几天
   *     写完的也可以往前翻。按钮跟「今天有没有记过」不再挂钩 —— 那是把
   *     一本书锁在因为她今天还没写字。
   */
  function renderDiaryBtn(api) {
    if (!diaryBtn) return;
    var stamp = currentStamp(api);
    if (!stamp) {
      diaryBtn.style.display = 'none';
      return;
    }
    diaryBtn.style.display = '';
    diaryBtn.disabled = false;
    diaryBtn.title = '';
    diaryBtn.classList.add('dy-ready');
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
    decorateChoices(api);
    maybeShowDaySummary(api);
  }

  /* ---------- 日记本（§6：一页式手记） ---------- */

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  /* 能翻到哪几天：第 1 天到**当前这天**。当前这天只看得见「已经形成的记录」——
     她自己那一页要等她夜里写完，也就是等第二天早上那场总结，才第一次露出来。 */
  var NAV_MIN = 1;
  var bookDay = 0;
  var bookMax = 0;

  /** 把这一天的内容填进书里。规则来自 daily/diary.js。 */
  function fillDiary(api, day, opts) {
    var entry = D.entryFor(api.story, day);
    if (!entry) return false;
    opts = opts || {};

    var now = currentStamp(api);
    var curDay = now ? now.day : 0;

    var block = D.blockOf(api.story);
    setText(book.title, opts.summary ? ('第 ' + day + ' 日总结') : block.title);
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

    // 「她写的」：这一天那一页的正文，按关系分档（规则在 diary.js 的 tierOf）。
    // 档位一个字都不显示 —— 玩家读到的是一整页人写的话。
    // **不是节点台词** —— 自编文本一律不进 dialogues，这是这个项目的红线。
    //
    // **当前这一天不露**：这一页是她夜里写的，白天翻开只看得见已经形成的记录。
    // 第二天早上那场总结才是它第一次露面的地方，也正因为如此，总结才非看不可。
    //
    // 两个例外：
    //   · summary —— 翻篇那一刻摊开的上一天，本来就是要给她那一页看的；
    //   · written —— 剧情入口那一场：她刚在第一夜写下这一笔，书是**当面摊开**的。
    //     （那会儿还没进日常层，curDay 是 0，按「当前这天不露」算会把刚写的那页藏起来。）
    var showNote = (opts.summary || opts.written) ? true : (day < curDay);
    var body = showNote ? (D.bodyFor(api.story, api.engine, day) || []) : [];
    setText(book.note, body.join('\n\n'));
    show(book.note, body.length > 0);
    show(book.ruleSoft, hasEvents && body.length > 0);
    show(book.empty, !hasEvents && body.length === 0);
    return true;
  }

  function renderNav() {
    if (!book) return;
    var many = bookMax > NAV_MIN;
    show(book.nav, many);
    if (!many) return;
    setText(book.pageNo, bookDay + ' / ' + bookMax);
    book.prev.disabled = bookDay <= NAV_MIN;
    book.next.disabled = bookDay >= bookMax;
  }

  /** 翻一天。翻不过去的方向什么也不做。 */
  function goDay(delta) {
    var api = window.act1;
    if (!api || !api.story) return;
    var d = bookDay + delta;
    if (d < NAV_MIN || d > bookMax) return;
    if (!fillDiary(api, d, {})) return;
    bookDay = d;
    renderNav();
  }

  function show(node, on) {
    if (node) node.style.display = on ? '' : 'none';
  }

  function isOpen() {
    return !!book && book.screen.classList.contains('on');
  }

  /** 把书摊开在第 day 页。摊不成返回 false（数据缺了就不开 —— 调用方据此决定要不要拦输入）。 */
  function showBook(api, day, opts) {
    if (!book || isOpen()) return false;
    var now = currentStamp(api);
    bookMax = now ? now.day : day;
    if (day < NAV_MIN || day > bookMax) return false;
    if (!fillDiary(api, day, opts)) return false;
    bookDay = day;
    renderNav();
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
    if (!showBook(api, INTRO_DAY, { summary: false, written: true })) { introPhase = 'done'; return false; }
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

    // 翻在当前这天。剧本里没有这一天的页就往前找最近的一页（第 7 天在猎场里，
    // 日常层的页只写到第 6 天）。
    var d = stamp.day;
    while (d > NAV_MIN && !D.entryFor(api.story, d)) d--;
    showBook(api, d, {});
  }

  /* ---------- 今天的记录：进新一天的第一个 hub 时，先把上一天摊开 ---------- */

  /**
   * 规则（设计稿 §4 的第三个入口）：**上一个时段走完就翻篇**这件事不能只靠
   * 玩家自己想起来 —— 第 3 天早晨踏进 hub 的那一刻，先把「第 2 日总结」摊在
   * 他眼前，合上之后才是当天的菜单。
   *
   * 只在**当天第一个 hub** 上开一次，一个会话里每天只开一次；读档跳进某天
   * 中段不会补开（那会儿也没有「刚刚翻篇」这件事）。
   */
  var summaryShown = {};

  function maybeShowDaySummary(api) {
    if (!book || isOpen()) return;
    var node = api.engine && api.engine.node;
    var stamp = currentStamp(api);
    if (!node || !stamp) return;
    if (stamp.day < 3) return;                                  // 第 2 天：那场戏在 intro 里演过了
    if (node.id !== 'dy_d' + stamp.day + '_mo_hub') return;      // 只在当天第一个 hub 上
    if (summaryShown[stamp.day]) return;
    summaryShown[stamp.day] = true;
    showBook(api, stamp.day - 1, { summary: true });
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
    closeDiary: closeDiary, isOpen: isOpen, goDay: goDay,
    bookDay: function () { return bookDay; },
    bookMax: function () { return bookMax; },
    introPhase: function () { return introPhase; },
  };
})();
