/**
 * Stage 0 试玩走查（无头）
 * =====================================================================
 *   node stage0/walkthrough.cjs
 *
 * 这不是正式测试，是 Stage 0 的「验尸报告」脚本。它做四件事：
 *
 *   1. 把 stage0/index.html 装进 dom-stub，用**没有改动过的** act1/ui.js +
 *      act1/engine.js 跑 stage0/story.json，真点按钮走完整条链：
 *      奥布里房间 → 今日安排 → 早晨 → 事件 → Hub → 中午 → 事件 → Hub →
 *      午后 → 事件 → Hub → 夜晚 → 事件 → Hub → 第一天结束
 *   2. 核对「教室那一幕」的台词逐字来自 act2/source/普里森堡第二章.txt。
 *      —— 这道核对**只属于 stage0**，没有加进 tests/fidelity.cjs，
 *         也没有改过 tests/ 里的任何一个字。
 *   3. 走四遍不同的日子（照常 / 主动挪走她的活 / 管家 / 大厅），
 *      把每次「一个动作同时带来的好结果和坏结果」逐条打印出来。
 *   4. 顺带证明「隐藏值不露脸」：statOrder 里一个隐藏值都没有。
 *
 * 失败会以退出码 1 结束。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { loadDom } = require(path.join(ROOT, 'tests', 'dom-stub.cjs'));
const { suite, norm } = require(path.join(ROOT, 'tests', 'harness.cjs'));

const api = require(path.join(ROOT, 'act1', 'engine.js'));
const uiApi = require(path.join(ROOT, 'act1', 'ui.js'));
const Stage0Diary = require(path.join(__dirname, 'diary.js'));
const story = require(path.join(__dirname, 'story.json'));

const { StoryEngine } = api;
const { Act1UI } = uiApi;

const SOURCE = norm(
  fs.readFileSync(path.join(ROOT, 'act2', 'source', '普里森堡第二章.txt'), 'utf8')
);

const NODES = {};
for (const n of story.nodes) NODES[n.id] = n;
/** 某个节点写死在剧本里的台词（不走引擎，直接读数据） */
const scriptLines = (id) => ((NODES[id] || {}).dialogues || []).map((d) => ({ speaker: d.speaker, text: d.text }));

/* 日记本。规则从 stage0/diary.js 来 —— 跟浏览器里 stage0.js 用的是**同一份**，
   这里不另写一套判定。 */
const DIARY_ENTRY = Stage0Diary.entryFor(story, Stage0Diary.DAY);
/* 哪个节点落在哪个时段（也是 diary.js 算的，跟左上角那行时间显示共用） */
const SLOT_OF = Stage0Diary.slotMap(story);
/** 此刻这一局，日记上会记哪几条（按时段排序） */
const diaryOf = (s) => Stage0Diary.eventTexts(story, s.engine);
/** 同上，但要带上时段和节点，核对「时段顺序 + 同一时段里的先后」用 */
const diaryItems = (s) => Stage0Diary.collect(story, s.engine);
/* 同一时段里几条的先后，取引擎的 visited（Set 的迭代顺序 = 进入顺序） */
const visitOrder = (s, id) => Array.from(s.engine.visited).indexOf(id);
/* 时段自己的先后：早晨 < 中午 < 午后 < 夜晚 */
const SLOT_RANK = {};
Stage0Diary.SLOTS.forEach((sl, i) => { SLOT_RANK[sl.label] = i; });

const t = suite('Stage 0 试玩走查');
const problems = [];   // 走到一半发现的架构问题，最后单独列出来

/* ================================================================== */
/* 试玩员                                                             */
/* ================================================================== */

function open() {
  const dom = loadDom(path.join(__dirname, 'index.html'));
  const engine = new StoryEngine(story);
  const ui = new Act1UI(engine, { doc: dom.doc, win: dom.win });
  ui.mount();
  ui.start();

  const s = { dom, engine, ui, visited: [], said: [], picks: [], _last: '' };
  record(s);
  return s;
}

const nodeId = (s) => (s.engine.node && s.engine.node.id) || '';
const statsNow = (s) => Object.assign({}, s.engine.stats);

/** 把此刻画面上那一格记下来（同一格重复调用只记一次） */
function record(s) {
  const v = s.ui.view;
  if (!v) return;
  const id = nodeId(s);
  if (v.type === 'line') {
    const key = id + '|' + v.index + '|' + v.line.text;
    if (key === s._last) return;
    s._last = key;
    s.said.push({ id, speaker: v.name || v.speaker, text: v.line.text, narration: !!v.narration });
  }
  if (s.visited[s.visited.length - 1] !== id) s.visited.push(id);
}

/** 一直点「继续」，直到停在选项或结局上 */
function settle(s) {
  let guard = 0;
  while (s.ui.view && s.ui.view.type === 'line') {
    if (++guard > 5000) throw new Error('推进不动了，疑似死循环');
    s.ui.step();
    record(s);
  }
  return s.ui.view;
}

/** 看看此刻停在哪：节点 id + [选项]/[结局] */
function peek(s) {
  const v = settle(s);
  return nodeId(s) + (v && v.type === 'end' ? ' [结局]' : v && v.type === 'choices' ? ' [选项]' : '');
}

