/**
 * 无头 Edge 截图 + 量尺寸
 * =====================================================================
 *   node tests/shots.cjs              四个分辨率全跑，截图存 tests/shots/
 *   node tests/shots.cjs --only 1440x900
 *   node tests/shots.cjs --e2e        不截图，从开始界面一路玩到第一幕收束（第九章末）
 *
 * 为什么要「量」而不是只看图：
 *   立绘顶端顶没顶到章节标题、左右两槽有没有叠在一起、选项和正文有没有对齐，
 *   这些是几像素的事，肉眼在缩略图上看不出来。所以先量一遍再说 ——
 *   getBoundingClientRect() 是不会骗人的，截图只是补一眼观感。
 *
 * 为什么用 CDP 而不是 msedge --screenshot：
 *   --screenshot 只能截「刚打开时」的样子，没法跳到一个指定节点，
 *   也拿不回任何数字。这里用 --remote-debugging-port 直接驱动，
 *   能先 enterNode(id) 跳到想看的画面，量完再截。
 *
 * 前置：Edge 装在默认位置。换浏览器改下面的 EDGE。
 * 注意：截图路径必须用正斜杠（反斜杠会被 Git Bash 吃掉）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'shots');
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = Number(process.env.CDP_PORT) || 9333;
const PORT = Number(process.env.SHOT_PORT) || 3899;
const BASE = `http://127.0.0.1:${PORT}`;

const RESOLUTIONS = [
  [1920, 1080], [1440, 900], [1366, 768], [1280, 720],
].map(([w, h]) => ({ w, h, name: `${w}x${h}` }));

/**
 * 要看的画面。
 *   mode    first=第一句台词 / choices=第一个选项点 / end=结局屏 / title=开始界面
 *   speaker 一路推到这个人开口的那一句（不然第一句多半是旁白，右槽是空的）
 *   via     先站到 via 这个节点再进 node —— 用来演示跨幕的视角切换提示
 */
const TARGETS = [
  { name: '01-开始界面', mode: 'title' },
  { name: '02-双立绘-西比拉与布朗', node: 's1_rain', mode: 'first', speaker: '布朗' },
  { name: '03-选项点-奥布里视角', node: 'o1_wait', mode: 'choices' },
  { name: '04-跨幕第一眼', node: 'b1_room', via: 'o4_end', mode: 'first' },
  { name: '05-牧师服', node: 'b12_morning', mode: 'first' },
  { name: '06-教室-伊莎贝尔', node: 'b18_classroom', mode: 'first', speaker: '伊莎贝尔' },
  { name: '07-换回女仆装', node: 'b24_change', mode: 'first' },
  { name: '08-第二幕选项点', node: 'b2_haier_knock', mode: 'choices' },
  { name: '11-双立绘-西比拉与奥布里', node: 'b19_aubrey', mode: 'first', speaker: '奥布里' },
  { name: '09-第一幕结局屏', node: 'o4_end', mode: 'end' },
  // b25_end 不再有结算屏（它退成了通往第 3 天的零台词过场），
  // 第一幕真正的收束屏挪到了第九章末 h9_end 那一格
  { name: '10-第一幕收束屏', node: 'h9_end', mode: 'end' },
  // 幕间自由活动：hub 的菜单、房间里的双立绘（右槽是她此刻那套）
  { name: '12-自由活动-hub', mode: 'roam', roam: 'fr_hub' },
  { name: '13-自由活动-西比拉房间', mode: 'roam', roam: 'fr_sib_riding' },
  { name: '14-换装-全身居中', mode: 'roam', roam: 'fr_sib_riding', openOutfit: true },
  { name: '15-结局卡片-两个按钮', node: 'o4_end', mode: 'end' },
  // 这一轮新长出来的三屏：请人过来 / 报仇结局 / 剧情中途的暂停按钮
  { name: '16-自由活动-请西比拉过来', mode: 'roam', roam: 'fr_hub', pick: '让布朗去请西比拉过来' },
  { name: '17-报仇结局', node: 'fr_revenge', mode: 'end' },
  { name: '18-暂停按钮-剧情中途', node: 'b1_room', mode: 'first' },
  // 第三幕：授课那几场用的是第二幕已经登记的教室（bg_classroom），跨幕复用同一张图
  { name: '19-第三幕-教室授课', node: 'c5a_quiz', mode: 'first', speaker: '伊莎贝尔' },
  // 日常层（daily/）：HUD 左上角的时间牌子 + HUD 上那颗【日记】按钮。
  // 这两样是 daily.js 运行时造出来的，#hud 又是 flex-wrap: nowrap ——
  // 多一颗按钮会不会把这一排挤出去，只有真量一遍才知道（设计稿 §5.2 要求量）。
  { name: '20-日常层-HUD与日记按钮', mode: 'daily', node: 'dy_d2_mo_hub' },
  { name: '21-日记本摊开', mode: 'daily', node: 'dy_d2_mo_hub', openDiary: true },
  // 时段菜单本身：右下角那一排图标卡（Stage0 那一套）。停在菜单上不往下走，
  // 量的是每张卡的大小、位置、图标颗数与那行「早晨 · 选择去向」。
  { name: '26-时段菜单-图标卡', mode: 'daily', node: 'dy_d3_mo_hub', stayHub: true, closeBook: true },
  { name: '27-时段菜单-主线日', mode: 'daily', node: 'dy_d2_nn_hub', stayHub: true },
  { name: '28-进第3天-先弹上一日总结', mode: 'daily', node: 'dy_d3_mo_hub', stayHub: true,
    wantBook: /第 2 日总结/ },
  // Esc 系统菜单：六颗入口 + 展开后的快捷键表。量的是它自己那一屏，
  // 顺带确认菜单铺开时底下那层还在（不是一块纯黑）。
  { name: '29-系统菜单', node: 'b1_room', mode: 'first', openMenu: true },
  { name: '30-系统菜单-快捷键', node: 'b1_room', mode: 'first', openMenu: true, openKeys: true },
  // 第一天那场册子（设计稿 §4）：末句「你开了门。她站在门外，把一本册子递了上来。」
  // 播完之后摊开，摊开的是第 1 日那一页 —— 那天一件记事都没有，整页只有她自己的字。
  { name: '22-第一天-她敲门递上册子', mode: 'intro', node: 'dy_d2_mo_intro' },
  { name: '23-第一天的日记', mode: 'intro', node: 'dy_d2_mo_intro', openBook: true },
  // 同样是第 2 天那一页，把关系推上去再翻一遍：四档「她写的」是四份不一样的字
  { name: '24-日记本-档4的正文', mode: 'daily', node: 'dy_d2_mo_hub', openDiary: true,
    stats: { 西比拉_好感: 60, 西比拉_亲密: 45, 西比拉_恨意: 10 } },
  // 狩猎篇：第六章返营那一格的插画过场。这一层是 ui.js 运行时造的（不带 id），
  // 整屏铺满 + 缓慢推进，所以要量的是「盖没盖满、文字有没有出画」。
  { name: '25-插画过场-第六章返营', mode: 'cut', node: 'h6_ride' },
];

/* ===================================================================
 * 工具
 * =================================================================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/** 连孩子一起收掉。Windows 上 child.kill() 只打死启动器那一个进程，
    Edge 自己还会生一窝（渲染进程、GPU 进程……）留在后台吃 CPU ——
    攒上几轮，下一轮拍照就会拍到超时。taskkill /T 才是整棵树。 */
