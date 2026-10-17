/* =====================================================================
   物品图标（药材 5 + 成品 1）—— 正式图还没画，这一份是**占位**
   ---------------------------------------------------------------------
   =====================================================================
   一、现在是什么状态（别把它当成正式素材）
   ---------------------------------------------------------------------
   这六张图**还没有正式的成品图**。文件里画的是**占位**：24×24 的线描，
   照指令里写的外观意思勾了个轮廓（卷曲的树皮条 / 有纤维的根茎切片 /
   浅脉的叶子 / 小陶罐 / 几粒种子 / 一只陶杯），够认出是哪一味，不是美术。

   所以每一张占位都**带标记**，两个地方都写死：
     · 节点上的 data-art="placeholder"（测试会查它，见 tests/brew.test.cjs）
     · 右下角一个「占位」角标（.dy-brew-art-tag，画在图标上）
   测试还会断言：**这六张里没有一张被当成正式图**。等作者把图交上来，
   往 daily/story.json 的 art.assets 里给对应那条加一个 "src" 就换掉了 ——
   代码一行都不用改，角标也跟着自己消失。

   =====================================================================
   二、找图的规矩（与 act1/ui.js 有一处**故意不同**）
   ---------------------------------------------------------------------
   ui.js 那边是「没写 src 就按 ../images/<key>.webp 试，试不通再退回像素图」。
   物品图标这一组不走那条：**写没写 src 就是「有没有正式图」的开关**，
   没写就直接画占位，不去试那个约定路径 —— 六张图每次开界面都先 404 一轮，
   控制台里会一直响。

   写 src 的那天，路径按老规矩来（`"src": "../images/xxx.webp"`，
   页面在 /act1/ 下，先退一级）。
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ItemIcons = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 占位图上那几个字。测试拿它核对「有没有明说是占位」。 */
  const PLACEHOLDER_TAG = '占位';

  const SVG_OPEN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">';

  /* ---------------------------------------------------------------------
     六张占位图。画的都是**单一物件**、透明底、同一个视角与粗细 ——
     将来换成真图时照着这几条要求画（见 images/README.md 的物品图标一节）。
     --------------------------------------------------------------------- */
  const ICONS = {
    /* 柳树皮：两片卷起来的干树皮条，一头卷进去 */
    item_willow_bark:
      '<path d="M5.6 17.8c1.7-1.3 3.3-3.2 4.5-5.6 1-1.9 2.5-3.1 4.2-3.3"/>' +
      '<path d="M5.6 17.8c1.4 1 2.9 1.2 4.7.6 2.5-.9 4.3-3 5.2-6.1"/>' +
      '<path d="M14.3 8.9c1.4-.4 2.6.2 2.8 1.4.2 1.1-.8 2.1-2.1 2.5"/>' +
      '<path d="M8.7 14.9c1.3.2 2.5-.2 3.4-1.1"/>',

    /* 苦根片：一片切下来的根茎，断面上是一圈放射状的纤维 */
    item_bitter_root:
      '<circle cx="12" cy="12" r="6.5"/>' +
      '<circle cx="12" cy="12" r="2.1"/>' +
      '<path d="M12 5.5v2.6M12 15.9v2.6M5.5 12h2.6M15.9 12h2.6"/>' +
      '<path d="M7.6 7.6 9.2 9.2M14.8 14.8l1.6 1.6M16.4 7.6l-1.6 1.6M9.2 14.8l-1.6 1.6"/>',

    /* 银脉草：一片叶子，主脉 + 几道发白的侧脉 */
    item_silverleaf:
      '<path d="M12 20.3c-4.3-2.6-6.1-6-5.3-10.1C7.3 7 9.1 4.8 12 3.6c2.9 1.2 4.7 3.4 5.3 6.6.8 4.1-1 7.5-5.3 10.1z"/>' +
      '<path d="M12 20.3V3.6"/>' +
      '<path d="M12 8.3 8.7 10.5M12 12.3l-3.3 2.2M12 8.3l3.3 2.2M12 12.3l3.3 2.2"/>',

    /* 蜂蜜：一只矮陶罐，木塞，罐口下一条蜜面 */
    item_honey:
      '<path d="M8.1 10.3h7.8l-1 8.9a1.8 1.8 0 0 1-1.8 1.6h-2.2a1.8 1.8 0 0 1-1.8-1.6z"/>' +
      '<path d="M7.5 10.3h9"/>' +
      '<path d="M9.7 10.3V7.7h4.6v2.6"/>' +
      '<path d="M8.8 13.4c1.7-.8 4.7-.8 6.4 0"/>',

    /* 芥籽：五粒红褐色的种子散着 */
    item_mustard_seed:
      '<ellipse cx="9.1" cy="10" rx="2" ry="1.6" transform="rotate(-22 9.1 10)"/>' +
      '<ellipse cx="14.5" cy="9.3" rx="2" ry="1.6" transform="rotate(16 14.5 9.3)"/>' +
      '<ellipse cx="11.4" cy="14.3" rx="2" ry="1.6" transform="rotate(-8 11.4 14.3)"/>' +
      '<ellipse cx="16" cy="15.3" rx="2" ry="1.6" transform="rotate(30 16 15.3)"/>' +
      '<ellipse cx="7.3" cy="15.7" rx="2" ry="1.6" transform="rotate(7 7.3 15.7)"/>',

    /* 日常调养煎剂：一只陶杯，深色液面，带柄 */
    item_daily_decoction:
      '<path d="M6.7 9.7h10.6l-1.2 9.3a1.8 1.8 0 0 1-1.8 1.6H9.7a1.8 1.8 0 0 1-1.8-1.6z"/>' +
      '<path d="M6.1 9.7h11.8"/>' +
      '<path d="M6.9 12.7c3.4-.9 6.8-.9 10.2 0"/>' +
      '<path d="M17.3 11.7h1.9a1.8 1.8 0 0 1 0 3.6h-1.2"/>',
  };

  function has(key) {
    return Object.prototype.hasOwnProperty.call(ICONS, key);
  }

  /** 这一张现在有没有正式的成品图。**有 src 才算有** —— 见文件头第二节。 */
  function isPlaceholder(key, assets) {
    const a = (assets || {})[key];
    return !(a && a.src);
  }

  function svgMarkup(key) {
    if (!has(key)) return '';
    return SVG_OPEN + ICONS[key] + '</svg>';
  }

  function urlOf(key, assets) {
    const a = (assets || {})[key];
    return a && a.src ? a.src : '';
  }

  /**
   * 造一个图标节点。
   *
   * 有正式图 → 一枚 <img data-art="asset">；
   * 没有     → 一枚占位（内联 SVG + 「占位」角标），data-art="placeholder"。
   * 两种都套在同一个 .dy-brew-art 壳里，样式只需要认这一个类。
   *
   * @param {object} doc
   * @param {string} key    素材 key（item_willow_bark…）
   * @param {object} assets story.art.assets
   */
  function makeIcon(doc, key, assets) {
    const box = doc.createElement('span');
    box.className = 'dy-brew-art';

    if (!isPlaceholder(key, assets)) {
      box.setAttribute('data-art', 'asset');
      const img = doc.createElement('img');
      img.className = 'dy-brew-art-img';
      img.setAttribute('alt', '');
      img.setAttribute('src', urlOf(key, assets));
      box.appendChild(img);
      return box;
    }

    box.setAttribute('data-art', 'placeholder');
    const svgHost = doc.createElement('span');
    svgHost.className = 'dy-brew-art-svg';
    svgHost.setAttribute('aria-hidden', 'true');
    /* 内联 SVG 只能靠 innerHTML 塞 —— 这一处是整个日常层唯一用它的地方，
       拼进去的全是本文件里的常量，没有任何外部数据。 */
    svgHost.innerHTML = svgMarkup(key);
    box.appendChild(svgHost);

    const tag = doc.createElement('span');
    tag.className = 'dy-brew-art-tag';
    tag.textContent = PLACEHOLDER_TAG;
    box.appendChild(tag);

    return box;
  }

  /** 给测试和「素材清单」用的：哪几张现在是占位。 */
  function placeholderList(assets) {
    return Object.keys(ICONS).filter((k) => isPlaceholder(k, assets));
  }

  return { PLACEHOLDER_TAG, ICONS, has, isPlaceholder, svgMarkup, urlOf, makeIcon, placeholderList };
});
