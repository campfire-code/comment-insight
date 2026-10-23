// 工具声明：评论情绪与需求分析（只分析用户自己从后台导出的评论表，不联网抓取）
import { MessageSquareHeart as MessageSquareHeartIcon } from 'lucide-react';
import type { BatchTool, RunContext } from '../kit/types';
import { baseName, cellText, errText, guessColumn, isFatalLlmError, mapPool, resolveColumn, safeName, toTable } from './common';
import {
  BATCH_SIZE, NO_NEED, buildBatchMessages, buildSuggestMessages, chunk, isMeaningful, parseBatchReply, parseCount, parseSuggestReply, pct,
  reportSheets, summarize, type Comment, type Detail, type Judged, type Suggestion,
} from './core';
import { readSheets, writeXlsx } from './xlsx';

const COMMENT_KEYWORDS = [/^(评论|留言|回复)(内容)?$/, /评论内容|留言内容|评论文本/, /评论|留言|弹幕/, /^内容$/, /comment|content|text/i];
const WORK_KEYWORDS = [/^(作品|视频|笔记|文章)(标题|名称)?$/, /作品|视频标题|笔记标题|文章标题/, /^标题$/, /title/i];
const LIKES_KEYWORDS = [/^(点赞|获赞|赞)(数)?$/, /点赞|获赞/, /like/i];

export interface FileData {
  file: string;
  total: number;
  skipped: number;
  calls: number;
  details: Detail[];
}

/** 一批评论：调用一次；漏掉的那几条再单独补一次；仍缺的记为中性、无需求 */
async function judgeBatch(batch: Comment[], known: string[], ctx: RunContext, count: () => void): Promise<Detail[]> {
  const got = new Map<number, Judged>();
  let pending = batch;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
    try {
      count();
      const reply = await ctx.llm(buildBatchMessages(pending, known), { json: true, temperature: 0.2 });
      const m = parseBatchReply(reply, pending.length);
      pending.forEach((c, i) => { const j = m.get(i + 1); if (j) got.set(c.id, j); });
      pending = pending.filter((c) => !got.has(c.id));
    } catch (e) {
      if (isFatalLlmError(e)) throw e;
      lastErr = e;
    }
  }
  if (!got.size && lastErr) throw lastErr;
  for (const j of got.values()) if (j.need && !known.includes(j.need)) known.push(j.need);
  return batch.map((c) => ({ ...c, ...(got.get(c.id) ?? { sentiment: '中性', emotion: '平淡', kind: NO_NEED, need: '（大模型没有返回这条的结果）' }) }));
}

