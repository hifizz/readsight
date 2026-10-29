/**
 * 从 server/src/app/api/chat/route.ts 和 server/src/lib/action-tags.ts 搬来的系统提示。
 * 扩展端的 tag 定义仍在 lib/action-tags.ts，这里只保留给模型看的任务说明。
 */
import type { ActionTag, SelectionContext } from '@/lib/messaging';

export const ACTION_TAG_PROMPTS: Record<ActionTag, string> = {
  meaning:
    '任务：仅解释这个词/短语在所在句子里的具体含义。不要重复字典基本义（用户已经看到）；说清作者为何这样用、跟最常见用法的差别（语气/感情色彩/搭配/隐含意）。3-5 句话。',
  pronunciation:
    '任务：给出该词的 IPA（美式 / 英式各一）及简短读法说明。本动作通常走查词，被路由到这里属于兜底。3 句以内。',
  'sentence-translate':
    '任务：给出本句的地道中文译法（一句话即可），再用一句话点出译时的关键取舍。共 2-3 句。',
  usage:
    '任务：列出该词/短语在本句里这种用法下，2-3 个常见搭配 + 例句。例句简短地道；每条单独一行。',
  translate:
    '任务：把所选句子翻成地道中文。先给译文，再用 1-2 句说明取舍（口语/书面、语气、为什么不字面翻）。',
  grammar:
    '任务：拆解所选句子的语法结构（主干、修饰、从句、并列），指出 1-2 处对中国读者最容易卡住的点并解释。控制在 5 句以内。',
  rewrite:
    '任务：给 2 种更地道的英文改写（口语化、书面化各一种或同语域两种），每种 1 句话，并简要说明为什么更地道。',
  'hard-parts':
    '任务：从所选段落里挑 2-3 处对中国读者最难懂的（生僻搭配/隐喻/文化典故/复杂句式）并解释。每处先引原文片段再解释。',
};

export function buildSystemPrompt(ctx: SelectionContext | undefined, actionTag?: ActionTag): string {
  const base = buildBaseSystemPrompt(ctx);
  if (!actionTag) return base;
  const taskPrompt = ACTION_TAG_PROMPTS[actionTag];
  return taskPrompt ? `${base}\n\n${taskPrompt}` : base;
}

function buildBaseSystemPrompt(ctx?: SelectionContext): string {
  if (!ctx) {
    return '你是一位耐心的英语学习助手。回答简洁、贴合用户的英文阅读语境，必要时给地道译法和用法示例。';
  }
  const base = [
    `用户选中："${ctx.selection.text}"（类型：${ctx.selection.type}）。`,
    `所在句子："${ctx.context.sentence}"。`,
    `所在段落："${ctx.context.paragraph}"。`,
  ];
  if (ctx.selection.type === 'word') {
    return [
      '你是一位耐心的英语学习助手。用户正在阅读一篇英文文章，刚选中了一个词。',
      ...base,
      '重要：词典基本义（IPA / 词性 / 字典定义）用户已经在旁边看到了，不要重复。请专注解释：',
      '  1. 这个词在这一句里具体是什么意思、为什么作者要这样用',
      '  2. 跟它平常的、最常见的用法相比有什么差别（语气 / 感情色彩 / 搭配 / 隐含意）',
      '  3. 如果存在更地道的中文译法、或者英文里常见的搭配，给一两个例子',
      '回答简洁，控制在 3-5 句。',
    ].join('\n');
  }
  return [
    '你是一位耐心的英语学习助手，正在帮助用户读懂一篇英文文章中的一段表达。',
    ...base,
    '请结合这个具体语境回答（地道译法 / 词义 / 用法 / 语法），不要脱离上下文给字典义。',
  ].join('\n');
}

export const TOOL_HINT =
  '你可以调用工具读取用户当前正在看的页面、查词典、把单词存进学习记录、检索已有记录。需要页面内容时先调用 get_page_content，不要编造正文。';