/** 在当前的选项里挑一个（按文字片段匹配）；挑不到就当场报错 */
function pick(s, label) {
  const v = settle(s);
  if (!v || v.type !== 'choices') {
    throw new Error(`【${nodeId(s)}】期望停在选项上，实际是 ${v && v.type}`);
  }
  const idx = v.choices.findIndex((c) => c.text.includes(label));
  if (idx < 0) {
    throw new Error(
      `【${nodeId(s)}】没有「${label}」这个选项，只有：\n    ` +
      v.choices.map((c, i) => `${i + 1}. ${c.enabled ? '' : '🔒'}${c.text}`).join('\n    ')
    );
  }
  if (!v.choices[idx].enabled) {
    throw new Error(`【${nodeId(s)}】「${label}」是锁着的（${v.choices[idx].lockedHint}）`);
  }
  s.picks.push(v.choices[idx].text);
  s.ui.choose(idx);
  record(s);
  return v.choices[idx].text;
}

/** 当前选项里那一项是不是灰的（锁着的） */
function isLocked(s, label) {
  const v = settle(s);
  if (!v || v.type !== 'choices') return false;
  return v.choices.some((c) => c.text.includes(label) && !c.enabled);
}

const saidIn = (s, id) => s.said.filter((x) => x.id === id).map((x) => x.text).join('\n');
const slotOrder = (s) => s.visited
  .filter((id) => /^h_|^d1_end$/.test(id))
  .filter((id, i, arr) => i === 0 || id !== arr[i - 1]);

/** 两次快照之间，每个数值变了多少（只列变了的） */
function diffOf(before, after) {
  const out = [];
  for (const k of Object.keys(after)) {
    const d = after[k] - (before[k] || 0);
    if (d) out.push({ stat: k, delta: d });
  }
  return out;
}
const fmtDiff = (list) => list.map((x) => `${x.stat} ${x.delta > 0 ? '+' : ''}${x.delta}`).join('、') || '（什么都没变）';

/** 只留看得见的六个 */
const visibleOf = (stats) => story.config.statOrder.map((k) => `${stats[k]}`).join(' / ');

/* ================================================================== */
/* 一、剧本本身                                                       */
/* ================================================================== */

t.section('剧本自检 · 隐藏值不露脸');

const check = new StoryEngine(story).validate();
t.empty(check.errors, 'engine.validate() 没有报错');
t.eq(check.stats.nodes, 38, '节点 38 个（含优先级 2 的 7 个桩 + 交了日记的 d1_diary_intro）');
t.eq(check.stats.endings, ['d1_end'], '只有一个结局节点 d1_end');
t.eq(check.stats.povs, ['奥布里'], '全篇只有奥布里一个视角');

t.eq(story.config.showStats, false, 'showStats 关着（数值不挂在侧栏上）');
t.eq(story.config.statOrder.length, 6, 'statOrder 只列了 6 个「看得见」的数值');
t.empty(
  story.config.statOrder.filter((k) => /亲密|恨意|反抗|尊敬|仆人|海尔|伊莎贝尔_好感|^旗_|^决斗_/.test(k)),
  '隐藏值（亲密/恨意/反抗/尊敬/仆人/海尔/伊莎贝尔好感/记录旗）一个都没进 statOrder'
);

const engine0 = new StoryEngine(story);
t.eq(engine0.statPanel().length, 6, '结局屏与侧栏渲染用的 statPanel() 也只有 6 项');
t.eq(engine0.statPanel().map((x) => x.label), story.config.statOrder.map((k) => story.config.statLabels[k]),
  '侧栏列出来的正好是那六个可见值，顺序也对');

/* ================================================================== */
/* 二、教室那一幕：台词逐字来自原文                                   */
/* ================================================================== */

t.section('教室那一幕是不是照原文来的');

const notFound = [];
for (const id of ['e_classroom', 'e_classroom_canon']) {
  for (const l of scriptLines(id)) {
    if (l.speaker === '旁白') continue;
    if (!SOURCE.includes(norm(l.text))) notFound.push(`${id}｜${l.text}`);
  }
}
t.empty(notFound, '教室 + 课后两个节点里，每一句人物台词都能在 act2/source 原文里逐字找到');

// 反查：原文里那几句最关键的，剧本里必须一字不差地还在
for (const must of [
  '西比拉坏！我不要学了，那些东西太难了。',
  '不要不要不要不要！一直坐在座位上我的屁股都疼了！',
  '小伊莎贝尔，大清早的哭什么呢？',
  '西比拉小姐，从刚刚的画面来看我并没有看见一点礼仪呢。',
  '很抱歉，沃大人，伊莎贝尔小姐不肯配合我。',
  '西比拉小姐是告状鬼。',
  '是西比拉小姐太严厉了！我感觉她随时准备打我。',
  '遵命，沃大人。',
  '哥哥！哥——',
]) {
  const hit = ['e_classroom', 'e_classroom_canon']
    .some((id) => scriptLines(id).some((l) => norm(l.text) === norm(must)));
  t.ok(hit, `原文这句一字不差地留着：${must.slice(0, 16)}…`);
}

/* ================================================================== */
/* 三、路线 A：照常的一天（完全不动她的日程）                         */
/* ================================================================== */

t.section('路线 A · 照常的一天');

const A = open();
const A0 = statsNow(A);

t.eq(peek(A), 'd1_wake [选项]', '开局在【奥布里房间】');
pick(A, '叫布朗进来');
t.eq(peek(A), 'd1_plan [选项]', '接着是【今日安排】');
settle(A);
t.ok(saidIn(A, 'd1_plan').includes('西比拉小姐今日的安排是'), '今日安排里报了她今天原本的安排');
pick(A, '照常。她该做什么就做什么。');
t.eq(peek(A), 'h_morning [选项]', '选完安排落在【早晨】');

