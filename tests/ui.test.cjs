/**
 * 渲染层测试（无头：用 dom-stub 顶替浏览器）
 * =====================================================================
 *   node tests/ui.test.cjs
 *
 * 除了「能不能跑」，主要盯这几件看得见的事：
 *   - 开始界面：开场停住、空格不会把第一句跳过去、背景是马车图、点击/回车都能进正片
 *   - 双立绘：左槽 = 主视角角色此刻的样子、右槽 = 正在说话的那一位；
 *     主视角角色自己开口时右槽收起来、左槽点亮
 *   - 换装：换衣节点换一张 art.portrait，左槽的图跟着换
 *   - 亮 / 暗两态：.portrait-slot 的 speaking 类分左右两个槽各管各的
 *   - 对话框：出选项 / 到结局时整个收起来（不再半透明地挂在底部）
 *   - 像素占位网格：真图到位就收起来，图 404 就留着
 *   - 图片路径：story.json 里写了 src 的素材，用的就是那个 src
 */

const fs = require('fs');
const path = require('path');
const { loadDom } = require('./dom-stub.cjs');
const { suite } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const api = require(path.join(ROOT, 'act1', 'engine.js'));
const uiApi = require(path.join(ROOT, 'act1', 'ui.js'));
const story = require(path.join(ROOT, 'act1', 'story.json'));
const story2 = require(path.join(ROOT, 'act2', 'story.json'));
const story3 = require(path.join(ROOT, 'act3', 'story.json'));
// 和浏览器里 boot() 一样：第一幕 + 顺着 meta.continues 读到的第二、第三幕
const wholeStory = api.composeStories([story, story2, story3]);

