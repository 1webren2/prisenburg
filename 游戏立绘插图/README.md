# 游戏立绘插图

**所有幕的图都只有一处：仓库根的 `images/`。** 那里没有分 `act1/images`、`act2/images`，
而且它**不能搬走** —— 剧本里一律写相对路径 `"src": "../images/xxx.webp"`（页面在 `/act1/`，要先退一级），
`compress_webp.py` 也只遍历那一个目录。

> **素材总表（权威）在 `images/README.md`** —— 逐张说明谁用在哪、尺寸、大小、还缺什么。
> 这份 README 只给概览和几条**一碰就出事的规矩**。

---

## 目录里现在有什么

| 类别 | 数量 | 说明 |
|---|---|---|
| `bg_*.webp` | 10 | 背景，1920 × 1080，铺满舞台 |
| `chr_*.webp` | 11 | 半身立绘，800 × 1200，站在立绘槽里 |
| `full_*.webp` | 4 | 全身像，900 × 1800，**只给换装浮层用** |
| `cut_hunt_return.jpg` + `漫长 拷贝.jpg` | 2 | 过场图 |
| 中文名 `.png` **原图** | 28 | 见下面「不许碰的」 |
| `item_*.webp` | 0 | **六张物品图一张都还没有** —— 现在画的是占位 |

### 通用立绘（不必再画新的）

`chr_soldier`（侍卫）、`chr_groom`（马夫）、`chr_maid`（普通女仆）这三张是**通用**的 ——
没有单独立绘的角色直接套用它们。

### 跨幕共用的素材

教室 `bg_classroom` 在第二幕登记一次，第三幕的授课场景直接引用同一个 key。
**同一个 key 不要在两幕各登记一遍** —— 内容不同的话 `composeStories()` 会直接抛错。

### 还没交的六张物品图

`item_willow_bark`、`item_bitter_root`、`item_silverleaf`、`item_honey`、
`item_mustard_seed`、`item_daily_decoction`。

规格：**单一物件、透明底**，统一视角 / 光照 / 比例 / 边缘处理，正方形、512² 上下，
转成 WebP 后叫 `item_<key>.webp` 放进 `images/`，**中世纪阴郁幻想**的气质，
不要现代药瓶、药房包装、过亮的卡通图标。

接法：在 `daily/story.json` 的 `art.assets` 里给对应那条补
`"src": "../images/item_willow_bark.webp"` 并删掉那条上的 `"placeholder": true` —— **代码一行不用改**，
角标自己消失。**别在没交图之前就写上 `src`**（那会把占位说成正式素材）。

> 现在画的是 `daily/item-icons.js` 里的内联 SVG 占位（带「占位」角标，节点上标着 `data-art="placeholder"`），
> `tests/brew.test.cjs` 与 `tests/shots.cjs` 都会查这件事。**别把占位说成正式素材。**

---

## 一碰就出事的规矩

1. **中文名原图不许删、不许改名。** `西比拉立绘.png`、`伊莎贝尔半身.png`、`马夫 拷贝.png`、
   `洗衣房.png` 这些是**若干文件的唯一副本**。要用的素材先**复制**成 ASCII 名再转 WebP
   （`chr_maid.webp` 就是这么来的），原件一直留在原地。

2. **立绘槽位 `.portrait-slot` 和四个图片宿主不许有 border / background / box-shadow。**
   `#portrait-image*` **不许用 `drop-shadow`** —— 立绘是抠好的，加阴影会露出底边。

3. **背景模糊只能加在换装浮层自己的 `#outfit-veil` 上。** 给 `#stage` / `#app` 加 `filter`
   会让 `position:fixed` 的 `#bg-layer` 失去视口定位（`style.css` 里有注记）。

4. **逐句立绘覆盖**用 `dialogues[].portrait`，**别去改人物表**。
   引擎支持 `line.portrait || characters[谁].portrait`，`upcomingAssets()` 也跟着提前拉图。
   （第二天教室线就是：西比拉穿教师服但站右槽，所以那几节她的每一句都写了
   `"portrait": "chr_sibylla_teacher"`。）

5. **没写 `src` 就按 `images/<素材key>.webp` 找**，找不到才回落到引擎生成的像素占位图。
   唯一**故意不走**这条约定路径的是那六张物品图 —— 走了会每次开界面先 404 一轮。

---

## 压缩

`compress_webp.py`（仓库根）**只遍历 `images/` 这一个目录**：对目录里每个 `.webp`，
按文件名前缀决定最大宽度（`chr_` 800 / `full_` 900 / `bg_` 1920，高度按比例，**绝不拉伸**），
**就地覆盖**那个 `.webp`；同名 ASCII 名 `.png` 在的话拿它当源（画质更好），不在就拿 WebP 自己当源。
**中文名原件不碰。**

```bash
python compress_webp.py
```

改完图跑一遍截图看看有没有被压坏：

```bash
node tests/shots.cjs        # 四个分辨率各量一遍真实尺寸
```
