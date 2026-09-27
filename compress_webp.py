#!/usr/bin/env python3
"""
把 images/ 里的插画缩到「屏幕上真正用得到的分辨率」，就地覆盖。

所有幕的图片**统一放在仓库根目录的 images/ 下**（不再按 act1/act2 分目录），
跨幕复用同一张图时只存一份，剧本里一律写 "../images/xxx.webp"。

为什么还要缩：WebP 压的是**体积**，没动**像素**。1600x2500 的立绘在页面上最多
显示到 700px 宽，剩下那一千多像素既拖慢解码、又拖慢首屏 —— 线上实测就是这里卡。

用法（在项目根目录）：
    python compress_webp.py             # 就地缩一遍
    python compress_webp.py --dry-run   # 只看看会怎么改，不写文件

需要 Pillow：python -m pip install Pillow
"""

import io
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit('没装 Pillow，先跑：python -m pip install Pillow')

ROOT = Path(__file__).resolve().parent
DIRS = [ROOT / 'images']

# 每一类图允许的最大宽度（高度按比例走，绝不拉伸）。
#   chr_   左右两个立绘槽，最宽也就 30vw 上下 —— 800 够到 4K
#   full_  换装浮层里居中显示，按高度撑满；1448 宽的原图给到 900（=1800 高）足够
#   bg_    铺满整屏，1920 是绝大多数显示器的一整屏
RULES = [('chr_', 800), ('full_', 900), ('bg_', 1920)]
DEFAULT_WIDTH = 800          # 没归类的图按立绘对待
QUALITY = 85

# 带透明通道的图开 exact：保住透明像素底下的颜色，缩小时不会沿轮廓泛黑边
# （和 CLAUDE.md 里「立绘不许描边」那条是同一个毛病）


def cap_for(name):
    for prefix, width in RULES:
        if name.startswith(prefix):
            return width
    return DEFAULT_WIDTH


def source_for(webp):
    """
    优先拿同名的 .png 当源。

    这批 .webp 是从 PNG 压出来的，从它再压一遍是二次损失；PNG 还在的时候
    直接拿原图缩，画质更好。等哪天把 PNG 删了，自动退回用 WebP 当源，脚本照跑。

    注意：images/ 里保留下来的原图大多是**中文名**（"洗衣房.png" 这种），
    和 ASCII 名对不上，所以那几张仍然会退回用 WebP 当源。想让脚本吃到原图，
    把原图另存一份 ASCII 名的 .png 放进来（例如 bg_laundry.png）即可。
    """
    png = webp.with_suffix('.png')
    return png if png.exists() else webp


def encode(im, keep_alpha):
    kw = {'quality': QUALITY, 'method': 6}
    if keep_alpha:
        kw['exact'] = True
    buf = io.BytesIO()
    im.save(buf, 'WEBP', **kw)
    return buf.getvalue()


def main():
    dry = '--dry-run' in sys.argv
    rows = []
    before_total = after_total = 0

    for d in DIRS:
        if not d.is_dir():
            print('跳过（没有这个目录）：%s' % d)
            continue
        for webp in sorted(d.glob('*.webp')):
            src = source_for(webp)
            before = webp.stat().st_size
            with Image.open(src) as raw:
                keep_alpha = raw.mode in ('RGBA', 'LA') or 'transparency' in raw.info
                if keep_alpha and raw.mode not in ('RGBA', 'LA'):
                    raw = raw.convert('RGBA')
                w, h = raw.size
                cap = cap_for(webp.name)
                if w > cap:
                    nh = max(1, round(h * cap / w))
                    im = raw.resize((cap, nh), Image.Resampling.LANCZOS)
                else:
                    im = raw.copy()          # 已经够小：只重压一遍，不放大
                data = encode(im, keep_alpha)
                new_size = im.size

            if not dry:
                webp.write_bytes(data)
            after = len(data)

            before_total += before
            after_total += after
            rows.append((webp.relative_to(ROOT).as_posix(), src.suffix,
                         (w, h), new_size, before, after))

    if not rows:
        print('没找到任何 .webp —— 是不是把脚本放到别处了？')
        return

    print('%-40s %-5s %-13s %-13s %10s %10s' % ('文件', '源', '原尺寸', '新尺寸', '原大小', '新大小'))
    print('-' * 96)
    for rel, ext, old_wh, new_wh, before, after in rows:
        print('%-40s %-5s %-13s %-13s %9.2fMB %9.2fMB' % (
            rel, ext, '%dx%d' % old_wh, '%dx%d' % new_wh,
            before / 1048576, after / 1048576))
    print('-' * 96)
    print('共 %d 张：%.2fMB -> %.2fMB（再压掉 %.1f%%）%s' % (
        len(rows), before_total / 1048576, after_total / 1048576,
        (1 - after_total / before_total) * 100 if before_total else 0,
        '  [--dry-run，没写文件]' if dry else ''))


if __name__ == '__main__':
    main()
