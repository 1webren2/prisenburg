/**
 * 红狮骑士团 · 存档服务器
 * ---------------------------------------------------------
 * 1) 托管静态网页（红狮骑士团 / 第一幕 act1/）
 * 2) 红狮骑士团： POST /api/save  保存进度 -> save.json
 *                 GET  /api/load  读取进度 <- save.json
 *    第一幕：     POST /api/act1/save  保存进度 -> act1/save.json
 *                 GET  /api/act1/load  读取进度 <- act1/save.json
 *    GET  /api/health   给前端探测服务器是否在线
 *
 * 第一幕的两套接口是分开的：它的存档单位是「剧情节点」，不是「场景 + 好感度」，
 * 而且会拿 nodeId 去剧本里核对（第一幕 + 后面各幕的节点都在同一张表里），
 * 存了一个剧本里不存在的节点会被打回。
 *
 * 另外保留了 GET /api/save 和 POST /api/load 两个"别名"，
 * 方便按最初的写法调用（语义上是反的，正常请用上面那组）。
 *
 * 启动：node server.js
 *   红狮骑士团  http://localhost:3000/
 *   第一幕      http://localhost:3000/act1
 */

'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const SAVE_FILE = path.join(ROOT, 'save.json');
const MAX_TEXT = 100;         // 字符串字段长度上限
const MAX_NUMBER = 1e6;       // 数值字段绝对值上限

/* ---------- 剧本：启动时全读进来，用来校验存档 ---------- */

const ACT1_DIR = path.join(ROOT, 'act1');
const ACT1_SAVE_FILE = path.join(ACT1_DIR, 'save.json');

/**
 * 存档是跨幕共用的（同一个页面、同一份 save.json），所以在第二幕存档时
 * nodeId 会是 b 开头的节点。只认第一幕的节点表的话，玩家一到第二幕就存不了档。
 * 这里顺着 meta.continues 把后面几幕也读进来，节点 id 并进同一张表。
 */
function loadActs(entryPath) {
  const nodeIds = new Set();
  const statLabels = new Set();
  const seen = new Set();
  const queue = [path.resolve(entryPath)];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const story = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const node of story.nodes || []) nodeIds.add(node.id);
    for (const key of Object.keys((story.config && story.config.statLabels) || {})) statLabels.add(key);
    for (const rel of ((story.meta || {}).continues || [])) {
      queue.push(path.resolve(path.dirname(file), rel));
    }
  }
  return { nodeIds, statLabels };
}

const ACT1 = { loaded: false, nodeIds: new Set(), statLabels: new Set(), reason: '' };
try {
  const loaded = loadActs(path.join(ACT1_DIR, 'story.json'));
  ACT1.nodeIds = loaded.nodeIds;
  ACT1.statLabels = loaded.statLabels;
  ACT1.loaded = true;
} catch (err) {
  ACT1.reason = err.message;
  console.warn('[act1] 读不到剧本，/api/act1/* 会返回 503：' + err.message);
}

const app = express();

app.use(cors());                                   // 允许 file:// 或别的端口打开页面时调用接口
app.use(express.json({ limit: '16kb' }));          // Express 自带 JSON 解析，不需要 body-parser

/* =========================================================
 * 1. 静态文件
 * ========================================================= */

// 存档文件、后端源码、依赖目录不允许通过 HTTP 直接下载
const BLOCKED_PATHS = new Set([
  '/save.json',
  '/act1/save.json',
  '/server.js',
  '/package.json',
  '/package-lock.json',
]);

// 小说原文不是游戏资源，不该能被直接下载
const BLOCKED_PREFIXES = ['/node_modules', '/.', '/act1/source', '/act2/source'];

app.use((req, res, next) => {
  const p = req.path;
  if (BLOCKED_PATHS.has(p) || BLOCKED_PREFIXES.some((pre) => p.startsWith(pre))) {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: '该路径不允许访问' });
  }
  next();
});

