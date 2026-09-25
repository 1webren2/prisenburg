# 图片素材目录

把美术素材按下面的**文件名**放进这个目录，刷新网页就会自动替换掉颜色块占位。
文件名对不上（或缺图）时不会报错，页面会继续显示 CSS 颜色块。

| 文件名 | 用途 | 建议尺寸 |
|---|---|---|
| `bg_hall.jpg` | 骑士大厅 · 背景 | 1920 × 1080 |
| `bg_training.jpg` | 训练场 · 背景 | 1920 × 1080 |
| `sibylla.png` | Sibylla 立绘（平时） | 800 × 1200，背景透明 |
| `sibylla_happy.png` | Sibylla 立绘（好感度分支解锁后） | 800 × 1200，背景透明 |

要换路径或加新图，改 `game.js` 里 `GAME_DATA` 的这两处即可：

- `scenes[].background.image` —— 场景背景
- `characters[].portrait` / `lines[].portrait` —— 立绘（写在台词上可以临时换表情）

支持 jpg / png / webp / gif / svg，改扩展名的时候记得同步改 `game.js` 里的路径。
