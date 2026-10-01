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

## Stage 0 · 日记本（临时原型，整个在 `stage0/` 里）

跑法、文件分工见 `stage0/README.md`；设计见 `stage0/日记系统设计.md`。
`stage0/` 是挂在 `act1/` 旁边的实验原型，**没有改过 `act1/` 里任何一个字节**。

> 设计稿是 **v3.2（2026-10-01）**，**代码和文档两边一致**（v2 已经没有了）。
> 一页式手记、`choice.diary` + 记录旗、左上角时间显示；
> **同一时段可以多条**：先按时段（早晨 → 中午 → 午后 → 夜晚），同一时段里再按她
> 今天走过的先后拼成一段 —— 一天最多 5 条（设计稿 §2.3）。
> 走完夜晚是 `d1_sleep → d1_diary_intro → d1_end`，`d1_diary` 脱链当文本来源。
> **日记的入口按天数分**：第一天是剧情（她写完日记、敲门把册子递上来，书当场摊开），
> **第二天起**才是 HUD 上的【日记】按钮、玩家主动查看。
> Stage 0 只有一天，所以**那颗按钮属于 Stage 1**，Stage 0 不做。
>
> 还没做的两件（都不是设计稿里的活）：`stage0/shots.cjs` 里写死了 37 个节点、
> 日记那张图还盯着 `d1_diary`，**下次跑截图前先修**；版式（一页纸、时间显示、
> 开场动画）**还没过过浏览器**。

**叙事原则 —— 日记是西比拉选择让你看到的内容，不是系统显示的数值。**
玩家看不到「埋怨 +5」，只看到她写下的那一句话。随着关系提升，日记的语气会逐渐
变化（分档见 `stage0/日记系统设计.md` 附录 A）。写日记文案的时候守住这条：
**它读起来得像一个人写给自己看的东西，不能读起来像一行日志。**

**叙事原则 —— 日记里有轻微的「玩家痕迹」。**
日记是西比拉在记录她自己的生活，玩家做的事只是改变了她今天**有什么可以写**
（详见设计稿 §7）。所以：

- 不写「奥布里取消了我的课程」，写「**上午没有为伊莎贝尔小姐授课**」。
- 玩家是那件事的**原因**，不是那句话的**主语**。
- 玩家做的事不能凭空消失 —— 停课就是停课，只是从她的角度写。

**技术债 —— 现阶段 flag 借用 stat 的命名空间。**
`旗_今日停课` 用 0/1 表示，`决斗_战绩` 用计数，它们和「好感 / 健康」这类真正的
数值混在同一个 `stats` 字典里，共用 `config.statLabels` 的校验。
正式 Scheduler 做起来之后，考虑**把 flags 和 stats 分开**。
（目前只有 `stage0/story.json` 用到 flag，三幕里一个都没有。）

**技术债 —— `diaryLog` 目前是 `stats` 里的 0/1 标记，不是字符串数组。**
理由是 `snapshot()` 只存 `nodeId + stats + lineIndex`，只有数字进得去；
文本现从 `choice.diary`（静态剧情数据）里查。**Stage 1 要把它升级成字符串数组，
必须同时改 `snapshot()` / `restore()` —— 那一步才碰 `act1/`**，还要处理
老存档的向后兼容。详见设计稿 §2.2。

**规矩 —— `stage0/` 脱链的节点不许用 `ending: true` 糊 `--validate`。**
`validate()` 判「走不到」时**不看 `ending`**（只看别的节点的
`next` / `continueTo` / `choices[].next`），所以加了也没用。
`d1_diary` 的做法是：**留着 `next`（不然会被算成结局节点，`endings` 核对会红）**
＋ 在 `d1_diary_intro` 上挂一个 `if: { any: [] }` 的兜底选项指向它
（恒假 → 永远锁着；本节点有 `next`，`advance()` 里 `next` 优先于 `choices`，
所以玩家永远看不见它）。详见设计稿 §2.4–2.5。

**规矩 —— 日记摊在 `d1_diary_intro` 的最后一句之后，不在节点入口。**
`stage0.js` 用**捕获阶段**的 `document` 监听，拦下「本来会离开这个节点」的那一下输入
（空格 / 回车 / 点 `#dialogue-box`），判据是 `diary.js` 的 `atLastLine()`
（`lineIndex >= 台词总数`）。**早一句摊开，屏幕上最后那两句就被书盖住了。**
`atLastLine()` 之所以放在 `diary.js` 而不是界面层：走查只加载 `engine.js + ui.js`，
`stage0.js` 那层拦输入它看不见 —— 抽成纯函数，走查才能用真引擎把那个边距钉住
（`000001`）。改这段先跑 `node stage0/walkthrough.cjs`。

**规矩 —— 同一时段的多条，先后不由剧本写死，由她「走过」的先后定。**
`collect()`（`stage0/diary.js`）先按时段排，同一时段里再按引擎 `visited` 的先后排 ——
`visited` 是个 `Set`（迭代顺序 = 进入顺序），而且**进了存档**，所以读档之后顺序不会乱；
拿不到它才退回剧本顺序。往同一时段再加一条 diary，只要挂在带记录旗的选项上，
它就会自动落在「她走到那一步」的位置上（早晨那条就是：课照常 → 课堂上的插曲）。