// —— 前置环境描述 + 返回
pick(A, '教室');
settle(A);
t.eq(nodeId(A), 'f_classroom', '点地点先到「前置环境描述」节点，不直接跳正片');
t.ok(
  saidIn(A, 'f_classroom').includes('你沿着走廊走去，还未靠近教室，便听见伊莎贝尔的哭喊。'),
  '前置描述里能听见伊莎贝尔的哭喊'
);
t.ok(!saidIn(A, 'e_classroom'), '还没进事件节点，正片一句都没演');
pick(A, '返回。');
t.eq(peek(A), 'h_morning [选项]', '【返回】回到当前所在地，时段没往前走');

// —— 真的走进去
pick(A, '教室');
pick(A, '进去看看。');
settle(A);
t.eq(nodeId(A), 'e_classroom', '进事件节点');
t.ok(saidIn(A, 'e_classroom').includes('一直坐在座位上我的屁股都疼了'), '教室里能看到那场哭闹');
t.ok(!isLocked(A, '把伊莎贝尔交回'), '课没停的时候，处理选项都是开的');

const aBeforeClass = statsNow(A);
pick(A, '把伊莎贝尔交回西比拉手里');
console.log(`  · 站西比拉这边：${fmtDiff(diffOf(aBeforeClass, statsNow(A)))}`);
t.eq(peek(A), 'h_noon [选项]', '教室事件收尾后自动回到 Hub（中午）');

pick(A, '后坡');
settle(A);
t.eq(nodeId(A), 'f_walk', '散步也有前置环境描述');
pick(A, '出门，往坡上走。');
t.eq(nodeId(A), 'e_walk', '进入散步事件');
settle(A);
t.ok(saidIn(A, 'e_walk').includes('我也常走这样一段路'), '散步里她松了一句口');
t.eq(peek(A), 'h_afternoon [选项]', '散步收尾后回到 Hub（午后）');

// —— 照常的一天：看见她在洗衣房，但不插手
pick(A, '洗衣房');
pick(A, '走进去。');
settle(A);
t.eq(nodeId(A), 'e_laundry', '洗衣房事件里她正在做工');
t.ok(saidIn(A, 'e_laundry').includes('手背被水泡得发白'), '她正在做的活被演出来了');
pick(A, '没什么。路过。');
t.ok(!saidIn(A, 'e_laundry_stop'), '没插手，就没有「换了人做」那一段');
t.eq(peek(A), 'h_night [选项]', '回 Hub（夜晚）');

pick(A, '西比拉的房间');
pick(A, '推门进去。');
settle(A);
t.eq(nodeId(A), 'e_sibylla_room', '夜里她在房里备课');
t.ok(saidIn(A, 'e_sibylla_room').includes('我正在备明日的课'), '她自己在做的那件事被演出来了');
pick(A, '不打扰她，替她把门掩上。');
t.eq(peek(A), 'd1_end [结局]', '「就寝前」不再挂选项，一路走到【第一天结束】');

t.eq(DIARY_ENTRY && DIARY_ENTRY.day, 1, '日记数据里有第 1 天那一条');
t.ok(A.visited.includes('d1_diary_intro'), '收尾路上经过「交代 → 她敲门」那一段');
t.ok(!A.visited.includes('d1_diary'), '玩家走不到 d1_diary —— 它只是日记正文的来源');
t.eq(diaryOf(A).length, 2, '今天早晨记了两条：课照常 + 课堂上的插曲');
t.ok(diaryOf(A)[0].includes('礼仪课上了一上午'), '第一条是课照常上的那件事');
t.ok(diaryOf(A)[1].includes('沃大人出现'), '第二条是课堂上的插曲，接在它后面');
t.eq(diaryItems(A).filter((x) => x.slot === '早晨').map((x) => x.node).join(' → '),
  'd1_plan → e_classroom',
  '同一个时段的几条，按她今天先走过哪个节点排（课在前，课堂里的插曲在后）');

t.eq(slotOrder(A).join(' → '), 'h_morning → h_noon → h_afternoon → h_night → d1_end',
  '四个时段按顺序走完，每次都回到 Hub，再收尾');
t.ok(!diaryOf(A).some((x) => x.includes('换了人做')), '没干的事，左页上不会凭空出现');
t.ok(!saidIn(A, 'd1_end').includes('洗衣房的活换了人做'), '没干的事，收尾里不会凭空出现');
t.ok(!saidIn(A, 'd1_end').includes('只刻了一半'), '没打断备课，收尾里也没有那一条');

const A_END = statsNow(A);
console.log(`  路线 A 收尾可见数值（好感/健康/埋怨/礼仪/秩序/声誉）：${visibleOf(A_END)}`);
console.log(`  路线 A 全天：${fmtDiff(diffOf(A0, A_END))}`);

/* ================================================================== */
/* 四、路线 B：主动挪走西比拉原定的活                                 */
/* ================================================================== */

t.section('路线 B · 把她的日程挪开');

const B = open();
const B0 = statsNow(B);

pick(B, '叫布朗进来');
const bBeforeStop = statsNow(B);
pick(B, '把上午的课停了');
const bStop = diffOf(bBeforeStop, statsNow(B));
console.log(`  · 停掉上午的课：${fmtDiff(bStop)}`);
t.ok(bStop.some((x) => x.stat === '西比拉_好感' && x.delta > 0), '挪走她的课 -> 好感上升');
t.ok(bStop.some((x) => x.stat === '西比拉_埋怨' && x.delta > 0), '同一件事 -> 埋怨同时上升（一个动作两种结果）');
t.ok(bStop.some((x) => x.stat === '伊莎贝尔_礼仪成长' && x.delta < 0), '同一件事 -> 伊莎贝尔的进度掉下去');

