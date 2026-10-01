/**
 * Stage 0 无头截图 + 量尺寸
 * =====================================================================
 *   node stage0/shots.cjs                 两个分辨率全跑，截图存 stage0/shots/
 *   node stage0/shots.cjs --only 1280x720
 *
 * 和 tests/shots.cjs 是同一套路子（CDP 驱动 Edge），但看的是 /stage0/。
 * 它走两条路线，每条都从开始界面真点进去：
 *
 *   甲「照常」：照常 → 教室正片（伊莎贝尔 / 西比拉老师）→ 上课收尾 →
 *              书房散步 → 洗衣房「路过」→ 夜里不打扰 → 日记 → 结局
 *   乙「停课」：把课停掉 → 大厅立规矩 → 决斗（输）→ 洗衣房换人 →
 *              打断备课 → 日记 → 结局
 *
 * 顺带核这几件事：
 *   1. 页面读的是 stage0/story.json，不是 act1 的
 *   2. art.assets 里每张图都真的取得到 200（404 会退回像素占位）
 *   3. 只要不是旁白/奥布里在说话，右槽就必须有立绘（能查出漏了 portrait 的角色）
 *   4. 立绘顶没顶标题 / 两槽叠没叠 / 下摆够不够得着对话框 /
 *      选项和正文对没对齐 / 结局卡片出没出画
 *
 * 注意：这是 stage0 自己的脚本，tests/ 里的东西一个字都没改。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'shots');
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = Number(process.env.S0_CDP_PORT) || 9334;
const PORT = Number(process.env.S0_PORT) || 3900;
const BASE = `http://127.0.0.1:${PORT}`;

const RESOLUTIONS = [[1440, 900], [1280, 720]].map(([w, h]) => ({ w, h, name: `${w}x${h}` }));

/* ---------- 两条路线 ---------- */

const ROUTE_A = {
  d1_wake: '叫布朗进来',
  d1_plan: '照常。她该做什么就做什么。',
  h_morning: '教室',
  f_classroom: '进去看看。',
  e_classroom: '把伊莎贝尔交回西比拉手里',
  h_noon: '后坡',
  f_walk: '出门，往坡上走。',
  h_afternoon: '洗衣房',
  f_laundry: '走进去。',
  e_laundry: '没什么。路过。',
  h_night: '西比拉的房间',
  f_sibylla_room: '推门进去。',
  e_sibylla_room: '不打扰她',
};

const ROUTE_B = {
  d1_wake: '叫布朗进来',
  d1_plan: '把上午的课停了',
  h_morning: '大厅',
  f_hall: '走过去看看。',
  e_hall: '把人都叫齐',
  h_noon: '外庭院',
  e_duel_call: '去取两把练习用的钝剑来',
  e_duel_fight: '把剑捡起来',
  h_afternoon: '洗衣房',
  f_laundry: '走进去。',
  e_laundry: '今天你别洗了',
  h_night: '西比拉的房间',
  f_sibylla_room: '推门进去。',
  e_sibylla_room: '打断她',
};

/* 丙：专门跑一遍优先级 2 新加的桩（马厩 / 账房 / 伊莎贝尔的房间），
   顺带把「书房」和「回房睡下」也走到。台词只有一两行，看的是菜单长得对不对。 */
const ROUTE_C = {
  d1_wake: '叫布朗进来',
  d1_plan: '照常。她该做什么就做什么。',
  h_morning: '外院',
  f_yard: '沿墙走一圈。',
  e_yard: '叫人把水洼扫了',
  h_noon: '书房',
  f_study: '走到书案前。',
  h_afternoon: '马厩',
  f_stable: '进去看看。',
  e_stable: '出来。',
  h_night: '伊莎贝尔的房间',
  f_isabelle_room: '推门看看。',
  e_isabelle_room: '把门带上。',
};

