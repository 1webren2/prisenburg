# images/ —— 素材总表

**所有幕的图都放这一个目录**（不再有 `act1/images`、`act2/images`）。剧本里一律写相对路径
`"src": "../images/xxx.webp"`（页面在 `/act1/`，要先退一级）；不写 `src` 时按
`images/<素材key>.webp` 找，再找不到才回落到引擎生成的像素占位图。

素材 key 和文件名一一对应：key `chr_maid` → 文件 `chr_maid.webp`。

## 命名与规格

| 前缀 | 是什么 | 尺寸 | 说明 |
|---|---|---|---|
| `bg_` | 背景 | 1920 × 1080 | 铺满舞台 |
| `chr_` | 半身立绘 | 800 × 1200 | 站在立绘槽里；已抠好底，禁止加 `drop-shadow` |
| `full_` | 全身像 | 900 × 1800 | 只给换装浮层用 |

**通用立绘**：`chr_soldier`（侍卫）、`chr_groom`（马夫）、`chr_maid`（普通女仆）这三张是通用的 ——
没有单独立绘的角色直接套用它们，不必再画新的。

## 25 张 WebP（共约 5.09 MB）

### 背景 bg_（1920 × 1080）

| 文件 | 用在哪 | 大小 |
|---|---|---|
| `bg_carriage.webp` | 第一幕 · 马车车厢（雨） | 180.2 KB |
| `bg_gate.webp` | 第一幕 · 雨中的普里森堡远景 / 城堡门口吊桥前 / 外庭院佣兵宿舍（一图三用） | 317.1 KB |
| `bg_hall.webp` | 第一幕 · 大厅高台与主座背后；第三幕 · 大宅门厅 | 279.8 KB |
| `bg_sibylla_room.webp` | 第二幕 · 西比拉的新房间（三楼） | 324.5 KB |
| `bg_corridor.webp` | 第二幕 · 三楼过道；第三幕 · 楼梯 | 169.8 KB |
| `bg_classroom.webp` | 第二幕 · 三楼教室 | 322.6 KB |
| `bg_isabelle_room.webp` | 第二幕 · 伊莎贝尔的卧室；第三幕 · 授课场景 | 339.0 KB |
| `bg_aubrey_room.webp` | 第二幕 · 奥布里的房间（幕间自由活动的 hub） | 192.2 KB |
| `bg_laundry.webp` | 第三幕 · 洗衣房 | 352.7 KB |
| `bg_meadow.webp` | 第三幕 · 府邸外的草地 | 581.9 KB |

> 第三幕的**书房**（`bg_study`）暂时没有图，故意不写 `src`，走像素占位 —— 画好了丢一张
> `bg_study.webp` 进来即可，剧本不用改。

### 半身立绘 chr_（800 × 1200）

| 文件 | 是谁 | 大小 |
|---|---|---|
| `chr_sibylla.webp` | 西比拉 · 女仆装 | 113.8 KB |
| `chr_sibylla_teacher.webp` | 西比拉 · 牧师服（＝教师服） | 138.6 KB |
| `chr_sibylla_riding.webp` | 西比拉 · 骑装 | 170.5 KB |
| `chr_sibylla_black.webp` | 西比拉 · 黑礼服 | 144.9 KB |
| `chr_aubrey.webp` | 奥布里 · 德 · 沃 | 132.5 KB |
| `chr_brown.webp` | 布朗管家 | 123.1 KB |
| `chr_isabelle.webp` | 伊莎贝尔 | 156.5 KB |
| `chr_haier.webp` | 海尔 | 141.8 KB |
| `chr_soldier.webp` | 门房佣兵（**通用**） | 141.5 KB |
| `chr_groom.webp` | 马夫（**通用**；第一幕的约翰用的就是它） | 142.5 KB |
| `chr_maid.webp` | 普通女仆（**通用**；第三幕的女仆用的就是它） | 105.8 KB |

### 全身像 full_（900 × 1800，只给换装浮层）

| 文件 | 是哪套衣服 | 大小 |
|---|---|---|
| `full_sibylla_maid.webp` | 女仆装 | 146.9 KB |
| `full_sibylla_teacher.webp` | 牧师服 | 154.2 KB |
| `full_sibylla_riding.webp` | 骑装 | 180.7 KB |
| `full_sibylla_black.webp` | 黑礼服 | 155.6 KB |

## 原图（28 张中文名 PNG）—— 不许删、不许改名

`西比拉立绘.png`、`伊莎贝尔半身.png`、`马夫 拷贝.png`、`洗衣房.png` 等等这些是**若干文件的唯一副本**。
要用的素材先**复制**成 ASCII 名再转 WebP（`chr_maid.webp` 就是这么来的），原件一直留在原地。

## 压缩

`compress_webp.py`（仓库根目录）**只遍历这个目录**：对目录里每个 `.webp`，按文件名前缀
决定最大宽度（`chr_` 800 / `full_` 900 / `bg_` 1920，高度按比例，绝不拉伸），**就地覆盖**那个 `.webp`；
同名 ASCII 名 `.png` 在的话拿它当源（画质更好），不在就拿 WebP 自己当源。中文名原件不碰。