t.eq(peek(B), 'h_morning [选项]', '停课之后照样从【早晨】开始');

// 停课之后再进教室：正片演不出来，只剩空教室和一条出路
pick(B, '教室');
settle(B);
t.ok(!saidIn(B, 'f_classroom').includes('还未靠近教室，便听见伊莎贝尔的哭喊'), '课停了，前置描述也跟着换了');
pick(B, '进去看看。');
settle(B);
t.eq(nodeId(B), 'e_classroom', '还是能进教室');
t.ok(isLocked(B, '把伊莎贝尔交回'), '课停了之后，那两个处理办法在界面上是灰的（带锁提示）');
t.ok(saidIn(B, 'e_classroom').includes('教室里空着'), '课停了，教室是空的');
t.ok(!saidIn(B, 'e_classroom').includes('西比拉坏'), '课停了，那场哭闹不会凭空重演');
problems.push('停课后再进教室，两个「上课」选项以 🔒 灰按钮的形式留在界面上。引擎的 availableChoices() 不过滤被 if 挡住的选项，Stage 0 只能靠 lockedHint 把它写得像「有意为之」。要彻底干净，得给引擎加一条「被挡住就整项不画」的开关 —— 那是 Stage 1 的事，Stage 0 没动引擎。');
pick(B, '把门带上，离开。');
t.eq(peek(B), 'h_noon [选项]', '空教室也能收尾回 Hub');

pick(B, '书房');
pick(B, '走到书案前。');
settle(B);
t.ok(saidIn(B, 'e_study').includes('而今天的课，没有上'), '书房里那句话跟着今天的实际情况变了');
t.eq(peek(B), 'h_afternoon [选项]', '书房看完就回 Hub');

pick(B, '洗衣房');
pick(B, '走进去。');
const bBeforeLaundry = statsNow(B);
pick(B, '今天你别洗了');
console.log(`  · 挪走洗衣房的活：${fmtDiff(diffOf(bBeforeLaundry, statsNow(B)))}`);
settle(B);
t.ok(saidIn(B, 'e_laundry_stop').includes('换了一双手'), '换了人做这件事，当场有人接住，不是只掉一个数字');
t.eq(peek(B), 'h_night [选项]', '回 Hub');

pick(B, '西比拉的房间');
pick(B, '推门进去。');
const bBeforeNight = statsNow(B);
pick(B, '打断她');
console.log(`  · 打断备课：${fmtDiff(diffOf(bBeforeNight, statsNow(B)))}`);
t.eq(peek(B), 'd1_end [结局]', '「就寝前」不再挂选项，一路走到【第一天结束】');

t.ok(diaryOf(B).some((x) => x.includes('蜡版')), '今晚打断了备课，日记上留下了这一笔');
t.ok(diaryOf(B).some((x) => x.includes('洗衣房')), '午后挪走的那摊活也在');
t.eq(diaryItems(B).map((x) => x.slot).join(' → '), '早晨 → 午后 → 夜晚',
  '一天里记下的几笔按时段排好（不是按玩家点选的顺序）');

const B_END = statsNow(B);
console.log(`  路线 B 收尾可见数值（好感/健康/埋怨/礼仪/秩序/声誉）：${visibleOf(B_END)}`);
console.log(`  路线 B 全天：${fmtDiff(diffOf(B0, B_END))}`);

t.ok(saidIn(B, 'd1_end').includes('上午的礼仪课停掉了'), '收尾里回述了「课停了」');
t.ok(saidIn(B, 'd1_end').includes('洗衣房的活换了人做'), '收尾里回述了「洗衣房换了人」');
t.ok(saidIn(B, 'd1_end').includes('只刻了一半'), '收尾里回述了「蜡版只刻了一半」');
t.ne(saidIn(B, 'd1_end'), saidIn(A, 'd1_end'), '同一天、不同做法，收尾的叙述确实不一样');
t.ok(B_END['普里森堡_声誉'] < A_END['普里森堡_声誉'], '把她的活挪走，府里的账面上是亏的');
t.ok(B_END['伊莎贝尔_礼仪成长'] < A_END['伊莎贝尔_礼仪成长'], '她的课被挪走，伊莎贝尔学到的更少');
t.ok(B_END['西比拉_亲密'] > A_END['西比拉_亲密'], '但玩家和她之间的关系是往前的（隐藏值）');
t.ok(B_END['西比拉_埋怨'] > A_END['西比拉_埋怨'], '同时，她心里那笔账也在加（隐藏值/可见值各记一头）');

/* ================================================================== */
/* 五、路线 C：外院 + 决斗                                            */
/* ================================================================== */

t.section('路线 C · 管家的一天');

const C = open();
pick(C, '叫布朗进来');
pick(C, '照常。她该做什么就做什么。');

pick(C, '外院');
settle(C);
t.eq(nodeId(C), 'f_yard', '外院也有前置环境描述');
pick(C, '沿墙走一圈。');
settle(C);
t.eq(nodeId(C), 'e_yard', '外院事件（原文没有这一幕，台词是 Stage 0 新写的）');
const cBeforeYard = statsNow(C);
pick(C, '叫人把水洼扫了');
console.log(`  · 上午管外院：${fmtDiff(diffOf(cBeforeYard, statsNow(C)))}`);
t.eq(peek(C), 'h_noon [选项]', '回 Hub');