/**
 * 截哪些节点。值是 null = 到这个节点第一句就截；
 * 值是人名 = 一路等到这个人开口才截（不然第一句多半是旁白，右槽是空的，看不出双立绘）；
 * 值是 '@choices' = 等这个节点把选项摆出来再截（时段菜单要看的就是那一排图标）；
 * 值是 '@diary' = 等日记本摊开再截（只有 d1_diary_intro 用得上 ——
 *   书是在这个节点**最后一句之后**才翻开的，等到第一句截只会截到「门又被敲响了」）。
 *   截完那一下空格会让 stage0.js 把书合上，路线照常往 d1_end 走。
 */
const SHOTS_A = {
  d1_wake: null, d1_plan: null,
  h_morning: '@choices', f_classroom: null,
  e_classroom: '伊莎贝尔', e_classroom_canon: '西比拉老师',
  h_noon: '@choices', f_walk: null, e_walk: '西比拉',
  h_afternoon: '@choices', f_laundry: null, e_laundry: '西比拉',
  h_night: '@choices', f_sibylla_room: null, e_sibylla_room: '西比拉',
  d1_sleep: null, d1_diary_intro: '@diary',
};

const SHOTS_B = {
  d1_plan: null, h_morning: '@choices', f_hall: null, e_hall: '布朗',
  e_duel_call: null, e_duel_fight: null, h_afternoon: null,
  e_laundry_stop: '西比拉', h_night: null, e_sibylla_room: '西比拉',
  e_night_talk: null, d1_diary_intro: '@diary',
};

