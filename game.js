/* =========================================================
 * 红狮骑士团 · 文字冒险  ——  game.js
 * ---------------------------------------------------------
 * 由原 C++ 版本翻译而来，对应关系：
 *   Dialogue  -> scene.lines[] 里的 { speaker, text }
 *   Choice    -> scene.choices[]（next / condition / effects）
 *   Scene     -> GAME_DATA.scenes[]（id / background / lines / choices）
 *   GameState -> state（variables 数值表 + characters 角色表 + sceneId）
 *   std::function 形式的 condition/effect -> 声明式数据（可序列化、好扩展）
 *
 * 文件结构：
 *   1. GAME_DATA  剧情数据（改剧情只需要动这一段）
 *   2. state      运行时状态
 *   3. 条件 / 效果引擎
 *   4. 画面渲染（背景 / 立绘 / 对话框 / 选项 / 状态栏）
 *   5. 输入绑定与启动
 * ========================================================= */

/* =========================================================
 * 1. 剧情数据
 * ========================================================= */

// 打字机速度（毫秒 / 字），想更快就调小
const TYPE_SPEED_MS = 24;
// 转场淡入淡出时长
const TRANSITION_MS = 420;

const GAME_DATA = {
  // 起始场景 id
  start: 'Hall of Knights',

  // 状态栏里显示好感度的角色
  hudCharacter: 'Sibylla',

  // 数值的中文名（用于飘字提示）
  variableLabels: {
    User_power: '剑术力量',
  },

  // 全局数值的初始值（对应 C++ 的 GameState::variables_）
  initialVariables: {
    User_power: 0,
  },

  // 角色（对应 C++ 的 Character，好感度存在角色身上）
  characters: {
    Sibylla: {
      name: 'Sibylla',
      displayName: 'Sibylla',
      age: 24,
      identity: '红狮骑士团 · 副团长',
      initialAffection: 0,
      color: '#e8825f',
      portrait: 'images/sibylla.png',   // 立绘：没有这张图就显示颜色块
    },
    User: {
      name: 'User',
      displayName: 'User',
      color: '#8fb8dd',
      // 主角没有立绘：轮到主角说话时，画面上的立绘会变暗
    },
  },

  // 全部场景
  scenes: [
    /* ---------------- 场景一：骑士大厅 ---------------- */
    {
      id: 'Hall of Knights',
      name: '骑士大厅',
      background: {
        image: 'images/bg_hall.jpg',
        fallback: 'linear-gradient(160deg, #3a2a1c 0%, #241a13 45%, #100c09 100%)',
      },
      defaultPortrait: 'Sibylla',
      lines: [
        { speaker: 'Sibylla', text: 'Welcome to the Red Lion Knights!' },
        { speaker: 'User', text: 'I would like to ask, what is the spiritual creed of the Red Lion Knights?' },
        { speaker: 'Sibylla', text: 'Wisdom, Power, Courage!' },
        { speaker: 'Sibylla', text: "Anywhere you'd like to go now? (Gazing at you with anticipation)" },
      ],
      // 再次进入该场景时只播这一句，避免反复刷屏（C++ 版是靠 found 标志实现同样的效果）
      shortLines: [
        { speaker: 'Sibylla', text: 'Anything else you would like to do?' },
      ],
      choices: [
        {
          text: 'Go to the Sword Training Ground',
          next: 'Training ground',
        },
        {
          text: 'Praise Sibylla',
          next: 'Hall of Knights',
          // 选择后的即时反馈台词（可选：删掉 lines 就回到 C++ 那种"直接重进场景"的行为）
          lines: [
            { speaker: 'Sibylla', text: 'Hehe, thank you. You are very kind.' },
          ],
          effects: [
            { type: 'affection', character: 'Sibylla', value: 10 },
          ],
        },
      ],
    },

    /* ---------------- 场景二：训练场 ---------------- */
    {
      id: 'Training ground',
      name: '训练场',
      background: {
        image: 'images/bg_training.jpg',
        fallback: 'linear-gradient(160deg, #2f3a2a 0%, #1d251b 45%, #0c0f0b 100%)',
      },
      defaultPortrait: 'Sibylla',
      lines: [
        { speaker: 'Sibylla', text: 'Welcome to the Training ground.' },
        { speaker: 'Sibylla', text: 'Want to practice your sword skills?' },
        { speaker: 'User', text: "That's a nice suggestion, but I'd rather take a walk around." },
        { speaker: 'Sibylla', text: 'Then please feel free to explore on your own.' },
      ],
      shortLines: [
        { speaker: 'Sibylla', text: 'The training ground is quiet... for now.' },
      ],
      choices: [
        {
          text: "Return to the Knights' Hall",
          next: 'Hall of Knights',
        },
        {
          text: 'Practice swordsmanship',
          next: 'Training ground',
          lines: [
            { speaker: 'User', text: '(You swing your sword until your arms ache.)' },
          ],
          effects: [
            { type: 'variable', key: 'User_power', value: 20 },
          ],
        },
        {
          // 好感度 > 60 才会解锁的隐藏分支
          text: 'Find Sibylla and practice swordplay',
          next: 'Training ground',
          condition: { type: 'affection', character: 'Sibylla', op: '>', value: 60 },
          lockedHint: '需要 Sibylla 好感度 > 60',
          lines: [
            { speaker: 'Sibylla', text: 'Of course! Let us cross blades.', portrait: 'images/sibylla_happy.png' },
            { speaker: 'User', text: '(She smiles and raises her sword.)' },
          ],
          effects: [
            { type: 'affection', character: 'Sibylla', value: 20 },
            { type: 'variable', key: 'User_power', value: 25 },
          ],
        },
      ],
    },
  ],
};