const { StoryEngine } = api;
const { Act1UI, CONFIG, imageSrc } = uiApi;
const CSS = fs.readFileSync(path.join(ROOT, 'act1', 'style.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'act1', 'index.html'), 'utf8');

const t = suite('渲染层');

/** 起一个装好的界面，等价于浏览器里的 boot() */
function bootUI(source) {
  const dom = loadDom();
  const engine = new StoryEngine(source || story);
  const ui = new Act1UI(engine, { doc: dom.doc, win: dom.win });
  ui.mount();
  ui.start();
  ui.showTitleScreen();
  return { ...dom, engine, ui };
}

/* ---------- 左右两槽的读法 ---------- */

/** 某个素材该画成什么 background-image */
const urlOf = (key, source) => {
  const src = source || story;
  return 'url("' + imageSrc(key, src.art.assets[key]) + '")';
};
const leftBG = (ui) => ui.els['portrait-image'].style.backgroundImage;
const rightBG = (ui) => ui.els['portrait-image-r'].style.backgroundImage;
const litLeft = (ui) => ui.els['portrait-layer'].classList.contains('speaking');
const litRight = (ui) => ui.els['portrait-layer-r'].classList.contains('speaking');
const leftSlotEmpty = (ui) => ui.els['portrait-layer'].classList.contains('empty');
const rightSlotEmpty = (ui) => ui.els['portrait-layer-r'].classList.contains('empty');

/** 这一格两个槽位各该放谁 —— 和 ui.js 的 resolveSlots() 是同一套规则的独立复述 */
function wantSlots(engine, view) {
  const art = (view && view.context) || engine.currentArt();
  const left = art.portrait || CONFIG.fallbackPortrait;
  const speaker = (view && view.type === 'line' && !view.narration) ? view.speaker : null;
  const povSpeaking = !!speaker && speaker === engine.pov;
  const right = (speaker && !povSpeaking) ? (view.portrait || null) : null;
  if (view && view.type === 'choices') {
    // 自由活动的房间里：左槽是来访的奥布里（压暗），右槽是房间里那个人此刻的样子
    const room = view.room;
    if (room && room.portrait) return { left, right: room.portrait, leftLit: false, rightLit: true };
    return { left, right: null, leftLit: true, rightLit: false };
  }
  return { left, right, leftLit: povSpeaking, rightLit: !!right };
}

/**
 * 往前推一格，替玩家把该点的都点了。
 * 走到结局屏时：后面还有一幕就按「继续下一幕」，没有就返回 false 表示到头了。
 *
 * 注意它**不点「自由活动 ▶」**：主线是主线，自由活动是另一条入口（单独测）。
 * 所以下面那段「走完整场戏核对两槽」的行为和加了自由活动之前一模一样。
 */
function autoStep(ui) {
  const v = ui.view;
  if (v.type === 'end') {
    if (ui.els['end-continue'].style.display === 'none') return false;
    ui.continueNextAct();
    return true;
  }
  if (v.type === 'choices') ui.choose(0); else ui.step();
  return true;
}

const portraitBG = (ui) => ui.els['portrait-image'].style.backgroundImage;
const bgBG = (ui) => ui.els['bg-image'].style.backgroundImage;

/* ===================================================================
 * 1. 挂载
 * =================================================================== */

t.section('挂载');

t.eq(CONFIG.portraitOverride, null, '不再统一借西比拉的脸（各自用自己的立绘，值必须是 null）');
t.eq(CONFIG.fallbackPortrait, 'chr_sibylla', '节点没写 art.portrait 时兜底用西比拉那张，左槽不空场');
t.eq(CONFIG.imageExt, '.webp', '按 key 拼路径时的扩展名是 .webp（插画都转 WebP 了）');
t.eq(CONFIG.titleBackground, 'bg_carriage', '开始界面背景是马车图');

const mounted = bootUI();
t.eq(
  Object.keys(mounted.ui.els).length,
  41,
  'mount() 找到了 41 个元素（32 + 结局卡片上的「自由活动」+ 换装浮层的 7 个 + 暂停按钮）'
);

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
  'url("../images/bg_carriage.webp")',
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

/* ---- 幕间路径：meta.continues 里的相对路径怎么解 ----
   页面是 /act1/index.html，入口剧本是 'story.json'，第二幕写的是 '../act2/story.json'。
   解出来的结果会原样交给 fetch（由页面地址去解），所以开头的 .. 必须留着 ——
   丢掉它就会去 /act1/act2/ 找，第二幕整个载入不了（这个 bug 真发生过）。 */
const rp = uiApi.resolvePath;
t.eq(rp('../act2/story.json', 'story.json'), '../act2/story.json', '从 act1/ 上一级再进 act2/，开头的 .. 要留着');
t.eq(rp('story.json', 'story.json'), 'story.json', '同目录的下一幕');
t.eq(rp('./act3/story.json', 'story.json'), 'act3/story.json', './ 要消掉');
t.eq(rp('act3/story.json', 'x/story.json'), 'x/act3/story.json', 'base 有目录时，接在它的目录后面');
t.eq(rp('../act3/story.json', 'x/story.json'), 'act3/story.json', 'base 有目录时，.. 正常回退一级');
t.eq(rp('../../act3/story.json', 'x/story.json'), '../act3/story.json', '回退到没有目录可退了，剩下的 .. 继续留着');
t.eq(rp('/act2/story.json', 'story.json'), '/act2/story.json', '绝对路径原样用');
t.eq(rp('https://example.com/a.json', 'story.json'), 'https://example.com/a.json', '绝对地址原样用');
t.eq(rp('../../act2/story.json', 'story.json'), '../../act2/story.json', '连着退两级也不会把 .. 吃掉');

// 真的把两幕拼起来之后，第二幕的节点确实在引擎里
t.ok(wholeStory.nodes.length > story.nodes.length, 'composeStories 之后第二幕的节点真的进来了');
t.ok(!!wholeStory.nodes.find((n) => n.id === 'b1_room'), '拼起来的剧本里有 b1_room');
t.eq(
  (wholeStory.characters['旁白'] || {}).narration, true,
  '合并后角色的定义取自第一幕（第二幕不重复声明 characters）'
);

t.eq(uiApi.imageSrc('chr_sibylla', story.art.assets.chr_sibylla), '../images/chr_sibylla.webp', '素材写了 src 就用 src（所有幕的图都在仓库根目录的 images/ 下）');
t.eq(uiApi.imageSrc('chr_lanark', story.art.assets.chr_lanark), '../images/chr_lanark.webp', '没写 src 就按 key 拼默认路径（默认扩展名跟着 WebP 走，页面在 /act1/ 所以要先退一级）');
t.eq(uiApi.imageSrc('chr_sibylla_teacher', story2.art.assets.chr_sibylla_teacher), '../images/chr_sibylla_teacher.webp', '第二幕的素材同样指向根目录 images/');
t.eq(uiApi.imageSrc('bg_study', story3.art.assets.bg_study), '../images/bg_study.webp', '第三幕的新场景还没画，回落到同名路径（拉不到就走像素占位）');

// 走完整场戏（第一幕 + 第二幕），沿途每一步都核对左右两槽
const portrait = bootUI(wholeStory);
let guard = 0;
const noPortrait = [];
const wrongSlot = [];
const speakingWrong = [];
const emptyWrong = [];
const count = { views: 0, leftLit: 0, leftDim: 0, rightLit: 0, rightEmpty: 0, twoPeople: 0, povSpeaking: 0 };

for (;;) {
  if (++guard > 5000) { t.ok(false, '剧情没有终点'); break; }
  const ui = portrait.ui;
  const v = ui.view;
  const want = wantSlots(portrait.engine, v);
  const where = `${portrait.engine.node.id} 第${v.index}行`;

  const gotLeft = leftBG(ui);
  const gotRight = rightBG(ui);
  const gotRightEmpty = !gotRight || gotRight === 'none';

  if (!gotLeft || gotLeft === 'none') noPortrait.push(`${portrait.engine.node.id} 左槽没画立绘`);
  else if (gotLeft !== urlOf(want.left, wholeStory)) {
    wrongSlot.push(`${where} 左槽是 ${gotLeft}，该是 ${urlOf(want.left, wholeStory)}`);
  }

  if (want.right) {
    if (gotRight !== urlOf(want.right, wholeStory)) {
      wrongSlot.push(`${where} 右槽是 ${gotRight}，该是 ${urlOf(want.right, wholeStory)}`);
    }
    if (gotRight === gotLeft) wrongSlot.push(`${where} 左右两槽是同一张图，右槽应该收掉`);
    if (want.left !== want.right) count.twoPeople++;
  } else if (!gotRightEmpty) {
    wrongSlot.push(`${where} 右槽本该空着，却是 ${gotRight}`);
  }

  // 该亮的时候亮、该暗的时候暗 —— 两槽各管各的
  if (litLeft(ui) !== want.leftLit) {
    speakingWrong.push(`${where} speaker=${v.speaker} 左槽期望 speaking=${want.leftLit} 实际=${litLeft(ui)}`);
  }
  if (litRight(ui) !== want.rightLit) {
    speakingWrong.push(`${where} speaker=${v.speaker} 右槽期望 speaking=${want.rightLit} 实际=${litRight(ui)}`);
  }

  // 没人的那一槽要整个藏掉，不能只靠「不画图」（否则像素占位会露出来）
  if (leftSlotEmpty(ui)) emptyWrong.push(`${where} 左槽被标成空的`);
  if (rightSlotEmpty(ui) !== !want.right) {
    emptyWrong.push(`${where} 右槽 empty=${rightSlotEmpty(ui)}，期望 ${!want.right}`);
  }

  count.views++;
  if (want.leftLit) count.leftLit++; else count.leftDim++;
  if (want.rightLit) count.rightLit++; else count.rightEmpty++;
  if (v.type === 'line' && !v.narration && v.speaker === portrait.engine.pov) count.povSpeaking++;

  if (!autoStep(ui)) break;
}

t.empty(noPortrait, '立绘常驻：左槽每一步都有立绘，不会空场');
t.empty(wrongSlot, '左槽 = 主视角角色此刻的样子，右槽 = 说话的那一位；同一个人时右槽收掉');
t.empty(speakingWrong, '两槽的亮/暗各管各的，跟「谁在说话」对得上');
t.empty(emptyWrong, '空着的那一槽整个藏掉（不露像素占位方块）');
t.ok(count.leftLit > 0, `确实出现过「主视角角色说话、左槽亮着」（${count.leftLit} 次）`);
t.ok(count.leftDim > 0, `确实出现过「别人说话/旁白、左槽压暗」（${count.leftDim} 次）`);
t.ok(count.rightLit > 0, `确实出现过「配角说话、右槽亮着」（${count.rightLit} 次）`);
t.ok(count.rightEmpty > 0, `确实出现过「主视角角色自己说话、右槽空着」（${count.rightEmpty} 次）`);
t.ok(count.twoPeople > 0, `确实出现过「两个人同时站在场上」（${count.twoPeople} 次）`);
t.ok(count.povSpeaking > 0, `确实出现过「主视角角色自己开口、右槽空着」（${count.povSpeaking} 次）`);
t.eq(count.leftLit + count.leftDim, count.views, '每一步左槽的亮/暗都有个明确状态');
t.eq(count.rightLit + count.rightEmpty, count.views, '每一步右槽要么亮着要么空着，没有第三种');

/* ---- 换装：换衣的节点换一张 art.portrait，左槽的图跟着换 ---- */

const outfit = bootUI(wholeStory);
const seenOutfits = [];
let outfitGuard = 0;
for (;;) {
  if (++outfitGuard > 5000) break;
  const v = outfit.ui.view;
  const bg = leftBG(outfit.ui);
  if (seenOutfits[seenOutfits.length - 1] !== bg) seenOutfits.push(bg);
  if (!autoStep(outfit.ui)) break;
}
t.ok(seenOutfits.includes('url("../images/chr_sibylla.webp")'), '第二幕前半段西比拉穿女仆装（chr_sibylla）');
t.ok(seenOutfits.includes('url("../images/chr_sibylla_teacher.webp")'), '换上牧师服（＝教师服）后左槽换成那张');
// 第二幕（给伊莎贝尔上课）和第三幕（接着当老师）各穿一段牧师服，中间隔着一段女仆装
t.eq(seenOutfits.filter((s) => s === 'url("../images/chr_sibylla_teacher.webp")').length, 2, '牧师服出现两段，各自连续，中间没有来回闪');
t.eq(
  seenOutfits[seenOutfits.length - 1],
  'url("../images/chr_sibylla.webp")',
  '结局前换回女仆装，左槽跟着换回来'
);

// 直接站到两个换装节点上，看的是同一件事，但更直白
const atOutfit = (id) => {
  const dom = loadDom();
  const engine = new StoryEngine(wholeStory);
  const ui = new Act1UI(engine, { doc: dom.doc, win: dom.win });
  ui.mount(); ui.start(); ui.begin();
  engine.enterNode(id);
  ui.render(engine.advance());
  return leftBG(ui);
};
t.eq(atOutfit('b11_sleep'), 'url("../images/chr_sibylla.webp")', '第二幕第一夜：女仆装');
t.eq(atOutfit('b12_morning'), 'url("../images/chr_sibylla_teacher.webp")', '段30 换上牧师服：左槽换了');
t.eq(atOutfit('b23_corridor'), 'url("../images/chr_sibylla_teacher.webp")', '一天下来还穿着牧师服');
t.eq(atOutfit('b24_change'), 'url("../images/chr_sibylla.webp")', '段76 换下牧师服：左槽又换回女仆装');

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

const bg = bootUI(wholeStory);
bg.ui.begin();
t.eq(bgBG(bg.ui), 'url("../images/bg_carriage.webp")', '开场（马车）用马车图');

const seenBg = new Set();
let bgGuard = 0;
for (;;) {
  if (++bgGuard > 8000) break;
  seenBg.add(bgBG(bg.ui));
  if (!autoStep(bg.ui)) break;
}
t.empty(
  Array.from(seenBg).filter((s) => !s || s === 'none').map(() => '有过没画背景的瞬间'),
  '全程背景都在（换节点时会沿用上一张，不会闪空）'
);
t.ok(seenBg.has('url("../images/bg_hall.webp")'), '走进大厅时换成了大厅图');
t.ok(seenBg.has('url("../images/bg_gate.webp")'), '到城堡门口时用的是大门口那张图');
t.ok(seenBg.has('url("../images/bg_sibylla_room.webp")'), '第二幕的新房间有自己的背景');
t.ok(seenBg.has('url("../images/bg_classroom.webp")'), '第二幕的教室有自己的背景');

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
t.ok(ch.ui.els['dialogue-box'].classList.contains('collapsed'), '出选项时对话框整个收起来（不再半透明地挂在底部）');

// 序章的选项点：替西比拉做决定，左槽亮着、右槽空着
t.ok(litLeft(ch.ui), '序章选项点是西比拉的视角，左槽亮着');
t.ok(rightSlotEmpty(ch.ui), '出选项时没人说话，右槽收起来');
t.eq(ch.engine.pov, '西比拉', '序章选项点确实是西比拉视角');
t.eq(leftBG(ch.ui), 'url("../images/chr_sibylla.webp")', '选项点上左槽是主视角角色西比拉');

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
t.eq(leftBG(main.ui), 'url("../images/chr_aubrey.webp")', '主视角换成奥布里后，左槽站的是奥布里（不再借西比拉的脸）');
t.ok(litLeft(main.ui), '选项点上是玩家替奥布里做决定，左槽亮着');
t.ok(rightSlotEmpty(main.ui), '奥布里的选项点：右槽空着');

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
t.eq(litLeft(fin.ui), false, '结局不是谁在说话，左槽压暗');
t.eq(litRight(fin.ui), false, '结局右槽也压暗');
t.ok(rightSlotEmpty(fin.ui), '结局屏上右槽收起来');
t.ok(fin.ui.els['dialogue-box'].classList.contains('collapsed'), '走到结局时对话框也收起来');
// 标题和副题跟着结局节点走，不再是写死的「第一幕 · 完」
t.eq(fin.ui.els['end-title'].textContent, '第一幕 · 完', '结局标题取自节点 title');
t.eq(fin.ui.els['end-sub'].textContent, '西比拉·德·克莱尔住进了伊莎贝尔的隔壁。', '副题取自节点的 endSub');
// 只载入第一幕时后面那一幕不在，按钮不该出现（免得点了没反应）
t.eq(fin.ui.els['end-continue'].style.display, 'none', '没有下一幕时「继续下一幕」按钮藏起来');
t.eq(fin.ui.continueNextAct(), false, '没有下一幕时按「继续」不会出事');

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
 * 6b. 幕间衔接：第一幕结局 -> 继续第二幕
 * =================================================================== */

t.section('幕间衔接');

const bridge = bootUI(wholeStory);
bridge.ui.begin();
let g4 = 0;
while (bridge.ui.view.type !== 'end') {
  if (++g4 > 2000) break;
  if (bridge.ui.view.type === 'choices') bridge.ui.choose(0); else bridge.ui.step();
}
t.eq(bridge.ui.view.type, 'end', '第一幕照常走到结局屏');
t.eq(bridge.ui.view.node.id, 'a10_end', '停的是第一幕的结局节点');
t.eq(bridge.ui.els['end-title'].textContent, '第一幕 · 完', '结局标题是第一幕的');
t.eq(bridge.ui.els['end-continue'].style.display, '', '有下一幕时按钮显示出来');
t.eq(bridge.ui.els['end-continue'].getAttribute('data-next'), 'b1_room', '按钮记着要去的节点');
t.eq(bridge.ui.els['end-continue'].textContent, '继续第二幕 ▶', '按钮上写着下一幕的名字');

bridge.fire(bridge.ui.els['end-continue'], 'click');
t.eq(bridge.engine.node.id, 'b1_room', '点一下接着演第二幕');
t.eq(bridge.ui.view.type, 'line', '接上之后直接就是第二幕的第一句话');
t.eq(bridge.ui.els['end-screen'].classList.contains('on'), false, '结局屏收掉了');
t.eq(bridge.ui.els['dialogue-box'].classList.contains('collapsed'), false, '对话框又打开了');
t.eq(bridge.engine.pov, '西比拉', '第二幕是西比拉视角');
t.eq(bridge.ui.els['title-bar'].getAttribute('data-pov'), '西比拉 · 德 · 克莱尔（观察者）', '右上角的视角标签跟着换');
t.eq(leftBG(bridge.ui), 'url("../images/chr_sibylla.webp")', '左槽换成第二幕主视角的西比拉');

// 从结局屏一路走下去，能走到第二幕的结局
let g5 = 0;
while (g5++ < 4000) {
  if (bridge.ui.view.type === 'end' && bridge.ui.view.node.id === 'b25_end') break;
  if (!autoStep(bridge.ui)) break;
}
t.eq(bridge.ui.view.type, 'end', '第二幕也能走到结局');
t.eq(bridge.ui.view.node.id, 'b25_end', '停在第二幕的结局节点 b25_end');
t.eq(bridge.ui.els['end-title'].textContent, '第二幕 · 完', '第二幕的结局标题跟着节点走');
t.eq(bridge.ui.els['end-continue'].style.display, '', '第二幕后面还有第三幕，按钮照旧在');
t.eq(bridge.ui.els['end-continue'].getAttribute('data-next'), 'c1_door', '按钮指向第三幕的开头');
t.eq(bridge.ui.els['end-continue'].textContent, '继续第三幕 ▶', '按钮上写着第三幕');
t.eq(bridge.engine.stats['伊莎贝尔_好感'] + bridge.engine.stats['西比拉_警惕'], 3, '数值一路带过来，没有被第二幕改掉');

// 接着走进第三幕，一路走到第三幕的结局
bridge.fire(bridge.ui.els['end-continue'], 'click');
t.eq(bridge.engine.node.id, 'c1_door', '点一下接着演第三幕');
t.eq(bridge.engine.pov, '西比拉', '第三幕仍然是西比拉视角');
t.eq(bridge.ui.els['end-screen'].classList.contains('on'), false, '结局屏又收掉了');

let g6 = 0;
while (g6++ < 4000) {
  if (bridge.ui.view.type === 'end' && bridge.ui.view.node.id === 'c27_end') break;
  if (!autoStep(bridge.ui)) break;
}
t.eq(bridge.ui.view.type, 'end', '第三幕也能走到结局');
t.eq(bridge.ui.view.node.id, 'c27_end', '停在第三幕的结局节点 c27_end');
t.eq(bridge.ui.els['end-continue'].style.display, 'none', '第三幕是最后一幕，没有「继续下一幕」了');
t.eq(bridge.ui.els['end-roam'].style.display, '', '第三幕的结局屏上照旧有「自由活动」的入口');

/* ===================================================================
 * 6c. 选项框：点下去就该立刻消失
 * =================================================================== */

t.section('选项框立刻消失');

/** 一直 step 到某个视图类型为止（推不动就报错，免得死循环） */
function stepTo(ui, type, limit) {
  for (let i = 0; i < (limit || 400); i++) {
    if (ui.view && ui.view.type === type) return ui.view;
    ui.step();
  }
  throw new Error('推不到 ' + type);
}

/** step 到菜单（选项屏或换装浮层）为止；走到结局就是走错了 */
function toMenu(ui, limit) {
  for (let i = 0; i < (limit || 400); i++) {
    const v = ui.view;
    if (v && (v.type === 'choices' || v.type === 'outfit')) return v;
    if (v && v.type === 'end') throw new Error('走到结局了，不该到这儿');
    ui.step();
  }
  throw new Error('推不到菜单');
}

/** 从头一路点到底，停在某个结局节点上；中途按「继续下一幕」跨幕 */
function playTo(ui, nodeId, limit) {
  for (let i = 0; i < (limit || 8000); i++) {
    const v = ui.view;
    if (v && v.type === 'end') {
      if (ui.engine.node.id === nodeId) return v;
      if (!ui.continueNextAct()) return null;
      continue;
    }
    if (v && v.type === 'choices') ui.choose(0); else ui.step();
  }
  throw new Error('走不到结局节点 ' + nodeId);
}

/** 在菜单里按文字找下标 */
const findText = (list, text) => list.findIndex((c) => c.text === text);

const gone = bootUI();
gone.ui.begin();
stepTo(gone.ui, 'choices');
t.eq(gone.ui.els.choices.children.length, 3, '选项画出来了');
t.eq(gone.ui.view.type, 'choices', '确实停在选项屏上');

// 走真浏览器里的那条路：点按钮 -> 冒泡到 #choices 上的事件代理
gone.fire(gone.ui.els.choices, 'click', { target: gone.ui.els.choices.children[0] });
t.eq(gone.ui.view.type, 'line', '点完走到了下一句台词');
t.eq(gone.ui.els.choices.children.length, 0, '点完选项框立刻空了（不再挂在屏幕上挡立绘）');

// 数字键走的是同一个 choose()，同样立刻收掉
stepTo(gone.ui, 'choices');
t.ok(gone.ui.els.choices.children.length > 0, '又走到一个选项屏');
gone.fireKey('1');
t.eq(gone.ui.els.choices.children.length, 0, '数字键选完，选项框同样立刻消失');

/* ===================================================================
 * 6d. 幕间自由活动 + 换装
 * =================================================================== */

t.section('幕间自由活动');

t.ok(HTML.includes('自由活动 ▶'), '结局卡片上摆着「自由活动 ▶」这个按钮');

// 剧本里没写 freeRoam（比如只载入第一幕）时，按钮不该冒出来
const solo = bootUI();
solo.ui.begin();
let gSolo = 0;
while (solo.ui.view.type !== 'end' && gSolo++ < 4000) {
  if (solo.ui.view.type === 'choices') solo.ui.choose(0); else solo.ui.step();
}
t.eq(solo.ui.view.type, 'end', '只载入第一幕也能走到结局');
t.eq(solo.ui.els['end-roam'].style.display, 'none', '剧本里没写自由活动，结局卡片上就不出现这个按钮');

const fr = bootUI(wholeStory);
fr.ui.begin();
playTo(fr.ui, 'a10_end');
t.eq(fr.ui.view.type, 'end', '先走到第一幕的结局（出的是结局卡片，不是黑屏）');
t.eq(fr.ui.els['end-continue'].style.display, '', '「继续下一幕」照旧在');
t.eq(fr.ui.els['end-roam'].style.display, '', '结局卡片上多了「自由活动 ▶」');
t.eq(fr.ui.els['end-roam'].getAttribute('data-anchor'), 'fr_hub', '按钮上记着要进哪个 hub');

fr.fire(fr.ui.els['end-roam'], 'click');
t.eq(fr.engine.node.id, 'fr_hub', '点一下进了自由活动');
t.eq(fr.ui.view.type, 'line', '先播一句占位开场白');
t.eq(fr.ui.els['end-screen'].classList.contains('on'), false, '结局卡片收掉了');
t.ok(
  (fr.ui.els['title-bar'].getAttribute('data-pov') || '').includes('奥布里'),
  '视角标签换成奥布里（扮演）'
);

toMenu(fr.ui);
t.eq(fr.ui.view.type, 'choices', '然后出菜单');
t.eq(fr.ui.els.choices.children.length, 6,
  'hub 菜单六项：两个去处 + 两个「请人过来」+ 下一幕 + 结束游戏');
t.eq(
  fr.ui.els.choices.children.map((b) => b.disabled),
  [false, false, false, false, false, false],
  'hub 上已经没有点不动的项了'
);
t.eq(
  fr.ui.els.choices.children.map((b) => b.getAttribute('data-index')),
  ['0', '1', '2', '3', '4', '5'],
  '每项还带着自己的序号（数字键和点击都靠它）'
);

// 自由活动里已经没有锁着的项了，但「灰显 + 说明为什么」这条路还得留着能用：
// 直接喂一个合成的视图给渲染层，把 .locked / .choice-lock 那两行走一遍
fr.ui.render({
  type: 'choices',
  choices: [
    { index: 0, text: '能点的', hint: '', enabled: true, lockedHint: '', effects: [] },
    { index: 1, text: '点不动的', hint: '', enabled: false, lockedHint: '条件不足', effects: [] },
  ],
});
t.ok(fr.ui.els.choices.children[1].className.includes('locked'), '灰显用的是 .locked');
t.ok(
  fr.ui.els.choices.children[1].children.some((c) => c.className.includes('choice-lock')),
  '锁住的那项写了原因'
);
t.eq(fr.ui.els.choices.children[0].className.includes('locked'), false, '能点的那项没有 .locked');
toMenu(fr.ui);
t.ok(fr.ui.els['dialogue-box'].classList.contains('collapsed'), '出菜单时对话框收起来');

// ---- 进西比拉的房间：两槽各站各的，右槽是她此刻的样子 ----
fr.ui.choose(0);
t.eq(fr.engine.node.id, 'fr_sib_maid', '进了西比拉的房间（她穿着女仆装）');
toMenu(fr.ui);
t.eq(leftBG(fr.ui), urlOf('chr_aubrey', wholeStory), '左槽是奥布里（主视角角色此刻的样子）');
t.eq(rightBG(fr.ui), urlOf('chr_sibylla', wholeStory), '右槽是她此刻那套：女仆装的半身像');
t.eq(litLeft(fr.ui), false, '说话的不是奥布里，左槽压暗');
t.eq(litRight(fr.ui), true, '房间里那个人亮着');
t.eq(leftSlotEmpty(fr.ui), false, '左槽不空');
t.eq(rightSlotEmpty(fr.ui), false, '右槽不空');
t.eq((fr.ui.view.room || {}).speaker, '西比拉', '视图告诉界面右槽站的是谁');
t.eq(
  fr.ui.view.choices.map((c) => c.text),
  ['称赞', '普通对话', '触摸', '换装', '离开'],
  '房间菜单：称赞 / 普通对话 / 触摸 / 换装 / 离开'
);

// ---- 好感低：触摸 -> 警惕上升，并且只给「感觉」不给数字 ----
t.eq(fr.engine.getStat('西比拉_好感'), 0, '刚进来好感是 0');
fr.engine.setStat('西比拉_好感', -10); // 落到「≥-49」那一档（0 那一档台词照说，但不动数值）
// 主线走下来警惕已经有底数了（主线的「好感 + 警惕 恒等于 3」），所以后面都按「涨了多少」来断言
const baseWatch = fr.engine.getStat('西比拉_警惕');
fr.fire(fr.ui.els.choices, 'click', {
  target: fr.ui.els.choices.children[findText(fr.ui.view.choices, '触摸')],
});
t.eq(fr.engine.getStat('西比拉_警惕'), baseWatch + 1, '好感低时触摸：警惕上升');
t.eq(fr.engine.getStat('西比拉_好感'), -11, '好感低时触摸：好感被扣掉 1（区间是 -100~100，扣得动）');
t.ok(fr.ui.els.toast.children.length > 0, '数值变动弹了提示');
t.empty(
  fr.ui.els.toast.children.filter((n) => /\d/.test(n._text || '')).map((n) => n._text),
  '提示里不带数字（真实数值要自己按 V 看）'
);

// ---- 好感高：同一次触摸走另一支 ----
fr.engine.setStat('西比拉_好感', 45); // 「≥40」那档
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '触摸'));
t.eq(fr.engine.getStat('西比拉_好感'), 46, '好感高时同一次触摸：好感上升');
t.eq(fr.engine.getStat('西比拉_警惕'), baseWatch + 1, '好感高时触摸：警惕不再涨');

