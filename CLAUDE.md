# 普里森堡（红狮骑士团 · 文字冒险）

浏览器里跑的文字冒险：剧情写在 `story.json` 里，引擎照着演。第一幕（序章，西比拉视角）+ 第二幕（奥布里视角）+ 第三幕，每幕结局之后有一段「幕间自由活动」。

**所有幕的图片统一放在仓库根目录的 `images/` 下**，不再分 `act1/images`、`act2/images`；剧本里一律写 `"src": "../images/xxx.webp"`（页面在 `/act1/`，要先退一级）。没写 `src` 就按 `images/<素材key>.webp` 找，找不到才回落到像素占位。

## 文稿归了类：根目录那五个文件夹（第四轮收尾）

**它们一个字节都不参与运行**，是给人翻的。真跑的东西（`act1/` `act2/` `act3/` `daily/` `hunt/` `stage0/` `images/` `store/`
`act*/source/`、`server.js`、`tests/`）**全在原地没动** —— 它们靠相对路径加载、`tests/` 里还写死了一批路径、
`server.js` 拿它们校验存档，搬走就散架。所以那四个分类文件夹里放的是**索引 README + 能搬的文稿**：

| 文件夹 | 里面是什么 | 各自的 README 写清了什么 |
|---|---|---|
| `游戏实际运行稿/` | `script_review/`（当前实际剧本的人工编辑导出）、`普里森堡_剧情稿整理与Claude首轮修改资料包/`（＝原 `_instr_round1/`）、那份 `.docx`、`回填报告_首轮.md` | 真正的 `story.json` 在哪、改完该跑什么、红线是什么 |
| `游戏小说原稿/` | `原著参考_第六至九章/`（与 `store/` 逐字节相同的副本） | 第一～三章在 `act*/source/`、第四～十一章在 `store/`，以及原文核对怎么用 |
| `游戏立绘插图/` | 只有 README | 图全在 `images/`，逐条列了「一碰就出事」的规矩（不许删改名、不许加阴影、模糊只能加在 `#outfit-veil`） |
| `游戏系统/` | 只有 README | 页面加载顺序、每个系统住在哪些文件里、测试怎么跑 |
| `废件/` | 上一代 C++ 原型（`.cpp/.h/.obj`、`MyGame.exe`、`build.bat`）、上一代网页原型（根目录老的 `game.js`/`index.html`/`style.css`）、`首轮修改指令.zip`、`server.log`、空目录 | 逐条写「能不能从 git 捞回来」，等你划完再删 |

`server.js` 的拦截名单跟着加了 `/游戏实际运行稿`、`/游戏小说原稿`、`/废件` 三条
（资料包里带着第六～九章原文，zip 里也是同一批）；**这三条是中文前缀，浏览器会 percent-encode，
所以拦截时要先 `decodeURIComponent` 再比一遍** —— 只比原串等于没拦。

**把根目录老 `index.html` 搬走有个副作用**：`express.static` 的 `index` 没了，
`http://localhost:3000/` 不再有页面（真页面一直是 `/act1`）。

## 改东西先看这张表（别整仓库翻）

| 想改什么 | 只看这个文件 |
|---|---|
| 剧情、台词、选项、数值、立绘指向 | `act1/story.json`、`act2/story.json`、`act3/story.json`、`daily/story.json` |
| 剧情怎么走、数值判定、自由活动与换装的状态机、剧本自检 | `act1/engine.js`（纯逻辑：不碰 DOM，也不碰 Node） |
| 画面、排版、立绘摆位、选项框、换装浮层 | `act1/ui.js` + `act1/style.css` |
| 页面骨架（所有元素 id 都在这儿） | `act1/index.html` |
| 存档接口、静态文件 | `server.js` |
| 终端里跑剧情、`--validate` | `act1/game.js`（命令行 + ANSI 渲染，一行剧情规则都没有） |
| 测试 | `tests/*.cjs` |
| **药材与药方的目录**（有哪几味、长什么样、几张方子、品质分档） | `daily/alchemy.js` |
| **熬药的规则**（状态机、三条工序处理器、评分、结算计划） | `daily/brew.js`（纯逻辑） |
| **熬药的界面**（浮层、手册、那两根条、账册采购的结算时点） | `daily/brew-ui.js` + `daily/brew.css` |
| 六张物品图（**现在全是占位**） | `daily/item-icons.js` + `daily/story.json` 的 `art.assets` |
| 府邸账目与固定采购的**数据** | `daily/story.json` 的 `pharmacy` 块 |

三个 JS 的分工一句话：**`engine.js` 决定下一步演什么 → `ui.js` 把它画成 DOM / `game.js` 把它画到终端**。
浏览器只加载前两个（`act1/index.html` 末尾那两行 `<script>`），引擎在浏览器里挂在 `window.Act1Story`。
熬药那一路是同一套分工的第二个例子：**`alchemy.js` 提供数据 → `brew.js` 决定这一步做得怎么样 → `brew-ui.js` 把它画成浮层**。

