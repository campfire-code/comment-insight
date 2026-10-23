// 生成 samples/ 里的示例文件（只在设置了 MAKE_SAMPLES=1 时运行）。评论均为本工具自己编写的示例。
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { writeXlsx } from './xlsx';

const WORKS = ['【示例】10 分钟番茄牛腩', '【示例】空气炸锅烤鸡翅', '【示例】一周带饭便当合集'];
const COMMENTS = [
  '跟着做了一次，家里人都说好吃！', '求出一期详细的炖牛腩火候教程', '字幕太小了，手机上看不清', '请问用的是什么锅？求链接',
  '讲得很清楚，已收藏', '背景音乐太吵了，盖过了讲解', '能不能出一期减脂版的', '空气炸锅多少度烤多久？',
  '期待下一期便当合集', '做出来太咸了，盐是不是写多了', '每次都是更新最快的，支持', '希望把用量写在评论区置顶',
  '[赞][赞][赞]', '这期节奏有点拖，前面一分钟都在聊天', '求出学生宿舍能做的版本', '视频里的菜刀在哪买的',
  '很治愈，下班看一集刚好', '上次说的续集呢？等了好久', '一般般吧', '👍👍',
];

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例文件', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => [
    WORKS[i % 3], `示例用户${String(i + 1).padStart(2, '0')}`, COMMENTS[(i * 7) % COMMENTS.length], (i * 37) % 120, `2026-10-${String((i % 20) + 1).padStart(2, '0')} 20:${String(i % 60).padStart(2, '0')}`,
  ]);
  writeFileSync('samples/示例-评论导出.xlsx', await writeXlsx([{ name: '评论', header: ['作品标题', '昵称', '评论内容', '点赞数', '评论时间'], rows }]));
  const csv = ['留言内容,时间', '讲得很清楚，已收藏,2026-10-01', '字幕太小了，手机上看不清,2026-10-02', '求出一期详细教程,2026-10-02', '[赞],2026-10-03', '背景音乐太吵了,2026-10-04', '期待下一期,2026-10-05'];
  writeFileSync('samples/示例-留言-无作品列.csv', '﻿' + csv.join('\r\n') + '\r\n');
});