function killTree(child) {
  if (!child || child.killed) return;
  try { child.kill(); } catch (err) { /* 已经没了 */ }
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (err) { /* 进程早退了，无所谓 */ }
  }
}

/** 起存档服务器（只为把页面和剧本发出来） */
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log_ = '';
    child.stdout.on('data', (d) => { log_ += d; });
    child.stderr.on('data', (d) => { log_ += d; });
    const started = Date.now();
    (function poll() {
      fetch(`${BASE}/api/health`).then((r) => r.ok ? resolve(child) : retry()).catch(retry);
      function retry() {
        if (Date.now() - started > 15000) return reject(new Error('服务器起不来：\n' + log_));
        setTimeout(poll, 120);
      }
    })();
  });
}

/** 裸 WebSocket 版 CDP 客户端（Node 自带的 WebSocket，不用装 puppeteer） */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.method || ''} ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    });
  }

  send(method, params, timeout) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')); }
      }, timeout || 30000);
    });
  }

  /** 跑一段表达式，拿回值 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面里报错：' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }

  /** 拍照。headless Edge 偶尔会卡住不回帧（超时不是页面坏了，多半是合成器睡着了）。
      卡住的时候同一张再要也没用 —— 请求排在原来那条后头一起卡着。所以每次重试之前
      先 bringToFront 把渲染进程叫醒，再等一小会儿；三次都要不到才算真挂了。 */
  async shot(file) {
    let last = null;
    for (let i = 0; i < 3; i++) {
      if (i) {
        await sleep(600 * i);
        try { await this.send('Page.bringToFront', {}); } catch (err) { /* 叫不醒就硬试 */ }
      }
      try {
        const r = await this.send('Page.captureScreenshot',
          { format: 'png', captureBeyondViewport: false }, 45000);
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return;
      } catch (err) { last = err; }
    }
    throw new Error(`截不到图（${path.basename(file)}）：${last && last.message}`);
  }
}

async function connect(retries) {
  for (let i = 0; i < (retries || 40); i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res);
          ws.addEventListener('error', () => rej(new Error('连不上调试端口')));
        });
        return new CDP(ws);
      }
    } catch (err) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('等不到 Edge 的调试端口 ' + CDP_PORT);
}

/** 跳到指定节点 / 指定状态 */
function jumpExpr(target) {
  const lines = [];
  if (target.mode === 'title') {
    lines.push('ui.showTitleScreen();');
  } else if (target.mode === 'roam') {
    // 自由活动：直接站到锚点上看菜单；openOutfit 再往里走一层开换装浮层
    lines.push('ui.begin();');
    lines.push(`e.enterRoam(${JSON.stringify(target.roam)});`);
    lines.push('let v = e.advance();');
    lines.push('for (let i = 0; i < 80 && v.type !== "choices"; i++) v = e.advance();');
    lines.push('ui.renderStats(); ui.render(v);');   // 先把房间那一屏画出来，两槽站好
    if (target.pick) {
      // 在 hub 菜单上按文字点一项（比如「让布朗去请西比拉过来」），再推到下一屏菜单
      lines.push(`const pi = v.choices.findIndex((c) => c.text === ${JSON.stringify(target.pick)});`);
      lines.push('if (pi >= 0) { e.choose(pi); v = e.advance(); }');
      lines.push('for (let i = 0; i < 80 && v.type !== "choices"; i++) v = e.advance();');
    }
    if (target.openOutfit) {
      lines.push('const idx = v.choices.findIndex((c) => c.text === "换装");');
      lines.push('if (idx >= 0) { e.choose(idx); v = e.advance(); }');
      lines.push('for (let i = 0; i < 20 && v.type !== "outfit"; i++) v = e.advance();');
    }
    lines.push('ui.renderStats(); ui.render(v);');
  } else if (target.mode === 'daily') {
    // 日常层：先把界面开起来，再站到第 2 天那个菜单上，顺手把这一时段处理掉 ——
    // 这样左上角有牌子、【日记】按钮是**亮**的（没做过处理选择时它是暗的，
    // 量不出「亮起来这一排挤不挤」）。openDiary 再把那本册子摊开。
    lines.push('ui.begin();');
    lines.push(`e.enterNode(${JSON.stringify(target.node)});`);
    if (target.stayHub) {
      // 就停在时段菜单上：三张活动卡是这一轮要看的画面本身
      lines.push('let v = e.advance();');
      lines.push('for (let i = 0; i < 80 && v.type !== "choices"; i++) v = e.advance();');
      // 进第 3 天头一个菜单时，上一日的总结会**自己**摊开盖住菜单（先看总结、
      // 合上才看得见今天的活动）。这一张要的是底下那排卡，所以先把书合上 ——
      // 书开着的样子另有一张（28）。
      if (target.closeBook) {
        lines.push('if (window.DailyUI.isOpen()) window.DailyUI.closeDiary();');
      }
    } else {
      lines.push('e.choose(0);');
      lines.push('let v = e.advance();');
      lines.push('for (let i = 0; i < 300 && v.type !== "choices"; i++) v = e.advance();');
      lines.push('e.choose(0);');
      lines.push('v = e.advance();');
      lines.push('for (let i = 0; i < 80 && v.type !== "choices"; i++) v = e.advance();');
    }
    lines.push('ui.renderStats(); ui.render(v);');
    // 关系推高之后翻同一页：四档正文是四份不一样的字，得亲眼看过一遍
    // （档位由 diary.js 的 tierOf 当天算，界面上一个字都不显示）。
    if (target.stats) lines.push(`Object.assign(e.stats, ${JSON.stringify(target.stats)});`);
    if (target.openDiary) lines.push('window.DailyUI.openDiary();');
  } else if (target.mode === 'intro') {
    // 第一天那场：她把册子递上来，**最后一句播完之后**才摊开（daily.js 在捕获阶段
    // 干的那件事）。截图脚本不模拟键盘，所以这里直接推到那一格，再手动摊开 ——
    // 用的是同一个入口，书里画的还是第 1 日那一页。
    lines.push('ui.begin();');
    lines.push(`e.enterNode(${JSON.stringify(target.node)});`);
    lines.push('let v = e.advance();');
    lines.push('for (let i = 0; i < 80 && e.lineIndex < e.visibleLines().length; i++) v = e.advance();');
    lines.push('ui.renderStats(); ui.render(v);');
    if (target.openBook) lines.push('window.DailyUI.openIntroDiary();');
  } else if (target.mode === 'cut') {
    // 插画过场：站到挂了 cutscene 的那一格，让 ui 自己把画铺上 ——
    // 走的是 render() 里那条路（不是手工调 showCutscene），量出来的才是玩家看见的那一屏
    lines.push('ui.begin();');
    lines.push(`e.enterNode(${JSON.stringify(target.node)});`);
    lines.push('let v = e.advance();');
    lines.push('ui.renderStats(); ui.render(v);');
  } else {
    lines.push('ui.begin();');
    if (target.via) lines.push(`e.enterNode(${JSON.stringify(target.via)});`);
    lines.push(`e.enterNode(${JSON.stringify(target.node)});`);
    lines.push('let v = e.advance();');
    if (target.mode === 'choices') lines.push('for (let i = 0; i < 80 && v.type !== "choices"; i++) v = e.advance();');
    if (target.mode === 'end') lines.push('for (let i = 0; i < 300 && v.type !== "end"; i++) v = e.advance();');
    if (target.speaker) {
      // 一路推到这个人开口的那一句（中间那些旁白右槽是空的，看不出双立绘）
      lines.push(`for (let i = 0; i < 80 && !(v.type === "line" && v.speaker === ${JSON.stringify(target.speaker)} && !v.narration); i++) v = e.advance();`);
    }
    lines.push('ui.renderStats(); ui.render(v);');
  }
  // Esc 系统菜单：跟哪个 mode 都能搭 —— 把菜单铺在当前的画面上量一次
  if (target.openMenu) {
    lines.push('ui.openMenu();');
    if (target.openKeys) lines.push('ui.renderKeysPanel(true);');
  }
  return `(() => {
    const a = window.act1;
    if (!a) return '没 boot 起来';
    const ui = a.ui, e = a.engine;
    ${lines.join('\n    ')}
    return (window.act1.ui.view && window.act1.ui.view.type) || 'title';
  })()`;
}

