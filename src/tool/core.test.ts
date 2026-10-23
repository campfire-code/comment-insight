import { describe, expect, it } from 'vitest';
import {
  NO_NEED, buildBatchMessages, buildSuggestMessages, chunk, isMeaningful, matchEmotion, matchKind, matchSentiment, parseBatchReply, parseCount,
  parseSuggestReply, reportSheets, summarize, type Detail,
} from './core';

const d = (over: Partial<Detail>, i = 0): Detail => ({
  id: i, file: 'a.xlsx', line: i + 2, text: `评论${i}`, work: '', likes: null, sentiment: '中性', emotion: '平淡', kind: NO_NEED, need: '', ...over,
});

describe('输入清洗', () => {
  it('纯表情、纯符号不分析，带字的保留', () => {
    expect(isMeaningful('[赞][赞]')).toBe(false);
    expect(isMeaningful('👍👍👍')).toBe(false);
    expect(isMeaningful('！！！')).toBe(false);
    expect(isMeaningful('求教程[捂脸]')).toBe(true);
    expect(isMeaningful('666')).toBe(true);
  });
  it('点赞数识别', () => {
    expect(parseCount(12)).toBe(12);
    expect(parseCount('1.2万')).toBe(12000);
    expect(parseCount('3w')).toBe(30000);
    expect(parseCount('')).toBeNull();
    expect(parseCount('很多')).toBeNull();
  });
  it('分批', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('模型写法兼容', () => {
  it('情绪倾向', () => {
    expect(matchSentiment('正面')).toBe('正面');
    expect(matchSentiment('积极')).toBe('正面');
    expect(matchSentiment('Negative')).toBe('负面');
    expect(matchSentiment('消极')).toBe('负面');
    expect(matchSentiment('客观')).toBe('中性');
  });
  it('细分情绪：列表外的按倾向兜底', () => {
    expect(matchEmotion('「期待」', '正面')).toBe('期待');
    expect(matchEmotion('非常喜爱', '正面')).toBe('喜爱');
    expect(matchEmotion('开心', '正面')).toBe('认同');
    expect(matchEmotion('生气', '负面')).toBe('不满');
    expect(matchEmotion('', '中性')).toBe('平淡');
  });
  it('需求类型', () => {
    expect(matchKind('内容需求', '出教程')).toBe('内容需求');
    expect(matchKind('产品', '求链接')).toBe('产品需求');
    expect(matchKind('提问', '')).toBe('提问求助');
    expect(matchKind('无', '')).toBe(NO_NEED);
    expect(matchKind('', '字幕大一点')).toBe('改进建议');
  });
});

describe('批量回复解析', () => {
  it('代码块 + 中文键名 + 漏项', () => {
    const m = parseBatchReply('```json\n{"结果":[{"编号":1,"情绪倾向":"正面","细分情绪":"期待","需求类型":"内容需求","需求要点":"出续集"},{"编号":3,"情绪倾向":"负面","细分情绪":"失望","需求类型":"无","需求要点":"无"}]}\n```', 3);
    expect(m.get(1)).toEqual({ sentiment: '正面', emotion: '期待', kind: '内容需求', need: '出续集' });
    expect(m.get(2)).toBeUndefined();
    expect(m.get(3)).toEqual({ sentiment: '负面', emotion: '失望', kind: NO_NEED, need: '' });
  });
  it('顶层数组缺 id 按顺序；越界编号丢弃；按编号做键', () => {
    const a = parseBatchReply('[{"sentiment":"positive","emotion":"喜爱","kind":"无"},{"id":9,"sentiment":"负面"}]', 2);
    expect(a.get(1)?.sentiment).toBe('正面');
    expect(a.size).toBe(1);
    const b = parseBatchReply('{"1":{"sentiment":"中性","kind":"提问求助","need":"哪里买"}}', 1);
    expect(b.get(1)).toEqual({ sentiment: '中性', emotion: '平淡', kind: '提问求助', need: '哪里买' });
  });
  it('没有结果时报错', () => {
    expect(() => parseBatchReply('{"results":[]}', 2)).toThrow('没有分析结果');
    expect(() => parseBatchReply('抱歉', 2)).toThrow('不是有效的 JSON');
  });
  it('提示词带编号和已有需求', () => {
    const m = buildBatchMessages([{ id: 0, file: 'a', line: 2, text: '求  教程\n谢谢', work: '', likes: null }], ['出教程']);
    expect(m[1].content).toContain('[1] 求 教程 谢谢');
    expect(m[1].content).toContain('已有的需求要点（尽量复用）：出教程');
  });
});

describe('统计', () => {
  const details: Detail[] = [
    d({ sentiment: '正面', emotion: '喜爱', kind: '内容需求', need: '出续集', likes: 5, text: '好看，求续集', work: '作品A' }, 0),
    d({ sentiment: '正面', emotion: '期待', kind: '内容需求', need: '出续集！', likes: 50, text: '蹲续集', work: '作品A' }, 1),
    d({ sentiment: '负面', emotion: '不满', kind: '改进建议', need: '字幕调大', likes: 80, text: '字幕太小看不清', work: '作品B' }, 2),
    d({ sentiment: '中性', emotion: '平淡', kind: NO_NEED, need: '', work: '作品B' }, 3),
  ];
  const s = summarize(details);
  it('情绪占比、细分情绪、需求类型', () => {
    expect(s.sentiments).toEqual([{ name: '正面', count: 2, ratio: 0.5 }, { name: '中性', count: 1, ratio: 0.25 }, { name: '负面', count: 1, ratio: 0.25 }]);
    expect(s.emotions.map((e) => e.name)).toEqual(['喜爱', '期待', '平淡', '不满']);
    expect(s.kinds.find((k) => k.name === '内容需求')?.count).toBe(2);
    expect(s.kinds.find((k) => k.name === NO_NEED)?.count).toBe(1);
  });
  it('需求按说法归并（忽略标点），典型评论取点赞最多的', () => {
    expect(s.needs[0]).toEqual({ need: '出续集', kind: '内容需求', count: 2, likes: 55, example: '蹲续集' });
    expect(s.needs).toHaveLength(2);
  });
  it('按作品统计、负面高赞评论', () => {
    expect(s.works).toEqual([
      { work: '作品A', total: 2, pos: 2, neu: 0, neg: 0, needs: 2 },
      { work: '作品B', total: 2, pos: 0, neu: 1, neg: 1, needs: 1 },
    ]);
    expect(s.negExamples).toEqual(['字幕太小看不清']);
  });
  it('建议请求只带统计，不带全部评论', () => {
    const m = buildSuggestMessages(s);
    expect(m[1].content).toContain('正面 2 条（50%）');
    expect(m[1].content).toContain('1. 出续集（内容需求，2 次）：蹲续集');
    expect(m[1].content).toContain('- 字幕太小看不清');
    expect(m[1].content).not.toContain('评论3');
  });
  it('报告：有作品和点赞列时多出「按作品」，负面评论标红', () => {
    const sheets = reportSheets(details, s, [{ target: '出续集', advice: '下周更新续集' }], { files: 1, total: 5, skipped: 1, calls: 2 });
    expect(sheets.map((x) => x.name)).toEqual(['汇总', '高频需求', '按作品', '明细']);
    expect(sheets[0].rows).toContainEqual(['1. 下周更新续集', '出续集']);
    expect(sheets[0].rows).toContainEqual(['没有提需求', 1, '25%']);
    expect(sheets[2].rows[1]).toEqual(['作品B', 2, 0, 1, 1, '50%', 1]);
    expect(sheets[3].header).toEqual(['行号', '作品', '评论内容', '点赞', '情绪倾向', '细分情绪', '需求类型', '需求要点']);
    expect([...sheets[3].red!]).toEqual(['2,4']);
  });
  it('报告：没有作品列时不出「按作品」，建议失败写原因', () => {
    const plain = details.map((x) => ({ ...x, work: '', likes: null }));
    const sheets = reportSheets(plain, summarize(plain), '运营建议生成失败：x', { files: 2, total: 4, skipped: 0, calls: 1 });
    expect(sheets.map((x) => x.name)).toEqual(['汇总', '高频需求', '明细']);
    expect(sheets[0].rows).toContainEqual(['运营建议生成失败：x']);
    expect(sheets[2].header[0]).toBe('来源文件');
  });
});

describe('建议解析', () => {
  it('JSON、字符串数组、纯文本', () => {
    expect(parseSuggestReply('{"suggestions":[{"target":"续集","advice":"出续集"}]}')).toEqual([{ target: '续集', advice: '出续集' }]);
    expect(parseSuggestReply('["1. 多回复评论"]')).toEqual([{ target: '', advice: '多回复评论' }]);
    expect(parseSuggestReply('1. 固定更新时间\n2. 加大字幕')).toEqual([{ target: '', advice: '固定更新时间' }, { target: '', advice: '加大字幕' }]);
  });
});
