/**
 * 原文核对（机械检查，不靠人眼看）
 * =====================================================================
 *   node tests/fidelity.cjs
 *
 * 规矩：剧本里的每一句台词、每一句旁白，都必须是小说原文的原话，
 *       一个字都不许自己写。这个脚本就是拿来自动查这件事的。
 *
 * **按幕成对检查。** 第一幕的原文配第一幕的剧本，第二幕的原文配第二幕的剧本，
 * 各查各的。不把两份原文拼成一个大串 —— 拼起来会放松要求，第二幕漏掉的小句
 * 可能被第一幕的文字凑巧满足。
 *
 * 最后一对是 act1/story.json 配 act1/source/第一章剧本.txt（第一章重构稿上线后，
 * 第一幕就是这一份了；v1 那对已经下线 —— 拿新剧本去对旧原文只会全红）。
 * 这一份原文带制作标签（【布朗管家】【若选A】【数值面板 · 当前】、A./A1. 选项行、
 * 【第一章 · 数值结算】之后的四张表），所以它比别人多几条取舍规则，都写在那条
 * ACTS 记录上：skip 是「这行不是正文」，skipFrom 是「这行往后都不是正文」，
 * stripTag 是「把行首标签削掉、后面的字留下」。**只有这一对用这些规则**，
 * 第二、三幕一个字都没动 —— 原文那一侧的松紧一旦放开，正查（不许自编）就守不住了，
 * 所以松的只能是「反查」那一侧，正查永远拿完整的原文来对。
 *
 * 两道硬性检查（不过就是 bug）：
 *   正着查 —— 不许自己编：把剧本每一句切成小句，逐个到原文里找，找不到就是杜撰。
 *   反着查 —— 不许漏掉：  把原文每一句切成小句，逐个到剧本里找，找不到就是丢弃。
 *
 * 一道提示（不算失败）：
 *   剧本把原文切碎、按选项重排过（这是当初定下的设计：选项只决定
 *   「这次先看原文里的哪一个动作」，每个分支重播的就是对应的那一句原文），
 *   所以「阅读顺序」跟「原文顺序」本来就不一样。这里只把数量打出来供参考，
 *   不当成错——真正的红线是「不能有原文之外的字」。
 *
 * 说话人归属单独查：引号里的内容算谁说的，是重建时最容易搞错的。
 *   只在「紧挨着引号的地方」出现人名 + 说话动词时才判定，够近才敢下结论。
 */

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');

const ACTS = [
  {
    name: '第二幕',
    source: path.join(ROOT, 'act2', 'source', '普里森堡第二章.txt'),
    story: require(path.join(ROOT, 'act2', 'story.json')),
  },
  {
    name: '第三幕',
    source: path.join(ROOT, 'act3', 'source', '第三章.txt'),
    story: require(path.join(ROOT, 'act3', 'story.json')),
  },
  {
    // 第一章的原文。这一份是**带制作标签的剧本**，不是小说原文，
    // 所以要多几条取舍规则（只有这一对写了这几项，第二、三幕一个字都没动）：
    //   skip      行：标题、「时间：…」、A./A1. 选项行、数值面板、「【幕间 …】」小标题
    //   skipFrom  行：从「【第一章 · 数值结算】」起是四张表（数值/线索/关系/待处理事项），
    //                 按约定只作为游戏状态（面板 + 0/1 标记 + meta.pending），文字不进剧情
    //   stripTag    ：行首的 【…】 削掉——【若选A】你叫来一名仆人… 里的正文要留下
    //   tagSpeakers ：这份原文的归属写成【布朗管家】这种独立一行的小标题，见 tagSpeakerOf
    // 注意这几条只影响**反查**（原文的小句是不是都进了剧本）；正查仍然拿完整的
    // 原文来对，一个字都不放过。
    name: '第一章',
    source: path.join(ROOT, 'act1', 'source', '第一章剧本.txt'),
    story: require(path.join(ROOT, 'act1', 'story.json')),
    stripTag: /^【[^】]*】/,
    skip: [
      /^第一章[:：]/,
      /^幕[一二三四] · /,
      /^【幕间/,
      /^时间[:：]/,
      /^[A-D][0-9]?[.、]/,
      /^【数值面板/,
      /^西比拉(力量值|好感度|警惕度|亲密度)[:：]/,
      /（这里是选项/,       // 【奥布里】（这里是选项三得对话）——原文里的批注，不是台词
    ],
    skipFrom: /^【第一章 · 数值结算】/,
    tagSpeakers: true,
  },
];

const t = suite('原文核对');

/* ===================================================================
 * 切句
 * =================================================================== */

