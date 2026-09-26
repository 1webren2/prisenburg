/**
 * 第一幕 · Node 终端入口（命令行 + ANSI 终端渲染器）
 * =====================================================================
 * 这个文件只做两件事：把引擎画到终端里、解析命令行参数。剧情规则一行都没有，
 * 全在 engine.js 里（那是纯逻辑，浏览器和 Node 都能跑）。
 *
 *   node act1/game.js                 在终端里玩（上下左右不用管，按数字选）
 *   node act1/game.js --validate      剧本自检：节点、结局、可达性、自由活动数据
 *   node act1/game.js --auto 1,2,1    自动按指定选项跑一遍（空位自动选第一个可用项）
 *   node act1/game.js --no-color      关掉 ANSI 颜色（画不出真彩色时用）
 *   node act1/game.js --story 别的.json
 *
 * 网页那一侧完全不加载这个文件：index.html 只引 engine.js + ui.js。
 */
'use strict';

const {
  StoryEngine,
  buildPixelArt,
  composeStories,
  wrapCJK,
  displayWidth,
  clamp,
  padTo,
} = require('./engine.js');

/* ===================================================================
 * 1. 终端渲染器（ANSI 真彩色画像素块）
 * =================================================================== */

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
};

const RAMP = ' .:-=+*#%@';   // 关掉颜色时的替代方案

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

class ConsoleRenderer {
  constructor(engine, options) {
    const opts = options || {};
    this.engine = engine;
    this.color = opts.color !== undefined ? !!opts.color : true;
    this.clear = opts.clear !== false;
    this.boxWidth = opts.boxWidth || 58;
    this.out = opts.out || ((s) => process.stdout.write(s));
    this.last = null;         // 最近一次的错误 / 提示
    this.dataPath = opts.dataPath || null;
  }

  /* ---- 绘制像素块 ---- */
  paint(art, indent) {
    if (!art) return '';
    if (!Array.isArray(art.matrix)) {
      // 传进来的多半是 story.json 里的素材定义，忘了过 pixelArt()
      throw new Error('paint() 需要 buildPixelArt() 生成的图（要有 matrix），请用 engine.pixelArt(key)');
    }
    const lines = [];
    const pad = indent || '';
    for (const row of art.matrix) {
      let s = pad;
      if (this.color) {
        let current = null;
        for (const cell of row) {
          if (cell === null || cell === undefined) {
            if (current !== null) { s += ANSI.reset; current = null; }
            s += ' ';
            continue;
          }
          if (cell !== current) {
            const [r, g, b] = hexToRgb(cell);
            s += `\x1b[38;2;${r};${g};${b}m`;
            current = cell;
          }
          s += '█';
        }
        s += ANSI.reset;
      } else {
        for (const cell of row) {
          if (cell === null || cell === undefined) { s += ' '; continue; }
          s += RAMP[clamp(Math.round(luminance(cell) * (RAMP.length - 1)), 0, RAMP.length - 1)];
        }
      }
      lines.push(s);
    }
    return lines.join('\n') + '\n';
  }

  box(lines, opts) {
    const width = this.boxWidth;
    const title = (opts && opts.title) || '';
    const top = title
      ? '┌─ ' + title + ' ' + '─'.repeat(Math.max(0, width - displayWidth(title) - 4)) + '┐'
      : '┌' + '─'.repeat(width) + '┐';
    const body = lines.map((l) => '│ ' + padTo(l, width - 2) + ' │').join('\n');
    return top + '\n' + body + '\n' + '└' + '─'.repeat(width) + '┘';
  }

