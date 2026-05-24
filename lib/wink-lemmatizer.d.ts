// 跟 server/src/types/wink-lemmatizer.d.ts 同步。
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