const SHOTS_C = {
  h_noon: '@choices', f_study: null, e_study: null,
  h_afternoon: '@choices', f_stable: null, e_stable: null,
  h_night: '@choices', f_isabelle_room: null, e_isabelle_room: null,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* ---------- 起服务器 / 起 Edge / CDP ---------- */

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; });
    child.stderr.on('data', (d) => { buf += d; });
    const started = Date.now();
    (function poll() {
      fetch(`${BASE}/api/health`).then((r) => (r.ok ? resolve(child) : retry())).catch(retry);
      function retry() {
        if (Date.now() - started > 15000) return reject(new Error('服务器起不来：\n' + buf));
        setTimeout(poll, 120);
      }
    })();
  });
}

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

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面里报错：' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }

  /** 截图偶尔会慢一下（无头 Edge 连着换页之后），给两次机会 */
  async shot(file) {
    let last = null;
    for (let i = 0; i < 2; i++) {
      try {
        const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return;
      } catch (err) { last = err; await sleep(400); }
    }
    throw last;
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

/* ---------- 装到页面里的试玩钩子 ---------- */

const HOOK = (route) => `(() => {
  const route = ${JSON.stringify(route)};
  const ui = () => window.act1.ui, eng = () => window.act1.engine;
  const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  window.__s0 = {
    peek: () => {
      const v = ui().view, q = (s) => document.querySelector(s);
      return {
        node: eng().node.id,
        title: eng().currentTitle(),
        view: v.type,
        line: v.type === 'line' ? v.line.text : '',
        speaker: v.type === 'line' ? (v.narration ? '旁白' : v.name) : '',
        speakerKey: v.type === 'line' ? v.speaker : '',
        stats: Object.assign({}, eng().stats),
        left: q('#portrait-image').style.backgroundImage,
        right: q('#portrait-image-r').style.backgroundImage,
        rightHidden: q('#portrait-layer-r').classList.contains('empty'),
        endOpen: q('#end-screen').classList.contains('on'),
        // 日记本摊开了没有。#diary-screen 是 fixed 的一层，书由 stage0.js
        // 在 d1_diary_intro 最后一句之后翻开 —— 只有真按了空格才会开，
        // 所以这一张非得等它，不能像别的节点那样「到第一句就截」。
        diaryOpen: !!q('#diary-screen') && q('#diary-screen').classList.contains('on'),
      };
    },
    begin: () => key(' '),
    step: () => {
      const v = ui().view;
      if (v.type === 'line') { key(' '); return 'line'; }
      if (v.type === 'choices') {
        const want = route[eng().node.id] || '\\u0000';
        let idx = v.choices.findIndex((c) => c.enabled && String(c.text).indexOf(want) >= 0);
        if (idx < 0) idx = v.choices.findIndex((c) => c.enabled);
        if (idx < 0) return 'stuck';
        const btn = document.querySelector('#choices .choice-btn[data-index="' + idx + '"]');
        if (btn) btn.click(); else ui().choose(idx);
        return 'pick:' + v.choices[idx].text;
      }
      return 'end';
    },
  };
  return true;
})()`;

const MEASURE = `(() => {
  try { document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} }); } catch (e) {}
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { left: +b.left.toFixed(1), top: +b.top.toFixed(1), right: +b.right.toFixed(1),
      bottom: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
      opacity: cs.opacity, visibility: cs.visibility, display: cs.display };
  };
  const choicesEl = document.querySelector('#choices');
  const isLoc = !!choicesEl && choicesEl.classList.contains('s0-locations');
  const out = {
    vw: innerWidth, vh: innerHeight,
    left: rect('#portrait-layer'), right: rect('#portrait-layer-r'),
    title: rect('#title-bar'), dlg: rect('#dialogue-box'), text: rect('#dialogue-text'),
    choice0: rect('#choices .choice-btn'), endCard: rect('.end-card'),
    isLoc: isLoc,
    locRow: isLoc ? rect('#choices') : null,
    locBtns: isLoc ? Array.from(choicesEl.children).map((b) => {
      const r = b.getBoundingClientRect();
      return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1),
        bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        label: (b.querySelector('.choice-text') || {}).textContent || '',
        icon: !!b.querySelector('.s0-icon'),
        hint: !!b.querySelector('.choice-hint') };
    }) : [],
    hud: rect('#hud'), statsPanel: rect('#stats-panel'),
  };
  const dlgEl = document.querySelector('#dialogue-box');
  out.dlgLayout = out.dlg;
  if (dlgEl && dlgEl.classList.contains('collapsed')) {
    dlgEl.classList.remove('collapsed');
    out.dlgLayout = rect('#dialogue-box');
    dlgEl.classList.add('collapsed');
  }
  out.leftImg = document.querySelector('#portrait-image').style.backgroundImage;
  out.rightImg = document.querySelector('#portrait-image-r').style.backgroundImage;
  return out;
})()`;

function inspect(label, m) {
  const bad = [];
  const notes = [];
  const shown = (r) => r && r.visibility !== 'hidden' && Number(r.opacity) > 0.01;
  const dlgTop = (m.dlgLayout || m.dlg || {}).top;

  if (shown(m.left)) {
    if (m.left.left < -0.5) bad.push(`左槽左边超出窗口 ${m.left.left}`);
    if (m.left.right > m.vw + 0.5) bad.push(`左槽右边超出窗口 ${m.left.right} > ${m.vw}`);
    if (m.title && m.left.top < m.title.bottom - 0.5) bad.push(`立绘顶到章节标题了（${m.left.top} < ${m.title.bottom}）`);
    if (m.left.top < -0.5) bad.push(`立绘顶端跑到窗口外面（${m.left.top}）`);
    if (m.left.h > m.vh) bad.push(`立绘比窗口还高（${m.left.h} > ${m.vh}）`);
    if (dlgTop && m.left.bottom < dlgTop - 1) bad.push(`立绘下摆没够到对话框（${m.left.bottom} < ${dlgTop}）`);
    notes.push(`左槽 ${m.left.w}×${m.left.h}@(${m.left.left},${m.left.top})`);
  } else {
    bad.push('左槽没显示出来');
  }
  if (shown(m.left) && shown(m.right)) {
    const ov = m.left.right - m.right.left;
    if (ov > 0.5) bad.push(`左右两槽叠在一起 ${ov.toFixed(1)}px`);
    notes.push(`两槽间距 ${(m.right.left - m.left.right).toFixed(1)}px`);
  }
  if (m.right) notes.push(m.right.visibility === 'hidden' ? '右槽：藏着' : `右槽 ${m.right.w}×${m.right.h}`);
  if (m.choice0 && m.text && !m.isLoc) {
    const dx = Math.abs(m.choice0.left - m.text.left);
    if (dx > 1) bad.push(`选项和正文没对齐（差 ${dx.toFixed(1)}px）`);
  }

  /* 时段菜单：一排图标钉在右下角。量的是「钉住了、没出画、没压到别的东西」。 */
  if (m.isLoc && m.locRow) {
    const r = m.locRow;
    const overlap = (a, b) => {
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return x > 0.5 && y > 0.5 ? { x: x, y: y } : null;
    };
    if (r.left < -0.5 || r.right > m.vw + 0.5) bad.push(`场景图标行左右出画（${r.left}..${r.right}，窗口宽 ${m.vw}）`);
    if (r.top < -0.5 || r.bottom > m.vh + 0.5) bad.push(`场景图标行上下出画（${r.top}..${r.bottom}，窗口高 ${m.vh}）`);
    if (m.hud && r.bottom > m.hud.top + 0.5) bad.push(`场景图标行压到底部控制条（行底 ${r.bottom} > 控制条顶 ${m.hud.top}）`);
    if (m.statsPanel && m.statsPanel.h > 0 && overlap(r, m.statsPanel)) bad.push('场景图标行压在右侧数值面板上');
    for (const slot of [m.left, m.right]) {
      if (!slot || !shown(slot)) continue;
      const ov = overlap(r, slot);
      if (ov) bad.push(`场景图标行压在立绘上（横 ${ov.x.toFixed(0)}px、竖 ${ov.y.toFixed(0)}px）`);
    }
    for (let i = 1; i < m.locBtns.length; i++) {
      if (m.locBtns[i].left < m.locBtns[i - 1].right - 0.5) bad.push('相邻两个场景图标叠在一起了');
    }
    for (const b of m.locBtns) {
      if (!b.icon) bad.push(`场景按钮「${b.label}」没有图标`);
      if (!b.hint) bad.push(`场景按钮「${b.label}」没有悬停提示`);
      if (b.h < 60) bad.push(`场景按钮「${b.label}」太小（高 ${b.h}）`);
    }
    notes.push(`场景图标 ${m.locBtns.length} 个 ${r.w}×${r.h}@(${r.left},${r.top})｜${m.locBtns.map((b) => b.label).join('/')}`);
  }
  if (m.endCard && m.endCard.w > 0) {
    if (m.endCard.left < -0.5 || m.endCard.right > m.vw + 0.5) bad.push('结局卡片左右出画');
    if (m.endCard.top < -0.5 || m.endCard.bottom > m.vh + 0.5) bad.push('结局卡片上下出画');
    notes.push(`结局卡片 ${m.endCard.w}×${m.endCard.h}@(${m.endCard.left},${m.endCard.top})`);
  }
  log(`  ${bad.length ? '✗' : '✓'} ${label}   ${notes.join(' · ')}`);
  for (const b of bad) log(`      ⚠ ${b}`);
  return bad;
}

const ASSET_CHECK = `(async () => {
  const assets = window.act1.story.art.assets || {};
  const out = [];
  for (const [key, a] of Object.entries(assets)) {
    let status = 0;
    try { status = (await fetch(a.src)).status; } catch (e) { status = -1; }
    if (status !== 200) out.push(key + ' -> ' + a.src + ' (' + status + ')');
  }
  return out;
})()`;

/* ---------- 走一条路线 ---------- */

async function playRoute(cdp, res, tag, route, shots) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: res.w, height: res.h, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url: `${BASE}/stage0/index.html` });

  let ok = false;
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const st = await cdp.eval('(() => { const b = document.getElementById("boot-error"); return window.act1 ? "ready" : (b && b.textContent ? "error:" + b.textContent.slice(0, 200) : "loading"); })()');
    if (st === 'ready') { ok = true; break; }
    if (String(st).startsWith('error')) throw new Error('页面加载失败：' + st);
  }
  if (!ok) throw new Error('等不到 /stage0/ boot 完');

  const bad = [];
  await cdp.eval(HOOK(route));
  await cdp.eval('window.__s0.begin()');
  const chars = await cdp.eval('window.act1.story.characters');

  const walked = [];
  const shotDone = {};
  let n = 0;
  let guard = 0;
  for (;;) {
    if (++guard > 3000) { bad.push('走了 3000 步还没到头'); break; }
    const s = await cdp.eval('window.__s0.peek()');
    if (walked[walked.length - 1] !== s.node) walked.push(s.node);

    // 该有立绘的人开口时，右槽不能是空的
    // （旁白不算；noPortrait 的（比如那本日记）也不算；主视角自己说话走左槽）
    const c = chars[s.speakerKey] || {};
    if (s.view === 'line' && s.speakerKey && !c.narration && !c.noPortrait && s.speakerKey !== '奥布里') {
      if (s.rightHidden || !s.right || s.right === 'none') {
        bad.push(`${s.node}：${s.speaker}（${s.speakerKey}）在说话，右槽却是空的 —— 这个角色没写 portrait？`);
      }
    }

    const want = (s.node in shots) ? shots[s.node] : undefined;
    if (want !== undefined && !shotDone[s.node]) {
      const matched = (want === null)
        || (want === '@choices' ? s.view === 'choices'
          : want === '@diary' ? s.diaryOpen
            : s.speakerKey === want);
      if (matched) {
        shotDone[s.node] = want === null ? 'first'
          : (want === '@choices' ? 'choices' : (want === '@diary' ? 'diary' : 'speaker'));
        // 等上一条选项飘出来的数值提示（2.6s）散掉再截 —— 机器走得太快，
        // 不等的话十几条提示会一起堆在屏幕中间，量布局就量不准了。
        // （真人玩不会这样，那是 Stage 0 每次选择都动数值才有的现象，单独记着。）
        await sleep(2900);
        const m = await cdp.eval(MEASURE);
        const label = `${tag}/${s.node}（${s.view}｜${s.title}｜${s.speaker || '—'}）`;
        for (const p of inspect(label, m)) bad.push(`${s.node}: ${p}`);
        n += 1;
        await cdp.shot(path.join(OUT_DIR, `${tag}-${String(n).padStart(2, '0')}-${s.node}_${res.name}.png`));
      }
    }

    if (await cdp.eval('window.__s0.step()') === 'end') break;
    await sleep(15);
  }

  for (const id of Object.keys(shots)) {
    if (!shotDone[id]) bad.push(`这一条路线没经过 ${id}，没能截到`);
    else if (shots[id] && shotDone[id] !== 'speaker' && shotDone[id] !== 'choices'
      && shotDone[id] !== 'diary') {
      bad.push(`${id} 没等到 ${shots[id]} 就过去了`);
    }
  }

  // 结局屏
  const s = await cdp.eval('window.__s0.peek()');
  if (!s.endOpen) bad.push('走到头了，结局屏却没开');
  else {
    // 等最后那几个数值提示（2.6s 后自己消失）飘完，不然它们会叠在结局卡片上
    await sleep(3000);
    const m = await cdp.eval(MEASURE);
    for (const p of inspect(`${tag}/结局屏（第一日结束）`, m)) bad.push('结局屏: ' + p);
    n += 1;
    await cdp.shot(path.join(OUT_DIR, `${tag}-${String(n).padStart(2, '0')}-结局屏_${res.name}.png`));
  }

  log(`  · ${tag} 走过 ${walked.length} 个节点，停在 ${walked[walked.length - 1]}，截了 ${n} 张`);
  if (walked[walked.length - 1] !== 'd1_end') {
    bad.push(`${tag} 没走到 d1_end，停在 ${walked[walked.length - 1]}；实际路线：${walked.join(' → ')}`);
  }
  for (const need of ['h_morning', 'h_noon', 'h_afternoon', 'h_night', 'd1_end']) {
    if (!walked.includes(need)) bad.push(`${tag} 这条链没经过 ${need}`);
  }
  return bad;
}

