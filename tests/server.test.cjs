/**
 * 存档服务器测试
 * =====================================================================
 *   node tests/server.test.cjs
 *
 * 会在一个空闲端口上把 server.js 真跑起来，然后用 HTTP 打它。
 * 注意：服务器把存档写死在 act1/save.json，所以脚本会先备份那份文件，
 * 跑完再放回去（原本没有就删掉），不会动你正在玩的进度。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { suite } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const SAVE_FILE = path.join(ROOT, 'act1', 'save.json');
const PORT = Number(process.env.TEST_PORT) || 3799;
const BASE = `http://127.0.0.1:${PORT}`;

const t = suite('服务器');

/* ---------------- 起服务器 ---------------- */

let backup = null;          // 原本的存档内容（null = 原本没有）
try { backup = fs.readFileSync(SAVE_FILE, 'utf8'); } catch (err) { backup = null; }

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PORT: String(PORT) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; fn(arg); } };

    child.stdout.on('data', (d) => { log += d.toString(); });
    child.stderr.on('data', (d) => { log += d.toString(); });
    child.on('exit', (code) => finish(reject, new Error(`服务器提前退出（code ${code}）：\n${log}`)));

    // 轮询 health 直到通
    const started = Date.now();
    (function poll() {
      fetch(`${BASE}/api/health`)
        .then((r) => { if (r.ok) finish(resolve, child); else retry(); })
        .catch(retry);
      function retry() {
        if (Date.now() - started > 15000) return finish(reject, new Error(`服务器 15 秒还没起来：\n${log}`));
        setTimeout(poll, 120);
      }
    })();
  });
}

/* ---------------- HTTP 小工具 ---------------- */