## 常跑的命令

- `node tests/run.cjs` —— 六道逻辑测试（engine / ui / server / fidelity / daily / brew），**改完必跑**
- `node tests/run.cjs ui` —— 只跑其中一道（engine / ui / server / fidelity / daily / brew）
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
- 熬药那一轮之后：`initialStats` **31** 项、`config.statLabels` **43** 项（多出来的是 6 项库存 + 2 面结算旗），
  六面库存全是 `[0, 99]`；`engine.test.cjs` 里那几条计数与「不从 0 起」的名单、`server.test.cjs` 里那张数值表都跟着改
- 账目的加总（`pharmacy.ledger.total === 各项之和`、正文里那几个数）在 `tests/brew.test.cjs` 里对账 —— **改金额要同时改正文**，不然那一节就红
- 教室线那一轮之后总节点数 **358**（日常层 **119**）、整场**只切 1 次视角**（周六夜进狩猎篇）；
  `engine.test.cjs` 的 `RETIRED_CLASSROOM`、`server.test.cjs` 与 `tests/shots.cjs` 里的 358、
  以及 `daily.test.cjs` 里那几条 day-2 结构断言都跟着改

## 第二天早晨的教室线（第四轮按作者稿重写）

作者稿（`普里森堡_第一二天剧情稿_第一夜日记后续衔接修正版.docx`）把第二天早晨的
「活动 A · 三楼的教室」整段写成了**奥布里视角**。所以现在走的是 `daily/story.json` 里的
七节：`dy_d2_mo_cls_door_e`（走廊）→ `_room_e`（伊莎贝尔的房间）→ `_desk_e`（书房，
楼下布朗与海尔）→ `_stand_e`（教室僵持）→ `_r`（介入，三选一 = 旗_授课方式）→
`_call_e`（授课继续 + 敲门就餐）→ `_after_e`（教室里只剩西比拉）→ 午餐。
三个走向仍是首轮那三节 `dy_d2_mo_{strict,plain,soft}_e`，正文没动，只是出口改接 `_call_e`。

**第二幕原著那条同名线（`b12_morning` ~ `b22_after`）正文一个字未动，整条脱链留档**
（见 `tests/engine.test.cjs` 的 `RETIRED_CLASSROOM`）。别再把它接回主线 ——
作者要的是上面那个奥布里视角的版本。

- **正文逐字取自那份稿**，基准在 `store/第二天早晨教室线.txt`，
  `tests/daily.test.cjs` 按拼接核对逐字钉住（与其它 author 稿同一套mechanism）。
  稿子里「后续：…」那几行是**给制作方的注记，不是台词** —— 它们存在三个选项的 `_note` 里。
- **整条线都是奥布里的镜头**，所以从早晨菜单走进去**不切视角、不弹横幅**。
  以前前半段是她的镜头（`b12~b16`），走进去会闪一下「奥布里>西比拉」再弹回来。
- **她那天穿教师服，但她在右槽**（左槽是奥布里）。右槽平常取 `characters[谁].portrait`
  （固定的那一张），所以那几节里西比拉的每一句都写了 `dialogues[].portrait = chr_sibylla_teacher`。
  引擎支持**逐句立绘覆盖**（`line.portrait || characters[谁].portrait`），
  `upcomingAssets()` 也跟着它提前拉图 —— 给谁换了衣服的场景就用这一条，别去改人物表。
- 日记那几条补记（她没亲历课堂时自己写下来的）挂在**新节点**上；其中两处的**时段是作者定的**
  （上课那段记在中午、海尔来叫吃饭那段记在午后），所以它们不跟着节点 id 的时段走，
  这条豁免明写在 `tests/daily.test.cjs` 里。

## 对话框的覆盖范围（第四轮）

对话框那块「皮」铺满整个界面宽：`#dialogue-box::before`，`left: 0` 一路到
`right: calc(-1 * var(--panel-w))`。原因：`#app` 是两栏 grid（左＝剧情，右＝数值面板占
`--panel-w`），对话框是左栏的子元素，`align-self: stretch` 只铺得满左栏 ——
面板收起来的时候右边会空出一条 240px 的口子。

**底色 / 毛玻璃 / 上沿描边 / 往上打的柔光，四样都在这一个伪元素上。**
这条是硬规矩：**不许拆成两块来拼**（本体一块 + 右边再补一条）。拆开的话两层的
`backdrop-filter` 各算各的、两道柔光在接缝处叠起来，看着就是两块板子拼在一起
（用户的原话：「怎么会有两个对话框」）。只有一层就不可能出缝。