/** 量尺寸。返回的每个矩形都是视口坐标 */
const MEASURE = `(() => {
  /* 入场动画（.choice-btn 的 choice-in 带 delay）还在飞的时候量出来的位置
     会差几像素 —— 那不是布局问题。量之前先把所有动画推到终点。 */
  try { document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* 推不动就算了 */ } }); } catch (e) { /* 老浏览器没有 getAnimations */ }

  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: +b.left.toFixed(1), top: +b.top.toFixed(1),
      right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1),
      w: +b.width.toFixed(1), h: +b.height.toFixed(1),
      opacity: cs.opacity, visibility: cs.visibility, display: cs.display,
    };
  };
  const out = {
    vw: innerWidth, vh: innerHeight,
    left: rect('#portrait-layer'),
    right: rect('#portrait-layer-r'),
    title: rect('#title-bar'),
    dlg: rect('#dialogue-box'),
    text: rect('#dialogue-text'),
    choices: rect('#choices'),
    choice0: rect('#choices .choice-btn'),
    choice0Text: rect('#choices .choice-btn .choice-text'),
    pov: rect('#pov-banner'),
    end: rect('#end-screen'),
    endCard: rect('.end-card'),
    endContinue: rect('#end-continue'),
    endRoam: rect('#end-roam'),
    outfit: rect('#outfit-screen'),
    outfitPortrait: rect('#outfit-portrait'),
    outfitChoices: rect('#outfit-choices'),
    /* ---- 插画过场（ui.js 运行时造的，按类名找） ---- */
    cut: rect('.cut-screen'),
    cutImage: rect('.cut-image'),
    cutCaption: rect('.cut-caption'),
    cutTitleText: (document.querySelector('.cut-title') || {}).textContent || '',
    cutOpen: (() => {
      const el = document.querySelector('.cut-screen');
      return !!(el && el.classList.contains('on'));
    })(),
    /* ---- 日常层（daily/daily.js 运行时造出来的那几块） ---- */
    hud: rect('#hud'),
    clock: rect('.dy-clock'),
    diaryBtn: rect('.dy-diary-btn'),
    diaryScreen: rect('.dy-diary-screen'),
    diaryBook: rect('.dy-diary-book'),
    diaryPage: rect('.dy-diary-page'),
    diaryOpen: !!(document.querySelector('.dy-diary-screen') || {}).classList
      && document.querySelector('.dy-diary-screen').classList.contains('on'),
    /* 时段菜单：右下角那三张活动卡（Stage0 那一套）。
       没挂 dy-cards 的节点（处理选择 _r、进入/返回）量到 null，不参与判定。 */
    dyCards: (() => {
      const box = document.getElementById('choices');
      if (!box || !box.classList.contains('dy-cards')) return null;
      const list = [].slice.call(box.querySelectorAll('.choice-btn'));
      if (!list.length) return null;
      const rs = list.map((el) => el.getBoundingClientRect());
      const pick = (f, how) => +how.apply(null, rs.map(f)).toFixed(1);
      const byTop = rs.slice().sort((a, b) => a.top - b.top);
      let rows = 1;
      let bandBottom = byTop[0].bottom;
      for (const r of byTop.slice(1)) {
        if (r.top >= bandBottom - 0.5) { rows += 1; bandBottom = r.bottom; }
        else bandBottom = Math.max(bandBottom, r.bottom);
      }
      const label = document.getElementById('dy-slot-label');
      return {
        n: list.length,
        rows,
        cards: rs.map((r) => [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]),
        left: pick((r) => r.left, Math.min),
        right: pick((r) => r.right, Math.max),
        top: pick((r) => r.top, Math.min),
        bottom: pick((r) => r.bottom, Math.max),
        // 每张卡顶上那枚图标（daily.js 注进去的 .dy-icon，第一个子节点）
        icons: list.filter((el) => el.firstChild && el.firstChild.className
          && String(el.firstChild.className).indexOf('dy-icon') >= 0).length,
        texts: list.map((el) => {
          const t = el.querySelector ? el.querySelector('.choice-text') : null;
          return (t && t.textContent) || '';
        }),
        keys: list.filter((el) => {
          const k = el.querySelector ? el.querySelector('.choice-key') : null;
          return !!(k && getComputedStyle(k).display !== 'none');
        }).length,
        label: label ? (label.textContent || '') : '',
        labelOn: !!(label && label.classList.contains('on')),
        labelRect: label ? (() => { const r = label.getBoundingClientRect(); return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })() : null,
      };
    })(),
    /* #hud 是 flex-wrap: nowrap —— 这一排自己不折，但**每一颗按钮的标签会在自己的框里折**：
       宽度被压掉 1px，两个汉字就分成两行。所以按按钮量一遍：
       藏起来的按钮 rect 是 0×0，先滤掉，再逐颗记下框宽和标签行数。 */
    hudBtns: (() => {
      const list = [].slice.call(document.querySelectorAll('#hud .hud-btn'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0);
      if (!list.length) return null;
      const rs = list.map((x) => x.r);
      const pick = (f, how) => +how.apply(null, rs.map(f)).toFixed(1);
      const byTop = rs.slice().sort((a, b) => a.top - b.top);
      let rows = 1;
      let bandBottom = byTop[0].bottom;
      for (const r of byTop.slice(1)) {
        if (r.top >= bandBottom - 0.5) { rows += 1; bandBottom = r.bottom; }
        else bandBottom = Math.max(bandBottom, r.bottom);
      }
      /* 每一颗的标签实际占几行 —— 数 Range 的行盒。
         折行的按钮会高出一倍（33px → 50px），可整排仍然是「1 行」：
         只量排数的话，六颗全折了也看不出来。 */
      const linesOf = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const tops = {};
        for (const b of r.getClientRects()) tops[Math.round(b.top)] = 1;
        return Object.keys(tops).length;
      };
      return {
        n: list.length,
        rows,
        labels: list.map((x) => (x.el.textContent || '').slice(0, 6)),
        lines: list.map((x) => linesOf(x.el)),
        heights: list.map((x) => Math.round(x.r.height)),
        left: pick((r) => r.left, Math.min),
        right: pick((r) => r.right, Math.max),
        top: pick((r) => r.top, Math.min),
        bottom: pick((r) => r.bottom, Math.max),
      };
    })(),
    /* 衣服那一排按按钮量：折成两行的话第二行会被挤出屏幕，
       而只量容器的话看不出来（容器本身还在窗口里）。 */
    outfitChips: (() => {
      const list = [].slice.call(document.querySelectorAll('#outfit-choices .choice-btn'));
      if (!list.length) return null;
      const rs = list.map((el) => el.getBoundingClientRect());
      const pick = (f, how) => +how.apply(null, rs.map(f)).toFixed(1);
      // 同一排的按钮竖直方向一定相交；折了行的话两行的竖直区间是不相交的
      const byTop = rs.slice().sort((a, b) => a.top - b.top);
      let rows = 1;
      let bandBottom = byTop[0].bottom;
      for (const r of byTop.slice(1)) {
        if (r.top >= bandBottom - 0.5) { rows += 1; bandBottom = r.bottom; }
        else bandBottom = Math.max(bandBottom, r.bottom);
      }
      return {
        n: list.length,
        rows,
        top: pick((r) => r.top, Math.min),
        bottom: pick((r) => r.bottom, Math.max),
        left: pick((r) => r.left, Math.min),
        right: pick((r) => r.right, Math.max),
        list: rs.map((r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]),
      };
    })(),
    outfitOpen: !!(document.querySelector('#outfit-screen') || {}).classList
      && document.querySelector('#outfit-screen').classList.contains('on'),
    outfitImg: document.querySelector('#outfit-image') ? document.querySelector('#outfit-image').style.backgroundImage : '',
    veilBlur: (() => {
      const v = document.querySelector('#outfit-veil');
      if (!v) return '';
      const cs = getComputedStyle(v);
      return cs.backdropFilter || cs.webkitBackdropFilter || '';
    })(),
    // 只在 SHOT_DEBUG 下用：谁在画面最上边那条上色（排查「屏幕上多了块灰的」）
    topDwellers: [].slice.call(document.querySelectorAll('body *')).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 8 || r.top > 120) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.02) return false;
      return !!(cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || cs.backgroundImage !== 'none' || cs.backdropFilter !== 'none';
    }).map((el) => (el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]) + '@' + Math.round(el.getBoundingClientRect().top)),
    dlgCollapsed: !!(document.querySelector('#dialogue-box') || {}).classList
      && document.querySelector('#dialogue-box').classList.contains('collapsed'),
    leftImg: (document.querySelector('#portrait-image') || {}).style ? document.querySelector('#portrait-image').style.backgroundImage : '',
    rightImg: document.querySelector('#portrait-image-r') ? document.querySelector('#portrait-image-r').style.backgroundImage : '',
  };
  /* 对话框收着的时候，它的 rect 是被 translateY(100%) 推下去之后的 ——
     拿它当「对话框上沿」会误判立绘飘在半空。这里把 collapsed 摘掉量一次，
     得到的是它在文档流里的真实高度和位置（reduced-motion 下过渡是 0.001ms，
     同步量不会漏掉动画中途的中间态）。顺带把「摘掉之后选项有没有挪位」也量了：
     两次位置一样，就说明 transform 没有脱离文档流，收起不会挤动布局。 */
  const dlgEl = document.querySelector('#dialogue-box');
  const chEl = document.querySelector('#choices');
  out.dlgLayout = out.dlg;
  out.choicesJump = null;
  if (dlgEl && dlgEl.classList.contains('collapsed')) {
    const before = chEl ? chEl.getBoundingClientRect().top : null;
    dlgEl.classList.remove('collapsed');
    out.dlgLayout = rect('#dialogue-box');
    if (chEl) out.choicesJump = +(chEl.getBoundingClientRect().top - before).toFixed(1);
    dlgEl.classList.add('collapsed');
  }
  return out;
})()`;

