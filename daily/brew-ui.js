/* =====================================================================
   熬药 · 界面层（加在 act1/ui.js 后面加载）
   ---------------------------------------------------------------------
   两件事，都长在日常层这一边，**没有改 act1/ui.js、也没有往 index.html 加 id**：
     1. 账册那一条固定采购的结算（走到 dy_d2_af_ledger_e 时发料，只发一次）
     2. 熬药浮层 —— 挂在 dy_d2_ev_brew_e 的最后一句之前

   和 daily/daily.js 同一套做法：DOM 全是运行时 createElement 出来的，
   页面骨架一个元素都没动（tests/dom-stub.cjs 是正则扫 index.html 的 id 的，
   不碰它就不必动 ui.js 的 mount() 清单和 ui.test.cjs 里的计数）。

   =====================================================================
   一、接在剧情哪一下
   ---------------------------------------------------------------------
   dy_d2_ev_brew_e 有五句，最后一句是「药煎好后，你把药倒进杯里……」。
   熬药要发生在这句**之前** —— 所以拦的是「第四句已经在屏幕上、玩家正要把
   最后一句推出来」的那一下（lineIndex === 总句数 − 1，且不是刚进节点）。
   早了会把「你把小册子放在手边」那句盖住，晚了这句就成马后炮了。
   做法与 daily.js 摊开日记本那一下完全一样：**捕获阶段**先下手，
   拦下来就把浮层推开；拦不动（材料不够之类）就放行，玩家照常往下走。

   浮层关掉之后输入照常落到 ui.js 上，最后一句接着播，节点照原样走
   dy_d2_ni_end_e。**熬药失败、跳过、甚至没料可熬，主线都不断。**

   =====================================================================
   二、按键不许串台
   ---------------------------------------------------------------------
   熬药期间 ui.js 那套（空格 / 回车推进对白、↑↓ 选项、Enter 确认）必须收不到
   输入。做法是**捕获阶段 stopImmediatePropagation** —— 和日记本那条一样，
   同一个 document 节点上光 stopPropagation 是拦不住同节点的其它监听器的。

   这一层还挂着：
     空格 / ↑ / W   按住 = 添柴（松开就落）
     Enter          确认这一步（阶段成绩屏上则是「继续」）
     1~9            投第几味药
     M              翻熬药手册（**翻开不停表**，见下面的说明）
     Esc            合上手册（手册没开时什么都不做 —— 不能让它落到系统菜单上）

   =====================================================================
   三、手册为什么不算暂停
   ---------------------------------------------------------------------
   设计要求是「操作过程中允许查看手册，但不能因为打开手册而重置倒计时」。
   所以手册只是盖在卡片上的一层纸，引擎那边一无所知 —— 表照走，火照落。
   翻手册看两眼再回来，火候已经掉下去了，这才是这道工序该有的压力。
   ===================================================================== */