// ---- 换装浮层 ----
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '换装'));
t.eq(fr.ui.view.type, 'outfit', '开的是换装浮层（独立视图，不是普通选项屏）');
t.eq(fr.ui.els['outfit-screen'].classList.contains('on'), true, '浮层打开了');
t.eq(
  fr.ui.els['dialogue-box'].classList.contains('collapsed'),
  true,
  '浮层里对话框是收起的（用户要的「缩小或隐藏」）'
);
t.eq(
  fr.ui.els['outfit-image'].style.backgroundImage,
  urlOf('full_sibylla_maid', wholeStory),
  '居中的全身立绘是当前那套'
);
t.eq(fr.ui.els['outfit-choices'].children.length, 7, '四套衣服 + 退出换装 + 进入下一幕 + 结束游戏');
t.eq(fr.ui.els.choices.children.length, 0, '浮层开着时下面那个选项栏是空的（不叠两层按钮）');
t.eq(
  fr.ui.view.choices.filter((c) => c.worn).map((c) => c.text),
  ['女仆装'],
  '现在穿着的那套被标了出来'
);
t.ok(
  fr.ui.els['outfit-choices'].children[0].children.some((c) => c.className.includes('choice-worn')),
  '标记旁边有说明文字'
);
t.ok(fr.ui.els['outfit-line'].children.length > 0, '浮层上挂着占位台词');

