// 纯函数：评论筛选、分批、提示词构造与回复解析、情绪与需求统计、报告表格。
import { extractJson, pick, stripBullet, type Cell } from './common';
import type { OutSheet } from './xlsx';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export const BATCH_SIZE = 30;
export const SENTIMENTS = ['正面', '中性', '负面'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
/** 细分情绪：模型只能从这里选 */
export const EMOTIONS = ['喜爱', '认同', '感谢', '期待', '好奇', '平淡', '疑惑', '失望', '不满', '愤怒'] as const;
/** 需求类型：「无」表示这条评论没有提出需求或建议 */
export const NEED_KINDS = ['内容需求', '产品需求', '改进建议', '提问求助'] as const;
export const NO_NEED = '无';

export interface Comment {
  id: number;
  file: string;
  /** 表格行号（含表头那一行，从 2 开始） */
  line: number;
  text: string;
  /** 所属作品（视频 / 笔记 / 文章标题），没有作品列时为空 */
  work: string;
  likes: number | null;
}

export interface Judged {
  sentiment: Sentiment;
  emotion: string;
  kind: string;
  need: string;
}
export interface Detail extends Comment, Judged {}

export const chunk = <T,>(arr: T[], size: number): T[][] => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

/** 没有文字的评论（纯表情、纯符号、[表情] 占位）不值得分析 */
export function isMeaningful(text: string): boolean {
  const t = text.replace(/\[[^\]\s]{1,8}\]/g, '');
  return /[\p{Script=Han}A-Za-z0-9]/u.test(t);
}

/** 点赞数：数字、「1.2万」「3w」；识别不了返回 null */
export function parseCount(v: Cell): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(万|w|W)?/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] ? 10000 : 1));
}

// check-zh: 忽略（写给大模型的提示词，里面的英文是 JSON 字段名，必须保留）
export const SYSTEM_PROMPT = `你是新媒体运营分析师，分析账号主自己作品下的用户评论。对每条评论判断：
1. sentiment 情绪倾向：只能是「正面」「中性」「负面」之一。单纯提问、陈述算中性；阴阳怪气、反讽算负面。
2. emotion 细分情绪：只能从「${EMOTIONS.join('、')}」里选一个。
3. kind 需求类型：只能是「${NEED_KINDS.join('」「')}」或「${NO_NEED}」。内容需求＝想看什么内容、希望出什么教程或续集；产品需求＝想买、想要链接、想要某种规格或功能；改进建议＝对内容或产品提出改进意见；提问求助＝问具体问题。没有就填「${NO_NEED}」。
4. need 需求要点：用 4～12 个字概括用户想要什么或建议什么，例如「出详细教程」「求购买链接」「字幕调大一点」。已经有的说法请直接复用，同一个需求不要换说法。kind 为「${NO_NEED}」时留空。
忠于原文，不编造评论里没有的内容。只输出 JSON，不要任何解释。`;