pick(C, '外庭院');
t.eq(nodeId(C), 'e_duel_call', '决斗从【中午】这个 Hub 发起');
pick(C, '去取两把练习用的钝剑来');
settle(C);
t.eq(nodeId(C), 'e_duel_fight', '进入决斗');
t.ok(saidIn(C, 'e_duel_fight').includes('剑脱手落在石板地上'), 'Stage 0 的第一场：奥布里输了（病弱、拄拐）');
const cBeforeDuel = statsNow(C);
pick(C, '把剑捡起来');
console.log(`  · 打一场（输）：${fmtDiff(diffOf(cBeforeDuel, statsNow(C)))}`);
t.eq(statsNow(C)['决斗_战绩'], 1, '输了也记在账上');

pick(C, '外院');
t.eq(nodeId(C), 'f_yard_pm', '午后的外院是另一段前置描述');
pick(C, '走过去看看。');
settle(C);
t.eq(nodeId(C), 'e_yard_pm', '外院事件（原文没有，台词是 Stage 0 新写的）');
const cBeforeKids = statsNow(C);
pick(C, '你们玩吧。');
console.log(`  · 不打断她们：${fmtDiff(diffOf(cBeforeKids, statsNow(C)))}`);

t.eq(peek(C), 'h_night [选项]', '回 Hub');
pick(C, '回房睡下');
t.ok(!saidIn(C, 'e_sibylla_room'), '夜晚 Hub 可以直接睡，不必非得进她的房间');
t.eq(peek(C), 'd1_end [结局]', '照样走到【第一天结束】');
t.ok(diaryOf(C).some((x) => x.includes('钝剑')), '左页回述了那场决斗');
t.eq(slotOrder(C).join(' → '), 'h_morning → h_noon → h_afternoon → h_night → d1_end', '时段链一样是完整的');

const C_END = statsNow(C);
console.log(`  路线 C 收尾可见数值（好感/健康/埋怨/礼仪/秩序/声誉）：${visibleOf(C_END)}`);
t.ok(C_END['普里森堡_秩序'] > A_END['普里森堡_秩序'], '管了外院，秩序比不管的那天高');

/* ================================================================== */
/* 六、路线 D：大厅（只走到中午，够了）                               */
/* ================================================================== */

t.section('路线 D · 大厅');

const D = open();
pick(D, '叫布朗进来');
pick(D, '照常。她该做什么就做什么。');
pick(D, '大厅');
settle(D);
t.eq(nodeId(D), 'f_hall', '大厅也有前置环境描述');
pick(D, '走过去看看。');
settle(D);
t.eq(nodeId(D), 'e_hall', '大厅事件（原文没有这一幕，台词是 Stage 0 新写的）');
const dBefore = statsNow(D);
pick(D, '把人都叫齐');
const dDiff = diffOf(dBefore, statsNow(D));
console.log(`  · 在大厅立规矩：${fmtDiff(dDiff)}`);
t.ok(dDiff.some((x) => x.stat === '仆人_尊敬' && x.delta > 0), '立了规矩，下人的尊敬动了（隐藏值）');
t.eq(peek(D), 'h_noon [选项]', '回 Hub');

/* ================================================================== */
/* 七、每个时段三个可去场景（优先级 2）                               */
/* ================================================================== */

t.section('时段菜单 · 每个时段三个场景');

/* 这四个节点就是 Stage 0 的「时段菜单」，stage0.js 认的是同一份名单。
   「回房睡下」不算地点，那是收工。 */
const MENU_IDS = ['h_morning', 'h_noon', 'h_afternoon', 'h_night'];
for (const id of MENU_IDS) {
  const locs = ((NODES[id] || {}).choices || []).filter((c) => c.text !== '回房睡下');
  t.eq(locs.length, 3, `【${id}】三个可去场景：${locs.map((c) => c.text).join(' / ')}`);
  t.ok(locs.every((c) => !!c.hint), `【${id}】每个场景都带一句说明（悬停时就是 tooltip）`);
  t.ok(locs.every((c) => !/\d/.test(c.text)), `【${id}】按钮上的场景名不带编号`);
  for (const c of locs) t.ok(!!NODES[c.next], `【${id}】「${c.text}」指向的节点 ${c.next} 存在`);
}

/* 「邀请西比拉散步」原来折在书房里当二级选项，现在提回中午的顶层菜单 ——
   这正是「她中午通常无事，所以可以把她的时间占掉」那个设计点。 */
const noonTexts = (NODES.h_noon.choices || []).map((c) => c.text);
t.ok(noonTexts.includes('后坡'), '中午的第三项是散步，不再藏在书房里');
t.ok(noonTexts.includes('外庭院'), '决斗仍然只在中午发起');
t.eq((NODES.e_study.choices || []).length, 0, '书房不再挂二级选项，看完就走');

/* ================================================================== */
/* 八、路线 E / F：新加的那几个桩                                     */
/* ================================================================== */

t.section('路线 E · 新增桩：马厩 / 账房');

const E = open();
pick(E, '叫布朗进来');
pick(E, '照常。她该做什么就做什么。');
pick(E, '教室'); pick(E, '进去看看。'); pick(E, '把伊莎贝尔交回西比拉手里');
pick(E, '后坡'); pick(E, '出门，往坡上走。');
pick(E, '马厩');
settle(E);
t.eq(nodeId(E), 'f_stable', '马厩也有前置环境描述');
pick(E, '进去看看。');
settle(E);
t.eq(nodeId(E), 'e_stable', '马厩事件（占位文本，只有两行）');
const eBefore = statsNow(E);
pick(E, '出来。');
t.ok(diffOf(eBefore, statsNow(E)).length > 0, '马厩这一趟也动了数值，不是个死按钮');
t.eq(peek(E), 'h_night [选项]', '马厩收尾回 Hub（夜晚）');