/* =========================================================
 * 2. 运行时状态
 * ========================================================= */

const state = {
  mode: 'title',        // title | line | choices | transition | ended
  sceneId: null,
  queue: [],            // 当前要播的台词队列
  lineIndex: 0,
  onQueueDone: null,    // 台词播完后的回调（通常是显示选项）
  typing: false,        // 打字机是否进行中
  typeTimer: null,
  fullText: '',
  variables: {},        // { User_power: 0 }
  characters: {},       // { Sibylla: { affection: 0 } }
  visits: {},           // 每个场景进入过的次数
  currentPortraitSrc: null,
};

/* =========================================================
 * 3. 条件 / 效果引擎
 * ========================================================= */

const OPS = {
  '>':  (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<':  (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

function getCharacter(name) {
  return GAME_DATA.characters[name] || null;
}

function getAffection(name) {
  const c = state.characters[name];
  return c ? c.affection : 0;
}

// 好感度限制在 0 ~ 100（对应 C++ 的 Character::Affection_change）
function setAffection(name, value) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  if (!state.characters[name]) {
    state.characters[name] = { affection: clamped };
  } else {
    state.characters[name].affection = clamped;
  }
  return clamped;
}

function changeAffection(name, delta) {
  return setAffection(name, getAffection(name) + delta);
}

function getVariable(key, defaultValue = 0) {
  return Object.prototype.hasOwnProperty.call(state.variables, key)
    ? state.variables[key]
    : defaultValue;
}

function addVariable(key, value) {
  state.variables[key] = getVariable(key) + value;
  return state.variables[key];
}

// 条件：支持单个条件对象，或用数组表示"同时满足"
// { type:'affection', character:'Sibylla', op:'>', value:60 }
// { type:'variable',  key:'User_power',  op:'>=', value:40 }
function evaluateCondition(condition, st) {
  if (!condition) return true;
  if (Array.isArray(condition)) return condition.every((c) => evaluateCondition(c, st));

  const compare = OPS[condition.op] || OPS['>'];
  switch (condition.type) {
    case 'affection': {
      const c = st.characters[condition.character];
      return compare(c ? c.affection : 0, condition.value);
    }
    case 'variable':
      return compare(
        Object.prototype.hasOwnProperty.call(st.variables, condition.key)
          ? st.variables[condition.key]
          : 0,
        condition.value
      );
    case 'always':
      return Boolean(condition.value);
    default:
      console.warn('[红狮骑士团] 未知的条件类型：', condition.type);
      return true;
  }
}

function formatDelta(n) {
  return (n >= 0 ? '+' : '') + n;
}

// 执行效果并弹出提示，返回执行结果的描述
function applyEffects(effects) {
  const results = [];
  (effects || []).forEach((effect) => {
    if (!effect) return;

    if (effect.type === 'affection') {
      const character = getCharacter(effect.character);
      const before = getAffection(effect.character);
      const after = changeAffection(effect.character, effect.value);
      results.push({
        text: `${character ? character.displayName : effect.character} 好感度 ${formatDelta(after - before)}`,
        color: character ? character.color : null,
      });
    } else if (effect.type === 'variable') {
      addVariable(effect.key, effect.value);
      const label = GAME_DATA.variableLabels[effect.key] || effect.key;
      results.push({ text: `${label} ${formatDelta(effect.value)}`, color: null });
    }
  });

  results.forEach((r) => showToast(r.text, r.color));
  return results;
}

function getScene(id) {
  return GAME_DATA.scenes.find((s) => s.id === id) || null;
}

function currentScene() {
  return getScene(state.sceneId);
}

/* =========================================================
 * 4. 画面渲染
 * ========================================================= */

const $ = (id) => document.getElementById(id);

const el = {
  stage: $('stage'),
  bgLayer: $('bg-layer'),
  bgPlaceholder: $('bg-placeholder'),
  bgPhPath: $('bg-ph-path'),
  portraitLayer: $('portrait-layer'),
  portraitImg: $('portrait-img'),
  portraitPlaceholder: $('portrait-placeholder'),
  portraitPhName: $('portrait-ph-name'),
  portraitPhPath: $('portrait-ph-path'),
  sceneTitle: $('scene-title'),
  dialogueBox: $('dialogue-box'),
  speakerPlate: $('speaker-plate'),
  speakerName: $('speaker-name'),
  dialogueText: $('dialogue-text'),
  nextIndicator: $('next-indicator'),
  choices: $('choices'),
  affectionLabel: $('affection-label'),
  affectionBar: $('affection-bar'),
  affectionValue: $('affection-value'),
  powerValue: $('power-value'),
  restartBtn: $('restart-btn'),
  saveBtn: $('save-btn'),
  loadBtn: $('load-btn'),
  serverDot: $('server-dot'),
  toastArea: $('toast-area'),
  veil: $('veil'),
  titleScreen: $('title-screen'),
  startBtn: $('start-btn'),
  endingScreen: $('ending-screen'),
  endingText: $('ending-text'),
  endingRestartBtn: $('ending-restart-btn'),
};

const REDUCED_MOTION =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 图片探测：加载失败就显示颜色块 ---------- */
const imageCache = new Map();
function imageExists(src) {
  if (!imageCache.has(src)) {
    imageCache.set(
      src,
      new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(true);
        probe.onerror = () => resolve(false);
        probe.src = src;
      })
    );
  }
  return imageCache.get(src);
}

