/**
 * popup 快捷按钮对应的 actionTag（PRD §8.1）。
 *
 * 注意：扩展端有同样定义在 `entrypoints/content/popup.tsx`（ActionTag），
 * 因为两个 tsconfig 不互通；改这里时记得同步改那边。
 */
export type ActionTag =
  | 'meaning' // 词义
  | 'pronunciation' // 音标 / 发音（不走 /chat，走 /lookup or Tier 0）
  | 'sentence-translate' // 本句译法
  | 'usage' // 用法搭配
  | 'translate' // 翻句
  | 'grammar' // 析语法
  | 'rewrite' // 改写地道说法
  | 'hard-parts'; // 难点定位

/**
 * 给每个 actionTag 配一个系统提示前缀，叠加到 selectionContext 的
 * 基础系统提示上（PRD §7.2 "轻路径"）。
 *
 * 风格统一：3-5 句、不重复字典义、贴合所在句语境。
 */
export const ACTION_TAG_PROMPTS: Record<ActionTag, string> = {
  meaning:
    '任务：仅解释这个词/短语在所在句子里的具体含义。不要重复字典基本义（用户已经看到）；说清作者为何这样用、跟最常见用法的差别（语气/感情色彩/搭配/隐含意）。3-5 句话。',
  pronunciation:
    '任务：给出该词的 IPA（美式 / 英式各一）及简短读法说明。本动作通常走 /api/lookup，被路由到这里属于兜底。3 句以内。',
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