(function () {
  'use strict';

  var A = window.AlchemyData;
  var B = window.BrewEngine;
  var I = window.ItemIcons;
  if (!A || !B || !I) return;                      // 三个模块缺一个就别装

  /* 剧本没写 pharmacy.brew 时的兜底（正常情况下 daily/story.json 里写着） */
  var DEFAULT_BREW = {
    node: 'dy_d2_ev_brew_e',
    recipe: 'recipe_daily_decoction_01',
    settledFlag: '旗_熬药结算',
  };

  /* 品质分档表……不在这一层 —— A.qualityOf() 那一处才是唯一的真值 */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** 显示/收起。**整层的那两块（浮层与手册）不走这里**：
      浮层靠 .on 那个类（CSS: .dy-brew-screen{display:none} / .on{display:block}），
      手册是个 flex 居中框、要显式写 flex —— 见 showManual()。 */
  function show(node, on) {
    if (node) node.style.display = on ? '' : 'none';
  }

  function showManual(on) {
    if (dom && dom.manual) dom.manual.style.display = on ? 'flex' : 'none';
  }

  function pct(x) {
    return (Math.max(0, Math.min(1, Number(x) || 0)) * 100).toFixed(1) + '%';
  }

  /* ---------- 时钟 ---------- */

  /* 真实经过的时间。引擎那边是注入进去的，这里给的就是它。
     测试会把 Date.now 换掉来推时间（见 tests/brew.test.cjs）。 */
  function nowMs() {
    return Date.now();
  }

  /* =====================================================================
     浮层的 DOM
     ===================================================================== */

  function buildScreen() {
    var screen = el('div', 'dy-brew-screen');
    var veil = el('div', 'dy-brew-veil');
    var card = el('div', 'dy-brew-card');

    /* ---- 头：方子名 + 简介 + 一行小字 ---- */
    var head = el('div', 'dy-brew-head');
    var title = el('div', 'dy-brew-title');
    var desc = el('p', 'dy-brew-desc');
    var meta = el('div', 'dy-brew-meta');
    head.appendChild(title);
    head.appendChild(desc);
    head.appendChild(meta);

    /* ---- 左：材料栏 ---- */
    var side = el('aside', 'dy-brew-side');
    var sideHead = el('div', 'dy-brew-sidehead', '手边的药');
    var mats = el('ul', 'dy-brew-mats');
    var manualBtn = el('button', 'dy-brew-manualbtn', '熬药手册');
    manualBtn.type = 'button';
    var sideHint = el('p', 'dy-brew-sidehint', '数字键 1~9 也能投药。');
    side.appendChild(sideHead);
    side.appendChild(mats);
    side.appendChild(manualBtn);
    side.appendChild(sideHint);

    /* ---- 中：这一段工序 ---- */
    var stage = el('section', 'dy-brew-stage');
    var dots = el('div', 'dy-brew-dots');
    var stageLabel = el('div', 'dy-brew-stagelabel');
    var brief = el('p', 'dy-brew-brief');
    var picks = el('div', 'dy-brew-picks');

    /* 火候：一根条 + 目标带 + 读数 */
    var heatBox = el('div', 'dy-brew-gauge');
    var heatHead = el('div', 'dy-brew-gaugehead');
    var heatName = el('span', 'dy-brew-gaugename', '火候');
    var heatVal = el('span', 'dy-brew-gaugeval');
    heatHead.appendChild(heatName);
    heatHead.appendChild(heatVal);
    var heatTrack = el('div', 'dy-brew-track');
    var heatBand = el('div', 'dy-brew-band');
    var heatFill = el('div', 'dy-brew-fill');
    heatTrack.appendChild(heatBand);
    heatTrack.appendChild(heatFill);
    heatBox.appendChild(heatHead);
    heatBox.appendChild(heatTrack);

    /* 进度条：来回扫的指针 + 命中区 */
    var sweepBox = el('div', 'dy-brew-gauge');
    var sweepHead = el('div', 'dy-brew-gaugehead');
    var sweepName = el('span', 'dy-brew-gaugename', '火口');
    var sweepHint = el('span', 'dy-brew-gaugeval');
    sweepHead.appendChild(sweepName);
    sweepHead.appendChild(sweepHint);
    var sweepTrack = el('div', 'dy-brew-track');
    var sweepBand = el('div', 'dy-brew-band');
    var sweepHeadEl = el('div', 'dy-brew-sweephead');
    sweepTrack.appendChild(sweepBand);
    sweepTrack.appendChild(sweepHeadEl);
    sweepBox.appendChild(sweepHead);
    sweepBox.appendChild(sweepTrack);

    /* 倒计时 */
    var timerBox = el('div', 'dy-brew-timer');
    var timerBar = el('div', 'dy-brew-timerbar');
    var timerText = el('span', 'dy-brew-timertext');
    timerBox.appendChild(timerBar);
    timerBox.appendChild(timerText);

    /* 反馈 */
    var feedback = el('ul', 'dy-brew-feedback');

    /* 动作 */
    var actions = el('div', 'dy-brew-actions');
    var fireBtn = el('button', 'dy-brew-btn dy-brew-fire');
    fireBtn.type = 'button';
    var confirmBtn = el('button', 'dy-brew-btn dy-brew-confirm');
    confirmBtn.type = 'button';
    var skipBtn = el('button', 'dy-brew-btn dy-brew-skip', '跳过');
    skipBtn.type = 'button';
    skipBtn.title = '没做完的部分按普通煎完';
    actions.appendChild(fireBtn);
    actions.appendChild(confirmBtn);
    actions.appendChild(skipBtn);

    stage.appendChild(dots);
    stage.appendChild(stageLabel);
    stage.appendChild(brief);
    stage.appendChild(picks);
    stage.appendChild(heatBox);
    stage.appendChild(sweepBox);
    stage.appendChild(timerBox);
    stage.appendChild(feedback);
    stage.appendChild(actions);

    /* ---- 正文两栏 ---- */
    var main = el('div', 'dy-brew-main');
    main.appendChild(side);
    main.appendChild(stage);

    /* ---- 手册：盖在卡片上的一层纸 ---- */
    var manual = el('div', 'dy-brew-manual');
    var manualPaper = el('div', 'dy-brew-manualpaper');
    var manualTitle = el('div', 'dy-brew-manualtitle', '熬药手册');
    var manualList = el('ul', 'dy-brew-manuallist');
    var manualNeed = el('ul', 'dy-brew-manualneed');
    var manualClose = el('button', 'dy-brew-btn dy-brew-manualclose', '合上');
    manualClose.type = 'button';
    manualPaper.appendChild(manualTitle);
    manualPaper.appendChild(manualList);
    manualPaper.appendChild(el('div', 'dy-brew-manualtitle', '这一锅要用的'));
    manualPaper.appendChild(manualNeed);
    manualPaper.appendChild(manualClose);
    manual.appendChild(manualPaper);

    /* ---- 开场 / 结算 / 缺料：三块整屏的纸 ---- */
    var ready = el('div', 'dy-brew-panel');
    var readyTitle = el('div', 'dy-brew-paneltitle');
    var readyBody = el('div', 'dy-brew-panelbody');
    var readyNeed = el('ul', 'dy-brew-manualneed');
    var readyActions = el('div', 'dy-brew-actions');
    var readyStart = el('button', 'dy-brew-btn dy-brew-start', '起火');
    readyStart.type = 'button';
    var readySkip = el('button', 'dy-brew-btn dy-brew-skip', '跳过');
    readySkip.type = 'button';
    readyActions.appendChild(readyStart);
    readyActions.appendChild(readySkip);
    ready.appendChild(readyTitle);
    ready.appendChild(readyBody);
    ready.appendChild(el('div', 'dy-brew-manualtitle', '要用到的药'));
    ready.appendChild(readyNeed);
    ready.appendChild(readyActions);

    var resultBox = el('div', 'dy-brew-panel dy-brew-resultpanel');
    var resultTitle = el('div', 'dy-brew-paneltitle');
    var resultBody = el('div', 'dy-brew-panelbody');
    var resultRows = el('ul', 'dy-brew-resultrows');
    var resultActions = el('div', 'dy-brew-actions');
    var resultClose = el('button', 'dy-brew-btn dy-brew-resultclose', '收好');
    resultClose.type = 'button';
    resultActions.appendChild(resultClose);
    resultBox.appendChild(resultTitle);
    resultBox.appendChild(resultBody);
    resultBox.appendChild(resultRows);
    resultBox.appendChild(resultActions);

    card.appendChild(head);
    card.appendChild(main);
    card.appendChild(manual);
    card.appendChild(ready);
    card.appendChild(resultBox);

    screen.appendChild(veil);
    screen.appendChild(card);

    return {
      screen: screen, veil: veil, card: card,
      title: title, desc: desc, meta: meta,
      mats: mats, manualBtn: manualBtn,
      dots: dots, stageLabel: stageLabel, brief: brief, picks: picks,
      heatTrack: heatTrack, heatBand: heatBand, heatFill: heatFill, heatVal: heatVal,
      sweepTrack: sweepTrack, sweepBand: sweepBand, sweepHeadEl: sweepHeadEl,
      sweepHint: sweepHint,
      timerBar: timerBar, timerText: timerText,
      feedback: feedback,
      fireBtn: fireBtn, confirmBtn: confirmBtn, skipBtn: skipBtn,
      manual: manual, manualList: manualList, manualNeed: manualNeed,
      manualClose: manualClose,
      ready: ready, readyTitle: readyTitle, readyBody: readyBody,
      readyNeed: readyNeed, readyStart: readyStart, readySkip: readySkip,
      resultBox: resultBox, resultTitle: resultTitle, resultBody: resultBody,
      resultRows: resultRows, resultClose: resultClose,
    };
  }

  /* =====================================================================
     运行时
     ===================================================================== */

  var dom = null;
  var mounted = false;
  var api = null;              // window.act1
  var active = false;          // 浮层开着吗
  var brew = null;             // 当前的 BrewEngine 实例（一次制作一个）
  var readyPhase = 'idle';     // idle / open / done：dy_d2_ev_brew_e 那一场只演一次
  var manualOpen = false;
  var frame = null;            // requestAnimationFrame / setInterval 的把手
  var lastNodeId = null;
  var settledThisRun = false;  // 这一锅写没写过库存（结算只写一次）

  function story() { return (api && api.story) || null; }
  function engine() { return (api && api.engine) || null; }

  function brewConf() {
    var st = story();
    var conf = (st && st.pharmacy && st.pharmacy.brew) || {};
    return {
      node: conf.node || DEFAULT_BREW.node,
      recipe: conf.recipe || DEFAULT_BREW.recipe,
      settledFlag: conf.settledFlag || DEFAULT_BREW.settledFlag,
    };
  }

  function recipe() {
    return A.recipeById(brewConf().recipe);
  }

  function getStat(name) {
    var e = engine();
    return e ? e.getStat(name) : 0;
  }

  /** 写一份库存。**只有结算这一步会调它** —— 别处都不许动药材。 */
  function addStat(stat, delta) {
    var e = engine();
    if (!e) return 0;
    return e.setStat(stat, (Number(e.getStat(stat)) || 0) + Number(delta || 0));
  }

  /* ---------- 开 / 关 ---------- */

  function openReady() {
    if (!dom) return false;
    var r = recipe();
    if (!r) return false;

    active = true;
    settledThisRun = false;
    brew = null;
    manualOpen = false;
    lastShape = '';
    showManual(false);
    show(dom.resultBox, false);
    show(dom.ready, true);
    dom.screen.classList.add('on');
    stopFrame();

    /* 上一回可能是「料不够」那一屏（按钮写着别的话），先摆回去 */
    dom.readyStart.textContent = '起火';
    dom.readySkip.textContent = '跳过';

    dom.title.textContent = r.name;
    dom.desc.textContent = r.desc || '';
    dom.meta.textContent = r.stages.length + ' 道工序 · 约 ' + r.durationMin + ' 分钟';

    fillManual();
    renderInventory();
    /* 起火前那一屏是盖在工序那一栏**上面**的（不透明）。底下那几颗按钮虽然看不见，
       键盘 Tab 还是摸得到 —— 这里一律禁掉，免得没烧起来的锅被人盲按出个确认来。
       （材料没投完 / 不在 RUNNING，renderStructure 也会把它们按掉，这一句是补上
        「还没进 RUNNING」那一段的空档。） */
    dom.fireBtn.disabled = true;
    dom.confirmBtn.disabled = true;
    show(dom.skipBtn, false);
    var idleBtns = dom.mats.getElementsByClassName('dy-brew-matbtn');
    for (var bi = 0; bi < idleBtns.length; bi++) idleBtns[bi].disabled = true;

    var chk = A.checkMaterials(r, getStat);
    if (chk.ok) {
      dom.readyTitle.textContent = '照旧方煎';
      dom.readyBody.textContent = r.manualIntro || '';
      show(dom.readyActions, true);
      dom.readyStart.disabled = false;
      dom.readySkip.disabled = false;
    } else {
      /* 没料可熬：**这不是死路**。缺口照实说，玩家按一下照常回主线 ——
         不扣料、不发成品、旗也不动（往后真凑齐了还能熬）。
         注意「回房去」这一颗**不能禁**：它是这一屏唯一的出口，
         禁掉就把人锁在浮层里了（onSkip 会认出没料，走 closeScreen）。 */
      dom.readyTitle.textContent = '手边的药不够';
      var names = chk.missing.map(function (m) { return m.name; }).join('、');
      dom.readyBody.textContent = '缺 ' + names + '。这一剂凑不齐，今晚先只能作罢。';
      show(dom.readyActions, true);
      dom.readyStart.disabled = true;
      dom.readySkip.disabled = false;
      dom.readySkip.textContent = '回房去';
    }
    renderNeed(dom.readyNeed);
    return true;
  }

  function startBrewing() {
    var r = recipe();
    if (!r) return;
    brew = new B.BrewEngine(r, { getStat: getStat, now: nowMs });
    var res = brew.start();
    if (!res.ok) {                                  // 料不够（理论上按钮是灰的）
      openReady();
      return;
    }
    show(dom.ready, false);
    lastShape = '';                                 // 换了引擎，结构那一半从头画一遍
    render();
    startFrame();
  }

  function startFrame() {
    stopFrame();
    var win = window;
    if (typeof win.requestAnimationFrame === 'function') {
      var step = function () {
        frame = win.requestAnimationFrame(step);
        tickFrame();
      };
      frame = win.requestAnimationFrame(step);
    } else if (typeof win.setInterval === 'function') {
      frame = win.setInterval(tickFrame, 50);
    }
  }

  function stopFrame() {
    if (frame === null) return;
    var win = window;
    if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frame);
    else if (typeof win.clearInterval === 'function') win.clearInterval(frame);
    frame = null;
  }

  /* 每帧：先把时间推给引擎（它自己判超时），再照状态重画。
     两件事都要做 —— 只画不推，表就是死的；只推不画，玩家看不见。
     不在 RUNNING 上（阶段成绩屏 / 结算屏）就停表：那两张屏上没有会动的数，
     留着 60fps 空转只是白烧电。next() 与 startBrewing() 会再起。 */
  function tickFrame() {
    if (!active || !brew) { stopFrame(); return; }
    brew.tick();
    render();
    if (brew.state !== B.STATE.RUNNING) stopFrame();
  }

  function closeScreen() {
    stopFrame();
    active = false;
    manualOpen = false;
    /* 整层的显隐只认 .on 这一个类 —— 这里绝不能再去写 style.display，
       写了就留在 DOM 上，下一回 add('on') 也盖不过它（浮层再也开不出来）。 */
    dom.screen.classList.remove('on');
    show(dom.ready, false);
    show(dom.resultBox, false);
    showManual(false);
    var e = engine();
    if (brew && brew.state === B.STATE.RUNNING) brew.cancel('closed');
    brew = null;
    /* 浮层关掉之后**不替玩家按那一下**：最后一句还等他推。
       这一场演过一次就记下来，读档回到同一句也不再演第二遍。 */
    if (readyPhase === 'open') readyPhase = 'done';
  }

  /* ---------- 材料栏 / 手册 / 进度点 ---------- */

  function renderInventory() {
    if (!dom) return;
    var r = recipe();
    var host = dom.mats;
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!r) return;

    var rows = A.inventoryRows(r, getStat);
    rows.forEach(function (row, i) {
      var li = el('li', 'dy-brew-mat');
      li.setAttribute('data-id', row.id);
      if (!row.have) li.classList.add('dy-brew-mat--out');
      if (row.used) li.classList.add('dy-brew-mat--used');

      var btn = el('button', 'dy-brew-matbtn');
      btn.type = 'button';
      btn.setAttribute('data-id', row.id);
      btn.appendChild(I.makeIcon(document, row.icon, (story() || {}).art && story().art.assets));

      var body = el('span', 'dy-brew-matbody');
      var top = el('span', 'dy-brew-matname', row.name);
      if (i < 9) {
        var key = el('span', 'dy-brew-matkey', String(i + 1));
        top.appendChild(key);
      }
      body.appendChild(top);
      body.appendChild(el('span', 'dy-brew-matdesc', row.desc || ''));

      var count = el('span', 'dy-brew-matcount', '×' + row.have);
      if (row.need) count.appendChild(el('em', 'dy-brew-matneed', '用 ' + row.need));
      body.appendChild(count);

      btn.appendChild(body);
      li.appendChild(btn);
      host.appendChild(li);
    });
  }

  function renderNeed(host) {
    while (host.firstChild) host.removeChild(host.firstChild);
    var r = recipe();
    if (!r) return;
    A.requiredMaterials(r).forEach(function (req) {
      var it = A.itemById(req.id) || { name: req.id, icon: '' };
      var li = el('li', 'dy-brew-needrow');
      li.appendChild(I.makeIcon(document, it.icon, (story() || {}).art && story().art.assets));
      li.appendChild(el('span', 'dy-brew-needname', it.name));
      li.appendChild(el('span', 'dy-brew-needqty', '×' + req.qty + '（现有 ' + getStat(A.statOf(req.id)) + '）'));
      host.appendChild(li);
    });
  }

  function fillManual() {
    var r = recipe();
    if (!r) return;
    while (dom.manualList.firstChild) dom.manualList.removeChild(dom.manualList.firstChild);
    r.stages.forEach(function (st, i) {
      var li = el('li', 'dy-brew-manualrow');
      li.appendChild(el('span', 'dy-brew-manualno', String(i + 1)));
      var body = el('span', 'dy-brew-manualbody');
      body.appendChild(el('span', 'dy-brew-manualname', st.label));
      body.appendChild(el('span', 'dy-brew-manualtext', st.manual || ''));
      li.appendChild(body);
      dom.manualList.appendChild(li);
    });
    renderNeed(dom.manualNeed);
  }

  function renderDots(snap) {
    var host = dom.dots;
    while (host.firstChild) host.removeChild(host.firstChild);
    var n = (recipe() || { stages: [] }).stages.length;
    for (var i = 0; i < n; i++) {
      var d = el('span', 'dy-brew-dot');
      if (snap && i < snap.stageIndex) d.classList.add('done');
      if (snap && i === snap.stageIndex) d.classList.add('now');
      d.textContent = String(i + 1);
      host.appendChild(d);
    }
  }

  /* ---------- 渲染 ---------- */

  /* 材料栏那几颗按钮是**可以点的**，所以绝不能每帧重建 —— 按钮在被按下的
     那一瞬间被换掉，这一次点击就没了（mousedown 与 mouseup 落在两个不同的
     元素上，click 根本不会发出来）。
     于是拆成两半：
       · 结构那一半（会换 DOM 节点的）只在 snap.shape 变了时重建
       · 火候 / 指针 / 倒计时那一半每帧都刷，但只改 style，不换节点 */
  var lastShape = '';

  function shapeOf(snap) {
    return [
      snap.state, snap.stageIndex,
      snap.picks.map(function (p) { return p.picked; }).join('+'),
      snap.picksLeft,
      /* 火候的按住/松开**不在**这个键里 —— 它一秒钟变好几回，进键就等于
         每按一次添柴都把材料栏重建一遍。它只改按钮上那几个字，见 renderLive */
      A.inventoryRows(recipe(), getStat).map(function (r) { return r.have; }).join(','),
      manualOpen ? 1 : 0,
    ].join('|');
  }

  function render() {
    if (!dom || !brew) return;
    var snap = brew.snapshot();
    var st = snap.stage;
    var r = recipe();

    var shape = shapeOf(snap);
    if (shape !== lastShape) {
      lastShape = shape;
      renderStructure(snap, st, r);
    }
    renderLive(snap, st);
  }

  /** 结构那一半：会换节点的都在这里。 */
  function renderStructure(snap, st, r) {
    renderDots(snap);
    renderInventory();

    var running = snap.state === B.STATE.RUNNING;
    var atResult = snap.state === B.STATE.STAGE_RESULT;

    show(dom.ready, false);
    show(dom.resultBox, snap.state === B.STATE.COMPLETED);

    dom.stageLabel.textContent = st ? st.label : (r ? r.name : '');
    dom.brief.textContent = st ? (st.brief || '') : '';

    /* 已投的药：一味一味摆出来，让「顺序」看得见 */
    var host = dom.picks;
    while (host.firstChild) host.removeChild(host.firstChild);
    var expected = st && st.materials ? st.materials.order : [];
    if (expected.length) {
      expected.forEach(function (id, i) {
        var rec = snap.picks[i];
        var chip = el('span', 'dy-brew-chip');
        var it = A.itemById(id) || { name: id };
        if (!rec) { chip.classList.add('todo'); chip.textContent = '待下：' + it.name; }
        else {
          chip.classList.add(rec.picked === id ? 'ok' : 'bad');
          chip.textContent = '已下：' + ((A.itemById(rec.picked) || {}).name || rec.picked);
        }
        host.appendChild(chip);
      });
      host.appendChild(el('span', 'dy-brew-pickhint', st.materials.hint || ''));
    }

    /* 反馈 */
    var fbHost = dom.feedback;
    while (fbHost.firstChild) fbHost.removeChild(fbHost.firstChild);
    var fb = (atResult && brew.stageResult ? brew.stageResult.feedback : []) || [];
    fb.forEach(function (f) {
      fbHost.appendChild(el('li', 'dy-brew-fb dy-brew-fb--' + f.level, f.text));
    });

    dom.fireBtn.disabled = !running;

    dom.confirmBtn.textContent = atResult ? '继续' : ((st && st.confirmLabel) || '确认');
    dom.confirmBtn.disabled = !running && !atResult;
    dom.confirmBtn.classList.toggle('wait', running && snap.picksLeft > 0);
    dom.confirmBtn.title = running && snap.picksLeft > 0
      ? ('还有 ' + snap.picksLeft + ' 味药没下') : '';

    show(dom.skipBtn, running || atResult);
    dom.skipBtn.disabled = !running && !atResult;

    /* 材料按钮只在 RUNNING、且这一段要投药、且还没投满时点得动 */
    var canPick = running && expected.length > 0 && snap.picksLeft > 0;
    var btns = dom.mats.getElementsByClassName('dy-brew-matbtn');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !canPick;

    showManual(manualOpen);
  }

  /** 每帧那一半：只改 style 与文本，一个节点都不换。 */
  function renderLive(snap, st) {
    dom.fireBtn.textContent = snap.holding ? '添柴中…（松开就撤）' : '添柴（按住 空格 / ↑）';
    dom.fireBtn.classList.toggle('on', !!snap.holding);

    if (st && st.heat) {
      var band = st.heat.band || [0, 100];
      dom.heatBand.style.left = pct(band[0] / 100);
      dom.heatBand.style.width = pct((band[1] - band[0]) / 100);
      dom.heatFill.style.width = pct(snap.heat / 100);
      var hot = snap.heat >= band[0] && snap.heat <= band[1];
      dom.heatFill.classList.toggle('in-band', hot);
      dom.heatVal.textContent = hot ? '正好' : (snap.heat < band[0] ? '偏小' : '偏大');
    }

    if (st && st.sweep) {
      var sb = st.sweep.band || [0, 1];
      dom.sweepBand.style.left = pct(sb[0]);
      dom.sweepBand.style.width = pct(sb[1] - sb[0]);
      dom.sweepHeadEl.style.left = pct(snap.sweep);
      var on = snap.sweep >= sb[0] && snap.sweep <= sb[1];
      dom.sweepHeadEl.classList.toggle('on', on);
      dom.sweepHint.textContent = on ? '就在这儿按' : '等指针过来';
    }

    if (snap.state === B.STATE.RUNNING && st) {
      var limit = Number(st.timeLimitMs) || 0;
      var left = snap.remainingMs;
      dom.timerText.textContent = (left / 1000).toFixed(1) + ' 秒';
      dom.timerBar.style.width = pct(limit ? left / limit : 0);
      dom.timerBar.classList.toggle('urgent', left <= 3000);
    } else {
      dom.timerText.textContent = '';
      dom.timerBar.style.width = '0%';
      dom.timerBar.classList.remove('urgent');
    }
  }

  /* =====================================================================
     结算
     ===================================================================== */

  /**
   * 把这一锅写进库存。**只写一次。**
   *
   * 三道闸：
   *   1. settledThisRun —— 这一次浮层里写过了（连点、重复 next 都挡在这）
   *   2. 旗_熬药结算    —— 这一局里写过了（读档跳回同一句、重新进浮层）
   *   3. settlementPlan 返回 null —— 没做完（CANCELLED / 中途关掉）
   * 三道都过不去就什么都不改。库存只在这一处加减。
   */
  function settle(result) {
    if (!result || !result.completed) return false;
    var conf = brewConf();
    if (settledThisRun) return false;
    if (Number(getStat(conf.settledFlag)) > 0) { settledThisRun = true; return false; }

    var plan = B.settlementPlan(result);
    if (!plan) return false;

    plan.forEach(function (op) { addStat(op.stat, op.delta); });
    addStat(conf.settledFlag, 1);                   // 落了旗，再进浮层也发不出第二份
    settledThisRun = true;
    return true;
  }

  function showResult(result) {
    if (!dom) return;
    stopFrame();
    show(dom.ready, false);
    showManual(false);
    show(dom.resultBox, true);
    manualOpen = false;

    /* 结算写在纸上之前先落库 —— 顺序反过来的话，玩家看完就关掉窗口，
       这一锅就白做了（材料没扣、成品没发，旗却是亮的） */
    var wrote = settle(result);

    dom.resultTitle.textContent = result.quality.label;
    var lines = [];
    lines.push(result.skipped
      ? '剩下的照着旧方草草煎完了。'
      : '你把这一锅滤出来，倒进杯里。');
    lines.push('这一剂在炉上花了约 ' + result.durationMin + ' 分钟。');
    dom.resultBody.textContent = lines.join('');

    var host = dom.resultRows;
    while (host.firstChild) host.removeChild(host.firstChild);

    var scoreRow = el('li', 'dy-brew-resultrow');
    scoreRow.appendChild(el('span', 'dy-brew-resultkey', '这一锅'));
    scoreRow.appendChild(el('span', 'dy-brew-resultval', result.score + ' 分 · ' + result.quality.label));
    host.appendChild(scoreRow);

    /* 三维分开报 —— 让玩家知道下一次差在哪儿 */
    [['material', '材料与顺序'], ['heat', '火候'], ['timing', '时机']].forEach(function (pair) {
      var d = result.dimensions[pair[0]];
      var li = el('li', 'dy-brew-resultrow');
      li.appendChild(el('span', 'dy-brew-resultkey', pair[1]));
      var txt = d.samples ? Math.round(d.score * 100) + ' / 100' : '这一段没考';
      li.appendChild(el('span', 'dy-brew-resultval', txt));
      host.appendChild(li);
    });

    var csRow = el('li', 'dy-brew-resultrow');
    csRow.appendChild(el('span', 'dy-brew-resultkey', '用掉的药'));
    var used = (result.consumed || []).map(function (c) {
      return ((A.itemById(c.id) || {}).name || c.id) + ' ×' + c.qty;
    }).join('、');
    csRow.appendChild(el('span', 'dy-brew-resultval', used || '——'));
    host.appendChild(csRow);

    var prRow = el('li', 'dy-brew-resultrow');
    prRow.appendChild(el('span', 'dy-brew-resultkey', '收下'));
    var prod = result.product ? (A.itemById(result.product.id) || {}) : null;
    if (prod && wrote) {
      var wrap = el('span', 'dy-brew-resultval');
      wrap.appendChild(I.makeIcon(document, prod.icon, (story() || {}).art && story().art.assets));
      wrap.appendChild(el('span', 'dy-brew-resultname', prod.name + ' ×' + result.product.qty));
      prRow.appendChild(wrap);
    } else if (prod) {
      prRow.appendChild(el('span', 'dy-brew-resultval', prod.name + '（已经收过了）'));
    } else {
      prRow.appendChild(el('span', 'dy-brew-resultval', '——'));
    }
    host.appendChild(prRow);
  }

  /* =====================================================================
     操作
     ===================================================================== */

  function onFire(on) {
    if (!active || !brew) return;
    brew.holdHeat(!!on);
    render();
  }

  function onConfirm() {
    if (!active || !brew) return;
    if (brew.state === B.STATE.STAGE_RESULT) {
      var res = brew.next();
      if (res.done) { showResult(brew.result()); return; }
      render();
      startFrame();                                 // 下一段开工，表接着走
      return;
    }
    var r = brew.confirm();
    if (!r.ok && r.reason === 'need-more-picks') {
      dom.confirmBtn.classList.add('shake');
      setTimeout(function () { if (dom) dom.confirmBtn.classList.remove('shake'); }, 320);
    }
    render();
  }

  function onPick(id) {
    if (!active || !brew) return;
    var r = brew.pick(id);
    if (r.ok) render();
  }

  function onSkip() {
    if (!active) return;
    if (!brew) {                                    // READY 那一屏的跳过
      var r = recipe();
      if (!r || !A.checkMaterials(r, getStat).ok) { closeScreen(); return; }
      brew = new B.BrewEngine(r, { getStat: getStat, now: nowMs });
    }
    var res = brew.skip();
    if (!res.ok) { render(); return; }
    showResult(brew.result());
  }

  function toggleManual(force) {
    if (!active) return;
    manualOpen = force === undefined ? !manualOpen : !!force;
    if (manualOpen) renderNeed(dom.manualNeed);
    showManual(manualOpen);
  }

  /* ---------- 事件 ---------- */

  function bind() {
    dom.fireBtn.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); onFire(true);
    });
    dom.fireBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); onFire(true); });
    dom.fireBtn.addEventListener('touchstart', function (ev) { ev.preventDefault(); onFire(true); });
    ['pointerup', 'pointercancel', 'pointerleave', 'mouseup', 'mouseleave', 'touchend', 'touchcancel']
      .forEach(function (type) {
        dom.fireBtn.addEventListener(type, function () { onFire(false); });
      });
    /* 松开鼠标那一下可能落在按钮外面 —— 补一道 document 上的兜底，
       不然火会一直添着（玩家会以为界面卡了） */
    document.addEventListener('mouseup', function () { if (active && brew) onFire(false); });

    dom.confirmBtn.addEventListener('click', function (ev) { ev.stopPropagation(); onConfirm(); });
    dom.skipBtn.addEventListener('click', function (ev) { ev.stopPropagation(); onSkip(); });
    dom.manualBtn.addEventListener('click', function (ev) { ev.stopPropagation(); toggleManual(); });
    dom.manualClose.addEventListener('click', function (ev) { ev.stopPropagation(); toggleManual(false); });
    dom.readyStart.addEventListener('click', function (ev) { ev.stopPropagation(); startBrewing(); });
    dom.readySkip.addEventListener('click', function (ev) { ev.stopPropagation(); onSkip(); });
    dom.resultClose.addEventListener('click', function (ev) { ev.stopPropagation(); closeScreen(); });

    /* 材料栏用事件代理：按钮是每一帧重建的，逐个挂监听会散架 */
    dom.mats.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var t = ev.target;
      while (t && t !== dom.mats) {
        if (t.getAttribute && t.getAttribute('data-id')) { onPick(t.getAttribute('data-id')); return; }
        t = t.parentNode;
      }
    });

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('click', onClick, true);
    /* 切走再回来：表是照真实时间算的，回来立刻推一次，超时当场结清，
       不会让玩家回来还看着一个停住的界面 */
    document.addEventListener('visibilitychange', function () {
      if (active && document.hidden === false) tickFrame();
    });
  }

  var HOLD_KEYS = { ' ': 1, 'ArrowUp': 1, 'w': 1, 'W': 1 };

  function onKeyDown(ev) {
    if (!active) {
      /* 浮层没开：看这一下输入是不是「该把那口锅端出来」的那一下。
         开不成（数据缺了之类）就**不拦** —— 输入照常落到 ui.js 上，玩家还能往下走。 */
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      if (!shouldOpenHere()) return;
      if (!openAtStory()) return;
      ev.stopImmediatePropagation();
      if (ev.preventDefault) ev.preventDefault();
      return;
    }

    var key = ev.key;
    /* 熬药期间这一层把键盘整个收下 —— 空格/回车不许漏到 ui.js 去推剧情 */
    ev.stopImmediatePropagation();
    if (ev.preventDefault) ev.preventDefault();

    if (HOLD_KEYS[key]) { onFire(true); return; }
    if (key === 'Enter') { onConfirm(); return; }
    if (key === 'm' || key === 'M') { toggleManual(); return; }
    if (key === 'Escape') { if (manualOpen) toggleManual(false); return; }
    if (key >= '1' && key <= '9') {
      /* 数字键对着材料栏的排列（两边都是 A.INGREDIENTS 的顺序）。
         现在不该投药的时候 pick() 自己会拒 —— 这里不另判一次。 */
      var it = A.INGREDIENTS[Number(key) - 1];
      if (it) onPick(it.id);
    }
  }

  function onKeyUp(ev) {
    if (!active) return;
    if (HOLD_KEYS[ev.key]) {
      ev.stopImmediatePropagation();
      onFire(false);
    }
  }

  function withinScreen(t) {
    while (t) { if (t === dom.screen) return true; t = t.parentNode; }
    return false;
  }

  /* 浮层开着的时候，点到后面去的那些一律不许生效。
     真浏览器里挡在前面的 veil 已经拦掉了（对话框、选项、HUD 都在它底下），
     这一道是给「直接派发到元素上」的那种点击兜底的 —— 无头走查就是这么点的。 */
  function onClick(ev) {
    if (!active) {
      /* 点对话框那一下也认：ui.js 的监听挂在 #dialogue-box 上（目标是它自己，
         属于冒泡的最内层），document 的捕获阶段仍然先跑。 */
      if (!shouldOpenHere()) return;
      var t = ev.target;
      if (!t || !t.closest || !t.closest('#dialogue-box')) return;
      if (!openAtStory()) return;
      ev.stopImmediatePropagation();
      if (ev.preventDefault) ev.preventDefault();
      return;
    }
    if (withinScreen(ev.target)) return;
    ev.stopImmediatePropagation();
    if (ev.preventDefault) ev.preventDefault();
  }

  /* =====================================================================
     剧情接入一：熬药那一场（dy_d2_ev_brew_e）
     ===================================================================== */

  function currentNodeId() {
    var e = engine();
    return (e && e.node && e.node.id) || '';
  }

  /**
   * 现在这一下输入，是不是「该把熬药浮层推开了」？
   *
   * 判据（跟 daily.js 那本册子同一套写法）：
   *   1. 引擎停在 dy_d2_ev_brew_e 上
   *   2. **最后一句还没播**，前一句刚播完（lineIndex === 总句数 − 1，且 > 0）
   *      —— 熬药要发生在那句「药煎好后」之前
   *   3. 没在打字（ui.locked）：那一下该交给 ui.js 把字补全
   *   4. 这一轮还没演过（readyPhase），而且**这一锅还没结算过**
   *      （读档跳回同一句、或者重进节点，都不再演第二遍）
   */
  function shouldOpenHere() {
    if (active) return false;
    if (readyPhase !== 'idle') return false;
    var conf = brewConf();
    var e = engine();
    if (!e || !e.node) return false;
    if (e.node.id !== conf.node) return false;
    if (api.ui && api.ui.locked) return false;
    if (Number(getStat(conf.settledFlag)) > 0) return false;

    var lines = e.visibleLines() || [];
    return lines.length >= 2 && e.lineIndex === lines.length - 1;
  }

  function openAtStory() {
    if (!openReady()) { readyPhase = 'done'; return false; }
    readyPhase = 'open';
    return true;
  }

  /* =====================================================================
     剧情接入二：账册那条固定采购（结算一次）
     ===================================================================== */

  /**
   * 走到账册节点时把这一笔固定采购结掉。
   *
   * **查看账册本身不是一次新的购买** —— 所以有 settledFlag 这道闸：
   * 第一次进这个节点发料，之后来回翻、读档跳回来，都不再发。
   * 料发出去之后账册上那句话就成真的了（正文里那一行写着数量与金额）。
   */
  function settlePurchasesAt(nodeId) {
    var st = story();
    if (!st || !st.pharmacy || !nodeId) return;
    var plan = B.purchasePlan(st.pharmacy, nodeId, getStat);
    plan.forEach(function (p) {
      p.items.forEach(function (op) { addStat(op.stat, op.delta); });
      if (p.flag) addStat(p.flag, 1);
    });
  }

  /* =====================================================================
     挂载
     ===================================================================== */

  function tick() {
    if (!api || !api.engine || !api.story) return;

    var id = currentNodeId();
    if (id !== lastNodeId) {
      lastNodeId = id;
      if (readyPhase !== 'open') readyPhase = 'idle';
      if (!active) settlePurchasesAt(id);
    }
  }

  function mount(a) {
    if (mounted) return;
    mounted = true;
    api = a;

    dom = buildScreen();
    document.body.appendChild(dom.screen);
    bind();

    api.engine.on('node', tick);
    tick();
  }

  (function waitForAct1(tries) {
    var a = window.act1;
    if (a && a.engine && a.story) { mount(a); return; }
    if (tries <= 0) return;
    setTimeout(function () { waitForAct1(tries - 1); }, 30);
  })(600);

  /* 给控制台和测试留一个把手 */
  window.BrewUI = {
    tick: tick,
    shouldOpenHere: shouldOpenHere,
    openAtStory: openAtStory,
    openReady: openReady,
    close: closeScreen,
    isActive: function () { return active; },
    isManualOpen: function () { return manualOpen; },
    toggleManual: toggleManual,
    engine: function () { return brew; },
    settlePurchasesAt: settlePurchasesAt,
    recipe: recipe,
    readyPhase: function () { return readyPhase; },
    /* 界面上那几块 DOM（无头走查要按按钮、要读材料栏里的数）。 */
    nodes: function () { return dom; },
  };
})();