/* =========================================================
 * 2. 存档内容校验
 * ========================================================= */

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * 把前端传来的数据整理成规范的存档对象。
 * 支持两种写法：
 *   嵌套：{ sceneId, characters: { Sibylla: { affection: 70 } }, variables: { User_power: 45 } }
 *   扁平：{ sceneId, affection: 70, power: 45 }        // 给 GET /api/save?affection=70 用
 * 返回 { save } 或 { error }
 */
function normalizeSave(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: '请求体必须是一个 JSON 对象' };
  }

  // ---- 当前场景 ----
  const sceneId = String(payload.sceneId ?? '').trim();
  if (!sceneId || sceneId.length > MAX_TEXT) {
    return { error: `sceneId 无效（必填，1~${MAX_TEXT} 个字符）` };
  }

  // ---- 角色好感度 ----
  const characters = {};
  if (payload.characters && typeof payload.characters === 'object' && !Array.isArray(payload.characters)) {
    for (const [name, raw] of Object.entries(payload.characters)) {
      const affection = toInt(raw && typeof raw === 'object' ? raw.affection : raw);
      if (!name || name.length > MAX_TEXT) {
        return { error: `角色名无效：${name}` };
      }
      if (affection === null || affection < 0 || affection > 100) {
        return { error: `角色 ${name} 的好感度必须是 0~100 的整数` };
      }
      characters[name] = { affection };
    }
  } else {
    const affection = toInt(payload.affection);
    const name = String(payload.character ?? 'Sibylla').trim() || 'Sibylla';
    if (affection === null || affection < 0 || affection > 100) {
      return { error: 'affection 必须是 0~100 的整数' };
    }
    characters[name] = { affection };
  }

  if (Object.keys(characters).length === 0) {
    return { error: '至少要有一个角色' };
  }

  // ---- 数值变量 ----
  const variables = {};
  if (payload.variables && typeof payload.variables === 'object' && !Array.isArray(payload.variables)) {
    for (const [key, value] of Object.entries(payload.variables)) {
      const n = toInt(value);
      if (!key || key.length > MAX_TEXT) {
        return { error: `变量名无效：${key}` };
      }
      if (n === null || Math.abs(n) > MAX_NUMBER) {
        return { error: `变量 ${key} 必须是绝对值不超过 ${MAX_NUMBER} 的整数` };
      }
      variables[key] = n;
    }
  } else if (payload.power !== undefined) {
    const power = toInt(payload.power);
    if (power === null || Math.abs(power) > MAX_NUMBER) {
      return { error: `power 必须是绝对值不超过 ${MAX_NUMBER} 的整数` };
    }
    variables.User_power = power;
  }

  return { save: { sceneId, characters, variables } };
}

/* =========================================================
 * 3. 接口
 * ========================================================= */

/** 保存：写 save.json（先写临时文件再改名，避免写一半留下坏档） */
async function handleSave(req, res) {
  // req.query 让 GET /api/save?... 也能用，req.body 给正常的 POST
  const payload = Object.assign({}, req.query, req.body);
  const { save, error } = normalizeSave(payload);

  if (error) {
    return res.status(400).json({ ok: false, error: 'INVALID_SAVE', message: error });
  }

  const record = Object.assign({ version: 1, savedAt: new Date().toISOString() }, save);

  try {
    const tmpFile = `${SAVE_FILE}.tmp`;
    await fsp.writeFile(tmpFile, JSON.stringify(record, null, 2), 'utf8');
    await fsp.rename(tmpFile, SAVE_FILE);
  } catch (err) {
    console.error('[save] 写入失败：', err);
    return res.status(500).json({ ok: false, error: 'WRITE_FAILED', message: '存档写入失败' });
  }

  console.log(`[save] ${record.sceneId}  好感度=${JSON.stringify(record.characters)}  变量=${JSON.stringify(record.variables)}`);
  res.json({ ok: true, save: record });
}

