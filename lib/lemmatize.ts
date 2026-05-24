/**
 * 浏览器侧 lemma 还原 —— 跟 server/src/lib/lookup.ts 的 resolveLemma 同源同算法，
 * PRD 决策：放前端做避免把全文 POST 上去。
 */
import lemmatize from 'wink-lemmatizer';

const lemma = lemmatize as unknown as {
  verb: (w: string) => string;
  noun: (w: string) => string;
  adjective: (w: string) => string;
};

/**
 * 试动词 → 名词 → 形容词三个路径，取第一个"产生变化"的结果。
 * 未匹配时 wink-lemmatizer 原样返回；这种情况说明已经是原形或词典外的词。
 */
export function resolveLemma(word: string): string {
  const lower = word.toLowerCase();
  const v = lemma.verb(lower);
  if (v !== lower) return v;
  const n = lemma.noun(lower);
  if (n !== lower) return n;
  const a = lemma.adjective(lower);
  if (a !== lower) return a;
  return lower;
}
