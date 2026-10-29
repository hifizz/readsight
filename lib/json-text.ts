/**
 * 从模型文本里取出 JSON。第三方端点经常在 JSON 外包 ``` 或一两句说明。
 */
export function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续在正文里找最外层的数组或对象 */
  }
  const arrayAt = trimmed.indexOf('[');
  const objectAt = trimmed.indexOf('{');
  const preferArray = arrayAt >= 0 && (objectAt < 0 || arrayAt < objectAt);
  if (preferArray) {
    const end = trimmed.lastIndexOf(']');
    if (end > arrayAt) return JSON.parse(trimmed.slice(arrayAt, end + 1));
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('response did not contain JSON');
}