  /* ---- 主渲染 ---- */
  render(view) {
    const e = this.engine;

    // 背景：line 视图自带 context，choices / end 视图没有，就现取。
    // 注意 currentArt() 给的是 story.json 里的素材定义（key + 尺寸 + 调色板），
    // 真正的像素矩阵要用 pixelArt(key) 生成。
    const art = view.context || e.currentArt();
    const bgArt = art.bg ? e.pixelArt(art.bg) : null;
    // 立绘：说话人有立绘就换（同一节点里换人说话就换脸），旁白沿用节点立绘
    const portraitArt =
      (view.type === 'line' && !view.narration && view.portrait && e.pixelArt(view.portrait)) ||
      (art.portrait ? e.pixelArt(art.portrait) : null);

    const parts = [];
    if (this.clear) parts.push('\x1b[2J\x1b[H');
    parts.push(this.paint(bgArt, '  '));

    // 标题条
    const title = e.currentTitle();
    const povName = e.povInfo.displayName || e.pov || '';
    parts.push(
      '  ' + ANSI.bold + title + ANSI.reset +
      '   ' + ANSI.dim + '视角：' + povName + ANSI.reset +
      '   ' + ANSI.dim + `${e.history.length} 步` + ANSI.reset
    );

    // 视角提示：只在刚切换的那一个节点显示
    if (e.povSwitchInfo) {
      parts.push('');
      parts.push('  ' + ANSI.bold + '◆ ' + e.povSwitchInfo.line + ANSI.reset);
      const hint = (e.povInfo && e.povInfo.hint) || '';
      if (hint) parts.push('  ' + ANSI.dim + '  ' + wrapCJK(hint, this.boxWidth + 4).join('\n    ') + ANSI.reset);
    }

    // 数值面板
    if (e.showStats) parts.push('', this.statsBox());

    // 立绘 + 对话框
    parts.push('');
    if (portraitArt) parts.push(this.paint(portraitArt, '  '));

    if (view.type === 'line') {
      const speaker = view.narration ? '' : view.name;
      const text = wrapCJK(view.line.text, this.boxWidth - 2);
      parts.push(this.box(text, { title: speaker }));
      parts.push('  ' + ANSI.dim + `[${view.index + 1}/${view.total}]` + ANSI.reset);
    } else if (view.type === 'choices' || view.type === 'outfit') {
      const isOutfit = view.type === 'outfit';
      parts.push('  ' + ANSI.bold + (isOutfit ? `${view.title}：` : '你的选择：') + ANSI.reset);
      if (isOutfit) {
        const who = view.roomName ? `（${view.roomName}）` : '';
        parts.push(`    现在穿着：${ANSI.bold}${view.outfitLabel || view.outfit || '——'}${ANSI.reset}${who}` + (view.full ? '   ' + ANSI.dim + view.full + ANSI.reset : ''));
      }
      for (const c of view.choices) {
        const num = `[${c.index + 1}]`;
        const tag = c.worn ? ANSI.dim + '（现在就穿着这套）' + ANSI.reset : '';
        if (c.enabled) {
          parts.push(`    ${ANSI.bold}${num}${ANSI.reset} ${c.text}${c.hint ? '  ' + ANSI.dim + c.hint + ANSI.reset : ''}${tag}`);
        } else {
          parts.push(`    ${ANSI.dim}${num} ${c.text}  🔒 ${c.lockedHint}${ANSI.reset}`);
        }
      }
    } else if (view.type === 'end') {
      // 结局文案跟着节点走 —— 第二幕之后就不再是「第一幕 · 完」了
      const endTitle = (view.node && view.node.title) || '完';
      parts.push(this.box(wrapCJK(endTitle + '。', this.boxWidth - 2), { title: '完' }));
      parts.push(this.statsBox());
      if (view.node && view.node.continueTo) {
        parts.push('  ' + ANSI.bold + `▶ 还有下一幕（${view.node.continueTo}）` + ANSI.reset);
      }
    }

    // 隐藏数值时，把「感觉」显示在最下面
    if (view.notes && view.notes.length) {
      parts.push('');
      for (const n of view.notes) parts.push('  ' + ANSI.italic + ANSI.dim + '· ' + n + ANSI.reset);
    }

    if (this.last) parts.push('  ' + ANSI.bold + this.last + ANSI.reset);

    parts.push('');
    parts.push('  ' + ANSI.dim + this.helpText(view) + ANSI.reset);
    this.out(parts.join('\n') + '\n');
  }

  statsBox() {
    const e = this.engine;
    const lines = [];
    if (!e.showStats) {
      lines.push('数值已隐藏 —— 按 V 查看');
    } else {
      for (const s of e.statPanel()) {
        lines.push(padTo(s.label, 30) + ' ' + padTo(s.display, 4) + ' ' + s.bar);
      }
    }
    return this.box(lines, { title: '内心' });
  }

  helpText(view) {
    if (view.type === 'choices' || view.type === 'outfit') return '输入数字选择   V=查看数值   R=重来   Q=退出';
    if (view.type === 'end') return 'R=重来   Q=退出';
    return '回车=继续   V=查看数值   R=重来   Q=退出';
  }
}