/* ---------- 主流程 ---------- */

async function main() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const resolutions = only ? RESOLUTIONS.filter((r) => r.name === only) : RESOLUTIONS;
  if (!resolutions.length) throw new Error('没有这个分辨率：' + only);

  // 每次先清空：文件名里带序号，剧本一改、路线一多，序号就会挪位，
  // 上一轮同一序号的旧图会留在原地冒充这一轮的结果（1440 和 1280 两边都会中招）。
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(EDGE)) throw new Error('找不到 Edge：' + EDGE + '（可以设 EDGE 环境变量指过去）');

  const server = await startServer();
  const profile = path.join(require('os').tmpdir(), 'prisenburg-stage0-' + process.pid);
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

    for (const res of resolutions) {
      log(`\n=== ${res.name} ===`);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: res.w, height: res.h, deviceScaleFactor: 1, mobile: false,
      });
      await cdp.send('Page.navigate', { url: `${BASE}/stage0/index.html` });
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        if (await cdp.eval('!!window.act1')) break;
        if (i === 99) throw new Error('页面没 boot 起来');
      }
      const boot = await cdp.eval('(() => ({ start: window.act1.story.meta.start, nodes: window.act1.story.nodes.length, act: window.act1.story.meta.act, hasAct2: !!window.act1.engine.nodes.b1_room }))()');
      log(`  · 页面读到的剧本：${boot.act}，起点 ${boot.start}，${boot.nodes} 个节点`);
      if (boot.start !== 'd1_wake') { log('      ⚠ 起点不是 d1_wake（读到 act1 的剧本去了？）'); problems += 1; }
      if (boot.nodes !== 38) { log(`      ⚠ 节点数是 ${boot.nodes}，该是 38`); problems += 1; }
      if (boot.hasAct2) { log('      ⚠ b1_room 竟然在 —— 这是 act1 的剧本'); problems += 1; }

      const missing = await cdp.eval(ASSET_CHECK);
      log(`  · 素材 ${missing.length ? `缺 ${missing.length} 张` : '全部取到 200'}`);
      for (const x of missing) { log(`      ⚠ ${x}`); problems += 1; }

      await sleep(150);
      await cdp.shot(path.join(OUT_DIR, `00-开始界面_${res.name}.png`));

      for (const [tag, route, shots] of [
        ['甲-照常', ROUTE_A, SHOTS_A],
        ['乙-停课', ROUTE_B, SHOTS_B],
        ['丙-新场景', ROUTE_C, SHOTS_C],
      ]) {
        const bad = await playRoute(cdp, res, tag, route, shots);
        for (const b of bad) log(`      ⚠ ${b}`);
        problems += bad.length;
      }
    }
  } finally {
    edge.kill();
    server.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { /* Windows 上偶尔删不掉 */ }
  }

  if (problems) {
    log(`\n✗ 量出 ${problems} 处问题`);
    process.exit(1);
  }
  log(`\n截图在 ${OUT_DIR}`);
  log('\n✓ /stage0/ 读自己的剧本、素材齐、两条路线都从开始界面真点得通、布局没有出画');
}

main().catch((err) => {
  console.error('\n跑挂了：', err.message);
  process.exit(1);
});