const get = (p) => fetch(BASE + p);
const postJSON = (p, body) => fetch(BASE + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function validSave(over) {
  return Object.assign({
    version: 1,
    nodeId: 'p1_carriage',
    pov: '西比拉',
    stats: { 伊莎贝尔_好感: 1, 西比拉_警惕: 2 },
    lineIndex: 3,
    history: ['p1_carriage'],
    visited: ['p1_carriage'],
    showStats: false,
  }, over || {});
}

/* ---------------- 跑 ---------------- */

async function main() {
  let child;
  try {
    child = await startServer();
  } catch (err) {
    console.error('起不来服务器：', err.message);
    process.exit(1);
  }

  try {
    /* ---------- 健康检查 ---------- */
    t.section('健康检查');
    const health = await get('/api/health');
    const hb = await health.json();
    t.eq(health.status, 200, '/api/health 返回 200');
    t.eq(hb.ok, true, '/api/health 里 ok=true');
    t.ok(hb.act1 && hb.act1.loaded !== false, '服务器启动时载入了 act1/story.json');

    /* ---------- 静态页面 ---------- */
    t.section('静态页面');

    const page = await get('/act1');
    const html = await page.text();
    t.eq(page.status, 200, 'GET /act1 返回 200');
    t.ok(html.includes('id="app"'), '/act1 给的是第一幕的页面');
    t.ok(html.includes('普里森堡'), '页面上有开始界面');
    t.ok(html.includes('title-bg'), '页面上有开始界面的背景层');

    const storyRes = await get('/act1/story.json');
    const storyBody = await storyRes.json();
    t.eq(storyRes.status, 200, 'GET /act1/story.json 返回 200');
    t.eq(storyBody.nodes.length, 34, '拿到的剧本是 34 个节点');

    const css = await get('/act1/style.css');
    t.eq(css.status, 200, 'GET /act1/style.css 返回 200');
    t.ok((await css.text()).includes('#portrait-layer:not(.speaking)'), '样式里有立绘的亮/暗规则');

    // 立绘和背景图必须真的能下载到（否则页面上就只剩像素占位了）
    t.section('图片');

    const files = [
      ['/act1/images/chr_sibylla.png', 'images/chr_sibylla.png'],
      ['/act1/images/bg_carriage.png', 'images/bg_carriage.png'],
      ['/act1/images/bg_gate.png', 'images/bg_gate.png'],
      ['/act1/images/bg_hall.png', 'images/bg_hall.png'],
    ];
    for (const [url, label] of files) {
      const r = await get(url);
      t.eq(r.status, 200, `GET ${url} 返回 200`);
      t.ok((r.headers.get('content-type') || '').includes('image'), `${label} 是图片`);
      const len = Number(r.headers.get('content-length') || 0);
      t.ok(len > 100000, `${label} 不是空文件（${len} 字节）`);
    }

    // story.json 里写了 src 的素材，路径要真能对上
    const missing = [];
    for (const [key, asset] of Object.entries(storyBody.art.assets)) {
      if (!asset.src) continue;
      const r = await fetch(`${BASE}/act1/${asset.src}`);
      if (r.status !== 200) missing.push(`${key} 的 src「${asset.src}」取不到（HTTP ${r.status}）`);
    }
    t.empty(missing, 'story.json 里写了 src 的素材，服务器上都拿得到');

    /* ---------- 存档 ---------- */
    t.section('存档');

    const snap = validSave();
    const saveRes = await postJSON('/api/act1/save', snap);
    const saveBody = await saveRes.json();
    t.eq(saveRes.status, 200, '保存返回 200');
    t.eq(saveBody.ok, true, '保存成功');
    t.ok(fs.existsSync(SAVE_FILE), '存档真的落到了 act1/save.json');

    const loadRes = await get('/api/act1/load');
    const loadBody = await loadRes.json();
    t.eq(loadRes.status, 200, '读档返回 200');
    t.eq(loadBody.ok, true, '读档成功');
    const got = loadBody.save.snapshot || loadBody.save;
    t.eq(got.nodeId, snap.nodeId, '读回来的节点一致');
    t.eq(got.stats, snap.stats, '读回来的数值一致');
    t.eq(got.lineIndex, snap.lineIndex, '读回来的行号一致');
    t.eq(got.history, snap.history, '读回来的来路一致');

    // 存一份能真的喂给引擎的
    const api = require(path.join(ROOT, 'act1', 'game.js'));
    const engine = new api.StoryEngine(storyBody);
    t.ok(!!engine.restore(got), '服务器存下来的快照，引擎能直接恢复');

    /* ---------- 存档校验 ---------- */
    t.section('存档校验');

    const rejects = [
      ['未知节点', validSave({ nodeId: '不存在的节点' })],
      ['没写 nodeId', validSave({ nodeId: '' })],
      ['未知数值', validSave({ stats: { 生命值: 3 } })],
      ['stats 是空的', validSave({ stats: {} })],
      ['stats 不是对象', validSave({ stats: [] })],
      ['数值越界', validSave({ stats: { 伊莎贝尔_好感: 999 } })],
      ['数值是负数', validSave({ stats: { 伊莎贝尔_好感: -1 } })],
      ['行号越界', validSave({ lineIndex: 99999 })],
      ['请求体不是对象', [1, 2, 3]],
    ];
    for (const [label, body] of rejects) {
      const r = await postJSON('/api/act1/save', body);
      const b = await r.json();
      t.ok(r.status >= 400 && b.ok !== true, `拒绝${label}（HTTP ${r.status}）`);
      t.ok(!!b.message, `拒绝${label}时给了说明`);
    }

    const bodyTooBig = await postJSON('/api/act1/save', { nodeId: 'p1_carriage', stats: { 伊莎贝尔_好感: 1 }, blob: 'x'.repeat(20000) });
    t.eq(bodyTooBig.status, 413, '请求体过大返回 413');

    const badJSON = await fetch(`${BASE}/api/act1/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{坏掉的 json',
    });
    t.ok(badJSON.status >= 400, '坏掉的 JSON 会被拒（不会 500 崩掉）');
    t.ok((await badJSON.json()).ok !== true, '坏 JSON 返回的也是 JSON');

    /* ---------- 不让下载的文件 ---------- */
    t.section('访问限制');

    for (const p of ['/act1/save.json', '/save.json', '/server.js', '/package.json', '/node_modules/express/package.json']) {
      const r = await get(p);
      t.eq(r.status, 403, `${p} 被挡在 403`);
    }

    const unknown = await get('/api/没有这个接口');
    t.eq(unknown.status, 404, '未知接口返回 404');
    t.ok((await unknown.json()).ok === false, '未知接口返回的是 JSON');

    /* ---------- 存完还能继续 ---------- */
    t.section('存档不干扰后续');

    const again = await postJSON('/api/act1/save', validSave({ nodeId: 'a10_end', stats: { 伊莎贝尔_好感: 0, 西比拉_警惕: 3 }, history: ['p1_carriage', 'a10_end'] }));
    t.eq(again.status, 200, '可以覆盖保存');
    const reload = await (await get('/api/act1/load')).json();
    t.eq((reload.save.snapshot || reload.save).nodeId, 'a10_end', '读回来的是最新那份');
  } finally {
    if (child) child.kill();
    // 把存档还原成跑测试之前的样子
    try {
      if (backup === null) { if (fs.existsSync(SAVE_FILE)) fs.unlinkSync(SAVE_FILE); }
      else fs.writeFileSync(SAVE_FILE, backup);
    } catch (err) {
      console.warn('（没能还原 act1/save.json：' + err.message + '）');
    }
  }

  t.done();
}

main().catch((err) => {
  console.error('测试崩了：', err);
  process.exit(1);
});