/* ===================================================================
 * 2. Node 命令行入口
 * =================================================================== */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-color') out.color = false;
    else if (a === '--no-clear') out.clear = false;
    else if (a === '--stats') out.showStats = true;
    else if (a === '--validate') out.validate = true;
    else if (a === '--auto') out.auto = argv[++i];
    else if (a === '--story') out.story = argv[++i];
    else out._.push(a);
  }
  return out;
}

/**
 * 顺着 meta.continues 把后续几幕的 story.json 都读进来（Node 侧走 fs）。
 * 入口那一幕的 continues 是相对它自己的路径写的，所以逐幕解相对路径。
 */
function loadStories(fs, path, entryPath) {
  const stories = [];
  const done = new Set();
  const queue = [path.resolve(entryPath)];
  while (queue.length) {
    const p = queue.shift();
    if (done.has(p)) continue;
    done.add(p);
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    stories.push(s);
    for (const rel of ((s.meta || {}).continues || [])) {
      queue.push(path.resolve(path.dirname(p), rel));
    }
  }
  return stories;
}

function main(argv) {
  /* eslint-disable global-require */
  const fs = require('fs');
  const path = require('path');
  const readline = require('readline');
  /* eslint-enable global-require */

  const args = parseArgs(argv);
  const storyPath = args.story || path.join(__dirname, 'story.json');

  let stories;
  try {
    stories = loadStories(fs, path, storyPath);
  } catch (err) {
    console.error(`[错误] 读不出剧本 ${storyPath}：${err.message}`);
    process.exit(1);
  }
  const story = stories.length > 1 ? composeStories(stories) : stories[0];

  const engine = new StoryEngine(story, { showStats: !!args.showStats });

  // ---- 自检模式 ----
  if (args.validate) {
    const r = engine.validate();
    console.log(`剧本：${storyPath}`);
    console.log(`节点 ${r.stats.nodes} 个，结局 ${r.stats.endings.length} 个，视角 ${r.stats.povs.join(' / ')}`);
    if (r.warnings.length) {
      console.log(`\n提醒（${r.warnings.length}）：`);
      for (const w of r.warnings) console.log('  · ' + w);
    }
    if (r.errors.length) {
      console.log(`\n错误（${r.errors.length}）：`);
      for (const e of r.errors) console.log('  ✗ ' + e);
      process.exit(1);
    }
    console.log('\n自检通过 ✅');
    return;
  }

  // ---- 自动跑一遍（用来验证分支，不交互）----
  if (args.auto !== undefined) {
    runAuto(engine, args.auto, { quiet: true });
    return;
  }

  // ---- 交互模式 ----
  const renderer = new ConsoleRenderer(engine, {
    color: args.color !== false,
    clear: args.clear !== false,
    dataPath: path.join(__dirname, 'save_snapshot.json'),
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdout.isTTY });

  let view = null;
  let notes = [];

  function step() {
    const e = engine;
    if (!e.node) { e.start(); notes = []; }
    let r = e.advance();

    if (r.type === 'end') {
      view = r;
      renderer.render(view);
      return;
    }
    if (r.type === 'choices') {
      view = r;
      renderer.render(view);
      return;
    }
    view = r;
    renderer.render(view);
  }

  rl.on('line', (raw) => {
    const input = String(raw).trim();
    const lower = input.toLowerCase();
    renderer.last = null;

    if (lower === 'q') { rl.close(); return; }

    if (lower === 'v') {
      const on = engine.toggleStats();
      renderer.last = on ? '显示真实数值' : '隐藏数值（只看感觉）';
      renderer.render(view || { type: 'line', line: { text: '' }, index: 0, total: 0 });
      return;
    }

    if (lower === 'p') {
      // 剧情中途暂停 ↔ 回到剧情（和网页版的 P 键同一条链路）
      const res = engine.paused ? engine.resumeFromStory() : engine.pauseToStory();
      if (!res.ok) { renderer.last = '这会儿按不了暂停'; renderer.render(view); return; }
      notes = [];
      view = engine.advance();
      renderer.render(view);
      return;
    }

    if (lower === 'r') {
      engine.start();
      notes = [];
      view = engine.advance();
      renderer.render(view);
      return;
    }

    if (lower === 's') {
      try {
        fs.writeFileSync(renderer.dataPath, JSON.stringify(engine.snapshot(), null, 2), 'utf8');
        renderer.last = `已存档到 act1/${path.basename(renderer.dataPath)}`;
      } catch (err) { renderer.last = '存档失败：' + err.message; }
      renderer.render(view);
      return;
    }

    if (lower === 'l') {
      try {
        const snap = JSON.parse(fs.readFileSync(renderer.dataPath, 'utf8'));
        engine.restore(snap);
        notes = [];
        view = engine.advance();
        renderer.render(view.type ? view : { type: 'line', line: { text: '' }, index: 0, total: 0 });
      } catch (err) { renderer.last = '读档失败：' + err.message; renderer.render(view); }
      return;
    }

    if (view && view.type === 'choices') {
      const n = Number(input);
      if (!Number.isInteger(n) || n < 1 || n > view.choices.length) {
        renderer.last = `请输入 1~${view.choices.length}`;
        renderer.render(view);
        return;
      }
      const res = engine.choose(n - 1);
      if (!res.ok) {
        renderer.last = res.reason === 'locked' ? `还不能选：${res.lockedHint}` : '选不了这个';
        renderer.render(view);
        return;
      }
      notes = res.notes || [];
      view = engine.advance();
      renderer.render(view);
      return;
    }

    // 台词推进
    if (view && view.type === 'end') { renderer.render(view); return; }
    view = engine.advance();
    if (view.type !== 'choices' && view.type !== 'end') notes = [];
    renderer.render(view);
  });

  rl.on('close', () => { process.stdout.write('\n'); process.exit(0); });

  console.log('第一幕 · 沃伯爵的府邸');
  console.log(engine.validate().ok ? '' : '(剧本自检有错误，见 --validate)');
  console.log('回车继续，数字选择，V 看数值，Q 退出。\n');
  step();
}