/* ---------- 状态栏 ---------- */
function updateHUD() {
  const name = GAME_DATA.hudCharacter;
  const character = getCharacter(name);
  const affection = getAffection(name);

  el.affectionLabel.textContent = `${character ? character.displayName : name} 好感度`;
  el.affectionValue.textContent = String(affection);
  el.affectionBar.style.width = `${affection}%`;
  el.powerValue.textContent = String(getVariable('User_power'));
}

/* ---------- 飘字提示 ---------- */
function showToast(text, color) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  if (color) node.style.setProperty('--accent', color);
  el.toastArea.appendChild(node);

  window.setTimeout(() => {
    node.classList.add('leaving');
    window.setTimeout(() => node.remove(), 400);
  }, 1600);
}

/* ---------- 背景 ---------- */
function setBackground(scene) {
  const bg = scene.background || {};
  const fallback = bg.fallback || 'linear-gradient(160deg, #2a2018, #0b0907)';

  // 第一层是图片，第二层是颜色块兜底：图片 404 时自动露出颜色块
  el.bgLayer.style.backgroundImage = bg.image ? `url("${bg.image}"), ${fallback}` : fallback;
  el.bgPhPath.textContent = bg.image || '（该场景没有配图）';

  if (!bg.image) {
    el.bgPlaceholder.classList.remove('hidden');
    return;
  }

  imageExists(bg.image).then((ok) => {
    if (state.sceneId !== scene.id) return;   // 已经切场景了，忽略这次结果
    el.bgPlaceholder.classList.toggle('hidden', ok);
  });
}

/* ---------- 立绘 ---------- */
function setPortrait(src, label, color) {
  if (color) document.documentElement.style.setProperty('--accent', color);

  el.portraitLayer.classList.remove('hidden', 'dimmed');
  if (state.currentPortraitSrc === src) return;   // 同一张图不重复播动画

  state.currentPortraitSrc = src;
  el.portraitPhName.textContent = label || '';
  el.portraitPhPath.textContent = src || '';

  el.portraitLayer.classList.remove('entering');
  void el.portraitLayer.offsetWidth;              // 强制重排，让动画能重新播放
  el.portraitLayer.classList.add('entering');

  if (!src) {
    el.portraitImg.classList.add('hidden');
    el.portraitPlaceholder.classList.remove('hidden');
    return;
  }

  el.portraitImg.classList.remove('hidden');
  el.portraitPlaceholder.classList.add('hidden');
  el.portraitImg.onerror = () => {                // 立绘加载失败 -> 显示颜色块
    el.portraitImg.classList.add('hidden');
    el.portraitPlaceholder.classList.remove('hidden');
  };
  el.portraitImg.src = src;
}