pick(E, '账房');
settle(E);
t.eq(nodeId(E), 'f_office', '账房也有前置环境描述');
pick(E, '推门进去。');
settle(E);
t.eq(nodeId(E), 'e_office', '账房事件（占位文本）');
pick(E, '出来，带上门。');
t.eq(peek(E), 'd1_end [结局]', '账房收尾 → 就寝 → 结局');

t.section('路线 F · 新增桩：伊莎贝尔的房间');

const F = open();
pick(F, '叫布朗进来');
pick(F, '照常。她该做什么就做什么。');
pick(F, '教室'); pick(F, '进去看看。'); pick(F, '把伊莎贝尔交回西比拉手里');
pick(F, '后坡'); pick(F, '出门，往坡上走。');
pick(F, '洗衣房'); pick(F, '走进去。'); pick(F, '没什么。路过。');
pick(F, '伊莎贝尔的房间');
settle(F);
t.eq(nodeId(F), 'f_isabelle_room', '她的房间也有前置环境描述');
pick(F, '返回。');
t.eq(peek(F), 'h_night [选项]', '【返回】不消耗时段');
pick(F, '伊莎贝尔的房间');
pick(F, '推门看看。');
settle(F);
t.eq(nodeId(F), 'e_isabelle_room', '进门看到她睡着（占位文本）');
const fBefore = statsNow(F);
pick(F, '把门带上。');
t.ok(
  diffOf(fBefore, statsNow(F)).some((x) => x.stat === '伊莎贝尔_好感' && x.delta > 0),
  '去看过她，那孩子的好感动了（隐藏值）'
);
t.eq(peek(F), 'd1_end [结局]', '收尾 → 就寝 → 结局');

/* ================================================================== */
/* 九、日记本                                                         */
/* ================================================================== */

t.section('日记本 · 节点形状');

const SLEEP = NODES.d1_sleep || {};
const INTRO = NODES.d1_diary_intro || {};
const DIARY = NODES.d1_diary || {};

t.ok(!SLEEP.choices || SLEEP.choices.length === 0, '就寝前不再挂「翻开看看」，日记是剧情推进开的');
t.eq(SLEEP.next, 'd1_diary_intro', '就寝前 next 到「交代 + 她敲门」那一段');
t.ok(!!INTRO.id, 'd1_diary_intro 存在');
t.eq(INTRO.next, 'd1_end', '那一段演完直接进结算（日记本由界面层插在中间摊开）');

// 「她写的」那几句只能是她写的东西 —— 多写一条旁白就会被这里拦下：
// 翻开这本册子的是日记本界面，不是对话框，旁白框架不该写在节点里。
t.eq((DIARY.dialogues || []).length, 1, '日记节点严格只有一条台词');
t.eq((DIARY.dialogues || [])[0] && DIARY.dialogues[0].speaker, '西比拉的日记',
  '而且那一条就是她写的那一页');
t.eq((DIARY.dialogues || []).filter((d) => d.if).length, 0, '那一条上不挂 if，档位是 Stage 1 的事');
t.eq(DIARY.next, 'd1_end', '留着 next：脱链了也得有去处，不然会被当成第二个结局');
t.ok(!(INTRO.dialogues || []).some((d) => d.speaker === '西比拉的日记'),
  '「她写的」只在 d1_diary 里，交代那一段一句日记台词都不混');

// 摊开的时机是「最后一句播完之后」—— 这一条在浏览器里由 stage0.js 拦输入实现，
// 走查看不见那层。但它依赖的那个判据（diary.js 的 atLastLine）是纯函数，这里核死。
const introLines = (INTRO.dialogues || []).map((d) => d.text);
t.ok(introLines[introLines.length - 1].includes('把一本册子递了上来'),
  'intro 最后一句是她把册子递上来 —— 日记就摊在这一句之后');
t.ok(introLines[introLines.length - 2].includes('门又被敲响了'),
  '敲门在倒数第二句：她敲完，门开了，人才算进来');
const introJudge = new StoryEngine(story);
introJudge.start();
introJudge.enterNode('d1_diary_intro');
const marks = [];
for (let i = 0; i < introJudge.visibleLines().length; i++) {
  introJudge.advance();
  marks.push(Stage0Diary.atLastLine(introJudge, 'd1_diary_intro') ? '1' : '0');
}
const expectMarks = introLines.map((_, i) => (i === introLines.length - 1 ? '1' : '0')).join('');
t.eq(marks.join(''), expectMarks,
  `每一句都没播完，只有最后一句算（${introLines.length} 句：${expectMarks}）—— 早一句摊开会把最后那两句盖住`);
t.eq(marks.length, introLines.length, '判据是拿引擎真跑出来的，不是拼的');

// 兜底选项：d1_diary 脱链之后，「走不到」那条警告靠它消掉。
// 它必须**永远锁着、从不渲染**，走查把这两件事各核一遍。
const stub = (INTRO.choices || [])[0] || null;
t.ok(!!stub, 'intro 上挂着那个兜底选项');
t.eq((INTRO.choices || []).length, 1, '就一个，不许多挂');
t.eq(stub && stub.next, 'd1_diary', '兜底选项指向日记节点 —— 它存在的唯一理由就是这个');
const probe = new StoryEngine(story);
probe.start();
t.eq(probe.checkCondition(stub.if), false, '兜底选项的条件恒假（{any: []}）');
probe.enterNode('d1_diary_intro');
t.eq(probe.availableChoices().filter((c) => c.enabled).length, 0,
  '它永远是灰的（enabled === false），玩家点不动');