// 点一件衣服（走 DOM 事件，和玩家真点一样）
const beforeWear = fr.engine.getStat('西比拉_好感');
fr.fire(fr.ui.els['outfit-choices'], 'click', {
  target: fr.ui.els['outfit-choices'].children[findText(fr.ui.view.choices, '骑装')],
});
t.eq(fr.engine.node.id, 'fr_sib_riding', '换装 = 换锚点（位置就是装束，存档天然记住她穿什么）');
t.eq(fr.engine.getStat('西比拉_好感'), beforeWear + 2, '换装影响好感');
t.eq(
  fr.ui.els['outfit-image'].style.backgroundImage,
  urlOf('full_sibylla_riding', wholeStory),
  '全身立绘跟着换'
);
t.eq(fr.ui.view.choices.filter((c) => c.worn).map((c) => c.text), ['骑装'], '「现在穿着」挪到骑装上');
t.eq(fr.ui.els.choices.children.length, 0, '在浮层里点完，底下那个选项栏也还是空的');

// 数字键在浮层里也认
fr.fireKey('4');
t.eq(fr.engine.node.id, 'fr_sib_black', '数字键在换装浮层里也能选（4 = 黑礼服）');
t.eq(fr.engine.getStat('西比拉_警惕'), baseWatch + 2, '黑礼服让警惕上升（数据里就是这么写的）');

