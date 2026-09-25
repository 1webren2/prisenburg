/**
 * 渲染层测试（无头：用 dom-stub 顶替浏览器）
 * =====================================================================
 *   node tests/ui.test.cjs
 *
 * 除了「能不能跑」，主要盯这几件看得见的事：
 *   - 开始界面：开场停住、空格不会把第一句跳过去、背景是马车图、点击/回车都能进正片
 *   - 立绘常驻 + 借图：任何节点都有立绘，而且（其他立绘没画好之前）统一借西比拉那张
 *   - 亮 / 暗两态：#portrait-layer 只在西比拉说话时带 speaking
 *   - 像素占位网格：真图到位就收起来，图 404 就留着
 *   - 图片路径：story.json 里写了 src 的素材，用的就是那个 src
 */

const fs = require('fs');
const path = require('path');
const { loadDom } = require('./dom-stub.cjs');
const { suite } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const api = require(path.join(ROOT, 'act1', 'game.js'));
const uiApi = require(path.join(ROOT, 'act1', 'ui.js'));
const story = require(path.join(ROOT, 'act1', 'story.json'));

const { StoryEngine } = api;
const { Act1UI, CONFIG, imageSrc } = uiApi;
const CSS = fs.readFileSync(path.join(ROOT, 'act1', 'style.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'act1', 'index.html'), 'utf8');

const t = suite('渲染层');

/** 起一个装好的界面，等价于浏览器里的 boot() */
function bootUI() {
  const dom = loadDom();
  const engine = new StoryEngine(story);
  const ui = new Act1UI(engine, { doc: dom.doc, win: dom.win });
  ui.mount();
  ui.start();
  ui.showTitleScreen();
  return { ...dom, engine, ui };
}

const portraitBG = (ui) => ui.els['portrait-image'].style.backgroundImage;
const bgBG = (ui) => ui.els['bg-image'].style.backgroundImage;
const isSpeaking = (ui) => ui.els['portrait-layer'].classList.contains('speaking');

/* ===================================================================
 * 1. 挂载
 * =================================================================== */

t.section('挂载');

t.ok(CONFIG.portraitOverride === 'chr_sibylla', 'CONFIG 里临时统一借西比拉的立绘');
t.eq(CONFIG.leadCharacter, '西比拉', '主角是西比拉');
t.eq(CONFIG.titleBackground, 'bg_carriage', '开始界面背景是马车图');

const mounted = bootUI();
t.eq(Object.keys(mounted.ui.els).length, 26, 'mount() 找到了 26 个元素');

// index.html 里不该有「没人管」的 id —— 要么进 ui.js 的清单，要么是纯装饰用的
const ALLOWED_ORPHANS = ['boot-error', 'app', 'stage', 'bg-veil', 'hud', 'title-veil', 'end-restart'];
t.empty(
  Array.from(mounted.doc.__ids).filter((id) => !(id in mounted.ui.els) && !ALLOWED_ORPHANS.includes(id))
    .map((id) => `index.html 里的 #${id} 没人用，也没在豁免名单里`),
  'index.html 里的 id 都有人管（或已在豁免名单里）'
);
t.empty(
  ALLOWED_ORPHANS.filter((id) => !mounted.doc.__ids.has(id)).map((id) => `豁免名单里的 #${id} 其实已经不存在了，该删掉`),
  '豁免名单没有过期项'
);
t.ok(HTML.includes('普里森堡'), '开始界面上写着游戏名「普里森堡」');

/* ===================================================================
 * 2. 开始界面
 * =================================================================== */

t.section('开始界面');

t.ok(mounted.ui.titleOpen, '开场停在开始界面');
t.ok(mounted.ui.els['title-screen'].classList.contains('on'), '开始界面是显示状态');
t.eq(
  mounted.ui.els['title-bg'].style.backgroundImage,
  'url("images/bg_carriage.png")',
  '开始界面背景用的是马车图'
);

// 空格在开始界面只认「开始」，不能把第一句跳过去
const firstView = mounted.ui.view;
t.eq(firstView.type, 'line', '剧情已经就位在第一句上（点开始就能接着走）');
const ev = mounted.fireKey(' ');
t.ok(ev.__prevented, '开始界面的空格被 preventDefault（不会滚页）');
t.eq(mounted.ui.titleOpen, false, '空格把开始界面收掉了');
t.eq(mounted.ui.view, firstView, '空格没有顺手把第一句跳过去');

// 收掉之后再按空格才是正常推进
mounted.fireKey(' ');
t.ne(mounted.ui.view, firstView, '开始界面收掉后，空格才推进剧情');

// 点「开始游戏」也能进
const byClick = bootUI();
t.ok(byClick.ui.titleOpen, '新开一局是先停在开始界面');
byClick.fire(byClick.ui.els['title-start'], 'click');
t.eq(byClick.ui.titleOpen, false, '点「开始游戏」进入正片');

// 直接点对话框不应该穿透开始界面
const clickThrough = bootUI();
const before = clickThrough.ui.view;
clickThrough.fire(clickThrough.ui.els['dialogue-box'], 'click');
t.eq(clickThrough.ui.view, before, '开始界面开着时，点对话框不会推进剧情');

/* ===================================================================
 * 3. 立绘
 * =================================================================== */

t.section('立绘');

const portrait = bootUI();
for (let i = 0; i < 4; i++) portrait.engine.advance();

t.eq(uiApi.imageSrc('chr_sibylla', story.art.assets.chr_sibylla), 'images/chr_sibylla.png', '素材写了 src 就用 src');
t.eq(uiApi.imageSrc('chr_brown', story.art.assets.chr_brown), 'images/chr_brown.jpg', '没写 src 就按 key 拼默认路径');

// 走完整场戏，沿途每一步都核对立绘
let guard = 0;
const noPortrait = [];
const wrongPortrait = [];
const speakingWrong = [];
let sawSpeaking = 0;
let sawDimmed = 0;

for (;;) {
  if (++guard > 5000) { t.ok(false, '剧情没有终点'); break; }
  const v = portrait.ui.view;
  const bg = portraitBG(portrait.ui);

  if (!bg || bg === 'none') noPortrait.push(`${portrait.engine.node.id} 没画立绘`);
  else if (bg !== 'url("images/chr_sibylla.png")') wrongPortrait.push(`${portrait.engine.node.id} 用的是 ${bg}`);

  // 该亮的时候亮、该暗的时候暗
  const shouldSpeak = v.type === 'choices'
    ? portrait.engine.pov === CONFIG.leadCharacter
    : (v.type === 'line' && !v.narration && v.speaker === CONFIG.leadCharacter);
  if (isSpeaking(portrait.ui) !== shouldSpeak) {
    speakingWrong.push(`${portrait.engine.node.id} 第${v.index}行 speaker=${v.speaker} 期望 speaking=${shouldSpeak} 实际=${isSpeaking(portrait.ui)}`);
  }
  if (isSpeaking(portrait.ui)) sawSpeaking++; else sawDimmed++;

  if (v.type === 'end') break;
  if (v.type === 'choices') portrait.ui.choose(0); else portrait.ui.step();
}

t.empty(noPortrait, '立绘常驻：任何节点都有立绘，不会空场');
t.empty(wrongPortrait, '其他角色的立绘还没画好，统一借西比拉那张');
t.empty(speakingWrong, '立绘的亮/暗跟「是不是西比拉在说话」对得上');
t.ok(sawSpeaking > 0, `确实出现过「西比拉说话、立绘亮着」（${sawSpeaking} 次）`);
t.ok(sawDimmed > 0, `确实出现过「别人说话/旁白、立绘压暗」（${sawDimmed} 次）`);

/* ---- 像素占位网格什么时候该让位 ----
   立绘和背景都是「像素网格 + 真图」两层叠着的。真图是透明 PNG，
   下面那层网格会从透明的地方透出来，看着就像人物被框在一个方块里
   （也就是「边界感」）。所以图片真加载成功了就得把网格收掉；
   图还没画好（404）时网格留着当占位。 */
const gridDisplay = (ui, id) => ui.els[id].style.display;

const withImg = bootUI();
withImg.runTimers(2);
t.eq(gridDisplay(withImg.ui, 'portrait-grid-host'), 'none', '立绘真图到位后，底下的像素占位网格收起来');
t.eq(gridDisplay(withImg.ui, 'bg-grid-host'), 'none', '背景真图到位后，底下的像素占位网格收起来');

// 图 404：走 onerror，网格不能被收掉，否则屏幕上什么都没有
const noImg = loadDom();
noImg.setImagesLoad(false);
const fallbackUI = new Act1UI(new StoryEngine(story), { doc: noImg.doc, win: noImg.win });
fallbackUI.mount();
fallbackUI.start();
noImg.runTimers(2);
t.eq(gridDisplay(fallbackUI, 'portrait-grid-host'), '', '立绘图 404 时像素占位网格留着');
t.eq(gridDisplay(fallbackUI, 'bg-grid-host'), '', '背景图 404 时像素占位网格留着');

/* ===================================================================
 * 4. 背景
 * =================================================================== */

t.section('背景');

const bg = bootUI();
bg.ui.begin();
t.eq(bgBG(bg.ui), 'url("images/bg_carriage.png")', '开场（马车）用马车图');

const seenBg = new Set();
for (;;) {
  if (++guard > 8000) break;
  const v = bg.ui.view;
  seenBg.add(bgBG(bg.ui));
  if (v.type === 'end') break;
  if (v.type === 'choices') bg.ui.choose(0); else bg.ui.step();
}
t.empty(
  Array.from(seenBg).filter((s) => !s || s === 'none').map(() => '有过没画背景的瞬间'),
  '全程背景都在（换节点时会沿用上一张，不会闪空）'
);
t.ok(seenBg.has('url("images/bg_hall.png")'), '走进大厅时换成了大厅图');
t.ok(seenBg.has('url("images/bg_gate.png")'), '到城堡门口时用的是大门口那张图');

/* ===================================================================
 * 5. 选项
 * =================================================================== */

t.section('选项');

const ch = bootUI();
ch.ui.begin();
while (ch.ui.view.type !== 'choices') ch.ui.step();

const btns = ch.ui.els.choices.children;
t.eq(btns.length, 3, '第一个决定点有 3 个选项');
t.eq(btns.map((b) => b.getAttribute('data-index')), ['0', '1', '2'], '按钮带着 data-index');
t.ok(btns[0].children.some((c) => c.className.includes('choice-text')), '选项按钮里有正文');
t.ok(btns[0].children.some((c) => c.className.includes('choice-hint')), '选项按钮里有 hint');
t.ok(ch.ui.els['dialogue-box'].classList.contains('choices-open'), '出选项时对话框让位（避免和选项重叠）');

// 序章的选项点：替西比拉做决定，立绘亮着
t.ok(isSpeaking(ch.ui), '序章选项点是西比拉的视角，立绘亮着');
t.eq(ch.engine.pov, '西比拉', '序章选项点确实是西比拉视角');

// 用键盘 1/2/3 也能选
const kb = bootUI();
kb.ui.begin();
while (kb.ui.view.type !== 'choices') kb.ui.step();
kb.fireKey('2');
t.eq(kb.engine.history[kb.engine.history.length - 1], 'p1_self', '按 2 选了第二个选项');

// 主场的选项点：替奥布里做决定，立绘压暗
const main = bootUI();
main.ui.begin();
let g2 = 0;
while (!(main.ui.view.type === 'choices' && main.engine.pov === '奥布里')) {
  if (++g2 > 900) break;
  if (main.ui.view.type === 'choices') main.ui.choose(0); else main.ui.step();
}
t.eq(main.engine.pov, '奥布里', '走到了奥布里的选项点');
t.eq(isSpeaking(main.ui), false, '奥布里的选项点：西比拉没在说话，立绘压暗');

/* ===================================================================
 * 6. 结局 / 重来
 * =================================================================== */

t.section('结局与重来');

const fin = bootUI();
fin.ui.begin();
let g3 = 0;
while (fin.ui.view.type !== 'end') {
  if (++g3 > 900) break;
  if (fin.ui.view.type === 'choices') fin.ui.choose(0); else fin.ui.step();
}
t.eq(fin.ui.view.type, 'end', '能走到结局');
t.ok(fin.ui.els['end-screen'].classList.contains('on'), '结局界面打开了');
t.ok(fin.ui.els['end-stats'].children.length > 0, '结局界面列出了数值');
t.eq(isSpeaking(fin.ui), false, '结局是旁白，立绘压暗');

fin.ui.restart();
t.ok(fin.ui.titleOpen, '「重新开始」退回开始界面');
t.eq(fin.engine.node.id, 'p1_carriage', '「重新开始」把剧情复位到开头');
t.eq(fin.ui.els['end-screen'].classList.contains('on'), false, '「重新开始」把结局界面收掉');
t.eq(fin.engine.stats, story.initialStats, '「重新开始」把数值归零');

// 键盘 R 也是重来
const kr = bootUI();
kr.ui.begin();
kr.ui.step();
kr.fireKey('r');
t.ok(kr.ui.titleOpen, '按 R 退回开始界面');

/* ===================================================================
 * 7. 数值面板
 * =================================================================== */

t.section('数值面板');

const stat = bootUI();
stat.ui.begin();
t.eq(stat.ui.els['stats-body'].children.length, 1, '默认不列数值，只给一句提示');
t.ok(stat.ui.els['stats-body'].children[0].className.includes('stat-hidden'), '默认那一句是「数值已隐藏」');

stat.fireKey('v');
t.eq(stat.engine.showStats, true, '按 V 打开真实数值');
t.eq(stat.ui.els['stats-body'].children.length, 2, '打开后有 2 行（两个隐藏数值）');
t.eq(stat.ui.els['stats-toggle'].getAttribute('data-on'), '1', '按钮状态跟着变');
t.eq(stat.ui.els['stats-panel'].classList.contains('revealed'), true, '面板展开');

stat.fireKey('v');
t.eq(stat.engine.showStats, false, '再按 V 收起来');

/* ===================================================================
 * 8. 存档 / 读档
 * =================================================================== */

t.section('存档与读档');

async function saveLoad() {
  const dom = loadDom();
  let stored = null;
  let health = true;
  const calls = [];

  dom.win.fetch = (url, opts) => {
    calls.push((opts && opts.method) || 'GET');
    const reply = (ok, body) => Promise.resolve({
      ok, status: ok ? 200 : 404,
      json: () => Promise.resolve(body),
    });
    if (url.endsWith(CONFIG.endpoints.save)) { stored = JSON.parse(opts.body); return reply(true, { ok: true, save: stored }); }
    if (url.endsWith(CONFIG.endpoints.load)) {
      if (!stored) return reply(false, { ok: false, message: '还没有存档' });
      return reply(true, { ok: true, save: { snapshot: stored } });
    }
    if (url.endsWith(CONFIG.endpoints.health)) return reply(health, { ok: health });
    return reply(false, { ok: false, message: '没有这个接口：' + url });
  };

  const engine = new StoryEngine(story);
  const ui = new Act1UI(engine, { doc: dom.doc, win: dom.win });
  ui.mount();
  ui.start();
  ui.begin();

  for (let i = 0; i < 3; i++) ui.step();
  const where = engine.node.id;
  const stepCount = engine.history.length;

  await ui.save();
  t.ok(!!stored, '保存：真的把快照发给了服务器');
  t.ok(ui.els['server-dot'].classList.contains('online'), '保存成功后服务器指示灯变绿');
  t.eq(stored.nodeId, where, '存的是当前节点');

  // 再往前走，直到真的换了个节点，然后读回来
  let walked = 0;
  while (engine.node.id === where && walked++ < 300) {
    if (ui.view.type === 'choices') ui.choose(0); else ui.step();
  }
  t.ne(engine.node.id, where, '读档前确实已经走远了');

  await ui.load();
  t.eq(engine.node.id, where, '读档回到存档时的节点');
  t.eq(engine.history.length, stepCount, '读档回到存档时的步数（不会多出一节）');
  t.eq(ui.titleOpen, false, '读档直接进正片，不停在开始界面');

  // 服务器没了的时候
  health = false;
  await ui.checkServer();
  t.ok(ui.els['server-dot'].classList.contains('offline'), '连不上服务器时指示灯变灰');

  const dead = loadDom();
  dead.win.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  const ui2 = new Act1UI(new StoryEngine(story), { doc: dead.doc, win: dead.win });
  ui2.mount();
  ui2.start();
  ui2.begin();
  const saved = await ui2.save();
  t.eq(saved, null, '连不上服务器时保存不会抛错，只是返回 null');
  t.ok(ui2.els['server-dot'].classList.contains('offline'), '保存失败时指示灯变灰');
  t.ok(ui2.els.toast.children.length > 0, '保存失败会弹一句提示');
}

saveLoad().then(() => {
  /* ===================================================================
   * 9. 样式（看得见的部分没法无头验证，至少确认规则在）
   * =================================================================== */

  t.section('样式');

  // ---- 选择器 → 声明的小解析器（够读这个文件用；@media 里的规则也会被收进来）
  // 先把注释剔掉：注释里带逗号/冒号的话会被误当成选择器和声明
  const CSS_PLAIN = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulesFor = (sel) => {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(CSS_PLAIN))) {
      const sels = m[1].split(',').map((s) => s.trim());
      if (sels.includes(sel)) out.push(m[2]);
    }
    return out;
  };
  /** 后面的规则覆盖前面的，和浏览器一致 */
  const declsFor = (sel) => {
    const out = {};
    for (const body of rulesFor(sel)) {
      for (const d of body.split(';')) {
        const i = d.indexOf(':');
        if (i < 0) continue;
        const k = d.slice(0, i).trim().toLowerCase();
        if (k) out[k] = d.slice(i + 1).trim();
      }
    }
    return out;
  };

  /* 立绘那一摞容器必须是「完全看不见的」。带边框/底色/阴影的话，
     透明背景的 PNG 会被衬出一个方框，也就是用户说的「边界感」。
     这条按用户的原话机械化地钉死：#portrait-layer 及其两个子层里
     不许出现非 0 的 border、非透明的 background(-color)、非 none 的 box-shadow。 */
  const BOXY = ['#portrait-layer', '#portrait-grid-host', '#portrait-image'];
  const boxy = [];
  for (const sel of BOXY) {
    const d = declsFor(sel);
    for (const k of Object.keys(d)) {
      if (!/^border(-(top|right|bottom|left))?$|^background(-color)?$|^box-shadow$/.test(k)) continue;
      const v = d[k].trim();
      const harmless = /^(0|none|transparent|initial|unset)$/i.test(v);
      if (!harmless) boxy.push(`${sel} { ${k}: ${v} }`);
    }
  }
  t.empty(boxy, '立绘容器里没有边框 / 底色 / 阴影（透明背景才能融进场景）');

  // 立绘不再是「贴在左下角贴着底边」：抬起来了，而且往右让开了 HUD
  const layer = declsFor('#portrait-layer');
  t.ok(/var\(--portrait-lift\)/.test(layer.bottom || ''), '立绘抬离底边，不会被铺满底部的对话框压住');
  t.ok(/vw$/.test(layer.left || ''), '立绘往右让开了一截，不贴着窗口左边');

  // 对话框横向铺满底部：左栏撑满 + 半透明（不能是纯色板子）
  const box = declsFor('#dialogue-box');
  t.eq(box['align-self'], 'stretch', '对话框撑满左栏整行');
  t.eq(box['width'], 'auto', '对话框宽度交给 stretch，不再限制在 940px');
  t.eq(box['border-radius'], '0', '铺满底部的对话框不再是圆角卡片');
  t.ok(/var\(--dialogue-bg\)/.test(box.background || ''), '对话框底色是渐变（上沿淡出，没有硬边）');
  t.ok(/var\(--dialogue-gutter\)/.test(box.padding || ''), '对话框正文仍然收在中间那一栏');
  t.ok(/--dialogue-gutter:\s*max\(\d+px/.test(CSS), '窄屏时留白有固定下限（--dialogue-gutter 用 max() 兜底），文字不会贴着窗口边');

  t.ok(/#portrait-layer:not\(\.speaking\)/.test(CSS), '有「不是西比拉说话时」的立绘规则');
  t.ok(/brightness\(/.test(CSS), '压暗用的是 brightness 滤镜');
  t.ok(/scale\(0\.\d+\)/.test(CSS), '后缩用的是 scale');
  // drop-shadow 会在透明 PNG 的人物轮廓外描一圈黑边，等于又把边界感加回来了
  const portraitImage = declsFor('#portrait-image');
  t.ok(!/drop-shadow/.test(portraitImage.filter || ''), '立绘图不加投影（投影会沿人物轮廓描边）');
  t.eq(portraitImage['background-color'], 'transparent', '立绘那一层的底色是透明的');
  t.ok(/#title-screen\b/.test(CSS), '有开始界面的样式');
  t.ok(/\.title-name\b/.test(CSS), '有游戏名的样式');
  t.ok(/#title-screen:not\(\.on\)/.test(CSS), '开始界面能整体淡出');
  t.ok(/pointer-events:\s*none/.test(CSS), '开始界面收掉之后不挡点击');

  // 开始界面要盖在 HUD 上面（否则按钮会被控制条压住）
  const zOf = (sel) => {
    const m = CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*z-index:\\s*(\\d+)'));
    return m ? Number(m[1]) : null;
  };
  const zTitle = zOf('#title-screen');
  const zHud = zOf('#hud');
  const zBoot = zOf('#boot-error');
  t.ok(zTitle !== null && zHud !== null && zTitle > zHud, `开始界面在控制条之上（${zTitle} > ${zHud}）`);
  if (zBoot !== null) t.ok(zBoot > zTitle, `加载失败提示还在开始界面之上（${zBoot} > ${zTitle}）`);

  t.done();
}).catch((err) => {
  console.error('存档测试崩了：', err);
  process.exit(1);
});