/* ===================================================================
 * 量出来的数字 -> 结论
 * =================================================================== */

function inspect(label, m, target) {
  target = target || {};
  const bad = [];
  const notes = [];
  const { vw, vh, left, right, title, dlg, choice0, text, endCard } = m;
  // 对话框上沿要按「没收起时」的位置算 —— 收起时它的 rect 是被推下去之后的
  const dlgTop = (m.dlgLayout || dlg || {}).top;

  const shown = (r) => r && r.visibility !== 'hidden' && Number(r.opacity) > 0.01;

  if (shown(left)) {
    if (left.left < -0.5) bad.push(`左槽左边超出窗口 ${left.left}`);
    if (left.right > vw + 0.5) bad.push(`左槽右边超出窗口 ${left.right} > ${vw}`);
    if (title && left.top < title.bottom - 0.5) bad.push(`立绘顶到章节标题了（立绘 top ${left.top} < 标题 bottom ${title.bottom}）`);
    if (left.top < -0.5) bad.push(`立绘顶端跑到窗口外面（top ${left.top}）`);
    if (left.h > vh) bad.push(`立绘比窗口还高（${left.h} > ${vh}）`);
    // 下摆和对话框：要够得着（站在后面），不能整张飘在框上面
    if (dlgTop && left.bottom < dlgTop - 1) bad.push(`立绘下摆没够到对话框（${left.bottom} < ${dlgTop}），人像是飘在半空`);
    notes.push(`左槽 ${left.w}×${left.h} @ (${left.left}, ${left.top})`);
  } else {
    bad.push('左槽没显示出来（主视角角色不该空场）');
  }

  if (shown(left) && shown(right)) {
    const overlap = left.right - right.left;
    if (overlap > 0.5) bad.push(`左右两个槽叠在一起 ${overlap.toFixed(1)}px`);
    notes.push(`两槽间距 ${(right.left - left.right).toFixed(1)}px`);
  }
  if (right) {
    notes.push(right.visibility === 'hidden' ? '右槽：藏着' : `右槽 ${right.w}×${right.h}`);
  }

  if (dlgTop) notes.push(`对话框上沿 ${dlgTop}${dlg.opacity === '0' ? '（收起）' : ''}`);
  if (m.choicesJump !== null) notes.push(`收起前后选项位移 ${m.choicesJump}px`);

  // 时段菜单那三张卡是**故意**钉在右下角的（#choices.dy-cards 把整排摘出文档流），
  // 所以它跟对话框正文不对齐是设计如此 —— 那一条只对普通竖排列表成立。
  if (choice0 && text && !m.dyCards) {
    const dx = Math.abs(choice0.left - text.left);
    if (dx > 1) bad.push(`选项和正文没对齐（选项 left ${choice0.left}，正文 left ${text.left}，差 ${dx.toFixed(1)}px）`);
    notes.push(`选项/正文左边距差 ${dx.toFixed(1)}px`);
  }
  if (m.choicesJump !== null && Math.abs(m.choicesJump) > 0.5) {
    bad.push(`对话框收起时选项跳了 ${m.choicesJump}px（收起不该影响布局）`);
  }

  if (endCard && endCard.w > 0) {
    if (endCard.left < -0.5 || endCard.right > vw + 0.5) bad.push('结局卡片超出窗口');
    notes.push(`结局卡片 ${endCard.w}×${endCard.h}`);
    if (m.endContinue) {
      notes.push('「继续下一幕」' + (m.endContinue.display === 'none' ? '：没有下一幕，藏起来' : '：在'));
    }
    if (m.endRoam) {
      notes.push('「自由活动」' + (m.endRoam.display === 'none' ? '：没有安排，藏起来' : '：在'));
    }
  }

  /* 换装浮层：全身立绘要居中、不出画，背景要糊、对话框要收起来。
     模糊**只能**加在浮层自己那层上 —— 给 #stage / #app 加 filter 会让
     position:fixed 的背景层换掉包含块，背景就不贴着视口了（style.css 里写着）。 */
  if (m.outfitOpen) {
    const op = m.outfitPortrait;
    if (!op) {
      bad.push('换装浮层开着，却量不到居中那层全身立绘');
    } else {
      const gapL = op.left;
      const gapR = vw - op.right;
      if (Math.abs(gapL - gapR) > 1) bad.push(`全身立绘没居中（左边距 ${gapL}，右边距 ${gapR}）`);
      if (op.left < -0.5 || op.right > vw + 0.5) bad.push(`全身立绘左右出画（${op.left} ~ ${op.right}，窗口宽 ${vw}）`);
      if (op.top < -0.5 || op.bottom > vh + 0.5) bad.push(`全身立绘上下出画（${op.top} ~ ${op.bottom}，窗口高 ${vh}）`);
      notes.push(`全身立绘 ${op.w}×${op.h} @ (${op.left}, ${op.top})，左右留白 ${gapL.toFixed(1)}/${gapR.toFixed(1)}`);
    }
    if (!/blur\(/.test(m.veilBlur || '')) bad.push(`浮层背后没糊（backdrop-filter 是「${m.veilBlur}」）`);
    if (!m.dlgCollapsed) bad.push('换装浮层开着，底下那个对话框却没收起');
    if (m.outfitChoices && m.outfitChoices.w <= 0) bad.push('换装浮层里那排衣服没铺开');
    const chips = m.outfitChips;
    if (chips) {
      if (chips.rows > 1) bad.push(`那排衣服折成了 ${chips.rows} 行（立绘高度是按一排估的，折行会把下面那行挤出屏幕）`);
      if (chips.bottom > vh + 0.5) bad.push(`那排衣服掉到窗口外面了（底边 ${chips.bottom} > 窗口高 ${vh}）`);
      if (chips.left < -0.5 || chips.right > vw + 0.5) bad.push(`那排衣服左右出画（${chips.left} ~ ${chips.right}）`);
      notes.push(`衣服 ${chips.n} 件·${chips.rows} 行，底边 ${chips.bottom} / 窗口高 ${vh}`);
    }
  }

  /* 插画过场：整屏铺满、画面盖住整个视口、说明文字落在画面里。
     这一层是运行时造的，量的是「盖没盖满」，不是某条 CSS 规则在不在。 */
  if (m.cutOpen) {
    const c = m.cut;
    if (!c || c.w <= 0) {
      bad.push('插画过场的层没铺开');
    } else {
      if (c.left > 0.5 || c.top > 0.5 || c.right < vw - 0.5 || c.bottom < vh - 0.5) {
        bad.push(`插画没盖满视口（${c.left},${c.top} ~ ${c.right},${c.bottom}，窗口 ${vw}×${vh}）`);
      }
      notes.push(`插画层 ${c.w}×${c.h}`);
    }
    // 画面放大之后仍然要盖满：这是「缓慢推进」不会露边的那条底线
    const img = m.cutImage;
    if (!img || img.w < vw - 0.5 || img.h < vh - 0.5) {
      bad.push(`插画放大之后露了边（画面 ${img && img.w}×${img && img.h} < 视口 ${vw}×${vh}）`);
    }
    const cap = m.cutCaption;
    if (!cap || cap.w <= 0) {
      bad.push('插画的说明文字那一块没铺开');
    } else {
      if (cap.left < -0.5 || cap.right > vw + 0.5) bad.push('插画的说明文字左右出画');
      if (cap.bottom > vh + 0.5) bad.push(`插画的说明文字掉到窗口外面（底边 ${cap.bottom} > ${vh}）`);
      notes.push(`插画标题「${m.cutTitleText}」，说明文字块 ${cap.w}×${cap.h}`);
      if (!m.cutTitleText) bad.push('插画没写标题');
    }
  }

  /* HUD 那一排 + 日常层挂上去的三块：时间牌子、【日记】按钮、摊开的册子。
     daily.js 往 #hud 里插了一颗按钮，把这一排的天然宽度顶过了 #hud 的 max-width ——
     1280×720 下六颗按钮的标签全被挤成两行。所以这里不只量排数和出画，还要逐颗数标签行数。 */
  const hud = m.hudBtns;
  if (hud) {
    if (hud.rows > 1) bad.push(`HUD 那排按钮折成了 ${hud.rows} 行`);
    if (hud.left < -0.5) bad.push(`HUD 那排按钮左边出画（${hud.left}）`);
    if (hud.right > vw + 0.5) bad.push(`HUD 那排按钮右边出画（${hud.right} > 窗口宽 ${vw}）`);
    if (m.hud && m.hud.bottom > vh + 0.5) bad.push(`HUD 掉到窗口外面（底边 ${m.hud.bottom} > 窗口高 ${vh}）`);
    /* 排数只有 1 不代表每颗是单行：这一排被压扁时六颗会各自折成两行
       （1280×720 上就发生过，HUD 从 33px 涨到 50px，而 --hud-h 是按 36px 留的） */
    const wrapped = (hud.lines || []).map((n, i) => (n > 1 ? `${(hud.labels || [])[i] || '?'}（${n} 行）` : null)).filter(Boolean);
    if (wrapped.length) bad.push(`HUD 有 ${wrapped.length} 颗按钮的标签折行了：${wrapped.join('、')}`);
    notes.push(`HUD ${hud.n} 颗按钮·${hud.rows} 行 @ (${hud.left}~${hud.right}) · 标签行数 ${(hud.lines || []).join('/')} · 高 ${(hud.heights || []).join('/')}`);
  }
  const ck = m.clock;
  if (ck && ck.w > 0 && shown(ck)) {
    if (ck.left < -0.5 || ck.right > vw + 0.5) bad.push(`时间牌子左右出画（${ck.left} ~ ${ck.right}）`);
    if (ck.top < -0.5 || ck.bottom > vh + 0.5) bad.push(`时间牌子上下出画（${ck.top} ~ ${ck.bottom}）`);
    // 章节标题也在左上角（#title-bar 是 top:22 / left:26），两行字叠起来就都看不清了
    if (shown(title)) {
      const dy = Math.min(ck.bottom, title.bottom) - Math.max(ck.top, title.top);
      const dx = Math.min(ck.right, title.right) - Math.max(ck.left, title.left);
      if (dy > 0.5 && dx > 0.5) bad.push(`时间牌子和章节标题叠上了（纵向压了 ${dy.toFixed(1)}px）`);
    }
    notes.push(`时间牌子 @ (${ck.left}, ${ck.top})${shown(title) ? `，标题底边 ${title.bottom}` : ''}`);
  }
  const db = m.diaryBtn;
  if (db && db.w > 0) {
    if (db.left < -0.5 || db.right > vw + 0.5) bad.push(`【日记】按钮左右出画（${db.left} ~ ${db.right}）`);
    notes.push(`【日记】按钮 ${db.w}×${db.h}${Number(db.opacity) < 0.9 ? '（暗着：今天还没记下什么）' : '（亮的）'}`);
  }
  /* 时段菜单那三张活动卡（Stage0 那一套）：三张、一行、不出画，
     每张顶上都有图标，编号（1/2/3）是藏起来的，上面还挂着那行时段提示。 */
  const dc = m.dyCards;
  if (dc) {
    if (dc.n !== 2 && dc.n !== 3) bad.push(`时段菜单是 ${dc.n} 张卡，该是 2~3 张`);
    if (dc.rows !== 1) bad.push(`图标卡折成了 ${dc.rows} 行`);
    if (dc.left < -0.5 || dc.right > vw + 0.5) bad.push(`活动卡左右出画（${dc.left} ~ ${dc.right}，窗口宽 ${vw}）`);
    if (dc.top < -0.5 || dc.bottom > vh + 0.5) bad.push(`活动卡上下出画（${dc.top} ~ ${dc.bottom}，窗口高 ${vh}）`);
    if (dc.icons !== dc.n) bad.push(`只有 ${dc.icons}/${dc.n} 张卡顶上画了图标`);
    if (dc.keys !== 0) bad.push(`活动卡上露出了 ${dc.keys} 个编号（编号该藏起来）`);
    if (!dc.labelOn) bad.push('时段提示那行没亮起来（「早晨 · 选择去向」）');
    if (dc.labelRect && (dc.labelRect.left < -0.5 || dc.labelRect.left + dc.labelRect.w > vw + 0.5)) {
      bad.push(`时段提示左右出画（${dc.labelRect.left} ~ ${dc.labelRect.left + dc.labelRect.w}）`);
    }
    // 每张卡都在视口里，且互相不叠（三张的矩形两两不相交）
    const rs = dc.cards || [];
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i]; const b = rs[j];
        const dx = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
        const dy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
        if (dx > 0.5 && dy > 0.5) bad.push(`第 ${i + 1} 张和第 ${j + 1} 张活动卡叠上了`);
      }
    }
    notes.push(`活动卡 ${dc.n} 张·${dc.rows} 行 @ (${dc.left}~${dc.right}, ${dc.top}~${dc.bottom}) · 图标 ${dc.icons} · 「${dc.label}」`);
  }
  if (m.diaryOpen) {
    const bk = m.diaryBook;
    if (!bk || bk.w <= 0) {
      bad.push('日记本开着，却量不到那本书');
    } else {
      if (bk.left < -0.5 || bk.right > vw + 0.5) bad.push(`日记本左右出画（${bk.left} ~ ${bk.right}，窗口宽 ${vw}）`);
      if (bk.top < -0.5 || bk.bottom > vh + 0.5) bad.push(`日记本上下出画（${bk.top} ~ ${bk.bottom}，窗口高 ${vh}）`);
      notes.push(`日记本 ${bk.w}×${bk.h} @ (${bk.left}, ${bk.top})`);
    }
    if (!m.diaryPage || m.diaryPage.w <= 0) bad.push('日记本里那页纸没铺开');
  }
  /* 这一张要不要求册子摊着 / 合上：进第 3 天头一个菜单时，上一日的总结会自己弹出来
     盖住菜单（规矩如此）。所以 26 号那张得先合上才看得见底下那排卡，
     28 号那张要的就是摊着的这本 —— 两件事都得真量一遍，不能只写在名字里。 */
  if (target.wantBook || target.closeBook) {
    const wb = m.wantBook || {};
    if (target.closeBook && wb.on) bad.push('册子还摊着 —— 它盖住了底下那排活动卡');
    if (target.wantBook) {
      if (!wb.on) bad.push('册子该自己摊开（进新一天先看上一日总结），实际没开');
      else if (!target.wantBook.test(wb.title)) bad.push(`摊开的那本写着「${wb.title}」，不是 ${target.wantBook}`);
      else notes.push(`册子摊着：「${wb.title}」`);
    }
  }

  const head = bad.length ? '✗' : '✓';
  log(`  ${head} ${label}`);
  log(`      ${notes.join(' · ')}`);
  if (m.leftImg) log(`      左槽图：${m.leftImg.replace(/^url\("|"\)$/g, '')}`);
  if (m.rightImg && m.rightImg !== 'none') log(`      右槽图：${m.rightImg.replace(/^url\("|"\)$/g, '')}`);
  if (m.outfitImg) log(`      全身图：${m.outfitImg.replace(/^url\("|"\)$/g, '')}`);
  if (process.env.SHOT_DEBUG && m.topDwellers) log('      [debug] 顶部那条上有谁：' + m.topDwellers.join(' '));
  if (process.env.SHOT_DEBUG && m.outfitChips) log('      [debug] 每个按钮 left/top/宽/高：' + JSON.stringify(m.outfitChips.list));
  for (const b of bad) log(`      ⚠ ${b}`);
  return bad;
}