// ---- 退出浮层 -> 回到房间菜单，她还是穿着刚换的那套 ----
fr.fireKey('5');
t.eq(fr.ui.view.type, 'choices', '「5 = 退出换装」回到房间菜单');
t.eq(fr.ui.els['outfit-screen'].classList.contains('on'), false, '浮层收掉了');
t.eq(rightBG(fr.ui), urlOf('chr_sibylla_black', wholeStory), '房间里的她换成了黑礼服的半身像');

// ---- 离开房间 -> 回 hub；伊莎贝尔的房间没有「换装」 ----
fr.ui.choose(findText(fr.ui.view.choices, '离开'));
t.eq(fr.engine.node.id, 'fr_hub', '离开房间回到进来的那个 hub');
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '去伊莎贝尔的房间'));
t.eq(fr.engine.node.id, 'fr_isa', '进得了伊莎贝尔的房间');
toMenu(fr.ui);
t.eq(fr.ui.view.choices.map((c) => c.text), ['称赞', '普通对话', '触摸', '离开'], '伊莎贝尔的房间没有「换装」');
t.eq(rightBG(fr.ui), urlOf('chr_isabelle', wholeStory), '右槽是伊莎贝尔');

// ---- 让布朗去请人过来：人站在奥布里的房间里 ----
fr.ui.choose(findText(fr.ui.view.choices, '离开'));
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '让布朗去请西比拉过来'));
t.eq(fr.engine.node.id, 'fr_visit_sib_black', '请来的西比拉穿着她最近一次穿的那套（上面刚换成黑礼服）');
toMenu(fr.ui);
t.eq(bgBG(fr.ui), urlOf('bg_aubrey_room', wholeStory), '背景还是奥布里的房间');
t.eq(rightBG(fr.ui), urlOf('chr_sibylla_black', wholeStory), '右槽站着被请来的她，还是那套黑礼服');
t.eq((fr.ui.view.room || {}).speaker, '西比拉', '视图说右槽是她');
t.eq(fr.ui.view.choices.map((c) => c.text), ['称赞', '普通对话', '触摸', '离开'],
  '来访的她借的是自己的动作表，但在这屋里不给换装');