// 断句用的标点（引号不切，只从句子两头剥掉）
const BREAK = /[，。：；！？、,.;:!?—…／/]+/;
// 剥掉的外壳字符：小句里不带这些，比对原文时原文那一侧也要剥掉同样的字符，
// 否则原文里被引号括起来的一个词（比如床垫发出的「咔嚓」一声）会对不上
const SHELL = /[“”"'「」『』（）()《》〈〉]/g;

function toClauses(text) {
  return String(text)
    .split(BREAK)
    .map((s) => s.replace(SHELL, '').replace(/[\s　]/g, ''))
    .filter((s) => s.length >= 2);       // 太短的（切剩下的单字）不算，免得噪声淹掉真问题
}

const flat = (s) => String(s).replace(/[\s　]/g, '');
// 小句比对用的原文形态：连引号一起去掉
const bare = (s) => String(s).replace(SHELL, '').replace(/[\s　]/g, '');

/* ===================================================================
 * 说话人归属
 * =================================================================== */

const NAMES = ['西比拉', '布朗', '奥布里', '伊莎贝尔', '海尔', '士兵', '约翰'];
const SPEECH = '(?:说道|问道|答道|笑道|叫道|喊道|骂道|应道|叹道|道|说|问|答|叫|喊)';
// 人名和动词之间通常还夹着一段动作描写，可能带一个逗号：
//   「布朗管家皱着脸，没好气地说道：「…」」
// 但不许跨句号/问号/叹号，否则就窜到别的话里去了
const GAP = '[^。：；！？]{0,6}(?:，[^。：；！？]{0,6})?';
const SENT_END = /[。！？\n]/;

/**
 * 认出「这句话是谁说的」。宁可认不出来（返回 null），也不乱猜——
 * 猜错会把真问题淹在噪声里，那这道检查就白做了。
 *
 * 分工：
 *   后缀式「“…”奥布里问道。」—— 引号后面紧跟着，好认，直接认。
 *   前缀式「西比拉问道：“…”」 —— 难认。中文里人名的位置太活：
 *     「她将衣服从海尔手上拿下，笑着说：“…”」紧挨动词的是海尔，可海尔是宾语；
 *     「还是不见伊莎贝尔出来的身影，她终于开口说道：“…”」同理。
 *   所以前缀式**只认「名字就是这一句的主语」这一种情况**：
 *   名字必须正好落在一个句子的开头（前面是句号/叹号/问号/换行，或者整段开头），
 *   句子内部不许再有句读把它切开。这一条窄，但认出来的就是对的。
 */
function speakerOf(text, wholeSource) {
  const quote = flat(text);
  if (quote.length < 4) return null;
  const at = wholeSource.indexOf(quote);
  if (at < 0) return null;

  const before = wholeSource.slice(Math.max(0, at - 200), at);
  const after = wholeSource.slice(at + quote.length, at + quote.length + 28);

  // 后缀式：「…”奥布里问道。」
  // 必须自己收尾（后面跟句号/叹号）。否则多半是下一段的「X 问道：“…”」，
  // 比如「…布朗管家没有多说，带她…」里的「说」就不是归属。
  const post = after.match(new RegExp('^[”"\']?(' + NAMES.join('|') + ')' + GAP + SPEECH + '[。！]'));
  if (post) return post[1];

  // 前缀式：往前找到最近的一个句子结尾，只在那之后的那一句里认
  let cut = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    if (SENT_END.test(before[i])) { cut = i; break; }
  }
  // 找不到句子边界（这一句比 40 字还长），或者这个名字根本不在开头 —— 不下结论
  if (cut < 0) return null;
  const clause = before.slice(cut + 1);

  const m = clause.match(new RegExp('^(' + NAMES.join('|') + ')' + GAP + SPEECH + '[：:]?[“"\']?$'));
  return m ? m[1] : null;
}

/**
 * 【…】式剧本的归属：原文把说话人写成一行开头的小标题
 *      【布朗管家】
 *      “西比拉小姐真是个善心人，主一定会保佑你的。”
 * 台词往前找最近的一个**行首标签**（【奥布里】（这里是选项三得对话） 这种
 * 标签后面还跟着批注的，标签照样算数），标签里只出现一个人名才算数。
 * 两条保守的额外条件：
 *   · 标签里出现两个名字（【西比拉 & 布朗】）—— 一句台词记两个人，不下结论；
 *   · 标签比人名长出一大截（【幕间 · 奥布里视角 · 第一章结算】）—— 那是小标题，
 *     不是「谁在说话」。人名后头跟个身份后缀（布朗管家）才算说话人。
 *   · 最近的那个标签认不出来就停手，不再往前翻（翻过去只会认成别人）。
 * 只有 act.tagSpeakers 的幕走这条路；别的幕行为跟以前一模一样。
 *
 * 传进来的原文是 act.tagSource：**完整**原文，被 skip 掉的排版行也在里面 ——
 * 标签恰恰长在那些行上，不能跟着被 skip 掉。
 */
