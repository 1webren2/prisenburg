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
    nodeId: 's1_rain',
    pov: '西比拉',
    stats: { 伊莎贝尔_好感: 1, 西比拉_警惕: 82 },
    lineIndex: 3,
    history: ['s1_rain'],
    visited: ['s1_rain'],
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
    t.eq(hb.act1.nodes, 364, '八份剧本的节点并进了同一张表（30 + 41 + 33 + 日常层 133 + 狩猎篇 127，自由活动锚点和报仇结局都在第二幕那张表里）');
    t.eq(
      hb.act1.stats,
      ['西比拉_好感', '西比拉_警惕', '西比拉_亲密', '西比拉_力量', '西比拉_压力', '西比拉_自主性',
        '佣兵_纪律', '伊莎贝尔_好感', '伊莎贝尔_礼仪成长', '海尔_好感', '布朗_好感',
        '线索_克莱尔旧事', '线索_观察西比拉', '线索_初夜观察', '线索_路上表现',
        '西比拉_健康', '西比拉_尊敬', '西比拉_埋怨', '西比拉_反抗', '西比拉_恨意',
        '普里森堡_秩序', '普里森堡_声誉', '仆人_尊敬',
        // 最后这 60 面是日常层的「记录旗」，不是数值：0/1 的记事标记，
        // 日记靠它们判断今天记不记得这一笔（daily/diary.js）。它们在
        // statLabels 里、不在 initialStats 里 —— getStat() 读不到就是 0。
        // 两个主线日按**时段**记（原著那一段过没过，一天一旗就够了），
        // 外加那两处「她没在那儿」的补记旗；自由日按**时段 + 地点**记：
        // 一个时段的旗是 0/1，「选了另一处」和「选了后一个做法」长得一模一样，
        // 第二天的回响台词要靠地点这一维才分得清她去的是哪儿。
        '旗_第2天早晨', '旗_第2天早晨_大厅', '旗_第2天早晨_后坡',
        '旗_第2天中午', '旗_第2天中午_洗衣房', '旗_第2天中午_外院',
        '旗_第2天午后', '旗_第2天午后_书房', '旗_第2天午后_洗衣房',
        '旗_第2天夜晚', '旗_第2天夜晚_教室', '旗_第2天夜晚_西比拉的房间',
        '旗_第3天早晨_大厅', '旗_第3天早晨_洗衣房', '旗_第3天早晨_账房',
        '旗_第3天中午_教室', '旗_第3天中午_书房', '旗_第3天中午_外院',
        '旗_第3天午后_外院', '旗_第3天午后_后坡', '旗_第3天午后_马厩',
        '旗_第3天夜晚_走廊', '旗_第3天夜晚_马厩', '旗_第3天夜晚_西比拉的房间',
        '旗_第4天早晨_大厅', '旗_第4天早晨_洗衣房', '旗_第4天早晨_教室',
        '旗_第4天中午_教室', '旗_第4天中午_书房', '旗_第4天中午_账房',
        '旗_第4天午后_外院', '旗_第4天午后_后坡', '旗_第4天午后_伊莎贝尔的房间',
        '旗_第4天夜晚_走廊', '旗_第4天夜晚_马厩', '旗_第4天夜晚_教室',
        '旗_第5天早晨_大厅', '旗_第5天早晨_洗衣房', '旗_第5天早晨_账房',
        '旗_第5天中午_教室', '旗_第5天中午_书房', '旗_第5天中午_外院',
        '旗_第5天午后_外院', '旗_第5天午后_后坡', '旗_第5天午后_伊莎贝尔的房间',
        '旗_第5天夜晚_走廊', '旗_第5天夜晚_马厩', '旗_第5天夜晚_西比拉的房间',
        '旗_第6天早晨', '旗_第6天早晨_大厅', '旗_第6天早晨_书房',
        '旗_第6天中午', '旗_第6天中午_教室', '旗_第6天中午_后坡',
        '旗_第6天午后', '旗_第6天午后_洗衣房', '旗_第6天午后_外院',
        '旗_第6天夜晚', '旗_第6天夜晚_西比拉的房间', '旗_第6天夜晚_账房'],
      '数值表跟着第一幕走（原有 15 项 + 新增 8 项 + 记录旗 60 面；警惕仍在表里，只是不上面板）'
    );

    /* ---------- 静态页面 ---------- */
    t.section('静态页面');

    const page = await get('/act1');
    const html = await page.text();
    t.eq(page.status, 200, 'GET /act1 返回 200');
    t.ok(html.includes('id="app"'), '/act1 给的是第一幕的页面');
    t.ok(html.includes('普里森堡'), '页面上有开始界面');
    t.ok(html.includes('title-bg'), '页面上有开始界面的背景层');

    // 一幕一个 story.json，服务器各发各的（合并是浏览器/引擎那边做的）
    const storyRes = await get('/act1/story.json');
    const storyBody = await storyRes.json();
    t.eq(storyRes.status, 200, 'GET /act1/story.json 返回 200');
    t.eq(storyBody.nodes.length, 30, '第一幕的剧本是 30 个节点');
    t.eq(storyBody.meta.continues, ['../act2/story.json'], '第一幕指着后面的第二幕');

    const story2Res = await get('/act2/story.json');
    const story2Body = await story2Res.json();
    t.eq(story2Res.status, 200, 'GET /act2/story.json 返回 200');
    t.eq(story2Body.nodes.length, 41,
      '第二幕的剧本是 41 个节点（27 段剧情 + 13 个自由活动锚点 + 报仇结局；fr_end_hub 已从主流程移除）');
    t.eq(story2Body.nodes[0].id, 'b1_room', '第二幕从 b1_room 开始');
    // 自由活动的锚点是追加在后面的，所以「最后一个节点」不再是 b25_end；
    // 该守的规矩是「b25_end 还是最后一段真正的剧情」
    t.ok(!!story2Body.nodes.find((n) => n.id === 'b25_end'), '第二幕里有 b25_end 这个收尾节点');
    t.eq(
      story2Body.nodes.filter((n) => !n.freeRoam).pop().id,
      'b25_end',
      '第二幕最后一段剧情仍然以 b25_end 收尾（自由活动锚点在它后面）'
    );
    t.ok(
      story2Body.nodes.some((n) => n.freeRoam && n.id === 'fr_the_end' && n.ending),
      '自由活动区里也有自己的结局节点（「结束游戏」落在它上面）'
    );

    // 收尾节点确实接得上：第一幕的出口就是第二幕的入口
    t.eq(
      storyBody.nodes.find((n) => n.id === 'o4_end').continueTo,
      story2Body.nodes[0].id,
      '第一幕结局的 continueTo 就是第二幕的第一个节点'
    );

    const css = await get('/act1/style.css');
    t.eq(css.status, 200, 'GET /act1/style.css 返回 200');
    t.ok((await css.text()).includes('#portrait-layer:not(.speaking)'), '样式里有立绘的亮/暗规则');

    // 立绘和背景图必须真的能下载到（否则页面上就只剩像素占位了）
    t.section('图片');

    // 所有幕的图统一放在仓库根目录的 images/ 下，页面在 /act1/，所以剧本里写 ../images/
    const files = [
      ['/images/chr_sibylla.webp', '西比拉的女仆装立绘'],
      ['/images/chr_brown.webp', '布朗管家的立绘'],
      ['/images/chr_soldier.webp', '门房佣兵的立绘（第一幕补上的那张，通用）'],
      ['/images/chr_maid.webp', '女仆的立绘（第三幕，通用）'],
      ['/images/chr_groom.webp', '马夫的立绘（通用；第一幕的约翰用的就是它）'],
      ['/images/bg_carriage.webp', '马车车厢的背景'],
      ['/images/bg_gate.webp', '城堡大门的背景'],
      ['/images/bg_hall.webp', '大厅的背景'],
      ['/images/chr_sibylla_teacher.webp', '第二幕的牧师服立绘'],
      ['/images/bg_sibylla_room.webp', '第二幕的新房间背景'],
      ['/images/bg_corridor.webp', '第二幕的三楼过道背景'],
      ['/images/bg_classroom.webp', '第二幕的教室背景'],
      ['/images/bg_isabelle_room.webp', '伊莎贝尔房间的背景'],
      ['/images/bg_aubrey_room.webp', '奥布里房间的背景（自由活动的 hub）'],
      ['/images/chr_sibylla_riding.webp', '西比拉的骑装半身像'],
      ['/images/chr_sibylla_black.webp', '西比拉的黑礼服半身像'],
      ['/images/chr_aubrey.webp', '奥布里的立绘（自由活动里站左槽）'],
      ['/images/chr_isabelle.webp', '伊莎贝尔的立绘'],
      ['/images/bg_laundry.webp', '第三幕的洗衣房背景'],
      ['/images/bg_meadow.webp', '第三幕的府邸外草地背景'],
      ['/images/full_sibylla_maid.webp', '女仆装全身图（换装浮层用）'],
      ['/images/full_sibylla_teacher.webp', '牧师服全身图（换装浮层用）'],
      ['/images/full_sibylla_riding.webp', '骑装全身图（换装浮层用）'],
      ['/images/full_sibylla_black.webp', '黑礼服全身图（换装浮层用）'],
    ];
    for (const [url, label] of files) {
      const r = await get(url);
      t.eq(r.status, 200, `GET ${url} 返回 200`);
      t.ok((r.headers.get('content-type') || '').includes('image'), `${label} 是图片`);
      const len = Number(r.headers.get('content-length') || 0);
      t.ok(len > 100000, `${label} 不是空文件（${len} 字节）`);
    }

    // 第三幕：同样一幕一个 story.json，收尾节点接上第二幕的出口
    const story3Res = await get('/act3/story.json');
    const story3Body = await story3Res.json();
    t.eq(story3Res.status, 200, 'GET /act3/story.json 返回 200');
    t.eq(story3Body.nodes.length, 33, '第三幕的剧本是 33 个节点（27 段主线 + 3 个决定点各岔出的两条）');
    t.eq(story3Body.meta.continues, ['../daily/story.json'], '第三幕的 continues 指向日常层');
    // 第三幕自己已经没有结局节点了：第一幕的收束点挪到了狩猎篇第八章末
    t.eq(story3Body.nodes.filter((n) => n.ending).length, 0, '第三幕不再自己收场（c27_end 改成一根 next 接狩猎篇）');
    t.eq(story3Body.nodes.find((n) => n.id === 'c27_end').next, 'h4_knock', 'c27_end 接着狩猎篇第一章的首节点');

    // 狩猎篇：一章一文件，也得能取到，而且第八章末尾才是收束
    const huntCh8 = await (await get('/hunt/ch8.json')).json();
    t.eq(huntCh8.nodes.filter((n) => n.ending).map((n) => n.id), ['h8_end'], '狩猎篇第八章末是第一幕的收束点');
    const huntCh4 = await (await get('/hunt/ch4.json')).json();
    t.eq(huntCh4.meta.continues, ['ch5.json'], '狩猎篇的加载链从第四章接第五章');

    // story.json 里写了 src 的素材，路径要真能对上。
    // 用 new URL(src, 这一幕的目录) 来拼 —— src 是「../images/...」，
    // 直接字符串接在 /act1/ 后面会拼出 /act1/../images/... 这种歪路径。
    const missing = [];
    for (const [dir, body] of [['/act1/', storyBody], ['/act2/', story2Body], ['/act3/', story3Body]]) {
      for (const [key, asset] of Object.entries((body.art && body.art.assets) || {})) {
        if (!asset.src) continue;
        const url = new URL(asset.src, BASE + dir);
        const r = await fetch(url);
        if (r.status !== 200) missing.push(`${dir} ${key} 的 src「${asset.src}」取不到（HTTP ${r.status}）`);
      }
    }
    t.empty(missing, '两幕里写了 src 的素材，服务器上都拿得到');

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
    const api = require(path.join(ROOT, 'act1', 'engine.js'));
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
      ['数值低于下限', validSave({ stats: { 西比拉_警惕: -1 } })],
      ['好感低于下限', validSave({ stats: { 西比拉_好感: -101 } })],
      ['好感高于上限', validSave({ stats: { 伊莎贝尔_好感: 101 } })],
      ['行号越界', validSave({ lineIndex: 99999 })],
      ['请求体不是对象', [1, 2, 3]],
    ];
    for (const [label, body] of rejects) {
      const r = await postJSON('/api/act1/save', body);
      const b = await r.json();
      t.ok(r.status >= 400 && b.ok !== true, `拒绝${label}（HTTP ${r.status}）`);
      t.ok(!!b.message, `拒绝${label}时给了说明`);
    }

    const bodyTooBig = await postJSON('/api/act1/save', { nodeId: 's1_rain', stats: { 伊莎贝尔_好感: 1 }, blob: 'x'.repeat(20000) });
    t.eq(bodyTooBig.status, 413, '请求体过大返回 413');

    // 好感的区间放宽成了 -100~100（报仇线会把好感打到负的），负数要能存能读
    const negSave = await postJSON('/api/act1/save', validSave({ stats: { 西比拉_好感: -73, 西比拉_警惕: 2 } }));
    t.eq(negSave.status, 200, '好感 -73 存得下（它的区间是 -100~100）');
    const negBack = await (await get('/api/act1/load')).json();
    const negGot = negBack.save.snapshot || negBack.save;
    t.eq(negGot.stats['西比拉_好感'], -73, '负的好感原样读回来（服务器不会把它夹成 0）');

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

    // 小说原文不是游戏资源，不该能被直接下载：三幕的 source/ 加上 store/
    // （第四～十一章原文，狩猎篇的取材来源）都要挡住。
    const sources = [
      '/act1/source/' + encodeURIComponent('第一幕原文.txt'),
      '/act2/source/' + encodeURIComponent('普里森堡第二章.txt'),
      '/act3/source/' + encodeURIComponent('第三章.txt'),
      '/store/' + encodeURIComponent('第五章.txt'),
      '/store/' + encodeURIComponent('第八章.txt'),
    ];
    for (const p of sources) {
      const r = await get(p);
      t.eq(r.status, 403, `${decodeURIComponent(p)} 被挡在 403`);
    }

    const unknown = await get('/api/没有这个接口');
    t.eq(unknown.status, 404, '未知接口返回 404');
    t.ok((await unknown.json()).ok === false, '未知接口返回的是 JSON');

    /* ---------- 存完还能继续 ---------- */
    t.section('存档不干扰后续');

    const again = await postJSON('/api/act1/save', validSave({ nodeId: 'o4_end', stats: { 伊莎贝尔_好感: 0, 西比拉_警惕: 82 }, history: ['s1_rain', 'o4_end'] }));
    t.eq(again.status, 200, '可以覆盖保存');
    const reload = await (await get('/api/act1/load')).json();
    t.eq((reload.save.snapshot || reload.save).nodeId, 'o4_end', '读回来的是最新那份');

    /* ---------- 跨幕存档 ---------- */
    t.section('跨幕存档');

    // 存档是同一个页面、同一份 act1/save.json 共用的。玩家走进第二幕之后
    // 停在的是 b 开头的节点 —— 服务器只认第一幕的节点表的话，一到第二幕就存不了档。
    const act2Snap = validSave({
      nodeId: 'b12_morning',
      pov: '西比拉',
      stats: { 伊莎贝尔_好感: 2, 西比拉_警惕: 82 },
      lineIndex: 1,
      history: ['s1_rain', 's4_hall', 'o4_end', 'b1_room', 'b12_morning'],
      visited: ['s1_rain', 'o4_end', 'b1_room', 'b12_morning'],
    });
    const act2Res = await postJSON('/api/act1/save', act2Snap);
    t.eq(act2Res.status, 200, '第二幕的节点也能存（服务器认得 b 开头的节点）');
    t.eq((await act2Res.json()).ok, true, '第二幕存档成功');

    const act2Back = await (await get('/api/act1/load')).json();
    const got2 = act2Back.save.snapshot || act2Back.save;
    t.eq(got2.nodeId, 'b12_morning', '读回来的还是第二幕那个节点');
    t.eq(got2.history, act2Snap.history, '跨幕的来路原样存下来了');

    // 存下来的这份要能直接喂给合并后的引擎
    const composed = new api.StoryEngine(api.composeStories([storyBody, story2Body]));
    t.ok(!!composed.restore(got2), '服务器存下来的跨幕快照，引擎能直接恢复');
    t.eq(composed.pov, '西比拉', '恢复后停在第二幕的西比拉视角');
    t.eq(composed.currentArt().portrait, 'chr_sibylla_teacher', '连「此刻穿着哪套衣服」都恢复得回来');

    // 一眼假的节点照样拒绝（校验没有因为跨幕而放松）
    const bogus = await postJSON('/api/act1/save', validSave({ nodeId: 'b999_不存在' }));
    t.ok(bogus.status >= 400, '第二幕里不存在的节点照样拒绝');

    /* ---------- 自由活动的存档 ---------- */
    t.section('自由活动存档');

    // 自由活动的「位置」就是锚点节点（装束＝位置），所以服务器一行都不用改：
    // 存档里存的还是普通的 nodeId，只不过这个节点在第二幕的自由活动区里。
    const roamSnap = validSave({
      nodeId: 'fr_sib_riding',
      pov: '奥布里',
      stats: { 伊莎贝尔_好感: 2, 西比拉_好感: 3, 西比拉_警惕: 82 },
      lineIndex: 0,
      history: ['s1_rain', 'o4_end', 'fr_hub', 'fr_sib_riding'],
      visited: ['s1_rain', 'o4_end', 'fr_hub', 'fr_sib_riding'],
    });
    const roamRes = await postJSON('/api/act1/save', roamSnap);
    t.eq(roamRes.status, 200, '自由活动的锚点节点也能存（服务器顺着 continues 收到了它）');
    const roamBack = await (await get('/api/act1/load')).json();
    const got3 = roamBack.save.snapshot || roamBack.save;
    t.eq(got3.nodeId, 'fr_sib_riding', '读回来还停在那个房间');

    const roamEngine = new api.StoryEngine(api.composeStories([storyBody, story2Body]));
    t.ok(!!roamEngine.restore(got3), '自由活动的快照，引擎能直接恢复');
    t.eq(roamEngine.pov, '奥布里', '恢复成奥布里的视角');
    t.eq(roamEngine.getStat('西比拉_好感'), 3, '新增的好感度也存得住');
    // 房间的开场白先排掉，然后才是菜单 —— 菜单上带着「她此刻站在右槽的哪张图」
    let roamView = roamEngine.advance();
    for (let i = 0; i < 5 && roamView.type !== 'choices'; i++) roamView = roamEngine.advance();
    t.eq((roamView.room || {}).portrait, 'chr_sibylla_riding',
      '「她此刻穿着哪套」跟着存档一起回来了（装束＝位置换来的）');

    // 一眼假的锚点照样拒绝
    const bogusRoam = await postJSON('/api/act1/save', validSave({ nodeId: 'fr_没有这个房间' }));
    t.ok(bogusRoam.status >= 400, '自由活动里不存在的锚点照样拒绝');
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