// 黑礼服 → 女仆装：请来的那套跟着「最近一次」走，不是「去过哪几件」
fr.ui.choose(findText(fr.ui.view.choices, '离开'));
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '去西比拉的房间'));
t.eq(fr.engine.node.id, 'fr_sib_black', '回她屋里，她还穿着黑礼服（换装=换锚点，位置记住了）');
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '换装'));
fr.fireKey(String(findText(fr.ui.view.choices, '女仆装') + 1));
t.eq(fr.engine.node.id, 'fr_sib_maid', '在浮层里换回女仆装');
fr.fireKey('5');
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '离开'));
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '让布朗去请西比拉过来'));
t.eq(fr.engine.node.id, 'fr_visit_sib_maid',
  '黑礼服穿过、女仆装又穿回来 —— 请来的是女仆装（钉死「不能用 visited 的 Set」）');
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '离开'));
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '让布朗去请伊莎贝尔过来'));
t.eq(fr.engine.node.id, 'fr_visit_isa', '请得来伊莎贝尔');
toMenu(fr.ui);
t.eq(rightBG(fr.ui), urlOf('chr_isabelle', wholeStory), '右槽是伊莎贝尔');
t.eq(fr.ui.view.choices.map((c) => c.text), ['称赞', '普通对话', '触摸', '离开'], '伊莎贝尔来访也没有换装');

// ---- 高好感的特殊剧情：菜单里多出来的一项 ----
fr.ui.choose(findText(fr.ui.view.choices, '离开'));
fr.engine.setStat('西比拉_好感', 85);
toMenu(fr.ui);
fr.ui.choose(findText(fr.ui.view.choices, '去西比拉的房间'));
toMenu(fr.ui);
const specialText = wholeStory.freeRoam.rooms['西比拉'].special.label;
t.eq(fr.ui.view.choices.map((c) => c.text),
  ['称赞', '普通对话', '触摸', specialText, '换装', '离开'],
  '好感 85：菜单里多出来一项，摆在触摸和换装之间');
fr.engine.setStat('西比拉_好感', 45);
fr.ui.step(); // 站在菜单里再推一下 = 照当前数值重画这张菜单
t.eq(fr.ui.view.type, 'choices', '还在菜单里（re-roam 不会把人赶走）');
t.eq(findText(fr.ui.view.choices, specialText), -1, '好感掉回 45：那一项又没了');
fr.engine.setStat('西比拉_好感', 85);
fr.ui.step();
fr.ui.choose(findText(fr.ui.view.choices, specialText));
t.eq(fr.ui.view.type, 'line', '点开先播台词');
t.eq(
  (fr.ui.view.line || {}).text,
  wholeStory.freeRoam.rooms['西比拉'].special.lines[0].text,
  '播的是数据结构里排第一的那句'
);
t.eq(rightBG(fr.ui), urlOf('chr_sibylla', wholeStory), '旁白那句也没把她从右槽抹掉（她还是女仆装那张）');
t.eq(litRight(fr.ui), true, '还是她那一侧亮着');
const specialEnd = toMenu(fr.ui);
t.eq(specialEnd.type, 'choices', '播完留在原地，还是房间菜单');
t.ok(findText(fr.ui.view.choices, '换装') >= 0, '换装照旧在');
t.eq(fr.engine.getStat('西比拉_亲密'), 2, '特殊剧情加的是亲密值');

// ---- 第二幕之后的自由活动：没有「进入下一幕」，但有「结束游戏」 ----
const fr2 = bootUI(wholeStory);
fr2.ui.begin();
playTo(fr2.ui, 'b25_end');
t.eq(fr2.ui.els['end-roam'].style.display, '', '第二幕结局卡片上也有「自由活动 ▶」');
t.eq(fr2.ui.els['end-roam'].getAttribute('data-anchor'), 'fr_end_hub', '进的是第二个 hub');
fr2.fire(fr2.ui.els['end-roam'], 'click');
t.eq(fr2.engine.node.id, 'fr_end_hub', '进了第二幕之后的自由活动');
toMenu(fr2.ui);
t.eq(findText(fr2.ui.view.choices, '进入下一幕'), -1, '已经是最后一幕，不显示「进入下一幕」');
t.ok(findText(fr2.ui.view.choices, '结束游戏') >= 0, '只留「结束游戏」');

fr2.ui.choose(findText(fr2.ui.view.choices, '结束游戏'));
t.eq(fr2.engine.node.id, 'fr_the_end', '结束游戏落在 fr_the_end');
t.eq(fr2.ui.view.type, 'end', 'fr_the_end 走的是结局屏，不是菜单');
t.eq(fr2.ui.els['end-title'].textContent, '全剧终', '结局屏标题取自节点 title');
t.eq(fr2.ui.els['end-roam'].style.display, 'none', '全剧终之后不再有「自由活动」（否则能一直绕圈）');
t.eq(fr2.ui.els['end-screen'].classList.contains('on'), true, '结局屏打开了');

/* ===================================================================
 * 6.5 中途暂停：剧情 → 自由活动 → 回到原来那一句
 * =================================================================== */

t.section('中途暂停');

const pz = bootUI(wholeStory);
t.eq(pz.ui.els['pause-btn'].style.display, 'none', '开始界面（还没有剧情）不显示暂停按钮');
t.eq(pz.ui.els['pause-btn'].textContent, '暂停 (P)', '按钮上是「暂停」');

pz.ui.begin();
t.eq(pz.ui.els['pause-btn'].style.display, '', '剧情一开始就出现「暂停 (P)」');

// 往前播两句，这样才测得出「回到原来那一句」
pz.ui.step();
pz.ui.step();
const pzNode = pz.engine.node.id;
const pzLine = pz.engine.lineIndex;
const pzNextText = pz.engine.visibleLines()[pzLine].text;   // 没暂停的话，下一句就该是它
t.ok(pzLine > 0, '确实播了一句以上');

pz.fire(pz.ui.els['pause-btn'], 'click');
t.eq(pz.engine.paused, true, '点一下就暂停（进自由活动）');
t.eq(pz.engine.node.id, 'fr_hub', '落在自由活动的 hub 上');
t.eq(pz.ui.view.type, 'line', '先播自由活动的开场白');
t.eq(pz.ui.els['pause-btn'].textContent, '回到剧情 (P)', '按钮改口叫「回到剧情」');
t.eq(pz.ui.els['pause-btn'].style.display, '', '暂停中按钮照旧显示');

toMenu(pz.ui);
t.eq(pz.ui.view.type, 'choices', '暂停之后自由活动的菜单照常出');
t.empty(pz.ui.view.choices.map((c) => c.text).filter((s) => /下一幕|结束游戏/.test(s)),
  '暂停中不列「进入下一幕 / 结束游戏」');
t.eq(pz.ui.els['pause-btn'].style.display, '', '在 hub 菜单上按钮也还在');

// 暂停期间进她的房间转一圈，涨的好感要留住
pz.ui.choose(findText(pz.ui.view.choices, '去西比拉的房间'));
toMenu(pz.ui);
const pzGain = pz.engine.getStat('西比拉_好感');
pz.ui.choose(findText(pz.ui.view.choices, '称赞'));
toMenu(pz.ui);
t.eq(pz.engine.getStat('西比拉_好感'), pzGain + 1, '暂停里自由活动照常涨好感');

pz.fireKey('p');
t.eq(pz.engine.paused, false, '再按 P 回到剧情');
t.eq(pz.engine.node.id, pzNode, '回到暂停时那个节点');
t.eq(pz.engine.lineIndex, pzLine + 1, '进度停在原文的同一处（刚把那一句重新摆出来）');
t.eq(pz.ui.view.line.text, pzNextText, '屏幕上就是「没暂停的话该看到的那一句」');
t.eq(pz.engine.getStat('西比拉_好感'), pzGain + 1, '自由活动里涨的好感一分不丢');
t.eq(pz.ui.els['pause-btn'].textContent, '暂停 (P)', '按钮改回「暂停」');
t.eq(pz.ui.els['end-screen'].classList.contains('on'), false, '没有误弹结局屏');

