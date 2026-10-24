import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import tool from './index';
import { readSheets, writeXlsx } from './xlsx';
import type { InputItem, ItemResult, Params, RunContext } from '../kit/types';

type Llm = RunContext['llm'];
function fakeCtx(files: Map<string, Uint8Array>, params: Params, llm: Llm): RunContext {
  return {
    params, outputDir: '/out', signal: new AbortController().signal, progress: () => {},
    readFile: async (p) => files.get(p)!,
    readText: async (p) => new TextDecoder().decode(files.get(p)!),
    writeFile: async (p, d) => void files.set(p, d),
    writeText: async (p, t) => void files.set(p, new TextEncoder().encode(t)),
    mkdir: async () => {},
    join: async (...parts) => parts.join('/'),
    llm, sidecar: async () => '', ffmpeg: async () => {}, duration: async () => 0,
  };
}
const defaults = (over: Params): Params => ({ ...Object.fromEntries(tool.params.map((f) => [f.key, f.default])), ...over });
const item = (name: string): InputItem => ({ id: name, name, path: '/in/' + name });

/** 假大模型：按关键词判断情绪和需求；建议请求返回固定建议 */
function fakeLlm(log: string[]): Llm {
  return async (m) => {
    const u = m[1].content;
    log.push(u);
    if (u.includes('suggestions')) return '```json\n{"suggestions":[{"target":"出教程","advice":"做一期详细教程"}]}\n```';
    const items = [...u.matchAll(/^\[(\d+)\] (.*)$/gm)].map(([, id, text]) => {
      const neg = /差|看不清|失望/.test(text);
      const pos = /好|喜欢|棒/.test(text);
      const need = /教程/.test(text) ? '出教程' : /字幕/.test(text) ? '字幕调大' : '';
      return { id: Number(id), sentiment: neg ? '负面' : pos ? '正面' : '中性', emotion: neg ? '失望' : pos ? '喜爱' : '平淡', kind: need === '出教程' ? '内容需求' : need ? '改进建议' : '无', need };
    });
    return '好的：' + JSON.stringify({ results: items });
  };
}

async function runAll(files: Map<string, Uint8Array>, names: string[], params: Params, llm: Llm) {
  const ctx = fakeCtx(files, defaults(params), llm);
  const results: { item: InputItem; result: ItemResult }[] = [];
  for (const n of names) results.push({ item: item(n), result: await tool.run(item(n), ctx) });
  const msg = await tool.afterAll!(results, ctx);
  return { results, msg };
}

