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
    name: '第一幕',
    source: path.join(ROOT, 'act1', 'source', '第一幕原文.txt'),
    story: require(path.join(ROOT, 'act1', 'story.json')),
  },
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

/* ===================================================================
 * 逐幕核对
 * =================================================================== */

let totalChecked = 0;
let totalClauses = 0;
const act1 = ACTS[0];

for (const act of ACTS) {
  const scriptLines = [];
  for (const node of act.story.nodes) {
    (node.dialogues || []).forEach((d, i) => {
      scriptLines.push({ node: node.id, index: i, speaker: d.speaker, text: d.text });
    });
  }

  const sourceText = fs.readFileSync(act.source, 'utf8');
  const sourceLines = sourceText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const sourceClauses = [];
  sourceLines.forEach((line, i) => toClauses(line).forEach((c) => sourceClauses.push({ clause: c, line: i + 1 })));

  // 段落之间保留换行当句子边界，段内不留空白
  act.wholeSource = sourceLines.map(flat).join('\n');
  const wholeSource = act.wholeSource;
  const bareSource = bare(wholeSource);
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
    const who = speakerOf(line.text, wholeSource);
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
const whole1 = act1.wholeSource;
const whole2 = ACTS[1].wholeSource;
t.eq(speakerOf('伯爵大人不禁止仆人们喝酒吗？', whole1), '西比拉', '前缀式归属认得出（西比拉问道：“…”）');
t.eq(speakerOf('难道就没有人将你买下过吗？', whole1), '奥布里', '后缀式归属认得出（“…”奥布里问道。）');
t.eq(speakerOf('这群该死的佣兵！', whole1), '布朗', '「布朗站在原地，向西比拉抱怨道」——西比拉是听话的人，说话的是布朗');
t.eq(speakerOf('原来如此。', whole1), '西比拉', '跨逗号也认得出（「西比拉听在耳里，点着头说道：“…”」）');
t.eq(speakerOf('海尔，谢谢你，你现在还有事要做吗？', whole2), null, '「她将衣服从海尔手上拿下，笑着说：」——海尔是宾语，不乱认说话人');
t.eq(speakerOf('是西比拉小姐太严厉了！我感觉她随时准备打我。', whole2), null, '「转过头指着西比拉辩解道：」——西比拉是宾语，不乱认说话人');
console.log(`  · 各幕合计认出 ${totalChecked} 句的说话人，逐句核对了归属（认不出的不下结论）`);

t.done();