/** 构造一批评论的分析请求 */
export function buildBatchMessages(batch: Comment[], knownNeeds: string[]): ChatMessage[] {
  const lines = batch.map((c, i) => `[${i + 1}] ${c.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  const known = knownNeeds.length ? `\n已有的需求要点（尽量复用）：${knownNeeds.slice(0, 40).join('、')}\n` : '';
  const user = `${known}
评论共 ${batch.length} 条：
${lines}

按这个格式输出，每条评论都要有一项，id 是方括号里的编号：
{"results": [{"id": 1, "sentiment": "正面", "emotion": "喜爱", "kind": "内容需求", "need": "需求要点"}]}`;
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }];
}

const clean = (v: unknown) => stripBullet(String(v ?? '')).replace(/[「」"']/g, '').trim();

/** 情绪倾向：兼容「积极 / 消极 / positive」等写法，认不出算中性 */
export function matchSentiment(raw: unknown): Sentiment {
  const s = clean(raw).toLowerCase();
  if (/负|消极|差评|不满|negative|neg/.test(s)) return '负面';
  if (/正|积极|好评|positive|pos/.test(s)) return '正面';
  return '中性';
}

export function matchEmotion(raw: unknown, sentiment: Sentiment): string {
  const s = clean(raw);
  const hit = EMOTIONS.find((e) => s === e) ?? EMOTIONS.find((e) => s.includes(e) || (s.length >= 2 && e.includes(s)));
  if (hit) return hit;
  return sentiment === '正面' ? '认同' : sentiment === '负面' ? '不满' : '平淡';
}

export function matchKind(raw: unknown, need: string): string {
  const s = clean(raw);
  if (!s || /^(无|没有|none|null)$/i.test(s)) return need ? '改进建议' : NO_NEED;
  const hit = NEED_KINDS.find((k) => s === k) ?? NEED_KINDS.find((k) => s.includes(k.slice(0, 2)));
  if (hit) return hit;
  if (/问|求助|咨询/.test(s)) return '提问求助';
  if (/买|链接|商品|产品/.test(s)) return '产品需求';
  if (/建议|改/.test(s)) return '改进建议';
  if (/内容|视频|教程|想看/.test(s)) return '内容需求';
  return need ? '改进建议' : NO_NEED;
}

/**
 * 解析一批结果：兼容代码块、多余文字、顶层数组、按编号做键的对象、中文键名、缺 id（按顺序对应）。
 * 返回 编号(从 1 开始) → 结果；模型漏掉的编号不在里面。
 */
export function parseBatchReply(text: string, size: number): Map<number, Judged> {
  const data = extractJson(text);
  let list: unknown[] = [];
  if (Array.isArray(data)) list = data;
  else {
    const inner = pick(data, ['results', 'result', 'items', 'data', 'list', '结果', 'comments']);
    if (Array.isArray(inner)) list = inner;
    else if (data && typeof data === 'object') {
      const entries = Object.entries(data as Record<string, unknown>).filter(([k, v]) => /^\d+$/.test(k) && v && typeof v === 'object');
      list = entries.map(([k, v]) => ({ id: Number(k), ...(v as object) }));
    }
  }
  const out = new Map<number, Judged>();
  list.forEach((x, pos) => {
    if (!x || typeof x !== 'object') return;
    const rawId = pick(x, ['id', '编号', '序号', 'no', 'index']);
    const id = rawId != null && /^\d+$/.test(String(rawId).replace(/[[\]]/g, '')) ? Number(String(rawId).replace(/[[\]]/g, '')) : pos + 1;
    if (id < 1 || id > size || out.has(id)) return;
    const sentiment = matchSentiment(pick(x, ['sentiment', '情绪倾向', '情绪', '倾向', 'polarity']));
    const emotion = matchEmotion(pick(x, ['emotion', '细分情绪', '情感']), sentiment);
    let need = clean(pick(x, ['need', '需求要点', '需求', '建议', 'demand', 'suggestion'])).slice(0, 20);
    if (/^(无|没有|none|null)$/i.test(need)) need = '';
    const kind = matchKind(pick(x, ['kind', '需求类型', '类型', 'type']), need);
    out.set(id, { sentiment, emotion, kind, need: kind === NO_NEED ? '' : need || kind });
  });
  if (!out.size) throw new Error('大模型返回的结果里没有分析结果');
  return out;
}

export interface NeedGroup {
  need: string;
  kind: string;
  count: number;
  /** 这些评论的点赞合计（没有点赞列时为 0） */
  likes: number;
  example: string;
}
export interface WorkStat {
  work: string;
  total: number;
  pos: number;
  neu: number;
  neg: number;
  needs: number;
}
export interface Summary {
  analyzed: number;
  sentiments: { name: Sentiment; count: number; ratio: number }[];
  emotions: { name: string; count: number; ratio: number }[];
  kinds: { name: string; count: number; ratio: number }[];
  needs: NeedGroup[];
  works: WorkStat[];
  /** 负面评论里出现最多的需求或建议，用于提示要先处理什么 */
  negExamples: string[];
}

const normNeed = (s: string) => s.replace(/[\s，。,.!！、~～?？]/g, '').toLowerCase();
const ratioList = <T extends string>(names: readonly T[], counts: Map<string, number>, total: number) =>
  names.map((name) => ({ name, count: counts.get(name) ?? 0, ratio: total ? (counts.get(name) ?? 0) / total : 0 }));

/** 统计：情绪分布、细分情绪、需求类型、高频需求（按次数，再按点赞）和按作品的情绪 */
export function summarize(details: Detail[], topN = 20): Summary {
  const n = details.length;
  const count = (key: (d: Detail) => string) => details.reduce((m, d) => m.set(key(d), (m.get(key(d)) ?? 0) + 1), new Map<string, number>());
  const emotions = ratioList(EMOTIONS, count((d) => d.emotion), n).filter((e) => e.count).sort((a, b) => b.count - a.count);
  const withNeed = details.filter((d) => d.kind !== NO_NEED);
  const groups = new Map<string, NeedGroup & { kinds: Map<string, number>; bestLikes: number }>();
  for (const d of withNeed) {
    const key = normNeed(d.need || d.kind);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { need: d.need || d.kind, kind: d.kind, count: 0, likes: 0, example: '', kinds: new Map(), bestLikes: -1 }));
    g.count++;
    g.likes += d.likes ?? 0;
    g.kinds.set(d.kind, (g.kinds.get(d.kind) ?? 0) + 1);
    // 典型评论取点赞最多的一条
    if ((d.likes ?? 0) > g.bestLikes) { g.bestLikes = d.likes ?? 0; g.example = d.text.replace(/\s+/g, ' ').slice(0, 60); }
  }
  const needs = [...groups.values()]
    .sort((a, b) => b.count - a.count || b.likes - a.likes)
    .slice(0, topN)
    .map((g) => ({ need: g.need, kind: [...g.kinds.entries()].sort((a, b) => b[1] - a[1])[0][0], count: g.count, likes: g.likes, example: g.example }));
  const works = new Map<string, WorkStat>();
  for (const d of details) {
    if (!d.work) continue;
    const w = works.get(d.work) ?? { work: d.work, total: 0, pos: 0, neu: 0, neg: 0, needs: 0 };
    w.total++;
    if (d.sentiment === '正面') w.pos++; else if (d.sentiment === '负面') w.neg++; else w.neu++;
    if (d.kind !== NO_NEED) w.needs++;
    works.set(d.work, w);
  }
  const negExamples = details.filter((d) => d.sentiment === '负面').sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, 5).map((d) => d.text.replace(/\s+/g, ' ').slice(0, 60));
  return {
    analyzed: n,
    sentiments: ratioList(SENTIMENTS, count((d) => d.sentiment), n) as Summary['sentiments'],
    emotions,
    kinds: ratioList([...NEED_KINDS, NO_NEED], count((d) => d.kind), n),
    needs,
    works: [...works.values()].sort((a, b) => b.total - a.total),
    negExamples,
  };
}

export const pct = (r: number) => `${(r * 100).toFixed(1).replace(/\.0$/, '')}%`;

/** 构造运营建议请求：只给统计结果和少量典型评论，不重复发送全部评论 */
export function buildSuggestMessages(s: Summary): ChatMessage[] {
  const senti = s.sentiments.map((x) => `${x.name} ${x.count} 条（${pct(x.ratio)}）`).join('；');
  const emo = s.emotions.slice(0, 5).map((x) => `${x.name} ${x.count}`).join('、');
  const needs = s.needs.slice(0, 12).map((g, i) => `${i + 1}. ${g.need}（${g.kind}，${g.count} 次）：${g.example}`).join('\n');
  const neg = s.negExamples.length ? `\n\n点赞较多的负面评论：\n${s.negExamples.map((t) => `- ${t}`).join('\n')}` : '';
  return [
    { role: 'system', content: '你是新媒体运营顾问。根据账号评论区的情绪统计和用户需求，给出具体、可执行的内容选题和运营建议，优先回应提得多的需求。不编造数据，不写空话。只输出 JSON。' },
    { role: 'user', content: `情绪分布：${senti}\n主要情绪：${emo || '无'}\n\n高频需求与建议：\n${needs || '（没有）'}${neg}\n\n给出 3～6 条建议，每条对应一个需求或问题，建议不超过 60 个字。\n格式：{"suggestions": [{"target": "针对的需求或问题", "advice": "建议"}]}` },
  ];
}

export type Suggestion = { target: string; advice: string };
export function parseSuggestReply(text: string): Suggestion[] {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    const lines = String(text).split('\n').map(stripBullet).filter((l) => l && !/[{}[\]]/.test(l));
    return lines.slice(0, 8).map((advice) => ({ target: '', advice }));
  }
  const list = Array.isArray(data) ? data : pick(data, ['suggestions', 'suggestion', 'advice', '建议', 'items', 'list']);
  if (!Array.isArray(list)) return [];
  return list.map((x) => (typeof x === 'string'
    ? { target: '', advice: stripBullet(x) }
    : { target: String(pick(x, ['target', 'problem', 'need', '针对', '需求', '问题']) ?? '').trim(), advice: String(pick(x, ['advice', 'suggestion', '建议', 'content']) ?? '').trim() })).filter((x) => x.advice);
}

export interface Totals {
  files: number;
  total: number;
  skipped: number;
  calls: number;
}

/** 报告：汇总、需求清单、按作品（有作品列时）、明细 */
export function reportSheets(details: Detail[], s: Summary, suggestions: Suggestion[] | string, t: Totals): OutSheet[] {
  const rows: Cell[][] = [];
  const bold: number[] = [];
  const title = (r: Cell[]) => { bold.push(rows.length); rows.push(r); };
  rows.push(['评论总数', t.total], ['分析的评论', s.analyzed], ['跳过（空评论、纯表情或超出上限）', t.skipped], ['大模型调用次数', t.calls]);
  if (t.files > 1) rows.push(['合并的文件数', t.files]);
  rows.push([]);
  title(['情绪倾向', '条数', '占比']);
  for (const x of s.sentiments) rows.push([x.name, x.count, pct(x.ratio)]);
  rows.push([]);
  title(['细分情绪', '条数', '占比']);
  for (const x of s.emotions) rows.push([x.name, x.count, pct(x.ratio)]);
  rows.push([]);
  title(['需求类型', '条数', '占比']);
  for (const x of s.kinds) rows.push([x.name === NO_NEED ? '没有提需求' : x.name, x.count, pct(x.ratio)]);
  rows.push([]);
  title(['内容与运营建议', '针对的需求或问题']);
  if (typeof suggestions === 'string') rows.push([suggestions]);
  else suggestions.forEach((x, i) => rows.push([`${i + 1}. ${x.advice}`, x.target]));

  const sheets: OutSheet[] = [
    { name: '汇总', header: ['概况', '数量'], rows, plain: true, boldRows: bold, wrap: [0] },
    { name: '高频需求', header: ['排名', '需求要点', '类型', '提到次数', '点赞合计', '典型评论'], rows: s.needs.map((g, i) => [i + 1, g.need, g.kind, g.count, g.likes, g.example]), wrap: [5] },
  ];
  if (s.works.length) {
    sheets.push({
      name: '按作品',
      header: ['作品', '评论数', '正面', '中性', '负面', '负面占比', '提需求的评论'],
      rows: s.works.map((w) => [w.work, w.total, w.pos, w.neu, w.neg, pct(w.total ? w.neg / w.total : 0), w.needs]),
      wrap: [0],
    });
  }
  const multi = t.files > 1;
  const hasWork = details.some((d) => d.work);
  const hasLikes = details.some((d) => d.likes != null);
  const header = [...(multi ? ['来源文件'] : []), '行号', ...(hasWork ? ['作品'] : []), '评论内容', ...(hasLikes ? ['点赞'] : []), '情绪倾向', '细分情绪', '需求类型', '需求要点'];
  const detailRows = details.map((d) => [...(multi ? [d.file] : []), d.line, ...(hasWork ? [d.work] : []), d.text, ...(hasLikes ? [d.likes] : []), d.sentiment, d.emotion, d.kind, d.need] as Cell[]);
  const textCol = (multi ? 1 : 0) + 1 + (hasWork ? 1 : 0);
  const red = new Set<string>();
  details.forEach((d, i) => { if (d.sentiment === '负面') red.add(`${i},${textCol + (hasLikes ? 2 : 1)}`); });
  sheets.push({ name: '明细', header, rows: detailRows, wrap: [textCol], red });
  return sheets;
}