/** 读取 */
async function handleLoad(req, res) {
  try {
    const raw = await fsp.readFile(SAVE_FILE, 'utf8');
    const save = JSON.parse(raw);
    res.json({ ok: true, save });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ ok: false, error: 'NO_SAVE', message: '还没有存档，先点一次"保存进度"' });
    }
    if (err instanceof SyntaxError) {
      console.error('[load] save.json 解析失败：', err.message);
      return res.status(500).json({ ok: false, error: 'CORRUPT_SAVE', message: 'save.json 内容损坏' });
    }
    console.error('[load] 读取失败：', err);
    res.status(500).json({ ok: false, error: 'READ_FAILED', message: '存档读取失败' });
  }
}

app.post('/api/save', handleSave);
app.get('/api/load', handleLoad);

// 别名：按需求里最初的写法保留
app.get('/api/save', handleSave);      // 例：/api/save?sceneId=Hall%20of%20Knights&affection=70&power=45
app.post('/api/load', handleLoad);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'red-lion-knights-save',
    saveFile: path.basename(SAVE_FILE),
    act1: ACT1.loaded ? { ok: true, nodes: ACT1.nodeIds.size, stats: Array.from(ACT1.statLabels) } : { ok: false, reason: ACT1.reason },
    time: new Date().toISOString(),
  });
});

/* =========================================================
 * 3b. 第一幕的存档接口
 * ---------------------------------------------------------
 * 存档单位是剧情节点，直接存引擎的 snapshot()：
 *   { nodeId, pov, stats, lineIndex, history, visited, showStats }
 * 校验比红狮骑士团那边严，因为 nodeId 是可以拿去和剧本对账的。
 * ========================================================= */

/** 校验一组节点 id 数组 */
function checkIdList(value, field) {
  if (value === undefined || value === null) return { list: [] };
  if (!Array.isArray(value)) return { error: `${field} 必须是数组` };
  if (value.length > 2000) return { error: `${field} 太长了（上限 2000）` };
  const list = [];
  for (const raw of value) {
    const id = String(raw);
    if (!ACT1.nodeIds.has(id)) return { error: `${field} 里有剧本中不存在的节点：${id}` };
    list.push(id);
  }
  return { list };
}

/** 把请求体整理成规范的第一幕存档；返回 { save } 或 { error, status } */
function normalizeAct1Save(payload) {
  if (!ACT1.loaded) {
    return { error: `服务器没载入 act1/story.json（${ACT1.reason}）`, status: 503 };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: '请求体必须是一个 JSON 对象' };
  }

  // ---- 停在哪个节点 ----
  const nodeId = String(payload.nodeId ?? '').trim();
  if (!nodeId) return { error: 'nodeId 必填' };
  if (!ACT1.nodeIds.has(nodeId)) {
    return { error: `nodeId「${nodeId}」不在 act1/story.json 里，存档被拒绝` };
  }

  // ---- 隐藏数值 ----
  const rawStats = payload.stats;
  if (!rawStats || typeof rawStats !== 'object' || Array.isArray(rawStats)) {
    return { error: 'stats 必须是对象' };
  }
  const stats = {};
  for (const [key, value] of Object.entries(rawStats)) {
    if (!ACT1.statLabels.has(key)) {
      return { error: `剧本里没有这个数值：${key}` };
    }
    const n = toInt(value);
    if (n === null || n < 0 || n > 100) {
      return { error: `数值 ${key} 必须是 0~100 的整数` };
    }
    stats[key] = n;
  }
  if (Object.keys(stats).length === 0) return { error: 'stats 不能是空的' };

  // ---- 播到第几行 ----
  const lineIndex = toInt(payload.lineIndex === undefined ? 0 : payload.lineIndex);
  if (lineIndex === null || lineIndex < 0 || lineIndex > 1000) {
    return { error: 'lineIndex 必须是 0~1000 的整数' };
  }

  const history = checkIdList(payload.history, 'history');
  if (history.error) return { error: history.error };
  const visited = checkIdList(payload.visited, 'visited');
  if (visited.error) return { error: visited.error };

  const pov = payload.pov === undefined || payload.pov === null ? null : String(payload.pov).slice(0, MAX_TEXT);

  return {
    save: {
      version: 1,
      nodeId,
      pov,
      stats,
      lineIndex,
      history: history.list,
      visited: visited.list,
      showStats: !!payload.showStats,
    },
  };
}

