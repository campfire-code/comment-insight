// 截图与预览用的示例数据（不会进入正式运行），内容均为示例
import type { Row } from '../kit/runner';

const text1 = `412 条评论，分析 396 条，调用大模型 15 次
情绪：正面 238（60.1%）、中性 109（27.5%）、负面 49（12.4%）
主要情绪：喜爱 121、期待 74、认同 63、不满 31
高频需求：出详细教程（42）、求用量表（27）、字幕调大（19）、出减脂版（15）、求购买链接（12）`;

const files: [string, number, Row['status'], Record<string, string | number>?, string?][] = [
  ['示例-十月视频评论导出.xlsx', 96_000, 'ok', { total: 412, analyzed: 396, senti: '60.1% / 27.5% / 12.4%', top: '出详细教程（42）' }, text1],
  ['示例-图文笔记评论.xlsx', 58_000, 'ok', { total: 236, analyzed: 221, senti: '71.5% / 20.4% / 8.1%', top: '求用量表（18）' }, '236 条评论，分析 221 条，调用大模型 8 次'],
  ['示例-公众号留言.csv', 41_000, 'ok', { total: 180, analyzed: 174, senti: '48.9% / 35.6% / 15.5%', top: '出系列合集（11）' }, '180 条评论，分析 174 条，调用大模型 6 次'],
  ['示例-直播回放评论.xlsx', 33_000, 'run'],
  ['旧版评论导出.xls', 12_000, 'err', undefined, '旧版 .xls 格式不支持，请用 Excel 或 WPS 另存为 .xlsx 后再拖进来'],
];

export const rows = (state: string): Row[] =>
  state === 'empty' ? [] : files.map(([name, size, status, row, text], i) => {
    const st = state === 'done' && status === 'run' ? 'ok' : status;
    return {
      item: { id: `p${i}`, name, path: `/示例/${name}`, size },
      status: st,
      progress: st === 'run' ? 0.48 : st === 'ok' ? 1 : 0,
      error: st === 'err' ? text : undefined,
      result: st === 'ok' ? { summary: `分析 ${row?.analyzed ?? 90} 条`, row: row ?? { total: 96, analyzed: 90, senti: '55% / 30% / 15%', top: '出教程（9）' }, text: text ?? '' } : undefined,
    };
  });