function dimPortrait() {
  el.portraitLayer.classList.add('dimmed');
}

// 轮到谁说话，就换谁的立绘；没有说话人的立绘（比如主角）就把当前立绘压暗
function updatePortrait(line, scene) {
  const character = getCharacter(line.speaker);
  const src =
    line.portrait ||
    (character && character.portrait) ||
    (!state.currentPortraitSrc && scene && scene.defaultPortrait
      ? (getCharacter(scene.defaultPortrait) || {}).portrait
      : null);

  if (src) {
    setPortrait(src, character ? character.displayName : line.speaker, character && character.color);
  } else {
    dimPortrait();
  }
}

/* ---------- 场景标题 ---------- */
function showSceneTitle(scene) {
  el.sceneTitle.textContent = `${scene.name} · ${scene.id}`;
  el.sceneTitle.classList.remove('faded');
  window.setTimeout(() => el.sceneTitle.classList.add('faded'), 2600);
}

/* ---------- 打字机 ---------- */
function clearTypeTimer() {
  if (state.typeTimer !== null) {
    window.clearInterval(state.typeTimer);
    state.typeTimer = null;
  }
}

function typeText(text) {
  clearTypeTimer();
  state.fullText = text;
  el.dialogueText.textContent = '';
  el.nextIndicator.classList.remove('visible');

  if (REDUCED_MOTION || TYPE_SPEED_MS <= 0) {
    el.dialogueText.textContent = text;
    state.typing = false;
    el.nextIndicator.classList.add('visible');
    return;
  }

  const chars = Array.from(text);
  state.typing = true;
  let i = 0;
  state.typeTimer = window.setInterval(() => {
    el.dialogueText.textContent += chars[i];
    i += 1;
    if (i >= chars.length) finishTyping();
  }, TYPE_SPEED_MS);
}

function finishTyping() {
  clearTypeTimer();
  state.typing = false;
  el.dialogueText.textContent = state.fullText;
  el.nextIndicator.classList.add('visible');
}

/* ---------- 台词队列 ---------- */
function startQueue(lines, onDone) {
  state.queue = lines || [];
  state.lineIndex = 0;
  state.onQueueDone = onDone || null;
  playCurrentLine();
}

function playCurrentLine() {
  // 队列播完 -> 执行回调（显示选项 / 结束）
  if (state.lineIndex >= state.queue.length) {
    const done = state.onQueueDone;
    state.onQueueDone = null;
    if (done) done();
    return;
  }

  const line = state.queue[state.lineIndex];
  const scene = currentScene();
  const character = getCharacter(line.speaker);

  el.speakerName.textContent = character ? character.displayName : line.speaker;
  if (character && character.color) {
    document.documentElement.style.setProperty('--accent', character.color);
  }
  if (scene) updatePortrait(line, scene);

  state.mode = 'line';
  typeText(line.text);
}

// 推进对话：正在打字就先显示完整，否则下一句 / 结束
function advance() {
  if (state.mode !== 'line') return;

  if (state.typing) {
    finishTyping();
    return;
  }

  if (state.lineIndex + 1 < state.queue.length) {
    state.lineIndex += 1;
    playCurrentLine();
    return;
  }

  state.lineIndex = state.queue.length;
  const done = state.onQueueDone;
  state.onQueueDone = null;
  if (done) done();
}

/* ---------- 选项 ---------- */
function showChoices() {
  const scene = currentScene();
  if (!scene || !scene.choices || scene.choices.length === 0) {
    showEnding('');
    return;
  }

  el.choices.innerHTML = '';

  scene.choices.forEach((choice, index) => {
    const available = evaluateCondition(choice.condition, state);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    btn.style.animationDelay = `${index * 70}ms`;
    if (!available) btn.disabled = true;

    const idx = document.createElement('span');
    idx.className = 'choice-index';
    idx.textContent = String(index + 1);

    const text = document.createElement('span');
    text.className = 'choice-text';
    text.textContent = choice.text;

    btn.appendChild(idx);
    btn.appendChild(text);

    if (available) {
      btn.addEventListener('click', () => choose(index));
    } else {
      const lock = document.createElement('span');
      lock.className = 'choice-lock';
      lock.textContent = `🔒 ${choice.lockedHint || '条件未满足'}`;
      btn.appendChild(lock);
    }

    el.choices.appendChild(btn);
  });

  el.dialogueBox.classList.add('hidden');
  el.choices.classList.remove('hidden');
  state.mode = 'choices';
}

