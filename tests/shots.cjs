/**
 * 无头 Edge 截图 + 量尺寸
 * =====================================================================
 *   node tests/shots.cjs              四个分辨率全跑，截图存 tests/shots/
 *   node tests/shots.cjs --only 1440x900
 *   node tests/shots.cjs --e2e        不截图，从开始界面一路玩到第三幕结局
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
const { spawn } = require('child_process');

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
  { name: '02-双立绘-西比拉与布朗', node: 'p1_brown', mode: 'first', speaker: '布朗' },
  { name: '03-选项点-奥布里视角', node: 'a1_returned', mode: 'choices' },
  { name: '04-跨幕第一眼', node: 'b1_room', via: 'o4_end', mode: 'first' },
  { name: '05-牧师服', node: 'b12_morning', mode: 'first' },
  { name: '06-教室-伊莎贝尔', node: 'b18_classroom', mode: 'first', speaker: '伊莎贝尔' },
  { name: '07-换回女仆装', node: 'b24_change', mode: 'first' },
  { name: '08-第二幕选项点', node: 'b2_haier_knock', mode: 'choices' },
  { name: '11-双立绘-西比拉与奥布里', node: 'b19_aubrey', mode: 'first', speaker: '奥布里' },
  { name: '09-第一幕结局屏', node: 'o4_end', mode: 'end' },
  { name: '10-第二幕结局屏', node: 'b25_end', mode: 'end' },
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
];

/* ===================================================================
 * 工具
 * =================================================================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

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

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')); }
      }, 30000);
    });
  }

  /** 跑一段表达式，拿回值 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面里报错：' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }

  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
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

function inspect(label, m) {
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

  if (choice0 && text) {
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
    }),
    step: () => {
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

  // boot() 是不是真的把两幕都读进来了？（不是只有 tests 里 composeStories 能拼）
  const loaded = await cdp.eval('(() => ({ nodes: window.act1.story.nodes.length, hasAct2: !!window.act1.engine.nodes.b1_room, hasAct3: !!window.act1.engine.nodes.c1_door }))()');
  log(`  · boot() 自己读进来的剧本：${loaded.nodes} 个节点，第二幕${loaded.hasAct2 ? '在' : '不在'}，第三幕${loaded.hasAct3 ? '在' : '不在'}`);
  if (!loaded.hasAct2) bad.push('boot() 没把第二幕读进来（meta.continues 的路径解错了）');
  if (!loaded.hasAct3) bad.push('boot() 没把第三幕读进来（meta.continues 的路径解错了）');
  if (loaded.nodes !== 109) bad.push(`boot() 读到的节点数是 ${loaded.nodes}，该是 109（三幕合起来）`);

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
  for (;;) {
    if (++guard > 4000) { bad.push('走了 4000 步还没到头，剧情可能成环了'); break; }
    const s = await cdp.eval('window.__e2e.peek()');
    if (walked[walked.length - 1] !== s.node) walked.push(s.node);
    seenPov.add(s.pov);

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
  if (walked[walked.length - 1] !== 'c27_end') bad.push(`全程没有走到 c27_end（第三幕结局），停在 ${walked[walked.length - 1]}`);
  if (!walked.includes('b1_room')) bad.push('全程没有进过第二幕');
  if (!walked.includes('b12_morning')) bad.push('全程没有走到换牧师服那一天');
  if (!walked.includes('c1_door')) bad.push('全程没有进过第三幕（第二幕结局的 continueTo 没接上）');

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
  log(bad.length ? `  ✗ 全程走下来有 ${bad.length} 处不对` : '  ✓ 第一幕 →「继续第二幕」→ 第二幕 →「继续第三幕」→ 第三幕结局，存档读档跨幕都对');
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

        const viewType = await cdp.eval(jumpExpr(target));
        await sleep(120);                       // 让样式落定（reduced-motion 下过渡是 0.001ms）
        const m = await cdp.eval(MEASURE);
        m.__view = viewType;
        problems += inspect(`${target.name}（${viewType}）`, m).length;
        await cdp.shot(path.join(OUT_DIR, `${target.name}_${res.name}.png`));
      }
    }

    problems += await probeChoicesVanish(cdp);
  } finally {
    edge.kill();
    server.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { /* Windows 上偶尔删不掉，无所谓 */ }
  }

  if (problems) {
    log(`\n✗ 量出 ${problems} 处问题`);
    process.exit(1);
  }
  if (e2eOnly) {
    log('\n✓ 从开始界面一路玩到第三幕结局，存档读档跨幕都对得上');
  } else {
    log(`\n截图在 ${OUT_DIR}`);
    log('\n✓ 所有分辨率下：立绘不叠、不顶标题、不出画，选项和正文对齐，对话框收起不挤动布局');
  }
}

main().catch((err) => {
  console.error('\n跑挂了：', err.message);
  process.exit(1);
});
