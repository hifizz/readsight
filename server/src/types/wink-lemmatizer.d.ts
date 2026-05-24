// wink-lemmatizer 不带类型声明（registry 没有 @types/...），手写一份。
// 实际导出形态：module.exports = { verb, noun, adjective, lemmatizeVerb, ... }
declare module 'wink-lemmatizer' {
  interface Lemmatize {
    verb(word: string): string;
    noun(word: string): string;
    adjective(word: string): string;
    lemmatizeVerb(word: string): string;
    lemmatizeNoun(word: string): string;
    lemmatizeAdjective(word: string): string;
  }
  const lemmatize: Lemmatize;
  export default lemmatize;
}