describe('完整流程', () => {
  it('跳过纯表情，分批分析，导出汇总 + 高频需求 + 按作品 + 明细', async () => {
    const rows = Array.from({ length: 64 }, (_, i) => [
      i % 2 ? '示例作品甲' : '示例作品乙', `用户${i}`,
      i < 4 ? '[赞][赞]' : i % 4 === 0 ? '字幕太小看不清' : i % 4 === 1 ? '讲得好，求出教程' : i % 4 === 2 ? '很喜欢' : '路过', i,
    ]);
    const files = new Map([['/in/评论.xlsx', await writeXlsx([{ name: 'S', header: ['作品标题', '昵称', '评论内容', '点赞数'], rows }])]]);
    const log: string[] = [];
    const { results, msg } = await runAll(files, ['评论.xlsx'], {}, fakeLlm(log));
    // 64 条去掉 4 条纯表情 = 60 条，每 30 条一批 → 2 次，再加 1 次建议
    expect(log).toHaveLength(3);
    expect(results[0].result.row).toEqual({ total: 64, analyzed: 60, senti: '50% / 25% / 25%', top: '出教程（15）' });
    expect(msg).toBe('共分析 60 条评论，调用大模型 3 次（含 1 次生成运营建议）。报告：/out/评论-评论情绪与需求报告.xlsx');
    const [sum, needs, works, det] = await readSheets(files.get('/out/评论-评论情绪与需求报告.xlsx')!, 'x.xlsx');
    const flat = sum.grid.map((r) => r.filter((c) => c != null && c !== ''));
    expect(flat).toContainEqual(['跳过（空评论、纯表情或超出上限）', 4]);
    expect(flat).toContainEqual(['负面', 15, '25%']);
    expect(flat).toContainEqual(['1. 做一期详细教程', '出教程']);
    expect(needs.grid[1].slice(0, 4)).toEqual([1, '出教程', '内容需求', 15]);
    expect(works.name).toBe('按作品');
    expect(works.grid).toHaveLength(3);
    expect(det.grid[0]).toEqual(['行号', '作品', '评论内容', '点赞', '情绪倾向', '细分情绪', '需求类型', '需求要点']);
    expect(det.grid).toHaveLength(61);
    expect(det.grid[1]).toEqual([6, '示例作品乙', '字幕太小看不清', 4, '负面', '失望', '改进建议', '字幕调大']);
  });

  it('多个 CSV 合并成一份报告；没有作品列不出「按作品」', async () => {
    const files = new Map([
      ['/in/a.csv', new TextEncoder().encode('留言\n讲得好\n字幕看不清\n')],
      ['/in/b.csv', new TextEncoder().encode('评论,备注\n求教程,x\n')],
    ]);
    const { msg } = await runAll(files, ['a.csv', 'b.csv'], { reportName: '十月评论' }, fakeLlm([]));
    expect(msg).toContain('报告：/out/十月评论.xlsx');
    const sheets = await readSheets(files.get('/out/十月评论.xlsx')!, 'x.xlsx');
    expect(sheets.map((s) => s.name)).toEqual(['汇总', '高频需求', '明细']);
    expect(sheets[2].grid[0][0]).toBe('来源文件');
    expect(sheets[2].grid).toHaveLength(4);
  });

  it('模型漏掉的评论会补问一次', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('评论\n好\n差\n')]]);
    let n = 0;
    const llm: Llm = async (m) => {
      if (m[1].content.includes('suggestions')) return '{"suggestions":[]}';
      n++;
      return n === 1 ? '{"results":[{"id":1,"sentiment":"正面"}]}' : '{"results":[{"id":1,"sentiment":"负面"}]}';
    };
    const { results } = await runAll(files, ['a.csv'], {}, llm);
    expect(n).toBe(2);
    const det = (results[0].result.data as { details: { sentiment: string }[] }).details;
    expect(det.map((x) => x.sentiment)).toEqual(['正面', '负面']);
  });

  it('建议失败时报告照样生成，写明原因', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('评论\n求教程\n')]]);
    const base = fakeLlm([]);
    const llm: Llm = async (m, o) => { if (m[1].content.includes('suggestions')) throw new Error('大模型调用失败（500，接口返回错误）'); return base(m, o); };
    await runAll(files, ['a.csv'], {}, llm);
    const [sum] = await readSheets(files.get('/out/a-评论情绪与需求报告.xlsx')!, 'x.xlsx');
    expect(sum.grid.flat()).toContain('运营建议生成失败：大模型调用失败（500，接口返回错误）');
  });

  it('上限生效；全是表情时不调用大模型', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('评论\n[赞]\n👍\n')]]);
    const log: string[] = [];
    const { results } = await runAll(files, ['a.csv'], {}, fakeLlm(log));
    expect(log).toHaveLength(0);
    expect(results[0].result.summary).toBe('2 条评论都是空的或只有表情');
    const big = new Map([['/in/b.csv', new TextEncoder().encode('评论\n' + Array.from({ length: 40 }, (_, i) => `好${i}`).join('\n'))]]);
    const r = await runAll(big, ['b.csv'], { maxCount: 30 }, fakeLlm([]));
    expect(r.results[0].result.text).toContain('只分析了前 30 条');
  });

  it('没配置大模型时整个文件失败；认不出评论列、指定列不存在时提示表头', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('评论\n好\n')], ['/in/b.csv', new TextEncoder().encode('订单号,金额\n1,2\n')]]);
    const noLlm: Llm = async () => { throw new Error('还没有设置大模型：请到「设置」里填写接口地址、密钥和模型名'); };
    await expect(tool.run(item('a.csv'), fakeCtx(files, defaults({}), noLlm))).rejects.toThrow('还没有设置大模型');
    await expect(tool.run(item('b.csv'), fakeCtx(files, defaults({}), noLlm))).rejects.toThrow('表头是：订单号、金额');
    await expect(tool.run(item('a.csv'), fakeCtx(files, defaults({ workCol: '视频' }), noLlm))).rejects.toThrow('找不到作品列「视频」');
  });

  it('旧版 xls 在处理前拦下', () => {
    expect(tool.check!(item('a.xls'))).toContain('另存为 .xlsx');
  });

  it('README 验收用例：samples 里的示例文件', async () => {
    const files = new Map<string, Uint8Array>([
      ['/in/示例-评论导出.xlsx', new Uint8Array(readFileSync('samples/示例-评论导出.xlsx'))],
      ['/in/示例-留言-无作品列.csv', new Uint8Array(readFileSync('samples/示例-留言-无作品列.csv'))],
    ]);
    const one = await runAll(files, ['示例-评论导出.xlsx'], {}, fakeLlm([]));
    expect(one.results[0].result.row).toMatchObject({ total: 60, analyzed: 54 });
    expect(one.results[0].result.summary).toBe('分析 54 条，调用 2 次');
    expect(one.msg).toBe('共分析 54 条评论，调用大模型 3 次（含 1 次生成运营建议）。报告：/out/示例-评论导出-评论情绪与需求报告.xlsx');
    const sheets = await readSheets(files.get('/out/示例-评论导出-评论情绪与需求报告.xlsx')!, 'x.xlsx');
    expect(sheets.map((s) => s.name)).toEqual(['汇总', '高频需求', '按作品', '明细']);
    expect(sheets[2].grid).toHaveLength(4);
    expect(sheets[3].grid).toHaveLength(55);
    expect(sheets[0].grid.map((r) => r.filter((c) => c != null && c !== ''))).toContainEqual(['跳过（空评论、纯表情或超出上限）', 6]);
    const both = await runAll(files, ['示例-评论导出.xlsx', '示例-留言-无作品列.csv'], {}, fakeLlm([]));
    expect(both.msg).toContain('报告：/out/评论情绪与需求报告.xlsx');
    const det = (await readSheets(files.get('/out/评论情绪与需求报告.xlsx')!, 'x.xlsx'))[3];
    expect(det.grid[0][0]).toBe('来源文件');
    expect(det.grid).toHaveLength(60);
    await expect(tool.run(item('示例-留言-无作品列.csv'), fakeCtx(files, defaults({ workCol: '视频' }), fakeLlm([])))).rejects.toThrow('找不到作品列「视频」，表头是：留言内容、时间');
  });
});
