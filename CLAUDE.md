# 普里森堡（红狮骑士团 · 文字冒险）

浏览器里跑的文字冒险：剧情写在 `story.json` 里，引擎照着演。第一幕（序章，西比拉视角）+ 第二幕（奥布里视角）+ 第三幕，每幕结局之后有一段「幕间自由活动」。

**所有幕的图片统一放在仓库根目录的 `images/` 下**，不再分 `act1/images`、`act2/images`；剧本里一律写 `"src": "../images/xxx.webp"`（页面在 `/act1/`，要先退一级）。没写 `src` 就按 `images/<素材key>.webp` 找，找不到才回落到像素占位。

## 改东西先看这张表（别整仓库翻）

| 想改什么 | 只看这个文件 |
|---|---|
| 剧情、台词、选项、数值、立绘指向 | `act1/story.json`、`act2/story.json`、`act3/story.json` |
| 剧情怎么走、数值判定、自由活动与换装的状态机、剧本自检 | `act1/engine.js`（纯逻辑：不碰 DOM，也不碰 Node） |
| 画面、排版、立绘摆位、选项框、换装浮层 | `act1/ui.js` + `act1/style.css` |
| 页面骨架（所有元素 id 都在这儿） | `act1/index.html` |
| 存档接口、静态文件 | `server.js` |
| 终端里跑剧情、`--validate` | `act1/game.js`（命令行 + ANSI 渲染，一行剧情规则都没有） |
| 测试 | `tests/*.cjs` |

三个 JS 的分工一句话：**`engine.js` 决定下一步演什么 → `ui.js` 把它画成 DOM / `game.js` 把它画到终端**。
浏览器只加载前两个（`act1/index.html` 末尾那两行 `<script>`），引擎在浏览器里挂在 `window.Act1Story`。

## 常跑的命令

- `node tests/run.cjs` —— 四道逻辑测试（engine / ui / server / fidelity），**改完必跑**
- `node tests/run.cjs ui` —— 只跑其中一道（engine / ui / server / fidelity）
- `node act1/game.js --validate` —— 剧本自检：节点、结局、可达性、自由活动数据
- `node tests/shots.cjs` —— 无头 Edge 截图 + 量真实尺寸（四个分辨率）；`--e2e` 是从开始界面真玩一遍
- `node server.js` —— http://localhost:3000/act1
- `node act1/game.js` —— 在终端里直接玩

## 不许碰的

- **台词只能用小说原文逐字重建。** 原文在 `act1/source/`、`act2/source/`、`act3/source/`，`tests/fidelity.cjs` 有正查 + 反查两道机械核对。自由活动里的 `[...]` 占位文本是用户明确允许的，所以它们放在 `freeRoam` 数据块里、**不进节点的 `dialogues`** —— 进了就会被原文核对拦下。
- `images/` 里的原件（含中文名原图）、`act1/source/`、`act2/source/`、`act3/source/` 是**若干文件的唯一副本**：不许删、不许改名。要用的素材先复制成 ASCII 名再放进去（`images/` 里如 `chr_maid.webp` 就是这么来的）。
- 仓库根目录的 `game.js`、`index.html`、`MyGame.exe`、`*.cpp`、`*.obj` 是**上一代废弃原型**，没有被加载，不要改别在那儿找代码。（`act1/game.js` 是另一回事，那是现在的终端入口。）
- 立绘槽位 `.portrait-slot` 和四个图片宿主不许有 border / background / box-shadow；`#portrait-image*` 不许用 `drop-shadow`（立绘是抠好的，加阴影会露出底边）。
- 背景模糊只能加在换装浮层自己的 `#outfit-veil` 上。给 `#stage` / `#app` 加 `filter` 会让 `position:fixed` 的 `#bg-layer` 失去视口定位（`style.css` 里有注记）。
- 大改动不要写进系统临时目录（没有 git 兜底），放项目里，跑完清掉。

## 剧本的硬规矩（`--validate` 会查）

- **自由活动的锚点节点（`freeRoam: true`）不许写 `next`** —— `advance()` 里 `next` 优先于自由活动状态机，写了就再也回不到菜单。菜单是运行时生成的。
- 节点没有 `next`、没有 `choices`、也没有 `ending` = 卡死，自检报错。
- `effects` / `if` 里出现的数值，必须先在 `config.statLabels` 里定义过。
- 位置用「锚点节点 id」表示：`snapshot()` / `restore()` 只认 `nodeId + stats + lineIndex`，所以自由活动里「她此刻穿着什么」天然被存档记住，不用加字段。
- **报仇场景 `fr_revenge` 的 `dialogues` 必须是空的** —— 它那几句占位台词走 `freeRoam.revenge.lines`，写进 `dialogues` 就会被原文核对当成自编台词拦下。

## 几处「一改就红」的数字（都在测试里）

- 节点 **109** 个（act1 34 + act2 42 + act3 33，其中 14 个是自由活动锚点，另有 1 个报仇结局 `fr_revenge` 不在 `anchors` 里）、结局 **5** 个、可达 109
- 数值区间写在 `config.statRanges`，没写的按 `[0, 100]`；两个「好感」是 `[-100, 100]`（`西比拉_警惕` 没写，所以是 `[0, 100]`，第三幕那个 −1 最低只压到 0）
- 枚举路径 `ALL_PATHS.length === 13824`，且每条路径**跨进第三幕那一刻**「伊莎贝尔_好感 + 西比拉_警惕 恒等于 3」（第三幕自己的选项会各 ±1）
- 视角切换 2 次；`a10_end.continueTo === 'b1_room'`；`b25_end.continueTo === 'c1_door'`；`c27_end.continueTo` 不存在
- `tests/dom-stub.cjs` 的元素是**按 `index.html` 里的 `id="..."` 正则扫出来**的：加了带 id 的新元素，要同步 `ui.js` 的 `mount()` 列表和 `ui.test.cjs` 里的计数
- 数值提示（`#toast` / `statNotes`）里的文案**不许带数字**
