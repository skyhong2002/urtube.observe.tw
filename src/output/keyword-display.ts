/** Display-only filtering; source keywords and matching evidence stay intact. */
export function isVisibleKeyword(text: string, categoryNames: readonly string[] = []): boolean {
  if (/[:：=＝]/u.test(text)) return false;
  const name = text.trim().toLowerCase();
  return !categoryNames.some(category => name === category.trim().toLowerCase());
}