const tool: BatchTool = {
  id: 'c31',
  name: '评论情绪与需求分析',
  tagline: '导入自己账号后台导出的评论表，AI 判断每条评论的情绪（正面 / 中性 / 负面及细分情绪），提炼用户想看什么、想要什么、提了什么建议，汇总高频需求并给出选题与运营建议，导出 Excel 报告。',
  icon: MessageSquareHeartIcon,
  category: '内容生产',
  type: 'text',
  mode: 'batch',
  resultView: 'table',
  columns: [['total', '评论'], ['analyzed', '已分析'], ['senti', '正面 / 中性 / 负面'], ['top', '最多的需求']],
  needsLLM: true,
  concurrency: 1,
  accept: { label: '评论表格', extensions: ['xlsx', 'csv', 'xls'] },
  params: [
    { key: 'commentCol', label: '评论在哪一列', type: 'text', default: '', placeholder: '不填自动识别「评论内容」等列；也可以写列字母' },
    { key: 'workCol', label: '作品在哪一列', type: 'text', default: '', placeholder: '不填自动识别；没有就填「无」', help: '有作品列时，报告里会多一张「按作品」的情绪对比' },
    { key: 'likesCol', label: '点赞数在哪一列', type: 'text', default: '', placeholder: '不填自动识别；没有就填「无」', help: '同样次数的需求，点赞多的排前面' },
    { key: 'maxCount', label: '最多分析多少条', type: 'number', default: 1000, min: 30, max: 5000, step: 30, unit: '条', help: `每 ${BATCH_SIZE} 条调用一次大模型，条数越多费用越高` },
    { key: 'reportName', label: '报告文件名', type: 'text', default: '评论情绪与需求报告' },
    { key: 'out', label: '保存到', type: 'folder', default: '' },
  ],
  check: (item) => (/\.xls$/i.test(item.name) ? '旧版 .xls 格式不支持，请用 Excel 或 WPS 另存为 .xlsx 后再拖进来' : null),

  async run(item, ctx) {
    const p = ctx.params;
    const sheets = await readSheets(await ctx.readFile(item.path!), item.name);
    const sheet = sheets.find((s) => s.grid.some((r) => r.length));
    if (!sheet) throw new Error('表格是空的');
    const table = toTable(sheet.grid);
    if (!table.rows.length) throw new Error('表格里只有表头，没有评论');
    const heads = `${table.header.slice(0, 12).join('、')}${table.header.length > 12 ? '…' : ''}`;

    const cSpec = String(p.commentCol ?? '').trim();
    const cCol = cSpec ? resolveColumn(table.header, cSpec) : guessColumn(table.header, COMMENT_KEYWORDS);
    if (cCol < 0) throw new Error(cSpec ? `找不到列「${cSpec}」，表头是：${heads}` : `没认出哪一列是评论，请在「评论在哪一列」里填写。表头是：${heads}`);
    const optional = (spec: string, keywords: RegExp[], label: string) => {
      if (spec === '无') return -1;
      if (spec) {
        const i = resolveColumn(table.header, spec);
        if (i < 0) throw new Error(`找不到${label}列「${spec}」，表头是：${heads}`);
        return i;
      }
      return guessColumn(table.header.map((h, i) => (i === cCol ? '' : h)), keywords);
    };
    const wCol = optional(String(p.workCol ?? '').trim(), WORK_KEYWORDS, '作品');
    const lCol = optional(String(p.likesCol ?? '').trim(), LIKES_KEYWORDS, '点赞');

    const valid = table.rows
      .map((r, i) => ({ text: cellText(r[cCol]), work: wCol >= 0 ? cellText(r[wCol]) : '', likes: lCol >= 0 ? parseCount(r[lCol]) : null, line: i + 2 }))
      .filter((x) => x.text && isMeaningful(x.text));
    const max = Math.max(1, Number(p.maxCount) || 1000);
    const comments: Comment[] = valid.slice(0, max).map((x, i) => ({ id: i, file: item.name, ...x }));
    const total = table.rows.length;
    const skipped = total - comments.length;
    if (!comments.length) {
      const data: FileData = { file: item.name, total, skipped, calls: 0, details: [] };
      return { summary: `${total} 条评论都是空的或只有表情`, row: { total, analyzed: 0, senti: '—', top: '—' }, data };
    }

    const known: string[] = [];
    let calls = 0;
    let done = 0;
    const batches = chunk(comments, BATCH_SIZE);
    const failed: string[] = [];
    const parts = await mapPool(batches, 2, async (b) => {
      try {
        return await judgeBatch(b, known, ctx, () => calls++);
      } catch (e) {
        if (isFatalLlmError(e)) throw e;
        failed.push(errText(e));
        return b.map((c) => ({ ...c, sentiment: '中性' as const, emotion: '平淡', kind: NO_NEED, need: `（这一批分析失败：${errText(e).slice(0, 40)}）` }));
      } finally {
        ctx.progress(0.05 + (0.95 * ++done) / batches.length);
      }
    }, ctx.signal);
    if (failed.length === batches.length) throw new Error(`全部分析失败：${failed[0]}`);

    const details = parts.flat();
    const s = summarize(details);
    const [pos, neu, neg] = s.sentiments;
    const data: FileData = { file: item.name, total, skipped, calls, details };
    const text = [
      `${total} 条评论，分析 ${comments.length} 条${valid.length > max ? `（超过上限，只分析了前 ${max} 条）` : ''}，调用大模型 ${calls} 次`,
      `情绪：正面 ${pos.count}（${pct(pos.ratio)}）、中性 ${neu.count}（${pct(neu.ratio)}）、负面 ${neg.count}（${pct(neg.ratio)}）`,
      s.emotions.length ? `主要情绪：${s.emotions.slice(0, 4).map((e) => `${e.name} ${e.count}`).join('、')}` : '',
      s.needs.length ? `高频需求：${s.needs.slice(0, 5).map((g) => `${g.need}（${g.count}）`).join('、')}` : '没有评论提出需求或建议',
      failed.length ? `${failed.length} 批分析失败，相关评论记为中性` : '',
    ].filter(Boolean).join('\n');
    return {
      summary: `分析 ${comments.length} 条，调用 ${calls} 次`,
      row: { total, analyzed: comments.length, senti: `${pct(pos.ratio)} / ${pct(neu.ratio)} / ${pct(neg.ratio)}`, top: s.needs[0] ? `${s.needs[0].need}（${s.needs[0].count}）` : '—' },
      text,
      data,
    };
  },

  async afterAll(results, ctx) {
    const files = results.map((r) => r.result.data as FileData | undefined).filter((d): d is FileData => !!d);
    if (!files.length) return;
    const details = files.flatMap((f) => f.details);
    const s = summarize(details);
    let calls = files.reduce((a, f) => a + f.calls, 0);
    let suggestions: Suggestion[] | string = '没有可分析的评论';
    if (s.analyzed) {
      try {
        calls++;
        suggestions = parseSuggestReply(await ctx.llm(buildSuggestMessages(s), { json: true, temperature: 0.5 }));
        if (!suggestions.length) suggestions = '大模型没有给出建议，可重新处理';
      } catch (e) {
        suggestions = `运营建议生成失败：${errText(e)}`;
      }
    }
    const totals = { files: files.length, total: files.reduce((a, f) => a + f.total, 0), skipped: files.reduce((a, f) => a + f.skipped, 0), calls };
    const rName = String(ctx.params.reportName || '评论情绪与需求报告');
    const name = files.length === 1 ? `${baseName(files[0].file)}-${rName}` : rName;
    const path = await ctx.join(ctx.outputDir, `${safeName(name)}.xlsx`);
    await ctx.writeFile(path, await writeXlsx(reportSheets(details, s, suggestions, totals), '篝火 · 评论情绪与需求分析'));
    return `共分析 ${s.analyzed} 条评论，调用大模型 ${calls} 次${s.analyzed ? '（含 1 次生成运营建议）' : ''}。报告：${path}`;
  },
};

export default tool;