function hideChoices() {
  el.choices.classList.add('hidden');
  el.choices.innerHTML = '';
  el.dialogueBox.classList.remove('hidden');
}

/* ---------- 选择 ---------- */
function choose(index) {
  if (state.mode !== 'choices') return;

  const scene = currentScene();
  if (!scene) return;
  const choice = scene.choices[index];
  if (!choice) return;

  // 双重保险：即使被绕过界面直接调用，条件不满足也不会生效
  if (!evaluateCondition(choice.condition, state)) {
    showToast('条件不满足', null);
    return;
  }

  state.mode = 'transition';
  applyEffects(choice.effects);
  updateHUD();
  hideChoices();

  const goNext = () => transitionTo(choice.next);

  if (choice.lines && choice.lines.length) {
    startQueue(choice.lines, goNext);   // 先播选择后的反馈台词
  } else {
    goNext();
  }
}

/* ---------- 场景切换 ---------- */
function transitionTo(sceneId) {
  state.mode = 'transition';
  el.veil.classList.add('show');

  window.setTimeout(() => {
    enterScene(sceneId);
    window.setTimeout(() => el.veil.classList.remove('show'), 60);
  }, REDUCED_MOTION ? 0 : TRANSITION_MS);
}

function enterScene(sceneId) {
  const scene = getScene(sceneId);
  if (!scene) {
    showEnding(`场景「${sceneId}」不存在，剧情到此为止。`);
    return;
  }

  state.sceneId = sceneId;
  state.visits[sceneId] = (state.visits[sceneId] || 0) + 1;
  state.currentPortraitSrc = null;

  setBackground(scene);
  showSceneTitle(scene);
  hideChoices();

  // 第二次及以后进入，用简短的台词（对应 C++ 里 found 标志的效果）
  const lines =
    state.visits[sceneId] > 1 && scene.shortLines ? scene.shortLines : scene.lines;

  startQueue(lines, () => {
    if (scene.ending) {
      showEnding(scene.endingText || '');
      return;
    }
    showChoices();
  });
}

/* ---------- 结局 ---------- */
function showEnding(text) {
  state.mode = 'ended';
  el.endingText.textContent = text || '';
  el.endingScreen.classList.remove('hidden');
}

/* ---------- 重新开始 ---------- */
function resetState() {
  clearTypeTimer();
  state.typing = false;
  state.mode = 'title';
  state.sceneId = null;
  state.queue = [];
  state.lineIndex = 0;
  state.onQueueDone = null;
  state.currentPortraitSrc = null;

  state.variables = Object.assign({}, GAME_DATA.initialVariables);
  state.characters = {};
  Object.keys(GAME_DATA.characters).forEach((name) => {
    state.characters[name] = {
      affection: getCharacter(name).initialAffection || 0,
    };
  });
  state.visits = {};

  el.choices.classList.add('hidden');
  el.choices.innerHTML = '';
  el.dialogueBox.classList.remove('hidden');
  el.nextIndicator.classList.remove('visible');
  el.dialogueText.textContent = '';
  el.speakerName.textContent = '';
  el.portraitLayer.classList.add('hidden');
  el.veil.classList.remove('show');
  document.documentElement.style.setProperty('--accent', '#e8825f');
}

function startGame() {
  resetState();
  updateHUD();
  el.titleScreen.classList.add('hidden');
  el.endingScreen.classList.add('hidden');
  enterScene(GAME_DATA.start);
}

function restart() {
  startGame();
}

/* =========================================================
 * 5. 存档：和 server.js 通信
 * ========================================================= */

// 用 file:// 直接打开页面时，接口在 localhost:3000；由服务器托管时用相对路径（同源）
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

async function apiRequest(path, options) {
  let res;
  try {
    res = await fetch(API_BASE + path, options);
  } catch (err) {
    const error = new Error('连不上服务器，请先运行：node server.js');
    error.offline = true;
    throw error;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    /* 服务器没返回 JSON，用下面的 HTTP 状态码兜底 */
  }

  if (!res.ok) {
    throw new Error((data && data.message) || `HTTP ${res.status}`);
  }
  return data;
}

