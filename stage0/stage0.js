/* =====================================================================
   Stage 0 专用渲染层（加在 act1/ui.js 后面加载）
   ---------------------------------------------------------------------
   做三件事：
     1. 把「时段菜单」画成右下角的图标按钮，并在菜单上方补一行时段小字
     2. 左上角那个「第 X 天 · 早晨」（设计稿 §5.1）
     3. 在 d1_diary_intro 的最后一句播完之后，把日记本摊开

   **没有改 act1/ui.js，也没有接管它的点击。** ui.js 仍然照常把
   <button class="choice-btn" data-index=N> 填进 #choices，事件代理也照常
   挂在 #choices 上；这里只是在它画完之后，往容器上挂一个 s0-locations 类、
   再往每个按钮里塞一个 SVG 图标。点击因此天然是通的。

   日记那一页写什么，规则在 stage0/diary.js 里（纯逻辑，walkthrough 用的是
   同一份）。这里只负责把它画进那本书。
   ===================================================================== */
(function () {
  'use strict';

  /* 哪几个节点的选项是「去哪儿」→ 这段时间叫什么。
     值就是菜单上方那行小字里的时段名。

     这份表**不另写**：它跟 diary.js 的 SLOTS 是同一件事（hub ↔ 时段名），
     在那儿写一遍就够了 —— 那边还要用它算「这条记事属于哪个时段」。
     取不到 diary.js 才回落到下面这份（图标菜单不该因为日记挂了就不画）。 */
  var FALLBACK_SLOTS = [
    { hub: 'h_morning', label: '早晨' },
    { hub: 'h_noon', label: '中午' },
    { hub: 'h_afternoon', label: '午后' },
    { hub: 'h_night', label: '夜晚' },
  ];

  var slots = (window.Stage0Diary && window.Stage0Diary.SLOTS) || FALLBACK_SLOTS;
  var MENUS = {};
  for (var si = 0; si < slots.length; si++) MENUS[slots[si].hub] = slots[si].label;

  /* 日记本的两个节点（设计稿 §4）：
       d1_diary_intro —— 挂日记本的那一个。她交上来了，书在这里摊开。
       d1_diary       —— 只在链外，是**文本来源**：她写的那一页。
     玩家永远走不到 d1_diary（进它的那个兜底选项恒锁），所以日记正文
     只能从节点里直接读，不能问引擎「你现在停在哪」。 */
  var DIARY_INTRO_NODE = 'd1_diary_intro';
  var DIARY_NODE = 'd1_diary';
  var DIARY_SPEAKER = '西比拉的日记';

  /* 场景名 → 图标。24×24 线稿，只描边不填色，颜色跟着 currentColor 走。

     全是一套画法：同样 1.6 的线宽、同样的圆头圆角（见下面 SVG_OPEN），
     每个图形 2~4 笔，墨迹大致铺满 x/y 的 4~20 那一圈；凡是方框都用
     <rect rx> 收圆角，凡是有尖角的都靠 stroke-linejoin 磨圆。
     没有一处 fill，没有粗细不一的实心块。
     全是简单几何图形，没有用现成的图标素材。 */
  var ICONS = {
    '教室':       /* 摊开的书 */
      '<path d="M12 7.4v11"/>' +
      '<path d="M12 7.4C10.2 6 7.9 5.6 4.8 5.8v10.7c3.1-.2 5.4.2 7.2 1.6"/>' +
      '<path d="M12 7.4c1.8-1.4 4.1-1.8 7.2-1.6v10.7c-3.1-.2-5.4.2-7.2 1.6"/>',
    '大厅':       /* 门廊：山墙 + 两根柱子 + 地坪 */
      '<path d="M4.2 9.6 12 4.6l7.8 5"/>' +
      '<path d="M6.8 9.6v9.4M17.2 9.6v9.4"/>' +
      '<path d="M4.2 19h15.6"/>',
    '外院':       /* 一棵树 */
      '<path d="M12 14.6v5.6"/>' +
      '<path d="M12 5.4 5.8 14.6h12.4z"/>',
    '书房':       /* 架子上三本高低不一的书 */
      '<rect x="4.8" y="7.6" width="3.6" height="11.4" rx="1"/>' +
      '<rect x="10" y="5.2" width="4.2" height="13.8" rx="1"/>' +
      '<rect x="15.8" y="8.4" width="3.6" height="10.6" rx="1"/>',
    '后坡':       /* 坡 + 太阳 */
      '<path d="M3.4 19.2h17.2"/>' +
      '<path d="M5.8 19.2c1.6-5.4 5.6-7.4 12-7.6"/>' +
      '<circle cx="17.6" cy="6.2" r="2.4"/>',
    '外庭院':     /* 交叉的两把剑 */
      '<path d="M4.6 4.6 16.2 16.2M19.4 4.6 7.8 16.2"/>' +
      '<path d="M15.2 19.4 19.4 15.2M4.6 19.4 8.8 15.2"/>',
    '洗衣房':     /* 洗衣盆 */
      '<path d="M3.8 10.2h16.4v4.6a5.6 5.6 0 0 1-5.6 5.6H9.4a5.6 5.6 0 0 1-5.6-5.6z"/>' +
      '<path d="M6.8 14.8h10.4"/>',
    '马厩':       /* 马蹄铁 */
      '<path d="M6.8 20.2v-5a5.2 5.2 0 0 1 10.4 0v5"/>' +
      '<path d="M6.8 20.2h3M14.2 20.2h3"/>',
    '西比拉的房间': /* 蜡烛（她房里那盏点到很晚的灯） */
      '<rect x="9.4" y="9.8" width="5.2" height="10.4" rx="1"/>' +
      '<path d="M12 3.8c1.7 1.9 1.7 3.5 0 4.6-1.7-1.1-1.7-2.7 0-4.6z"/>',
    '账房':       /* 账本：方框里打格 */
      '<rect x="5" y="4.4" width="14" height="15.2" rx="1.2"/>' +
      '<path d="M5 9.4h14M5 14.6h14M12 4.4v15.2"/>',
    '伊莎贝尔的房间': /* 一张小床 */
      '<path d="M3.6 19.4V9.4"/>' +
      '<path d="M3.6 19.4h16.8"/>' +
      '<path d="M3.6 14.4h16.8"/>' +
      '<path d="M3.6 11.4h5.4v3"/>',
    '回房睡下':   /* 月亮 */
      '<path d="M19.8 14.6A8.6 8.6 0 1 1 10.4 4a6.6 6.6 0 0 0 9.4 10.6z"/>',
  };

  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';

  var choicesEl = document.getElementById('choices');
  if (!choicesEl) return;

  /* 时段提示那行小字。act1 的页面上没有这个元素，取不到就跳过。 */
  var slotLabel = document.getElementById('s0-slot-label');

  /* 左上角的时间显示。同上，只有 stage0 的页面才有。 */
  var clockEl = document.getElementById('s0-clock');

  /* 日记本那一层。同样只有 stage0 的页面才有。 */
  var diaryEls = {
    screen: document.getElementById('diary-screen'),
    title: document.getElementById('diary-title'),
    day: document.getElementById('diary-day'),
    weather: document.getElementById('diary-weather'),
    events: document.getElementById('diary-events'),
    note: document.getElementById('diary-note'),
    close: document.getElementById('diary-close'),
  };

  var titleScreenEl = document.getElementById('title-screen');

  var diaryPhase = 'idle';   // idle | open | done
  var lastNodeId = null;
  var clockText = null;      // 上一次画出来的那行字，没变就不重画

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  /**
   * 引擎此刻停在哪个节点。
   *
   * **优先信 engine.node，不优先信 ui.view** —— ui.view 会慢一拍：
   * ui.choose() 里 engine.choose() 先把游标挪走，hideChoices() 才清空
   * #choices 触发观察器，而 render() 要到这之后才跑。观察器被叫醒的那一刻，
   * ui.view 还是上一个节点。引擎的游标才是权威，界面只是它的影子。
   */
  function currentNodeId() {
    var api = window.act1;
    if (!api) return '';
    var node = api.engine.node || (api.ui && api.ui.view && api.ui.view.node);
    return (node && node.id) || '';
  }

  /* ===================================================================
   * 一、时段菜单
   * =================================================================== */

  function decorate() {
    var id = currentNodeId();
    var slot = has(MENUS, id) ? MENUS[id] : '';
    var isMenu = !!slot && choicesEl.children.length > 0;
    choicesEl.classList.toggle('s0-locations', isMenu);

    if (slotLabel) {
      if (isMenu) slotLabel.textContent = slot + ' · 选择去向';
      slotLabel.classList.toggle('on', isMenu);
    }

    if (!isMenu) return;

    for (var i = 0; i < choicesEl.children.length; i++) {
      var btn = choicesEl.children[i];
      if (btn.getElementsByClassName('s0-icon').length) continue;   // 已经塞过了
      var textEl = btn.getElementsByClassName('choice-text')[0];
      var inner = textEl ? ICONS[textEl.textContent.trim()] : null;
      if (!inner) continue;                                          // 没图标就保持原样
      var icon = document.createElement('span');
      icon.className = 's0-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = SVG_OPEN + inner + '</svg>';
      btn.insertBefore(icon, btn.firstChild);
    }
  }

  /* ===================================================================
   * 二、HUD 左上角的时间显示（设计稿 §5.1）
   * =================================================================== */

  /**
   * 节点 → 时段。**这个映射也不另写**：diary.js 的 slotMap() 已经从开头
   * 顺着剧本走过一遍，每个节点落在哪个时段它都知道（路过哪个 hub 就算哪个，
   * 没路过的继承上一个）。
   *
   * 用它而不是自己记「上一个 hub」有个好处：**没有状态**。重开一局、
   * 读档跳回某个节点，都不用重置什么，问一句就完了。
   * 剧本对象不变就缓存着（纯函数，节点 id 和数值都不参与）。
   */
  var slotCache = { story: null, map: null };

  function slotMapOf(api) {
    var D = window.Stage0Diary;
    if (!D || !D.slotMap || !api.story) return null;
    if (slotCache.story !== api.story) {
      slotCache.story = api.story;
      slotCache.map = D.slotMap(api.story);
    }
    return slotCache.map;
  }

  /* 天数先用 diary.js 里的占位符（Stage 0 只有一天）。接上真正的时间系统时
     换掉 diary.js 那个常量就行，这里不用动。 */
  function dayLabel() {
    var D = window.Stage0Diary;
    return '第 ' + ((D && D.DAY_PLACEHOLDER) || 'X') + ' 天';
  }

  function renderClock() {
    if (!clockEl) return;
    var api = window.act1;
    if (!api || !api.story) return;

    // 开始界面收掉之前不显。它不是 fixed 铺满的一层不透明底，
    // 左上角那块可能透出来 —— 不跟它赌，直接不画。
    var onTitle = !!(titleScreenEl && titleScreenEl.classList.contains('on'));

    var map = slotMapOf(api);
    var slot = (map && map[currentNodeId()]) || (slots[0] && slots[0].label) || '';

    var text = dayLabel() + ' · ' + slot;
    if (text !== clockText) {
      clockText = text;
      clockEl.textContent = '';
      var dayEl = document.createElement('span');
      dayEl.textContent = dayLabel();
      var sepEl = document.createElement('span');
      sepEl.textContent = ' · ';
      var slotEl = document.createElement('span');
      slotEl.className = 's0-clock-slot';
      slotEl.textContent = slot;
      clockEl.appendChild(dayEl);
      clockEl.appendChild(sepEl);
      clockEl.appendChild(slotEl);
    }
    clockEl.classList.toggle('on', !onTitle);
  }

  /* ===================================================================
   * 三、日记本
   * =================================================================== */

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function findNode(story, id) {
    var list = (story && story.nodes) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** 把这一天的内容填进书里。规则来自 stage0/diary.js（跟走查共用一份）。 */
  function fillDiary() {
    var api = window.act1;
    var D = window.Stage0Diary;
    if (!api || !D || !diaryEls.screen) return false;

    var entry = D.entryFor(api.story, D.DAY);
    if (!entry) return false;

    var block = D.blockOf(api.story);
    setText(diaryEls.title, block.title);
    setText(diaryEls.day, entry.date);
    setText(diaryEls.weather, entry.weather);
    if (diaryEls.weather) diaryEls.weather.setAttribute('data-weather', entry.weather);

    // 「今日事件」：今天记了哪几条，由 diary.js 从各个选项的 diary 字段算出来。
    // 全空是理论上不该发生的事（早晨那条永远成立），但真空了也不要留一块白。
    var host = diaryEls.events;
    if (host) {
      while (host.firstChild) host.removeChild(host.firstChild);
      var lines = D.eventTexts(api.story, api.engine) || [];
      if (!lines.length) {
        var none = document.createElement('li');
        none.className = 'diary-empty';
        none.textContent = '今天没有记下什么。';
        host.appendChild(none);
      } else {
        for (var k = 0; k < lines.length; k++) {
          var li = document.createElement('li');
          li.textContent = lines[k];
          host.appendChild(li);
        }
      }
    }

    // 「她写的」= d1_diary 节点里那几条「西比拉的日记」台词，按顺序接起来。
    //
    // **这里不能走 engine.visibleLines()**（v2 是那么写的）：日记摊开的时候
    // 引擎正停在 d1_diary_intro 上 —— d1_diary 已经脱链，是纯粹的文本来源。
    // 所以直接读那个节点，if 交给 engine.checkCondition 判，语义跟 visibleLines 一样。
    var noteNode = findNode(api.story, DIARY_NODE);
    var parts = [];
    var all = (noteNode && noteNode.dialogues) || [];
    for (var j = 0; j < all.length; j++) {
      var d = all[j];
      if (d.speaker !== DIARY_SPEAKER) continue;
      if (d.if && !api.engine.checkCondition(d.if)) continue;
      parts.push(d.text);
    }
    setText(diaryEls.note, parts.join('\n'));
    return true;
  }

  function isDiaryOpen() {
    return !!diaryEls.screen && diaryEls.screen.classList.contains('on');
  }

  function openDiary() {
    if (isDiaryOpen()) return;
    diaryPhase = 'open';
    if (!fillDiary()) { diaryPhase = 'done'; return; }
    diaryEls.screen.classList.add('on');
  }

  /**
   * 现在这一下输入，是不是「该把日记翻开了」？
   *
   * 三个条件：
   *   1. 引擎停在 d1_diary_intro 上，**最后一句已经播完**
   *      —— 判据是 diary.js 的 atLastLine()，纯函数，走查也核它
   *      （早一句就会把「门又被敲响了」盖住：人还没进来，书先开了）
   *   2. 此刻没在打字（ui.locked）—— 那一下该交给 ui.step() 把字补全，
   *      玩家的第一下空格永远只是「别磨蹭，快打完」
   *   3. 这一轮还没摊开过（diaryPhase 是 idle）
   *
   * 第 3 条不只是防重复：它还是**防卡死**的。万一 fillDiary() 失败
   * （数据缺了、diary.js 没加载），openDiary() 会把 phase 标成 done，
   * 于是这一下输入不再被拦、照常落到 ui.step() 上，玩家还能往下走。
   * 少了它，那边开着书失败、这边把输入吃掉，人就永远卡在最后一句上了。
   */
  function shouldOpenDiaryHere() {
    if (diaryPhase !== 'idle') return false;
    var api = window.act1;
    if (!api || !api.engine) return false;
    if (api.ui && api.ui.locked) return false;

    var D = window.Stage0Diary;
    return !!(D && D.atLastLine && D.atLastLine(api.engine, DIARY_INTRO_NODE));
  }

  /**
   * 合上。关书后**直接进结算，不再有额外对白** —— 所以把节点剩下的行
   * 一口气走完（d1_diary_intro 已经没行了，d1_end 那段日终旁白也被跳掉），
   * 只把最后那一拍交给 render()。
   */
  function closeDiary() {
    if (!isDiaryOpen()) return;
    diaryPhase = 'done';
    diaryEls.screen.classList.remove('on');

    var api = window.act1;
    if (!api) return;
    var v = null;
    for (var i = 0; i < 500; i++) {
      v = api.engine.advance();
      if (!v || v.type !== 'line') break;
    }
    api.ui.render(v);
    lastNodeId = currentNodeId();   // 同步一下，别再当成「刚进入某个节点」
  }

  if (diaryEls.close) diaryEls.close.addEventListener('click', closeDiary);

  /* 书开着的时候，输入不能漏到背后那条对话上去。
     ui.js 的 keydown 挂在 document 上（冒泡阶段）；这里挂**捕获阶段**，
     用 stopImmediatePropagation 把它拦住 —— 同一个 document 节点上，
     光 stopPropagation 是拦不住同节点的其它监听器的。

     同一支监听器还管另一件事：**该摊开日记的那一下**。它也得在捕获阶段
     先下手，不然 ui.step() 会先把游标推进 d1_end，日记就没得开了。 */
  document.addEventListener('keydown', function (ev) {
    if (isDiaryOpen()) {
      // 回车 / 空格 / Esc 也能合上，不然只剩鼠标一条路
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape') closeDiary();
      ev.stopImmediatePropagation();
      ev.preventDefault();
      return;
    }
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    if (!shouldOpenDiaryHere()) return;
    openDiary();
    ev.stopImmediatePropagation();
    ev.preventDefault();
  }, true);

  /* 点对话框那一下也一样：ui.js 的监听挂在 #dialogue-box 上（目标是它自己，
     属于冒泡的最内层），document 的捕获阶段仍然先跑。 */
  document.addEventListener('click', function (ev) {
    if (isDiaryOpen()) return;                 // 书开着时点外面不动它，得按「合上」
    if (!shouldOpenDiaryHere()) return;
    var t = ev.target;
    if (!t || !t.closest || !t.closest('#dialogue-box')) return;
    openDiary();
    ev.stopImmediatePropagation();
    ev.preventDefault();
  }, true);

  /* ===================================================================
   * 四、节点变化时叫一次
   * =================================================================== */

  /**
   * 每次 DOM 变动都调这个。
   *   - decorate() / renderClock() 每次都重算（选项和节点 id 可能各变各的）
   *   - 日记那一轮只认**跨进** d1_diary_intro 的边沿（见下）
   */
  function tick() {
    var id = currentNodeId();

    // 「一次性触发锁」：认的是**边沿**（节点 id 变了），不是电平。
    // 所以 DOM 多刷一拍也不会「打开 → 关闭 → 又打开」——
    // 那些多出来的 tick 里 id 没变，entered 是 false。
    // 换了节点就重置，所以重新开始时这一轮是干净的，日记照开。
    var entered = id !== lastNodeId;
    lastNodeId = id;
    if (entered) diaryPhase = 'idle';

    decorate();
    renderClock();
  }

  /* #choices：选项被填上 / 清空时醒过来，菜单靠它。
     #dialogue-box：每画一行台词就会被 ui.js 重写一次，是「页面刚换了一帧」
     最便宜可靠的节拍 —— 时间显示和「最后一句播完了吗」都靠这一拍。
     #title-screen：它收起来（class 掉了）就是「开始游戏」那一瞬间，
     而那一刻**没有**任何别的 DOM 会动（第一句早画好了）——
     不盯着它，时间显示要等到玩家推第一句才冒出来。
     （日记本自己不再有节点可盯：它由输入那一下翻开，见上面那两支监听器。） */
  new MutationObserver(tick).observe(choicesEl, { childList: true });
  var box = document.getElementById('dialogue-box');
  if (box) {
    new MutationObserver(tick).observe(box, {
      childList: true, subtree: true, characterData: true,
    });
  }
  if (titleScreenEl) {
    new MutationObserver(tick).observe(titleScreenEl, {
      attributes: true, attributeFilter: ['class'],
    });
  }
  tick();
})();