/* ===================================================================
 * 真·走一遍：真的点按钮、真的敲空格、真的存档读档
 * ===================================================================
 * 上面那批是「跳到某个节点看画面」，走的是 enterNode()；
 * 这一段走的是玩家真正走的那条路 —— boot() 自己 fetch 剧本、
 * 键盘事件、按钮点击、HTTP 存档。两幕是在 boot() 里拼起来的，
 * 拼接路径写错的话只有这一段能查出来（已经栽过一次）。
 */

/* 装两个小钩子到页面上：peek() 看现在在哪，step() 往前推一步。
   走的是玩家那条路 —— document 上的键盘监听、真实的按钮 click，
   不是直接调 engine.advance()。 */
const PLAY_JS = `(() => {
  const ui = () => window.act1.ui, eng = () => window.act1.engine;
  window.__e2e = {
    peek: () => ({
      node: eng().node.id, view: ui().view.type,
      title: eng().currentTitle(), pov: eng().pov,
      stats: eng().stats, portrait: eng().currentArt().portrait,
      // 日记本这会儿是不是摊开的（第一天那一场要在这一条路上真的开过一次）
      diary: !!(window.DailyUI && window.DailyUI.isOpen()),
      // 时段菜单：站着的这一格是不是三张活动卡，卡上是几项
      cards: (() => {
        const box = document.getElementById('choices');
        return {
          on: !!(box && box.classList.contains('dy-cards')),
          n: box ? box.querySelectorAll('.choice-btn').length : 0,
          icons: box ? [].slice.call(box.querySelectorAll('.choice-btn')).filter((el) => el.firstChild
            && String(el.firstChild.className).indexOf('dy-icon') >= 0).length : 0,
        };
      })(),
      // 摊开的那本书上写着什么（第 2 日的总结要在进第 3 天时自己弹出来）
      book: (() => {
        const t = document.querySelector('.dy-diary-title');
        const d = document.querySelector('.dy-diary-day');
        return {
          on: !!(document.querySelector('.dy-diary-screen') || {}).classList
            && document.querySelector('.dy-diary-screen').classList.contains('on'),
          title: t ? (t.textContent || '') : '',
          day: d ? (d.textContent || '') : '',
        };
      })(),
      // 插画过场铺着没有（第六章返营那一格要在这一条路上真的铺过一次）
      cut: !!ui().cutsceneOpen,
    }),
    step: () => {
      // 册子摊着的时候它是模态的：日/月/数字键都被 daily.js 在捕获阶段吞掉。
      // 玩家这时会按 Esc（或空格）把它合上 —— 脚本也走同一条路。
      if (window.DailyUI && window.DailyUI.isOpen()) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return 'ok';
      }
      const v = ui().view;
      if (v.type === 'line') {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        return 'ok';
      }
      if (v.type === 'choices') {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        return 'ok';
      }
      const btn = document.getElementById('end-continue');
      if (btn && btn.style.display !== 'none') { btn.click(); return 'ok'; }
      return 'end';                       // 到头了，没有下一幕
    },
  };
  return !!window.__e2e;
})()`;