let sawStub = false;
let vProbe = null;
for (let i = 0; i < 200; i++) {
  vProbe = probe.advance();
  if (vProbe.type === 'line') continue;
  if (vProbe.type === 'choices') sawStub = true;
  break;
}
t.eq(sawStub, false, '而且它从不渲染：有 next 的节点根本走不到选项那一步（engine.js:620）');
t.eq(vProbe && vProbe.type, 'end', 'intro 走完直接结算');

// 正文不跟玩家走的证据：路线 A 和路线 B 做了完全不同的事，「她写的」是一模一样的
const noteOf = (id) => scriptLines(id).filter((l) => l.speaker === '西比拉的日记').map((l) => l.text).join('\n');
t.ok(noteOf('d1_diary').includes('我被安置在三楼'),
  '「她写的」是固定正文（甲案：抵达、分房归这一块）—— 只报事实，不解释、不表态');
t.ok(noteOf('d1_diary').includes('第X日') && noteOf('d1_diary').includes('天气，阴'),
  '签名行按固定格式收尾：西比拉，第X日，记，天气，阴。');
t.ok(noteOf('d1_diary').indexOf('\n') >= 0,
  '签名行另起一行（\\n）—— #diary-note 的 white-space: pre-line 把它显出来');

t.section('日记本 · 数据块');

const DB = story.diary || {};
t.eq(DB.title, '西比拉手记', '数据块有书名');
t.eq((DB.entries || []).length, 1, '第 1 天一条（多天是 Stage 1 的事）');
t.eq(DIARY_ENTRY.day, 1, '日期编号');
t.ok(!!DIARY_ENTRY.date && !!DIARY_ENTRY.weather, '那一页页眉该有的都有：日期、天气');
t.ok(['晴', '阴', '雨'].indexOf(DIARY_ENTRY.weather) >= 0,
  '天气是三个值里的一个，不是随便一个字符串');
t.ok(typeof DIARY_ENTRY.weather === 'string', '天气写死在数据里 —— 不引入随机，重读存档才不会变');
t.ok(!Object.keys(story.initialStats).some((k) => k.indexOf('天气') >= 0),
  '存档里根本没有天气这个字段，所以只能写死');
t.ok(!DIARY_ENTRY.events, '「今日事件」不再挂在数据块里 —— 它跟着选项走（choice.diary）');

t.section('日记本 · 事件从哪来（choice.diary）');

// --validate 只走节点，看不见 choice.diary 和 diary 数据块。这几条账由这里补：
// 文本挂在选项上，判定挂在记录旗上，两样必须一一配齐，配不齐的日子会漏记。
const diaryChoices = [];
for (const node of story.nodes) {
  for (const c of node.choices || []) if (c.diary !== undefined) diaryChoices.push({ node: node.id, c });
}
t.ok(diaryChoices.length >= 5, `四个时段都记过事了（带 diary 的选项 ${diaryChoices.length} 个）`);
t.empty(diaryChoices.filter((x) => typeof x.c.diary !== 'string' || !x.c.diary),
  'choice.diary 一律是字符串（条件式 variant 是 Stage 1 的事）');
t.empty(diaryChoices.filter((x) => /\d/.test(x.c.diary)),
  '事件文案里不许出现数字（跟 #toast 那条规矩一样）');
t.empty(diaryChoices.filter((x) => !(x.c.effects || []).some((e) => Stage0Diary.isRecordStat(e.stat))),
  '每个带 diary 的选项都挂了记录旗 —— 没挂就无从判断「今天记没记这一条」');
for (const x of diaryChoices) {
  for (const e of x.c.effects || []) {
    if (!Stage0Diary.isRecordStat(e.stat)) continue;
    t.ok(Object.prototype.hasOwnProperty.call(story.config.statLabels, e.stat),
      `「${x.node}」的 diary 判定用了已定义的数值「${e.stat}」`);
  }
}
// 「上午的课停没停」这一对是靠**值**分开的：一个写 1、一个写 0。
// 只认旗名不认值，两条会同时成立，那一天就会记成两笔。
const planDiary = diaryChoices.filter((x) => x.node === 'd1_plan');
t.eq(planDiary.length, 2, '【今日安排】那一对选项都带 diary（照常 / 停课）');
const planKeys = planDiary.map((x) => (x.c.effects || [])
  .filter((e) => Stage0Diary.isRecordStat(e.stat))
  .map((e) => e.stat + '=' + e.value).join());
t.eq(planKeys.sort().join(' | '), '旗_今日停课=0 | 旗_今日停课=1',
  '两条写的是同一个旗的 0 和 1 —— 玩家只能走一条，所以永远只有一条成立');
// 「照常」那条的 effects 是给日记当钥匙用的，写的是 0 —— 跟初始值一样，
// 算出来 delta 是 0，note 会被 applyEffects 过滤掉（engine.js:516），
// 所以界面上一个字都不会冒出来。这里把它钉死，免得以后有人「顺手」改成 1。
t.ok((planDiary.find((x) => x.c.text.includes('照常')).c.effects || [])
  .every((e) => !e.note), '「照常」那条钥匙不挂 note（其实挂了也不会显示，但别留这个坑）');

