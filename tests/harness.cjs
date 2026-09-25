/**
 * 极简测试跑手（不引任何依赖，node 直接跑）
 * =====================================================================
 *   const { suite } = require('./harness.cjs');
 *   const t = suite('引擎');
 *   t.ok(cond, '说明');
 *   t.eq(实际, 期望, '说明');
 *   t.throws(() => …, '说明');
 *   t.done();          // 打印结果，失败则 process.exit(1)
 */

function show(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(show).join(', ') + ']';
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function suite(name) {
  const results = [];
  let group = '';

  const api = {
    /** 分节标题 */
    section(title) { group = title; },

    ok(cond, msg) {
      results.push({ group, msg, pass: !!cond, detail: '' });
      return !!cond;
    },

    eq(actual, expected, msg) {
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      results.push({
        group, msg, pass,
        detail: pass ? '' : `\n      实际=${show(actual)}\n      期望=${show(expected)}`,
      });
      return pass;
    },

    /** 不等于（用来挡「两个值意外相同」） */
    ne(actual, unexpected, msg) {
      return api.ok(actual !== unexpected, msg);
    },

    throws(fn, msg) {
      let threw = false, err = null;
      try { fn(); } catch (e) { threw = true; err = e; }
      results.push({ group, msg, pass: threw, detail: threw ? '' : '      期望抛错，但没有抛' });
      return err;
    },

    /** 把一个「哪里不达标」的清单记成一条用例 */
    empty(list, msg) {
      const arr = Array.from(list);
      results.push({
        group, msg, pass: arr.length === 0,
        detail: arr.length ? '\n      ' + arr.slice(0, 25).join('\n      ') +
          (arr.length > 25 ? `\n      …（共 ${arr.length} 条）` : '') : '',
      });
      return arr.length === 0;
    },

    done() {
      const failed = results.filter((r) => !r.pass);
      let lastGroup = null;
      for (const r of results) {
        if (r.group && r.group !== lastGroup) { console.log('\n── ' + r.group); lastGroup = r.group; }
        if (!r.pass) console.log(`  ✗ ${r.msg}${r.detail}`);
      }
      console.log(
        `\n${failed.length ? '❌' : '✅'} ${name}：${results.length - failed.length}/${results.length} 通过` +
        (failed.length ? `，失败 ${failed.length}` : '')
      );
      if (failed.length) process.exit(1);
      return true;
    },
  };

  return api;
}

/** 把一段文本抹平成便于比较的样子：去掉空白和引号差异 */
function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[\s　]+/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

module.exports = { suite, norm };
