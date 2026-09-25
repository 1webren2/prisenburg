/**
 * 原文核对（机械检查，不靠人眼看）
 * =====================================================================
 *   node tests/fidelity.cjs
 *
 * 规矩：剧本里的每一句台词、每一句旁白，都必须是小说原文的原话，
 *       一个字都不许自己写。这个脚本就是拿来自动查这件事的。
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
const SOURCE_FILE = path.join(ROOT, 'act1', 'source', '第一幕原文.txt');
const story = require(path.join(ROOT, 'act1', 'story.json'));

const t = suite('原文核对');

/* ===================================================================
 * 切句
 * =================================================================== */

// 断句用的标点（引号不切，只从句子两头剥掉）
const BREAK = /[，。：；！？、,.;:!?—…／/]+/;

function toClauses(text) {
  return String(text)
    .split(BREAK)
    .map((s) => s.replace(/[“”"'「」『』（）()《》〈〉\s　]/g, ''))
    .filter((s) => s.length >= 2);       // 太短的（切剩下的单字）不算，免得噪声淹掉真问题
}

const flat = (s) => String(s).replace(/[\s　]/g, '');

/** 剧本里所有台词，按节点顺序（节点内部也是播出的顺序） */
const scriptLines = [];
for (const node of story.nodes) {
  (node.dialogues || []).forEach((d, i) => {
    scriptLines.push({ node: node.id, index: i, speaker: d.speaker, text: d.text });
  });
}

const sourceText = fs.readFileSync(SOURCE_FILE, 'utf8');
const sourceLines = sourceText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const sourceClauses = [];
sourceLines.forEach((line, i) => toClauses(line).forEach((c) => sourceClauses.push({ clause: c, line: i + 1 })));

t.ok(sourceLines.length > 40, `读到了原文（${sourceLines.length} 段，${sourceText.length} 字）`);
t.ok(scriptLines.length > 100, `剧本里有 ${scriptLines.length} 行台词/旁白`);
t.ok(sourceClauses.length > 200, `原文切出 ${sourceClauses.length} 个小句`);

const wholeSource = flat(sourceText);
const wholeScript = scriptLines.map((l) => flat(l.text)).join('');

/* ===================================================================
 * 正着查：不许自己编
 * =================================================================== */

const invented = [];
let verbatim = 0;
let partial = 0;

for (const line of scriptLines) {
  const mine = flat(line.text);
  if (!mine) continue;

  for (const c of toClauses(line.text)) {
    if (!wholeSource.includes(c)) {
      invented.push(`${line.node} 第${line.index + 1}行「${c}」——原文里找不到（整行：${line.text}）`);
    }
  }
  if (wholeSource.includes(mine)) verbatim++; else partial++;
}

t.section('正着查：不许自己编');
t.empty(invented, '剧本里的每一句都能在原文里逐字找到（没有杜撰）');
t.ok(verbatim > 0, `其中 ${verbatim} 行整行逐字照搬`);

/* ===================================================================
 * 反着查：不许漏掉
 * =================================================================== */

const dropped = [];
for (const { clause, line } of sourceClauses) {
  if (!wholeScript.includes(clause)) dropped.push(`原文第 ${line} 段「${clause}」在剧本里找不到`);
}

t.section('反着查：不许漏掉');
t.empty(dropped, `原文的 ${sourceClauses.length} 个小句，剧本里全都有（没有丢弃）`);

/* ===================================================================
 * 提示：重播与重排
 * =================================================================== */

t.section('提示（不算失败）');

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

/* ===================================================================
 * 说话人归属
 * =================================================================== */

t.section('说话人');

const NAMES = ['西比拉', '布朗', '奥布里', '伊莎贝尔', '海尔', '士兵', '约翰'];
const SPEECH = '(?:说道|问道|答道|笑道|叫道|喊道|骂道|应道|叹道|道|说|问|答|叫|喊)';
// 人名和动词之间通常还夹着一段动作描写，可能带一个逗号：
//   「布朗管家皱着脸，没好气地说道：「…」」
// 但不许跨句号/问号/叹号，否则就窜到别的话里去了
const GAP = '[^。：；！？]{0,6}(?:，[^。：；！？]{0,6})?';
const TO_LISTENER = /[向对朝冲跟和与]/;        // 「向X说道」里的 X 是听话的人，不是说话的人

/**
 * 认出「这句话是谁说的」。宁可认不出来（返回 null），也不乱猜——
 * 猜错会把真问题淹在噪声里，那这道检查就白做了。
 */
function speakerOf(text) {
  const quote = flat(text);
  if (quote.length < 4) return null;
  const at = wholeSource.indexOf(quote);
  if (at < 0) return null;

  const before = wholeSource.slice(Math.max(0, at - 28), at);
  const after = wholeSource.slice(at + quote.length, at + quote.length + 28);

  // 后缀式：「…”奥布里问道。」
  // 必须自己收尾（后面跟句号/叹号）。否则多半是下一段的「X 问道：“…”」，
  // 比如「…布朗管家没有多说，带她…」里的「说」就不是归属。
  const post = after.match(new RegExp('^[”"\']?(' + NAMES.join('|') + ')' + GAP + SPEECH + '[。！]'));
  if (post) return post[1];

  // 前缀式：「西比拉问道：“…」
  // 取「离动词最近」的那个名字，不是最左边那个：
  //   「…看了西比拉一眼，奥布里说道：“…”」说的是奥布里，不是西比拉。
  // 正则被 $ 钉死在末尾，exec 只能找到最左的那个，所以这里逐个起点试。
  const preRe = new RegExp('^(' + NAMES.join('|') + ')' + GAP + SPEECH + '[：:]?[“"\']?$');
  let hit = null;
  for (let i = 0; i < before.length; i++) {
    const m = before.slice(i).match(preRe);
    if (m) hit = { name: m[1], index: i };      // 起点越靠后越接近动词，覆盖掉前面的
  }
  if (!hit) return null;

  // 「向西比拉抱怨道」「对西比拉身旁的布朗管家说道」——名字是听话的人，不认
  if (TO_LISTENER.test(before.slice(Math.max(0, hit.index - 12), hit.index))) return null;
  return hit.name;
}

const suspicious = [];
let checked = 0;

for (const line of scriptLines) {
  if (line.speaker === '旁白') continue;
  const who = speakerOf(line.text);
  if (!who) continue;                         // 原文这里没写清楚「谁说的」，不下结论

  checked++;
  if (who !== line.speaker) {
    suspicious.push(`${line.node}「${line.text.slice(0, 18)}…」记在 ${line.speaker} 名下，但原文紧挨着写的是 ${who}`);
  }
}

t.empty(suspicious, '每句台词的说话人和原文紧挨着的名字对得上（没有把话安到别人头上）');

// 这道检查本身也要验一下，免得哪天正则失效、什么都认不出来还假装通过
t.eq(speakerOf('伯爵大人不禁止仆人们喝酒吗？'), '西比拉', '前缀式归属认得出（西比拉问道：“…”）');
t.eq(speakerOf('难道就没有人将你买下过吗？'), '奥布里', '后缀式归属认得出（“…”奥布里问道。）');
t.eq(speakerOf('这群该死的佣兵！'), null, '「向西比拉抱怨道」认成听话的人，不乱认说话人');
t.eq(speakerOf('原来如此。'), '西比拉', '跨逗号也认得出（「西比拉听在耳里，点着头说道：“…”」）');
console.log(`  · 其中 ${checked} 句能从原文直接认出「谁说的」，逐句核对了归属（认不出的不下结论）`);
t.ok(checked >= 8, `能直接认出说话人的句子够多（${checked} 句），这道检查不是空转`);

t.done();