function tagSpeakerOf(text, wholeSource) {
  const quote = flat(text);
  if (quote.length < 4) return null;
  const at = wholeSource.indexOf(quote);
  if (at < 0) return null;

  const before = wholeSource.slice(0, at).split('\n');
  for (let i = before.length - 1; i >= 0; i--) {
    const m = before[i].match(/^【([^】]+)】/);
    if (!m) continue;
    const tag = m[1];
    const hits = NAMES.filter((n) => tag.includes(n));
    if (hits.length === 1 && tag.length <= hits[0].length + 3) return hits[0];
    return null;                      // 最近的那个标签认不出来，就不再往前翻
  }
  return null;
}

/* ===================================================================
 * 逐幕核对
 * =================================================================== */

let totalChecked = 0;
let totalClauses = 0;

for (const act of ACTS) {
  const scriptLines = [];
  for (const node of act.story.nodes) {
    (node.dialogues || []).forEach((d, i) => {
      scriptLines.push({ node: node.id, index: i, speaker: d.speaker, text: d.text });
    });
  }

  const sourceText = fs.readFileSync(act.source, 'utf8');
  const rawLines = sourceText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // 制作标签先按 act 上的规则挑掉（v1 的三幕没写这几项，等于一行不删）。
  const keptLines = [];
  for (const line of rawLines) {
    if (act.skipFrom && act.skipFrom.test(line)) break;
    if (act.skip && act.skip.some((r) => r.test(line))) continue;
    keptLines.push(line);
  }
  // 反查用的正文：行首标签削掉，剩下的才是原文的字
  const sourceLines = keptLines
    .map((l) => (act.stripTag ? l.replace(act.stripTag, '').trim() : l))
    .filter(Boolean);
  const sourceClauses = [];
  sourceLines.forEach((line, i) => toClauses(line).forEach((c) => sourceClauses.push({ clause: c, line: i + 1 })));

  // 段落之间保留换行当句子边界，段内不留空白。
  // 这一份带着【…】标签：说话人归属要靠它们（tagSpeakerOf），所以标签不能削。
  act.wholeSource = keptLines.map(flat).join('\n');
  const wholeSource = act.wholeSource;
  // 归属用的那一份：**完整**原文，连被 skip 掉的标签行一起。
  // 标签就长在那些行上（【奥布里】（这里是选项三得对话）），跟正文一起被 skip 掉就白瞎了。
  act.tagSource = rawLines.map(flat).join('\n');
  // 正查拿的是**完整**原文（连 skipFrom 之后的部分一起）：那一侧越宽松，
  // 「不许自编」就越守不住。skip / stripTag 只让反查那一侧松手。
  const bareSource = bare(rawLines.map(flat).join('\n'));
  const bareScript = bare(scriptLines.map((l) => l.text).join(''));

  t.section(`${act.name} · 材料`);
  t.ok(sourceLines.length > 40, `${act.name}原文 ${sourceLines.length} 段、${sourceText.length} 字`);
  t.ok(scriptLines.length > 100, `${act.name}剧本 ${scriptLines.length} 行台词/旁白`);
  t.ok(sourceClauses.length > 200, `${act.name}原文切出 ${sourceClauses.length} 个小句`);
  totalClauses += sourceClauses.length;

  /* ---- 正着查：不许自己编 ---- */

  const invented = [];
  let verbatim = 0;
  let partial = 0;

  for (const line of scriptLines) {
    const mine = flat(line.text);
    if (!mine) continue;
    for (const c of toClauses(line.text)) {
      if (!bareSource.includes(c)) {
        invented.push(`${line.node} 第${line.index + 1}行「${c}」——原文里找不到（整行：${line.text}）`);
      }
    }
    if (bareSource.includes(bare(mine))) verbatim++; else partial++;
  }

  t.section(`${act.name} · 正着查：不许自己编`);
  t.empty(invented, '每一句都能在原文里逐字找到（没有杜撰）');
  t.ok(verbatim > 0, `其中 ${verbatim} 行整行逐字照搬`);

  /* ---- 反着查：不许漏掉 ---- */

  const dropped = [];
  for (const { clause, line } of sourceClauses) {
    if (!bareScript.includes(clause)) dropped.push(`原文第 ${line} 段「${clause}」在剧本里找不到`);
  }

  t.section(`${act.name} · 反着查：不许漏掉`);
  t.empty(dropped, `原文的 ${sourceClauses.length} 个小句，剧本里全都有（没有丢弃）`);

  /* ---- 提示：重播与重排 ---- */

  let cursor = 0;
  let reordered = 0;
  for (const line of scriptLines) {
    const pos = toClauses(line.text)
      .map((c) => wholeSource.indexOf(c))
      .filter((p) => p >= 0);
    if (!pos.length) continue;
    if (Math.min(...pos) < cursor) reordered++;
    cursor = Math.max(cursor, ...pos);
  }
  console.log(`  · ${verbatim} 行整行照搬，${partial} 行是原文的一部分（省略了中间的从句，省掉的也是原文）`);
  console.log(`  · ${reordered} 行落在原文更靠前的位置 —— 分支重播对应那一句原文，属于当初定下的设计`);

  /* ---- 说话人 ---- */

  t.section(`${act.name} · 说话人`);

  const suspicious = [];
  let checked = 0;

  for (const line of scriptLines) {
    if (line.speaker === '旁白') continue;
    let who = speakerOf(line.text, wholeSource);
    if (!who && act.tagSpeakers) who = tagSpeakerOf(line.text, act.tagSource);
    if (!who) continue;                         // 原文这里没写清楚「谁说的」，不下结论

    checked++;
    if (who !== line.speaker) {
      suspicious.push(`${line.node}「${line.text.slice(0, 18)}…」记在 ${line.speaker} 名下，但原文紧挨着写的是 ${who}`);
    }
  }

  t.empty(suspicious, '每句台词的说话人和原文紧挨着的名字对得上（没有把话安到别人头上）');
  t.ok(checked >= 8, `能直接认出说话人的句子够多（${checked} 句），这道检查不是空转`);
  totalChecked += checked;
}