// 结局屏上按不动
const pzEnd = bootUI(wholeStory);
pzEnd.ui.begin();
playTo(pzEnd.ui, 'b25_end');
t.eq(pzEnd.ui.els['pause-btn'].style.display, 'none', '结局屏上没有暂停按钮');

// 从结局卡片进的自由活动也没有可回的地方
const pzRoam = bootUI(wholeStory);
pzRoam.ui.begin();
playTo(pzRoam.ui, 'a10_end');
pzRoam.fire(pzRoam.ui.els['end-roam'], 'click');
t.eq(pzRoam.engine.node.id, 'fr_hub', '从结局卡片进了自由活动');
t.eq(pzRoam.ui.els['pause-btn'].style.display, 'none', '这里没有「原来的剧情」，按钮不显示');
const toastBefore = pzRoam.ui.els.toast.children.length;
pzRoam.fireKey('p');
t.eq(pzRoam.engine.paused, false, '误按 P 什么也不会发生（不弹提示、不报错）');
t.eq(pzRoam.ui.els.toast.children.length, toastBefore, '误按 P 连提示都不弹');

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
t.eq(stat.ui.els['stats-body'].children.length, 4, '打开后有 4 行（四个隐藏数值，多了「亲密」）');
t.eq(stat.ui.els['stats-toggle'].getAttribute('data-on'), '1', '按钮状态跟着变');
t.eq(stat.ui.els['stats-panel'].classList.contains('revealed'), true, '面板展开');

stat.fireKey('v');
t.eq(stat.engine.showStats, false, '再按 V 收起来');

/* ===================================================================
 * 8. 存档 / 读档
 * =================================================================== */

t.section('存档与读档');

/* 存档现在落在浏览器自己的 localStorage 里（纯静态站，没有后端可调）。
   ui.js 是从**注入进来的 window** 上取 localStorage 的，所以往 dom.win 上
   挂一个替身，就等于在真浏览器里跑 —— 下面把能踩的坑挨个踩一遍：
   没存过档、存档内容坏了、节点对不上剧本、压根没有 localStorage、
   有但不让写（无痕 / 配额满）。每一种都只该弹一句提示，不该抛错。 */
function fakeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    size: () => map.size,
  };
}

/** 起一局，并装上指定的那个「localStorage」（传 null = 这个环境根本没有） */
function bootWithStore(store) {
  const dom = loadDom();
  dom.win.localStorage = store;
  const engine = new StoryEngine(story);
  const ui = new Act1UI(engine, { doc: dom.doc, win: dom.win });
  ui.mount();
  ui.start();
  ui.begin();
  return { ui, engine, store };
}

const store = fakeStore();
const sl = bootWithStore(store);

for (let i = 0; i < 3; i++) sl.ui.step();
const where = sl.engine.node.id;
const stepCount = sl.engine.history.length;

const saved = sl.ui.save();
t.ok(store.size() > 0, '保存：真的写进了 localStorage');
t.ok(sl.ui.els['server-dot'].classList.contains('online'), '保存成功后存档指示灯变绿');
t.eq(saved.nodeId, where, '存的是当前节点');
t.ok(!(saved instanceof Promise), '存档是同步的（不用再等服务器回话）');

const kept = JSON.parse(store.getItem(CONFIG.storageKey));
t.eq(kept.nodeId, where, 'localStorage 里那份快照就是它（钥匙用的是 CONFIG.storageKey）');
t.ok(Array.isArray(kept.history) && Array.isArray(kept.visited), '快照该有的字段都在（history / visited）');

// 再往前走，直到真的换了个节点，然后读回来
let walked = 0;
while (sl.engine.node.id === where && walked++ < 300) {
  if (sl.ui.view.type === 'choices') sl.ui.choose(0); else sl.ui.step();
}
t.ne(sl.engine.node.id, where, '读档前确实已经走远了');

sl.ui.load();
t.eq(sl.engine.node.id, where, '读档回到存档时的节点');
t.eq(sl.engine.history.length, stepCount, '读档回到存档时的步数（不会多出一节）');
t.eq(sl.ui.titleOpen, false, '读档直接进正片，不停在开始界面');

// 数值也一并拽回去
const statName = '西比拉_好感';
const statThen = sl.engine.getStat(statName);
sl.engine.setStat(statName, statThen + 7);
sl.ui.load();
t.eq(sl.engine.getStat(statName), statThen, '读档把数值也拽回存档那一刻');

/* ---- 存不成 / 读不成的时候，都只该弹一句提示 ---- */

const empty = bootWithStore(fakeStore());
t.eq(empty.ui.load(), null, '没存过档就读：返回 null，不抛错');
t.ok(empty.ui.els.toast.children.length > 0, '没存过档会弹一句提示');

const broken = bootWithStore(fakeStore());
broken.store.setItem(CONFIG.storageKey, '{这不是 JSON');
t.eq(broken.ui.load(), null, '存档不是合法 JSON：返回 null，不抛错');
t.ok(broken.ui.els.toast.children.length > 0, '存档坏了会弹一句提示');

const wrongNode = bootWithStore(fakeStore());
wrongNode.store.setItem(CONFIG.storageKey, JSON.stringify({ version: 1, nodeId: '没这个节点', stats: {} }));
t.eq(wrongNode.ui.load(), null, '存档里的节点对不上这一版剧本：返回 null');
t.eq(wrongNode.engine.node.id, story.meta.start, '读档失败时引擎一步都没动（还停在开头）');

// 压根没有 localStorage：无痕模式 / 站点数据被禁
const none = bootWithStore(null);
t.eq(none.ui.save(), null, '没有 localStorage 时保存返回 null，不抛错');
t.ok(none.ui.els['server-dot'].classList.contains('offline'), '存不了时指示灯变灰');
t.ok(none.ui.els.toast.children.length > 0, '存不了会弹一句提示');
t.eq(none.ui.load(), null, '没有 localStorage 时读档也返回 null，不抛错');
t.eq(none.ui.checkStorage(), false, '没有 localStorage 时自检返回 false');

// 有 localStorage 但不让写（配额满、无痕模式下常见）
const full = bootWithStore(Object.assign(fakeStore(), {
  setItem: () => { throw new Error('QuotaExceededError'); },
}));
t.eq(full.ui.save(), null, '写不进去时保存返回 null，不抛错');
t.ok(full.ui.els['server-dot'].classList.contains('offline'), '写不进去时指示灯变灰');
t.eq(full.ui.checkStorage(), false, '写不进去时自检也是 false（探针键就写不了）');

// 一切正常的时候
const good = bootWithStore(fakeStore());
t.eq(good.ui.checkStorage(), true, '能写的时候自检返回 true');
t.ok(good.ui.els['server-dot'].classList.contains('online'), '自检通过时指示灯变绿');
t.eq(good.store.size(), 0, '探针键用完就删掉，不留垃圾');

