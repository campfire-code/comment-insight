// 截图与预览用的示例数据（不会进入正式运行），内容均为示例
import type { Row } from '../kit/runner';
import { pct, summarize, type Detail, type Sentiment } from './core';
import type { FileData } from './index';

// [评论, 点赞, 情绪倾向, 细分情绪, 需求类型, 需求要点]
type Seed = [string, number, Sentiment, string, string, string];
const SEEDS: Seed[] = [
  ['红烧肉这个火候讲得太清楚了，求出一期详细教程', 328, '正面', '期待', '内容需求', '出详细教程'],
  ['能不能把每一步的用量都做成表格发出来', 241, '正面', '期待', '内容需求', '求用量表'],
  ['已经照着做了三次，家里人都说好吃', 190, '正面', '喜爱', '无', ''],
  ['想看减脂版的做法，少糖少油那种', 176, '正面', '期待', '内容需求', '出减脂版'],
  ['你用的这个砂锅在哪里买的？求链接', 152, '中性', '好奇', '产品需求', '求购买链接'],
  ['字幕太小了，手机上看不清', 133, '负面', '不满', '改进建议', '字幕调大'],
  ['步骤讲得太快，暂停好几次才跟上', 118, '负面', '失望', '改进建议', '放慢讲解速度'],
  ['博主的刀工真好，看着就解压', 97, '正面', '喜爱', '无', ''],
  ['出一期系列合集吧，每周一道家常菜', 92, '正面', '期待', '内容需求', '出系列合集'],
  ['请问五花肉要先焯水吗？', 86, '中性', '疑惑', '提问求助', '问焯水步骤'],
  ['砂锅是哪个牌子的，有没有同款？', 80, '中性', '好奇', '产品需求', '求购买链接'],
  ['背景音乐太吵了，盖住了讲解', 74, '负面', '不满', '改进建议', '降低背景音乐'],
  ['感谢分享，终于学会了', 66, '正面', '感谢', '无', ''],
  ['希望能出一个详细的文字版步骤', 61, '正面', '期待', '内容需求', '出详细教程'],
  ['用量能写在评论区置顶吗', 58, '中性', '平淡', '内容需求', '求用量表'],
  ['做出来太咸了，是不是盐放多了', 52, '负面', '失望', '提问求助', '问用盐量'],
  ['这期的剪辑节奏很舒服', 47, '正面', '认同', '无', ''],
  ['有减脂期可以吃的版本吗', 44, '正面', '期待', '内容需求', '出减脂版'],
  ['想要同款砂锅的购买方式', 40, '中性', '好奇', '产品需求', '求购买链接'],
  ['详细一点的教程什么时候出？', 37, '正面', '期待', '内容需求', '出详细教程'],
  ['字幕颜色和背景太接近', 33, '负面', '不满', '改进建议', '字幕调大'],
  ['每次都看到最后才报用量，建议开头就说', 29, '负面', '失望', '改进建议', '开头说用量'],
  ['太好吃了！已收藏', 25, '正面', '喜爱', '无', ''],
  ['辣椒可以换成别的吗', 21, '中性', '疑惑', '提问求助', '问替换食材'],
  ['喜欢这种安静的风格', 18, '正面', '认同', '无', ''],
  ['看完饿了', 14, '正面', '喜爱', '无', ''],
  ['博主能不能出个调料清单', 11, '正面', '期待', '内容需求', '求调料清单'],
  ['视频里的计时器很实用', 9, '正面', '认同', '无', ''],
  ['讲解语速能再慢一点就好了', 7, '中性', '平淡', '改进建议', '放慢讲解速度'],
  ['已经二刷了', 5, '正面', '喜爱', '无', ''],
];

function details(file: string, from: number, to: number, work: string): Detail[] {
  return SEEDS.slice(from, to).map(([text, likes, sentiment, emotion, kind, need], i) => ({ id: i, file, line: i + 2, text, work, likes, sentiment, emotion, kind, need }));
}

function fileData(file: string, total: number, from: number, to: number, work: string): FileData {
  return { file, total, skipped: total - (to - from), calls: Math.ceil((to - from) / 30), details: details(file, from, to, work) };
}

const DATA = {
  a: fileData('示例-十月视频评论导出.xlsx', 34, 0, 30, '红烧肉家常做法'),
  b: fileData('示例-图文笔记评论.xlsx', 22, 2, 22, '周末早餐合集'),
  c: fileData('示例-公众号留言.csv', 19, 8, 24, '一周减脂食谱'),
};

function resultOf(d: FileData) {
  const s = summarize(d.details);
  const [pos, neu, neg] = s.sentiments;
  const text = `${d.total} 条评论，分析 ${d.details.length} 条，调用大模型 ${d.calls} 次`;
  return {
    summary: `分析 ${d.details.length} 条，调用 ${d.calls} 次`,
    row: { total: d.total, analyzed: d.details.length, senti: `${pct(pos.ratio)} / ${pct(neu.ratio)} / ${pct(neg.ratio)}`, top: s.needs[0] ? `${s.needs[0].need}（${s.needs[0].count}）` : '—' },
    text,
    data: d,
  };
}

const files: [string, number, Row['status'], FileData?, string?][] = [
  ['示例-十月视频评论导出.xlsx', 96_000, 'ok', DATA.a],
  ['示例-图文笔记评论.xlsx', 58_000, 'ok', DATA.b],
  ['示例-公众号留言.csv', 41_000, 'ok', DATA.c],
  ['示例-直播回放评论.xlsx', 33_000, 'run'],
  ['旧版评论导出.xls', 12_000, 'err', undefined, '旧版 .xls 格式不支持，请用 Excel 或 WPS 另存为 .xlsx 后再拖进来'],
];

export const rows = (state: string): Row[] =>
  state === 'empty' ? [] : files.map(([name, size, status, data, error], i) => {
    const st = state === 'done' && status === 'run' ? 'ok' : status;
    return {
      item: { id: `p${i}`, name, path: `/示例/${name}`, size },
      status: st,
      progress: st === 'run' ? 0.48 : st === 'ok' ? 1 : 0,
      error: st === 'err' ? error : undefined,
      result: st === 'ok' ? resultOf(data ?? DATA.a) : undefined,
    };
  });