/* ===================================================================
 * 这道检查自己也要验一下，免得哪天正则失效、什么都认不出来还假装通过
 * =================================================================== */

t.section('检查器自检');
// 自检的语料直接读原文，不跟 ACTS 挂钩：第一幕那对已经从核对清单里下线了
// （v1 的剧本不在仓库里了），但 speakerOf 那几条例子是照着第一幕的句子写的，
// 留着当样本才验得出前缀式 / 后缀式归属还认不认得出。
const fixture = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map(flat).join('\n');
const whole1 = fixture('act1/source/第一幕原文.txt');
const whole2 = fixture('act2/source/普里森堡第二章.txt');
t.eq(speakerOf('伯爵大人不禁止仆人们喝酒吗？', whole1), '西比拉', '前缀式归属认得出（西比拉问道：“…”）');
t.eq(speakerOf('难道就没有人将你买下过吗？', whole1), '奥布里', '后缀式归属认得出（“…”奥布里问道。）');
t.eq(speakerOf('这群该死的佣兵！', whole1), '布朗', '「布朗站在原地，向西比拉抱怨道」——西比拉是听话的人，说话的是布朗');
t.eq(speakerOf('原来如此。', whole1), '西比拉', '跨逗号也认得出（「西比拉听在耳里，点着头说道：“…”」）');
t.eq(speakerOf('海尔，谢谢你，你现在还有事要做吗？', whole2), null, '「她将衣服从海尔手上拿下，笑着说：」——海尔是宾语，不乱认说话人');
t.eq(speakerOf('是西比拉小姐太严厉了！我感觉她随时准备打我。', whole2), null, '「转过头指着西比拉辩解道：」——西比拉是宾语，不乱认说话人');

const draft = ACTS.find((a) => a.tagSpeakers);
t.eq(tagSpeakerOf('管家先生，你们终于到了。', draft.tagSource), '海尔', '【】式剧本：台词归最近的上一个【标签】（【海尔】）');
t.eq(tagSpeakerOf('伯爵大人。', draft.tagSource), null, '【西比拉 & 布朗】两个人一起的标签不下结论');
t.eq(tagSpeakerOf('这是句假话。你从学习走路开始', draft.tagSource), null, '标签认不出来时不往前翻别的标签');
t.eq(tagSpeakerOf('西比拉小姐，作为奥布里大人新买下的仆人，你对于路途延期似乎很不在意呢。', draft.tagSource), '布朗', '【布朗管家】——人名后面跟个身份后缀也算数');
t.eq(tagSpeakerOf('伊莎贝尔，再坚持一会儿，老师还没来呢。', draft.tagSource), '奥布里', '标签后面跟着批注（【奥布里】（这里是…））也照样算数');
console.log(`  · 各幕合计认出 ${totalChecked} 句的说话人，逐句核对了归属（认不出的不下结论）`);

t.done();