/** 自动跑：choices 形如 "1,2,1,3"，空位自动选第一个可用项 */
function runAuto(engine, script, opts) {
  const quiet = !opts || opts.quiet !== false;
  const picks = String(script).split(',').map((s) => s.trim()).filter((s) => s !== '');
  let pickIndex = 0;
  let guard = 0;
  const log = [];

  engine.start();
  for (;;) {
    if (guard++ > 2000) throw new Error('剧情跑了 2000 步还没结束，可能有环');
    const r = engine.advance();

    if (r.type === 'line') {
      log.push({ pov: engine.pov, line: r.line.text });
      continue;
    }
    if (r.type === 'choices') {
      let idx = pickIndex < picks.length ? Number(picks[pickIndex]) - 1 : -1;
      pickIndex++;
      const usable = r.choices.filter((c) => c.enabled);
      if (idx < 0 || !r.choices[idx] || !r.choices[idx].enabled) {
        // 指定的选项被锁或没指定 -> 退而求其次，选第一个可用的
        const fallback = r.choices.findIndex((c) => c.enabled);
        log.push({ choose: `(指定 ${idx + 1} 不可用，改选 ${fallback + 1}) ${r.choices[fallback].text}` });
        idx = fallback;
      } else {
        log.push({ choose: r.choices[idx].text });
      }
      const res = engine.choose(idx);
      if (res.notes && res.notes.length) log.push({ notes: res.notes });
      continue;
    }
    if (r.type === 'end') {
      log.push({ end: engine.node.id, stats: Object.assign({}, engine.stats) });
      // 这一幕演完了，后面还有一幕的话接着往下跑（enterNode 会把 ended 清掉）
      const nextAct = r.node && r.node.continueTo;
      if (!nextAct) break;
      log.push({ continueTo: nextAct });
      engine.enterNode(nextAct);
    }
  }

  if (!quiet) return log;

  // 精简输出：只打印选择、视角切换、效果和结局
  let pov = null;
  for (const entry of log) {
    if (entry.pov && entry.pov !== pov) {
      pov = entry.pov;
      console.log(`\n【视角 → ${pov}】`);
    }
    if (entry.choose) console.log(`  ▶ ${entry.choose}`);
    for (const n of entry.notes || []) console.log(`      · ${n}`);
    if (entry.end) {
      console.log(`\n【结局节点 ${entry.end}】`);
      for (const [k, v] of Object.entries(entry.stats)) console.log(`      ${k} = ${v}`);
    }
    if (entry.continueTo) console.log(`\n【幕间衔接 → ${entry.continueTo}】`);
  }
  console.log('');
  return log;
}


/* ===================================================================
 * 3. 导出
 * =================================================================== */

/* 只导出终端这一侧。剧情规则一律从 engine.js 拿，这里不再转手。 */
module.exports = {
  ConsoleRenderer,
  parseArgs,
  loadStories,
  main,
  runAuto,
};

/* 直接 node act1/game.js 进来时，才真的跑命令行。 */
if (require.main === module) main(process.argv.slice(2));