async function endToEnd(cdp) {
  log('\n=== 真·走一遍全程 ===');
  const bad = [];

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${BASE}/act1/index.html` });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (await cdp.eval('!!window.act1')) break;
    if (i === 99) throw new Error('页面没 boot 起来');
  }

  // boot() 是不是真的把三幕都读进来了？（不是只有 tests 里 composeStories 能拼）
  const loaded = await cdp.eval('(() => ({ nodes: window.act1.story.nodes.length, hasAct2: !!window.act1.engine.nodes.b1_room, hasAct3: !!window.act1.engine.nodes.c1_door }))()');
  log(`  · boot() 自己读进来的剧本：${loaded.nodes} 个节点，第二幕${loaded.hasAct2 ? '在' : '不在'}，第三幕${loaded.hasAct3 ? '在' : '不在'}`);
  if (!loaded.hasAct2) bad.push('boot() 没把第二幕读进来（meta.continues 的路径解错了）');
  if (!loaded.hasAct3) bad.push('boot() 没把第三幕读进来（meta.continues 的路径解错了）');
  if (loaded.nodes !== 328) bad.push(`boot() 读到的节点数是 ${loaded.nodes}，该是 328（三幕 + 日常层 + 狩猎篇五章 + 第九章合起来）`);

  await cdp.eval(PLAY_JS);

  // 从开始界面进场（这是玩家按的那一下空格）
  await cdp.eval('document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); "ok"');

  const walked = [];
  const seenPov = new Set();
  let savedAt = null;
  let savedStats = null;
  let savedPortrait = null;
  let crossedAct = false;
  let guard = 0;
  const diaryNodes = [];              // 日记本在哪些节点上摊开过（按先后去重）
  let diarySteps = 0;
  let cutAt = null;                   // 插画过场在哪个节点上铺开过
  const cardHubs = [];                // 走过的时段菜单（该拿着三张活动卡）
  const cardBad = [];                 // 卡不对的时段菜单
  let summaryAt = null;               // 上一天总结在第几天的第一个菜单上弹出来
  let summaryTitle = '';
  for (;;) {
    // 狩猎篇五章比前面加起来还长，步子放宽到 9000
    if (++guard > 9000) { bad.push('走了 9000 步还没到头，剧情可能成环了'); break; }
    const s = await cdp.eval('window.__e2e.peek()');
    if (walked[walked.length - 1] !== s.node) walked.push(s.node);
    seenPov.add(s.pov);
    if (s.diary) {
      diarySteps++;
      if (!diaryNodes.includes(s.node)) diaryNodes.push(s.node);
    }
    if (s.cut) cutAt = s.node;
    if (s.cards && s.cards.on && !cardHubs.includes(s.node)) {
      // 同一格会 peek 好几次（合上总结的那一下不动剧情），按节点去重
      cardHubs.push(s.node);
      if ((s.cards.n !== 2 && s.cards.n !== 3) || s.cards.icons !== s.cards.n) {
        cardBad.push(`${s.node}（${s.cards.n} 项 / ${s.cards.icons} 个图标）`);
      }
    }
    if (s.book && s.book.on && !summaryAt && /总结/.test(s.book.title)) {
      summaryAt = s.node;
      summaryTitle = s.book.title + ' / ' + s.book.day;
    }

    // 刚进第二幕：存一份，待会儿读回来
    if (!crossedAct && s.node.charAt(0) === 'b') {
      crossedAct = true;
      savedAt = await cdp.eval('(async () => { await window.act1.ui.save(); return window.act1.engine.node.id; })()');
      savedStats = s.stats;
      savedPortrait = s.portrait;
      log(`  · 走到 ${savedAt}（${s.title}），在这里存了一份`);
    }

    if (await cdp.eval('window.__e2e.step()') === 'end') break;
    await sleep(15);
  }

  log(`  · 一路走过 ${walked.length} 个节点、视角经过 ${[...seenPov].join(' → ')}，最后停在 ${walked[walked.length - 1]}`);
  if (walked[walked.length - 1] !== 'h9_end') bad.push(`全程没有走到 h9_end（第一幕真正的收束点），停在 ${walked[walked.length - 1]}`);
  if (!walked.includes('b1_room')) bad.push('全程没有进过第二幕');
  // 换牧师服那一场在第二幕原著授课线里（b17_scream 起，b18 是教室）；
  // b12_morning 那条旧链首轮回填后已脱链，主线不再从它进来。
  if (!walked.includes('b18_classroom')) bad.push('全程没有走到换牧师服那一天（第二幕授课线 b18_classroom）');
  // 第一天那本册子：走空格走到底，它得在引入场那一格自己摊开（daily.js 的捕获阶段），
  // 摊开之后再按一下就合上、接着往下走 —— 既不漏开，也不能把人卡在最后一句上。
  // （摊开过的**不止**这一格：往后每天头一个菜单上还会弹上一日总结，所以看的是
  //   「这一格在不在名单里」，不是「最后摊开的是哪一格」。）
  log(`  · 日记本在 ${diaryNodes.length} 处摊开过（${diaryNodes.join('、')}），共 ${diarySteps} 次停顿`);
  if (!diaryNodes.includes('dy_d2_mo_intro')) {
    bad.push(`第一天的册子该在 dy_d2_mo_intro（第一夜之后那一场）摊开，实际只在 ${diaryNodes.join('、')} 摊开过`);
  }
  if (!walked.includes('dy_d2_mo_hub')) bad.push('全程没有走进第 2 天早晨的菜单（册子合上之后接不上）');
  // 时段菜单：走过 14 个，每一个都得是「图标卡 + 每张卡一个图标」
  log(`  · 一路走过 ${cardHubs.length} 个时段菜单，都是图标卡`);
  if (cardHubs.length !== 14) bad.push(`走过了 ${cardHubs.length} 个时段菜单，该是 14 个`);
  if (cardBad.length) bad.push(`有 ${cardBad.length} 个时段菜单不是图标卡：${cardBad.join('、')}`);
  // 进第 3 天的第一个菜单时，上一日（第 2 日）的总结要自己摊开
  log(`  · 上一日总结在 ${summaryAt} 上弹出来（${summaryTitle}）`);
  if (summaryAt !== 'dy_d3_mo_hub') bad.push(`第 2 日总结该在 dy_d3_mo_hub 上自己摊开，实际在 ${summaryAt}`);
  if (summaryAt && !/第 2 日总结/.test(summaryTitle)) bad.push(`摊开的那本标题是「${summaryTitle}」，该是「第 2 日总结」`);
  // 首轮回填后 c1～c27 那条旧链脱链留档，不在主线上；第二幕之后接的是日常层
  if (!walked.includes('dy_d3_mo_intro')) bad.push('第二幕之后没有接上日常层（b25_end 的 next 没接上）');
  // 狩猎篇：日常层第 6 天夜里的交付场景接进第四章，五章一章节一节地走到底
  if (!walked.includes('h4_request')) bad.push('全程没有进过狩猎篇第四章（周六夜的交付场景没接上）');
  if (!walked.includes('h6_ride')) bad.push('全程没有走到第六章返营那一格（插画过场所在处）');
  if (cutAt !== 'h6_ride') bad.push(`插画过场该在 h6_ride 铺开，实际在 ${cutAt}`);
  else log('  · 插画过场在 h6_ride 上真的铺开过（走的是空格，不是直接调引擎）');

  // 存档是在第二幕存的，读回来得把人放回第二幕那个节点 ——
  // 而且数值和「此刻穿着哪套衣服」都要跟着回来（存档是跨幕共用的那一份）
  if (savedAt) {
    const back = await cdp.eval(`(async () => {
      await window.act1.ui.load();
      const e = window.act1.engine;
      return {
        node: e.node.id, stats: e.stats, portrait: e.currentArt().portrait,
        title: e.currentTitle(), pov: e.pov,
        endOpen: document.getElementById('end-screen').classList.contains('on'),
        titleOpen: document.getElementById('title-screen').classList.contains('on'),
      };
    })()`);
    log(`  · 存完又一路走到结局，再读档：回到 ${back.node}（${back.title}，${back.pov} 视角）`);
    if (back.node !== savedAt) bad.push(`读档回到了 ${back.node}，该回到 ${savedAt}`);
    if (back.endOpen) bad.push('读档后结局屏还开着');
    if (back.titleOpen) bad.push('读档后停在开始界面（应该直接进场）');
    if (back.portrait !== savedPortrait) bad.push(`读档后左槽穿着 ${back.portrait}，存档时是 ${savedPortrait}`);
    if (JSON.stringify(back.stats) !== JSON.stringify(savedStats)) {
      bad.push(`读档后数值是 ${JSON.stringify(back.stats)}，存档时是 ${JSON.stringify(savedStats)}`);
    }
    log(`  · 读回来的数值 ${JSON.stringify(back.stats)}、立绘 ${back.portrait}，都对得上存档那一刻`);
  }

  for (const b of bad) log(`      ⚠ ${b}`);
  log(bad.length ? `  ✗ 全程走下来有 ${bad.length} 处不对` : '  ✓ 第一幕 → 第一夜 → 日常层第 2~6 天 → 狩猎篇六章（含第九章），一路走到第一幕收束；存档读档跨幕都对');
  return bad.length;
}

/* ===================================================================
 * 跑
 * =================================================================== */

/**
 * 任务一那一条：点完任何一个选项，底下的选项框必须立刻消失 ——
 * 不然按钮会一直挂在屏幕下半截，正好压在立绘的裙摆上。
 * 单独开一次页面量，免得打扰上面那条「真·走一遍」的路线。
 */
async function probeChoicesVanish(cdp) {
  log('\n=== 选项点完立刻消失 ===');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${BASE}/act1/index.html` });
  let up = false;
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (await cdp.eval('!!window.act1')) { up = true; break; }
  }
  if (!up) { log('      ⚠ 页面没 boot 起来'); return 1; }

  const r = await cdp.eval(`(() => {
    const a = window.act1, ui = a.ui, e = a.engine;
    ui.begin();
    let v = e.advance();
    for (let i = 0; i < 80 && v.type !== 'choices'; i++) v = e.advance();
    ui.renderStats(); ui.render(v);
    const count = () => document.querySelectorAll('#choices .choice-btn').length;
    const before = count();
    const btn = document.querySelector('#choices .choice-btn');
    if (btn) btn.click();                     // 玩家真的点了一下
    return {
      before,
      after: count(),
      view: ui.view.type,
      dlgCollapsed: document.getElementById('dialogue-box').classList.contains('collapsed'),
    };
  })()`);

  const bad = [];
  log(`  · 选项屏上 ${r.before} 个按钮；点完第一项之后还剩 ${r.after} 个（视图：${r.view}）`);
  if (r.before < 1) bad.push('选项屏上没画出按钮');
  if (r.after !== 0) bad.push(`点完选项之后还有 ${r.after} 个按钮挂在屏幕上（会挡住立绘）`);
  if (r.view === 'choices') bad.push('点完选项还停在选项屏上');
  for (const b of bad) log(`      ⚠ ${b}`);
  log(bad.length ? '  ✗ 选项框没有立刻消失' : '  ✓ 点完选项按钮立刻收掉，屏幕上不留按钮');
  return bad.length;
}