{
  /* 下面这一段的变量只在这儿用；以前是个 .then() 回调（存档还是异步的），
     现在存档同步了，留个普通块就够 */
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
  const BOXY = [
    '.portrait-slot', '#portrait-layer-r',
    '#portrait-grid-host', '#portrait-image',
    '#portrait-grid-host-r', '#portrait-image-r',
    '#outfit-image',
  ];
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
  t.empty(boxy, '左右两个立绘槽里都没有边框 / 底色 / 阴影（透明背景才能融进场景）');

  // 立绘不再是「贴在左下角贴着底边」：抬起来了，而且往右让开了 HUD
  const layer = declsFor('.portrait-slot');
  t.ok(/var\(--portrait-lift\)/.test(layer.bottom || ''), '立绘抬离底边，不会被铺满底部的对话框压住');
  t.ok(/vw$/.test(layer.left || ''), '立绘往右让开了一截，不贴着窗口左边');

  // 右槽镜像到右边，两个槽不会叠在一起
  const layerR = declsFor('#portrait-layer-r');
  t.eq(layerR.left, 'auto', '右槽把 left 松开');
  t.ok(/vw$/.test(layerR.right || ''), '右槽从窗口右边往内让开一截');
  t.ok(/bottom right/.test(layerR['transform-origin'] || ''), '右槽的缩放锚点在右下角（镜像）');

  // 没人的那一槽要整个藏掉，不然像素占位方块会露出来
  const empty = declsFor('.portrait-slot.empty');
  t.ok(/hidden/.test(empty.visibility || ''), '空槽位 visibility: hidden');
  t.eq(empty.opacity, '0', '空槽位透明度 0');

  // 对话框横向铺满底部：左栏撑满 + 半透明（不能是纯色板子）
  const box = declsFor('#dialogue-box');
  t.eq(box['align-self'], 'stretch', '对话框撑满左栏整行');
  t.eq(box['width'], 'auto', '对话框宽度交给 stretch，不再限制在 940px');
  t.eq(box['border-radius'], '0', '铺满底部的对话框不再是圆角卡片');
  t.ok(/var\(--dialogue-bg\)/.test(box.background || ''), '对话框底色是渐变（上沿淡出，没有硬边）');
  t.ok(/var\(--dialogue-gutter\)/.test(box.padding || ''), '对话框正文仍然收在中间那一栏');
  t.ok(/--dialogue-gutter:\s*max\(\d+px/.test(CSS), '窄屏时留白有固定下限（--dialogue-gutter 用 max() 兜底），文字不会贴着窗口边');

  t.ok(/#portrait-layer:not\(\.speaking\)/.test(CSS), '有「左槽没在说话时」的立绘规则');
  t.ok(/#portrait-layer-r:not\(\.speaking\)/.test(CSS), '有「右槽没在说话时」的立绘规则');
  t.ok(/brightness\(/.test(CSS), '压暗用的是 brightness 滤镜');
  t.ok(/scale\(0\.\d+\)/.test(CSS), '后缩用的是 scale');
  // 两个槽的后缩方向相反，才是镜像而不是一起往左飘
  t.ok(/translateX\(-/.test(declsFor('#portrait-layer:not(.speaking)').transform || ''), '左槽往后缩是往左');
  t.ok(/translateX\(/.test(declsFor('#portrait-layer-r:not(.speaking)').transform || ''), '右槽往后缩是往右');
  // drop-shadow 会在透明 PNG 的人物轮廓外描一圈黑边，等于又把边界感加回来了
  for (const sel of ['#portrait-image', '#portrait-image-r']) {
    const d = declsFor(sel);
    t.ok(!/drop-shadow/.test(d.filter || ''), `${sel} 不加投影（投影会沿人物轮廓描边）`);
    t.eq(d['background-color'], 'transparent', `${sel} 那一层的底色是透明的`);
    t.eq(d['background-size'], 'contain', `${sel} 用 contain，立绘不会变形`);
  }
  t.eq(declsFor('#portrait-image-r')['background-position'], 'bottom right', '右槽的图贴右下角');

  // 「继续下一幕」那个按钮：金色，和「重新开始」区分得开
  const cont = declsFor('.end-continue-btn');
  t.ok(/var\(--gold\)/.test(cont.color || ''), '「继续下一幕」按钮是金色的');
  t.ok(/var\(--gold\)/.test(cont['border-color'] || ''), '「继续下一幕」按钮的边框也是金色的');

  /* 对话框收起：出选项 / 到结局时不再让上一句话半透明地赖在底部。
     用 transform 往下推、不用 display: none —— transform 不脱离文档流，
     对话框仍然占着原来的高度，上面的选项不会忽然往下跳。 */
  const collapsed = declsFor('#dialogue-box.collapsed');
  t.eq(collapsed.opacity, '0', '对话框收起时透明度 0');
  t.ok(/translateY\(100%\)/.test(collapsed.transform || ''), '对话框是往下推出屏幕的');
  t.eq(collapsed['pointer-events'], 'none', '收起之后不挡点击');
  t.ok(/transform/.test(declsFor('#dialogue-box').transition || ''), '收起/打开是有过渡的（transform 一起过渡）');
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

  /* ---------------- 换装浮层 ---------------- */

  const zEnd = zOf('#end-screen');
  const zOutfit = zOf('#outfit-screen');
  t.eq(zOutfit, 10, '换装浮层的 z-index 是 10');
  if (zEnd !== null) t.ok(zOutfit > zEnd, `浮层压在结局卡片之上（${zOutfit} > ${zEnd}）`);
  t.ok(zOutfit < zTitle, `浮层还在开始界面之下（重开时不会露在标题上面：${zOutfit} < ${zTitle}）`);

  // 背景模糊只能加在浮层自己那一层上
  const veil = declsFor('#outfit-veil');
  t.ok(/blur\(/.test(veil['backdrop-filter'] || ''), '浮层背后那层负责把背景糊掉');
  t.ok(/blur\(/.test(veil['-webkit-backdrop-filter'] || ''), '-webkit- 前缀也写了');
  t.eq(declsFor('#stage').filter, undefined, '#stage 上没有 filter（否则 fixed 的背景层会换掉包含块）');
  t.eq(declsFor('#app').filter, undefined, '#app 上没有 filter（同上）');

  // 全身立绘居中
  const op = declsFor('#outfit-portrait');
  t.ok(/1448\s*\/\s*2896/.test(op['aspect-ratio'] || ''), '全身立绘用 1:2（四张全身图都是 1448×2896）');
  t.ok(/auto/.test(op.margin || ''), '全身立绘左右自动居中');
  const off = declsFor('#outfit-screen');
  t.ok(/fixed/.test(off.position || ''), '浮层是全屏铺满的');
  t.ok(
    /center/.test(off['align-items'] || '') && /center/.test(off['justify-content'] || ''),
    '浮层内容整体居中'
  );
  t.ok(/#outfit-screen:not\(\.on\)/.test(CSS), '浮层能整体淡出');
  const offNot = declsFor('#outfit-screen:not(.on)');
  t.eq(offNot['pointer-events'], 'none', '浮层收起来之后不挡点击');
  t.eq(offNot.opacity, '0', '浮层收起来之后是透明的');

  // 全身图那一层也要守红线：drop-shadow 会沿人物轮廓描一圈黑边
  const od = declsFor('#outfit-image');
  t.ok(!/drop-shadow/.test(od.filter || ''), '#outfit-image 不加投影（投影会沿人物轮廓描边）');
  t.eq(od['background-size'], 'contain', '#outfit-image 用 contain，立绘不会变形');
  t.eq(od['background-position'], 'center bottom', '#outfit-image 贴着底边居中');

  // 「现在穿着」那个标记
  t.ok(/\.choice-btn\.worn\b/.test(CSS), '有「现在穿着」那套衣服的样式');
  t.ok(/\.choice-worn\b/.test(CSS), '标记旁边那行说明文字也有样式');

  t.done();
}