**内容一个像素都不挪**：正文留白还是 `--dialogue-gutter`，
立绘抬起高度还是 `--portrait-lift`。要改覆盖范围就改那一条伪元素，
别去动 `#app` 的栅格（那会把立绘与选项的定位一起掀了）。
皮是绝对定位，会盖住没定位的正文 —— 所以 `#dialogue-text` 抬到
`position: relative; z-index: 1`，姓名牌与「继续」提示各补一个 `z-index: 1`。

`tests/ui.test.cjs` 按「只有一个盒子在画背景」机械化地钉死这几条
（本体自己不许再写 background / box-shadow / backdrop-filter / border-top），
`tests/shots.cjs` 每一屏都量「皮够不够到窗口右边、正文在不在它上面」（`dlgStrip` / `dlgText`）。

## 熬药（第四轮，全在 `daily/` 里）

第二天傍晚 `dy_d2_ev_brew_e` 那一场接了一个小游戏：四道工序、火候、来回扫的火口、评分、
跳过，以及账册那条固定采购。分工见上面那张表。

**规矩 —— 库存住在 `stats` 里。** 引擎的 `snapshot()` 只存 `nodeId + stats + lineIndex`，
仓库里没有独立的背包系统，所以「治病药材还剩几份」就是引擎数值表里的几项：
键是 `药材_ + 物品 id`（`药材_ing_willow_bark`），**判断一律不拿中文显示名当身份**。
这一借是有意的，也是「flag 与数值共用 stats」那笔技术债的一部分 —— 换来的好处是
存档 / 读档、服务器校验白名单、老存档兼容三样全都不用动。

**规矩 —— 扣材料只在结算，一次，且与玩家点错无关。** 投错料不额外扣、也不锁定，
它只影响这一阶段的成绩；真正扣的是方子上写的那几味各一份（`requiredMaterials()`），
在 `COMPLETED` 那一刻由 `settlementPlan()` 一次性算出来。所以「材料什么时候少的」
永远只有一个答案。写库存只许走 `brew-ui.js` 里那一个 `addStat()`。

**规矩 —— 结算只认一次。** 三道闸：这次浮层里写过了（`settledThisRun`）、
这一局里写过了（`旗_熬药结算`）、这一锅压根没做完（`settlementPlan` 返回 null）。
连点、读档跳回同一句、来回进出账册，都发不出第二份（账册那边认 `旗_账册药材结算`）。

**规矩 —— 浮层挂在「最后一句之前」那一句上。** `dy_d2_ev_brew_e` 五句，
最后一句是「药煎好后……」，熬药要发生在那句之前 —— 拦的是
`lineIndex === 总句数 − 1` 那一下输入（做法与 `daily.js` 摊开日记本那次一样，
**捕获阶段**先下手）。**正文五句一个字没动，也没有给它加任何选项**；
熬完 / 跳过 / 甚至料不够，都照原样走 `dy_d2_ni_end_e`，主线不断。

**规矩 —— 熬药期间键盘归它。** 捕获阶段 `stopImmediatePropagation`，
空格 / 回车不许漏到 `ui.js` 去推剧情。默认键：空格 / ↑ 按住添柴、Enter 确认、
`1~9` 投药、`M` 翻手册、Esc 合上手册。**翻开手册不停表**（引擎那边一无所知）。

**规矩 —— 倒计时按真实经过的时间算。** 每次 tick 拿注入的时钟算 elapsed，
不是「定时器回调一次就减一格」：掉帧、切标签页都不影响判定。
切走再回来时超时当场结清，制作照常往下走。游戏内那 30 分钟是**固定**的，
不随玩家手快手慢改变，只进结算信息。

**六张物品图现在全是占位**（`daily/item-icons.js`）：没有正式的成品图，
所以画的是带「占位」角标的内联 SVG，节点上写着 `data-art="placeholder"`，
`brew.test.cjs` 与 `shots.cjs` 都会查这件事。**别把它说成正式素材。**
作者交图之后：把图放进 `images/`，在 `daily/story.json` 的 `art.assets` 里给那条
补一个 `"src": "../images/<key>.webp"` —— 代码一行不用改，角标自己消失。
（这一组**故意不走**「没写 src 就按约定路径试」那条：那会每次开界面先 404 一轮。）

**账册那一段是本轮唯一被授权扩写的正文。** 原文一字未动地留着（前段 + 收尾那半句），
新增的四句夹在中间，由 `tests/daily.test.cjs` 里的 `LEDGER_ADDED` 逐字盯着 ——
**想偷偷改原文，前段 / 收尾两条立刻拦下；想往中间塞东西，第三条拦下。**
`store/第二天新场景.txt` 那份基准一个字都没动。金额是**暂定值**（原著没有货币单位），
数据源是 `daily/story.json` 的 `pharmacy.ledger`，正文里那几个数由 `brew.test.cjs` 对着它核。

## Stage 0 · 日记本（临时原型，整个在 `stage0/` 里）

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