async function main() {
  const e2eOnly = process.argv.includes('--e2e');
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const resolutions = only ? RESOLUTIONS.filter((r) => r.name === only) : RESOLUTIONS;
  if (!resolutions.length) throw new Error('没有这个分辨率：' + only);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(EDGE)) throw new Error('找不到 Edge：' + EDGE + '（可以设 EDGE 环境变量指过去）');

  const server = await startServer();
  const profile = path.join(require('os').tmpdir(), 'prisenburg-shots-' + process.pid);
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-prefers-reduced-motion',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let problems = 0;
  try {
    const cdp = await connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    if (e2eOnly) {
      problems += await endToEnd(cdp);
    }

    for (const res of e2eOnly ? [] : resolutions) {
      log(`\n=== ${res.name} ===`);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: res.w, height: res.h, deviceScaleFactor: 1, mobile: false,
      });

      for (const target of TARGETS) {
        await cdp.send('Page.navigate', { url: `${BASE}/act1/index.html` });

        // 等 boot() 把剧本读完、界面挂上
        let ok = false;
        for (let i = 0; i < 100; i++) {
          await sleep(100);
          const state = await cdp.eval('(() => { const b = document.getElementById("boot-error"); return window.act1 ? "ready" : (b && b.textContent ? "error:" + b.textContent.slice(0, 120) : "loading"); })()');
          if (state === 'ready') { ok = true; break; }
          if (String(state).startsWith('error')) throw new Error(`${target.name} 加载失败：${state}`);
        }
        if (!ok) throw new Error(`${target.name} 等不到 act1 boot 完`);

        // 日常层那两张：daily.js 是等 window.act1 出现之后才挂上去的（最多晚 30ms），
        // 比 boot() 慢一拍。不等它就会量到一片空的 HUD。
        if (target.mode === 'daily' || target.mode === 'intro') {
          for (let i = 0; i < 40; i++) {
            if (await cdp.eval('!!document.querySelector(".dy-diary-btn")')) break;
            await sleep(50);
          }
        }

        const viewType = await cdp.eval(jumpExpr(target));
        await sleep(120);                       // 让样式落定（reduced-motion 下过渡是 0.001ms）
        const m = await cdp.eval(MEASURE);
        m.__view = viewType;
        if (target.wantBook || target.closeBook) {
          // 摊开的那本书上写着什么（第 28 张要的是「第 2 日总结」那一页）
          m.wantBook = await cdp.eval(`(() => {
            const s = document.querySelector('.dy-diary-screen');
            const t = document.querySelector('.dy-diary-title');
            return {
              on: !!(s && s.classList.contains('on')),
              title: t ? (t.textContent || '').trim() : '',
            };
          })()`);
        }
        problems += inspect(`${target.name}（${viewType}）`, m, target).length;
        await cdp.shot(path.join(OUT_DIR, `${target.name}_${res.name}.png`));
      }
    }

    problems += await probeChoicesVanish(cdp);
  } finally {
    killTree(edge);
    killTree(server);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { /* Windows 上偶尔删不掉，无所谓 */ }
  }

  if (problems) {
    log(`\n✗ 量出 ${problems} 处问题`);
    process.exit(1);
  }
  if (e2eOnly) {
    log('\n✓ 从开始界面一路玩到第一幕收束（第九章末），存档读档跨幕都对得上');
  } else {
    log(`\n截图在 ${OUT_DIR}`);
    log('\n✓ 所有分辨率下：立绘不叠、不顶标题、不出画，选项和正文对齐，对话框收起不挤动布局');
  }
}

main().catch((err) => {
  console.error('\n跑挂了：', err.message);
  process.exit(1);
});
