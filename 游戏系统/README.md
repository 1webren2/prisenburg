# 游戏系统

**代码全部原地没动。** 它们靠相对路径互相加载、`tests/` 里还写死了一批路径，搬走就散架。
这份 README 是「哪个系统住在哪些文件里、想改该翻哪一页」的索引。

> 仓库根的 **`CLAUDE.md`** 才是权威的分工表与规矩清单。这里只做定位。

---

## 一句话分工

**`engine.js` 决定下一步演什么 → `ui.js` 把它画成 DOM / `game.js` 把它画到终端。**
熬药那一路是同一套分工的第二个例子：
**`alchemy.js` 提供数据 → `brew.js` 决定这一步做得怎么样 → `brew-ui.js` 把它画成浮层。**

---

## 一、页面骨架与加载顺序

入口页面是 **`act1/index.html`**（`http://localhost:3000/act1`）。第二、三幕没有自己的页面，
它们通过 `meta.continues` 并进**同一张节点表**，还是这个页面在跑。

`act1/index.html` 末尾按这个顺序加载：

```
style.css                ← 主样式（所有元素 id 都在 index.html 里）
../daily/daily.css       ← 日常层样式，全部挂在 dy- 前缀的类上
../daily/brew.css        ← 熬药浮层样式

engine.js                ← 纯逻辑：不碰 DOM，也不碰 Node
ui.js                    ← 画成 DOM；mount() 那份元素清单对着 index.html 的 id 扫
../daily/diary.js        ← 日记：collect() / atLastLine()
../daily/daily.js        ← 日常层状态机
../daily/alchemy.js      ← 药材与药方的目录（数据）
../daily/item-icons.js   ← 六张物品图（现在全是占位）
../daily/brew.js         ← 熬药规则：状态机、工序处理器、评分、结算计划（纯逻辑）
../daily/brew-ui.js      ← 熬药界面：浮层、手册、两根条、账册结算时点
```

引擎在浏览器里挂在 `window.Act1Story`。

---

## 二、各系统在哪

| 系统 | 文件 | 备注 |
|---|---|---|
| **剧情引擎**（走节点、数值判定、自由活动与换装状态机、剧本自检） | `act1/engine.js` | 纯逻辑，不碰 DOM 也不碰 Node |
| **界面渲染** | `act1/ui.js` + `act1/style.css` | 立绘摆位、选项框、换装浮层 |
| **终端界面** | `act1/game.js` | 命令行 + ANSI 渲染，**一行剧情规则都没有**；`--validate` 在这儿 |
| **存档接口 / 静态文件** | `server.js`（仓库根） | 同时是 express 静态服务器；`/store`、`/act*/source` 在这里被挡 |
| **日常层** | `daily/daily.js` + `daily/daily.css` | 第二天起的时间线、时段菜单、自由活动 |
| **日记本** | `daily/diary.js` | 一页式手记；`collect()` 按时段 + 走访先后排序 |
| **熬药 · 数据** | `daily/alchemy.js` | 有哪几味药材、长什么样、几张方子、品质分档 |
| **熬药 · 逻辑** | `daily/brew.js` | 状态机、三条工序处理器、评分、`settlementPlan()` |
| **熬药 · 界面** | `daily/brew-ui.js` + `daily/brew.css` | 浮层、手册、两根条、账册采购的结算时点 |
| **物品图占位** | `daily/item-icons.js` | 全是带「占位」角标的内联 SVG |
| **Stage 0 日记本原型** | `stage0/`（整套独立） | `stage0/README.md` + `stage0/日记系统设计.md`；**没改过 `act1/` 一个字节** |
| **测试** | `tests/` | 见下 |

页面骨架里**所有元素 id 都在 `act1/index.html`** —— 加一个带 id 的新元素，
要同步 `ui.js` 的 `mount()` 列表和 `tests/ui.test.cjs` 里的计数
（`tests/dom-stub.cjs` 的元素是按 `index.html` 里的 `id="..."` 正则扫出来的）。

---

## 三、剧本数据

| 文件 | 是什么 |
|---|---|
| `act1/story.json` | 第一幕 |
| `act2/story.json` | 第二幕 + 幕间自由活动的 `freeRoam` 块 |
| `act3/story.json` | 第三幕 |
| `hunt/ch4.json` ~ `ch9.json` | 狩猎篇 |
| `daily/story.json` | 日常层；`meta.continues` 指向 `../hunt/ch4.json` |
| `daily/story.json` 的 `pharmacy` 块 | 府邸账目与固定采购的**数据** |
| `daily/story.json` 的 `art.assets` | 六张物品图的登记处 |
| `stage0/story.json` | Stage 0 原型 |

**剧情稿与原文的归类见 `游戏实际运行稿/` 和 `游戏小说原稿/` 两个文件夹。**

---

## 四、测试

```bash
node tests/run.cjs              # 六道全跑（engine / ui / server / fidelity / daily / brew）—— 改完必跑
node tests/run.cjs ui           # 只跑其中一道
node tests/shots.cjs            # 无头 Edge 截图 + 量真实尺寸（四个分辨率）
node tests/shots.cjs --e2e      # 从开始界面真玩一遍
node act1/game.js --validate    # 剧本自检：节点、结局、可达性、自由活动数据
node stage0/walkthrough.cjs     # Stage 0 的走查
```

| 文件 | 管什么 |
|---|---|
| `tests/run.cjs` | 总入口 |
| `tests/harness.cjs` | 测试小框架（`t.eq` / `t.ok` / `suite`） |
| `tests/dom-stub.cjs` | DOM 替身；元素按 `act1/index.html` 的 `id="..."` 正则扫出来 |
| `tests/engine.test.cjs` | 引擎：节点计数、数值区间、枚举路径、视角切换、脱链留档 |
| `tests/ui.test.cjs` | 界面：对话框那块「皮」只有一个盒子在画背景 |
| `tests/server.test.cjs` | 存档接口 + 静态文件拦截 + 数值表 |
| `tests/fidelity.cjs` | **原文核对**：正查 + 反查（见 `游戏小说原稿/README.md`） |
| `tests/daily.test.cjs` | 日常层结构与作者稿逐字核对 |
| `tests/brew.test.cjs` | 熬药：占位图、账目加总与正文对账 |
| `tests/shots.cjs` | 无头截图；产物在 `tests/shots/`（gitignore 掉了） |

**几处「一改就红」的数字**（全在测试里）写在 `CLAUDE.md`，动之前先看那一节。

---

## 五、跑起来

```bash
node server.js      # http://localhost:3000/act1  （根目录 / 是上一代原型，已搬进 废件/）
node act1/game.js   # 在终端里直接玩
```
