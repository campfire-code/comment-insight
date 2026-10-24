// 单个评论表的结果：情绪环 + 细分情绪 + 「用户想要什么」便利贴墙（按需求类型分，附点赞最多的原话）；以及还没导入时的空状态示意。
import { MessageSquareQuote, Settings, Table2, Upload } from 'lucide-react';
import type { InputItem, ItemResult } from '../kit/types';
import { NEED_KINDS, pct, summarize, type Summary } from './core';
import type { FileData } from './index';
import './tool.css';

const TONE: Record<string, 'pos' | 'neu' | 'neg'> = { 喜爱: 'pos', 认同: 'pos', 感谢: 'pos', 期待: 'pos', 好奇: 'neu', 平淡: 'neu', 疑惑: 'neu', 失望: 'neg', 不满: 'neg', 愤怒: 'neg' };
const NOTE_TINT = ['t1', 't2', 't3', 't4'];

function Donut({ s }: { s: Summary }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const [pos, neu, neg] = s.sentiments;
  const cls = ['pos', 'neu', 'neg'];
  return (
    <svg className="cm-donut" viewBox="0 0 120 120" role="img" aria-label={`正面 ${pct(pos.ratio)}，中性 ${pct(neu.ratio)}，负面 ${pct(neg.ratio)}`}>
      <circle cx="60" cy="60" r={r} className="cm-ring" />
      {s.sentiments.map((x, i) => {
        const len = x.ratio * c;
        const el = x.count ? <circle key={x.name} cx="60" cy="60" r={r} className={`cm-seg ${cls[i]}`} strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-acc} /> : null;
        acc += len;
        return el;
      })}
      <text x="60" y="58" textAnchor="middle" className="cm-d-big">{pct(pos.ratio)}</text>
      <text x="60" y="76" textAnchor="middle" className="cm-d-sub">正面</text>
    </svg>
  );
}

export function ResultBody({ item, result }: { item: InputItem; result: ItemResult }) {
  const d = result.data as FileData | undefined;
  if (!d?.details.length) return <p className="cm-plain">{result.text || result.summary}</p>;
  const s = summarize(d.details);
  const notes = NEED_KINDS.map((k) => ({ kind: k, count: s.kinds.find((x) => x.name === k)?.count ?? 0, needs: s.needs.filter((n) => n.kind === k).slice(0, 2) })).filter((n) => n.needs.length);
  return (
    <div className="cm-res">
      <h3 className="cm-file k-ellipsis" title={item.name}><Table2 size={15} />{item.name}</h3>
      <div className="cm-top">
        <Donut s={s} />
        <ul className="cm-legend">
          {s.sentiments.map((x, i) => <li key={x.name}><i className={['pos', 'neu', 'neg'][i]} />{x.name}<b className="k-num">{x.count}</b><small className="k-num">{pct(x.ratio)}</small></li>)}
          <li className="cm-total k-num">分析 {s.analyzed} 条，共 {d.total} 条</li>
        </ul>
      </div>
      {s.emotions.length > 0 && (
        <ul className="cm-emo" aria-label="细分情绪">
          {s.emotions.slice(0, 6).map((e) => <li key={e.name} className={TONE[e.name] ?? 'neu'}>{e.name}<b className="k-num">{e.count}</b></li>)}
        </ul>
      )}
      {notes.length > 0 ? (
        <>
          <h4 className="cm-h"><MessageSquareQuote size={14} />用户想要什么</h4>
          <div className="cm-notes">
            {notes.map((n, i) => (
              <section key={n.kind} className={`cm-note ${NOTE_TINT[i % 4]}`}>
                <header>{n.kind}<small className="k-num">{n.count} 条</small></header>
                <ul>{n.needs.map((g) => <li key={g.need}><b>{g.need}</b><span className="k-num">×{g.count}</span></li>)}</ul>
                <blockquote>{n.needs[0].example}</blockquote>
              </section>
            ))}
          </div>
        </>
      ) : <p className="cm-plain">没有评论提出需求或建议</p>}
    </div>
  );
}

/** 空状态：一张评论表 → 情绪环和需求便利贴 */
export function Empty({ hover }: { hover: boolean }) {
  return (
    <div className="cm-empty">
      <svg viewBox="0 0 440 150" role="img" aria-label="一张评论表，变成情绪占比环和用户需求便利贴">
        <g className="cm-sheet">
          <rect x="8" y="14" width="130" height="118" rx="8" />
          {[0, 1, 2, 3, 4, 5].map((i) => <g key={i}><rect x="20" y={28 + i * 17} width="26" height="8" rx="4" className="a" /><rect x="54" y={28 + i * 17} width={[64, 52, 70, 44, 60, 38][i]} height="8" rx="4" /></g>)}
        </g>
        <path d="M156 74 H196 M187 65 L198 74 L187 83" className="cm-arrow" />
        <text x="176" y="58" textAnchor="middle" className="cm-cap">逐条判断</text>
        <g transform="translate(208 22)">
          <circle cx="42" cy="42" r="34" className="cm-ring" />
          <circle cx="42" cy="42" r="34" className="cm-seg pos" strokeDasharray="128 214" transform="rotate(-90 42 42)" />
          <circle cx="42" cy="42" r="34" className="cm-seg neg" strokeDasharray="30 214" strokeDashoffset="-132" transform="rotate(-90 42 42)" />
          <text x="42" y="47" textAnchor="middle" className="cm-d-big small">情绪</text>
        </g>
        <g>
          <rect x="316" y="16" width="116" height="52" rx="6" className="cm-sn t1" /><rect x="326" y="28" width="60" height="7" rx="3.5" className="ln" /><rect x="326" y="44" width="84" height="6" rx="3" className="ln soft" />
          <rect x="324" y="78" width="108" height="52" rx="6" className="cm-sn t2" /><rect x="334" y="90" width="52" height="7" rx="3.5" className="ln" /><rect x="334" y="106" width="76" height="6" rx="3" className="ln soft" />
        </g>
        <text x="73" y="148" textAnchor="middle" className="cm-cap muted">评论表</text>
        <text x="374" y="148" textAnchor="middle" className="cm-cap muted">需求便利贴</text>
      </svg>
      <ul className="cm-steps">
        <li><Settings size={16} /><b>先设置</b><span>在「设置」里填自己的大模型接口地址、密钥和模型名</span></li>
        <li><Table2 size={16} /><b>再导入</b><span>拖入自己后台导出的评论表（xlsx 或 csv），自动认出评论、作品、点赞列</span></li>
        <li><Upload size={16} /><b>得到</b><span>每个表一张情绪与需求卡片，并导出含运营建议的 Excel 报告</span></li>
      </ul>
      <h2 className="cm-title">{hover ? '松开鼠标，开始添加' : '把评论表拖进来'}</h2>
      <p className="cm-act">只分析你自己导出的表格，不登录平台、不抓取评论</p>
    </div>
  );
}
