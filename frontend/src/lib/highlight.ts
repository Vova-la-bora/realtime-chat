// Подсветка найденных слов в тексте результата поиска

export interface TextPart {
  text: string;
  match: boolean;
}

// Сервер ищет по основам слов («архитектура» находит «архитектуру»), поэтому слово запроса
// сравнивается с началом слов текста: у длинных слов отбрасывается окончание
function stemPrefix(word: string): string {
  if (word.length >= 7) {
    return word.slice(0, -2);
  }
  if (word.length >= 5) {
    return word.slice(0, -1);
  }
  return word;
}

// Слова запроса без служебных частей синтаксиса: кавычек, исключений (-слово) и OR
function queryPrefixes(query: string): string[] {
  const prefixes: string[] = [];
  for (const raw of query.toLowerCase().split(/\s+/)) {
    if (raw.startsWith('-')) {
      continue;
    }
    const word = raw.replace(/[^\p{L}\p{N}]/gu, '');
    if (word.length >= 2 && word !== 'or') {
      prefixes.push(stemPrefix(word));
    }
  }
  return prefixes;
}

// Делит текст на куски; у кусков, содержащих слова запроса, match = true
export function highlightParts(text: string, query: string): TextPart[] {
  const prefixes = queryPrefixes(query);
  const parts: TextPart[] = [];
  let last = 0;
  for (const found of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = found.index ?? 0;
    const lower = found[0].toLowerCase();
    if (!prefixes.some((p) => lower.startsWith(p))) {
      continue;
    }
    if (start > last) {
      parts.push({ text: text.slice(last, start), match: false });
    }
    parts.push({ text: found[0], match: true });
    last = start + found[0].length;
  }
  if (last < text.length || parts.length === 0) {
    parts.push({ text: text.slice(last), match: false });
  }
  return parts;
}