function setServerStatus(status) {
  el.serverDot.classList.remove('online', 'offline');
  if (status === 'online') {
    el.serverDot.classList.add('online');
    el.serverDot.title = '存档服务：已连接';
  } else if (status === 'offline') {
    el.serverDot.classList.add('offline');
    el.serverDot.title = '存档服务：未连接（先运行 node server.js）';
  } else {
    el.serverDot.title = '存档服务状态：检测中…';
  }
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('busy', busy);
}

async function checkServer() {
  try {
    await apiRequest('/api/health');
    setServerStatus('online');
  } catch (err) {
    setServerStatus('offline');
  }
}

/** 保存：把当前场景、好感度、数值发给服务器 */
async function saveGame() {
  if (!state.sceneId) {
    showToast('还没有开始游戏，没有可保存的进度', null);
    return;
  }

  setBusy(el.saveBtn, true);
  try {
    const data = await apiRequest('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneId: state.sceneId,
        characters: state.characters,
        variables: state.variables,
      }),
    });
    setServerStatus('online');
    const scene = getScene(data.save.sceneId);
    showToast(`已保存：${scene ? scene.name : data.save.sceneId}`, null);
  } catch (err) {
    if (err.offline) setServerStatus('offline');
    showToast(`保存失败：${err.message}`, null);
  } finally {
    setBusy(el.saveBtn, false);
  }
}

/** 把存档里的数值写回 state */
function applySave(save) {
  state.variables = Object.assign({}, GAME_DATA.initialVariables, save.variables || {});

  Object.keys(GAME_DATA.characters).forEach((name) => {
    const saved = save.characters && save.characters[name];
    setAffection(name, saved ? saved.affection : getCharacter(name).initialAffection || 0);
  });
}

/** 读取：从服务器取回进度并跳到存档所在的场景 */
async function loadGame() {
  setBusy(el.loadBtn, true);
  try {
    const data = await apiRequest('/api/load');
    setServerStatus('online');

    resetState();
    applySave(data.save);
    updateHUD();

    el.titleScreen.classList.add('hidden');
    el.endingScreen.classList.add('hidden');

    const scene = getScene(data.save.sceneId);
    if (!scene) {
      showToast(`存档里的场景「${data.save.sceneId}」在当前剧情里不存在`, null);
      return;
    }

    showToast(`已读取：${scene.name}`, null);
    transitionTo(scene.id);
  } catch (err) {
    if (err.offline) setServerStatus('offline');
    showToast(`读取失败：${err.message}`, null);
  } finally {
    setBusy(el.loadBtn, false);
  }
}

/* =========================================================
 * 6. 输入绑定与启动
 * ========================================================= */

el.startBtn.addEventListener('click', startGame);
el.restartBtn.addEventListener('click', restart);
el.endingRestartBtn.addEventListener('click', restart);
el.saveBtn.addEventListener('click', saveGame);
el.loadBtn.addEventListener('click', loadGame);

// 点击画面任意处推进对话（选项按钮上的点击不在此列）
el.stage.addEventListener('click', (event) => {
  if (event.target && typeof event.target.closest === 'function' && event.target.closest('button')) {
    return;
  }
  advance();
});

document.addEventListener('keydown', (event) => {
  const key = event.key;

  // Ctrl 组合键：Ctrl+S 保存 / Ctrl+L 读取
  // （这里直接 return，免得 Ctrl+R 刷新页面时被当成"重新开始"）
  if (event.ctrlKey || event.metaKey) {
    if (key === 's' || key === 'S') {
      event.preventDefault();
      saveGame();
    } else if (key === 'l' || key === 'L') {
      event.preventDefault();
      loadGame();
    }
    return;
  }

  if (key === ' ' || key === 'Enter' || key === 'Spacebar') {
    event.preventDefault();
    advance();
  } else if (key >= '1' && key <= '9') {
    choose(Number(key) - 1);
  } else if (key === 'r' || key === 'R') {
    restart();
  }
});

// 调试用：在浏览器控制台里可以访问 window.RedLionGame
window.RedLionGame = {
  data: GAME_DATA,
  state,
  startGame,
  restart,
  advance,
  choose,
  enterScene,
  evaluateCondition,
  applyEffects,
  getAffection,
  getVariable,
  getScene,
  saveGame,
  loadGame,
  applySave,
  checkServer,
};

resetState();
updateHUD();
checkServer();   // 探测 server.js 是否在运行，更新右上角指示灯