/** 第一幕：保存 -> act1/save.json */
async function handleAct1Save(req, res) {
  const { save, error, status } = normalizeAct1Save(req.body);
  if (error) {
    return res.status(status || 400).json({ ok: false, error: 'INVALID_SAVE', message: error });
  }

  const record = Object.assign({ savedAt: new Date().toISOString() }, save);
  try {
    const tmpFile = `${ACT1_SAVE_FILE}.tmp`;
    await fsp.writeFile(tmpFile, JSON.stringify(record, null, 2), 'utf8');
    await fsp.rename(tmpFile, ACT1_SAVE_FILE);
  } catch (err) {
    console.error('[act1 save] 写入失败：', err);
    return res.status(500).json({ ok: false, error: 'WRITE_FAILED', message: '存档写入失败' });
  }

  console.log(`[act1 save] ${record.nodeId}（第 ${record.lineIndex} 行） 数值=${JSON.stringify(record.stats)}`);
  res.json({ ok: true, save: record });
}

/** 第一幕：读取 <- act1/save.json */
async function handleAct1Load(req, res) {
  try {
    const raw = await fsp.readFile(ACT1_SAVE_FILE, 'utf8');
    const save = JSON.parse(raw);
    res.json({ ok: true, save });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ ok: false, error: 'NO_SAVE', message: '还没有存档，先点一次"保存进度"' });
    }
    if (err instanceof SyntaxError) {
      console.error('[act1 load] act1/save.json 解析失败：', err.message);
      return res.status(500).json({ ok: false, error: 'CORRUPT_SAVE', message: 'act1/save.json 内容损坏' });
    }
    console.error('[act1 load] 读取失败：', err);
    res.status(500).json({ ok: false, error: 'READ_FAILED', message: '存档读取失败' });
  }
}

app.post('/api/act1/save', handleAct1Save);
app.get('/api/act1/load', handleAct1Load);

// 其它 /api/xxx 统一返回 JSON，而不是 HTML
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND', message: `没有这个接口：${req.method} ${req.originalUrl}` });
});

/* =========================================================
 * 4. 静态页面 + 启动
 * ========================================================= */

app.use(express.static(ROOT, { index: 'index.html' }));

// 统一错误处理：保证出错时也返回 JSON（前端才能显示出人话）
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ ok: false, error: 'PAYLOAD_TOO_LARGE', message: '请求体太大（上限 16kb）' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ ok: false, error: 'BAD_JSON', message: '请求体不是合法的 JSON' });
  }
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: 'INTERNAL', message: '服务器内部错误' });
});

const server = app.listen(PORT, () => {
  console.log('=========================================');
  console.log('  文字游戏 · 存档服务器已启动');
  console.log(`  红狮骑士团： http://localhost:${PORT}/`);
  console.log(`  第一幕：     http://localhost:${PORT}/act1`);
  console.log(`  存档文件：   ${SAVE_FILE}`);
  console.log(`               ${ACT1_SAVE_FILE}${ACT1.loaded ? `（剧本 ${ACT1.nodeIds.size} 个节点）` : '（剧本未载入！）'}`);
  console.log('  按 Ctrl+C 停止');
  console.log('=========================================');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[启动失败] 端口 ${PORT} 已被占用。`);
    console.error('  换个端口试试：  PORT=3001 node server.js');
    console.error('  或找出占用进程：netstat -ano | findstr :3000');
  } else {
    console.error('[启动失败]', err);
  }
  process.exit(1);
});
