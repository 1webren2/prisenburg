/**
 * 一把跑完所有检查
 * =====================================================================
 *   node tests/run.cjs
 *
 * 四道：
 *   engine    —— 剧本站不站得住，216 条分支是不是都能走通
 *   ui        —— 开始界面、立绘亮暗、背景、选项、存档（无头，不用开浏览器）
 *   server    —— 存档接口和静态文件（会真起一个服务器）
 *   fidelity  —— 每句话是不是都出自小说原文（不许自己编，也不许漏）
 *
 * 单独的跑法： node tests/engine.test.cjs
 */

const path = require('path');
const { spawnSync } = require('child_process');

const SUITES = [
  ['engine', 'tests/engine.test.cjs', '剧本与引擎'],
  ['ui', 'tests/ui.test.cjs', '渲染层（开始界面 / 立绘 / 背景 / 选项）'],
  ['server', 'tests/server.test.cjs', '存档服务器'],
  ['fidelity', 'tests/fidelity.cjs', '原文核对'],
];

const ROOT = path.join(__dirname, '..');
const only = process.argv[2];
const results = [];

for (const [key, file, label] of SUITES) {
  if (only && key !== only) continue;
  console.log('\n' + '='.repeat(64));
  console.log(`▶ ${label}   (node ${file})`);
  console.log('='.repeat(64));

  const run = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
  results.push({ key, label, ok: run.status === 0 });
}

if (!results.length) {
  console.error(`没有叫「${only}」的检查。可选：${SUITES.map((s) => s[0]).join(' / ')}`);
  process.exit(1);
}

console.log('\n' + '='.repeat(64));
for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.label}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n❌ ${failed} 项没过` : '\n✅ 全部通过');
process.exit(failed ? 1 : 0);