// 一个时段**可以**记多条（v3.2）：早晨既有「课照常 / 停课」那一笔，课上出了插曲时
// 还有那一笔。几条不是并排的几个格子，是按她今天走过的先后拼在一起，所以核两件事：
//   ① 时段只往前走（早晨 → 中午 → 午后 → 夜晚），不回头
//   ② 同一个时段里的几条，顺序 = 引擎 visited 里的先后
// 拿六条路线各验一遍（比只核数据强，「两条同时成立」这种错只有真跑完一天才看得出来）
for (const [name, s] of [['A', A], ['B', B], ['C', C], ['D', D], ['E', E], ['F', F]]) {
  const items = diaryItems(s);
  t.eq(items.length, items.filter((x) => SLOT_OF[x.node]).length,
    `路线 ${name}：每一条都认得自己属于哪个时段`);
  t.ok(items.every((x, i) => i === 0 || SLOT_RANK[items[i - 1].slot] <= SLOT_RANK[x.slot]),
    `路线 ${name}：时段只往前走，不回头`);
  t.ok(items.every((x, i) => i === 0
      || SLOT_RANK[items[i - 1].slot] < SLOT_RANK[x.slot]
      || visitOrder(s, items[i - 1].node) < visitOrder(s, items[i].node)),
    `路线 ${name}：同一时段里的几条，按她走过的先后拼在一起`);
}
t.eq(diaryItems(C).map((x) => x.slot).join(' → '), '早晨 → 中午', '路线 C：决斗算【中午】那一笔');

t.section('日记本 · 事件判定规则');

// 规则本身是 stage0/diary.js 里的纯函数，拿一份袖珍剧本直接单元测试，
// 不必真去凑一个「什么都没干」的日子。
// 值对了才记 —— 这是跟 v2 最大的区别：判据从「条件池 + 兜底条」变成了
// 「我写的那个旗，此刻是不是对得上」。
const MINI = {
  meta: { start: 'm_plan', title: '袖珍剧本' },
  config: {
    statLabels: { '旗_甲': '记录 · 甲', '决斗_战绩': '记录 · 决斗' },
    initialStats: { '旗_甲': 0, '决斗_战绩': 0 },
    statRanges: { '旗_甲': [0, 1], '决斗_战绩': [0, 9] },
    statOrder: [],
  },
  nodes: [
    { id: 'm_plan', dialogues: [], choices: [
      { text: '照常', next: 'h_morning', diary: '早晨 · 甲没动', effects: [{ stat: '旗_甲', value: 0 }] },
      { text: '挪开', next: 'h_morning', diary: '早晨 · 甲动了', effects: [{ stat: '旗_甲', value: 1 }] },
      { text: '没挂旗', next: 'h_morning', diary: '这句不该被收进来', effects: [] },
    ] },
    { id: 'h_morning', dialogues: [], choices: [{ text: '往下', next: 'h_noon' }] },
    { id: 'h_noon', dialogues: [], choices: [
      { text: '打一场', next: 'm_end', diary: '中午 · 打过了', effects: [{ stat: '决斗_战绩', value: 1 }] },
    ] },
    { id: 'm_end', dialogues: [], ending: true },
  ],
};
const mini = new StoryEngine(MINI);
mini.start();
t.eq(Stage0Diary.collect(MINI, mini).map((x) => x.text).join('|'), '早晨 · 甲没动',
  '旗还是 0 → 记「照常」那条；没挂旗的那条被跳过（无从判断）');
mini.stats['旗_甲'] = 1;
t.eq(Stage0Diary.collect(MINI, mini).map((x) => x.text).join('|'), '早晨 · 甲动了',
  '旗被改成 1 → 换成另一条，两条不会同时成立');
mini.stats['决斗_战绩'] = 1;
t.eq(Stage0Diary.collect(MINI, mini).map((x) => x.slot + '｜' + x.text).join(' / '),
  '早晨｜早晨 · 甲动了 / 中午｜中午 · 打过了',
  '两笔都有时按时段排（早晨在前），不是按点的先后');

t.section('日记本 · 存档');

// 日记不加任何字段：内容是从 stats 和节点现算的，所以重读存档天然就对。
const snapA = A.engine.snapshot();
t.ok(!Object.keys(snapA).some((k) => /日记|diary/i.test(k)),
  '存档里没有日记相关的字段（内容是现算的）');
t.ok(diaryItems(A).length >= 1, '随手一局也记得出事来');
// 存档只认 nodeId + stats + lineIndex（engine.js 的 snapshot），
// 「今天记了哪几条」全在那几个 0/1 的记录旗里 —— 所以读档之后翻开日记，
// 看到的就是那一天当时的样子。这就是「显性存档」。
t.eq(diaryItems(A).length, 2, 'A 记 2 条：早晨那一段（课照常 + 课堂插曲）');
t.eq(diaryItems(B).length, 3, 'B 记 3 条：停课 / 挪走洗衣房的活 / 打断备课');
t.ne(diaryItems(A).length, diaryItems(B).length,
  '记几条完全由旗子决定，不由那本册子决定');

/* ================================================================== */
/* 十、已知的架构问题（不影响本次验收，留给 Stage 1 决定）             */
/* ================================================================== */

t.section('架构问题清单');
problems.push('决斗只放在【中午】这一个 Hub 里 —— 这是设计决定（决斗固定在正午发起），不是引擎限制。引擎的 next 是写死的，没有「回到来的地方」这种动态返回点，所以真要改成全天任意时段可发起，得复制整条链或者动引擎。');
problems.push('可选的选项闸门（choices[].if）在界面上是灰按钮，不是消失。要做「这个时段这里没人」这种干净的菜单，得给引擎加过滤开关。');
problems.push('结局屏只报「此刻的绝对值」，报不了「今天涨了多少」。Stage 0 是靠 d1_end 里那几句按记录旗拼出来的叙述来当结算的。');
for (const p of problems) console.log('  ⚠ ' + p);
console.log(`  共 ${problems.length} 条，见上。`);

t.done();
