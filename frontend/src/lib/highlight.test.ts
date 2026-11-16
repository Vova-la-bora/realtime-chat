import { describe, expect, it } from 'vitest';
import { highlightParts } from './highlight';

const marked = (text: string, query: string) =>
  highlightParts(text, query)
    .filter((p) => p.match)
    .map((p) => p.text);

describe('highlightParts', () => {
  it('подсвечивает слово целиком и сохраняет остальной текст', () => {
    expect(highlightParts('Релиз назначен на пятницу', 'пятница')).toEqual([
      { text: 'Релиз назначен на ', match: false },
      { text: 'пятницу', match: true },
    ]);
  });

  it('склеенные части дают исходный текст', () => {
    const text = 'Мы обсуждаем архитектуру, а потом ещё раз — архитектуру!';
    const joined = highlightParts(text, 'архитектура')
      .map((p) => p.text)
      .join('');
    expect(joined).toBe(text);
  });

  it('находит другие формы слова и не зависит от регистра', () => {
    expect(marked('Обсуждаем Архитектуру проекта', 'АРХИТЕКТУРА')).toEqual(['Архитектуру']);
    expect(marked('релиза не будет, релизов много', 'релиз')).toEqual(['релиза', 'релизов']);
  });

  it('подсвечивает слова обоих запросов', () => {
    expect(marked('Красный велосипед и синий диван', 'красный диван')).toEqual([
      'Красный',
      'диван',
    ]);
  });

  it('игнорирует кавычки, исключённые слова и OR', () => {
    expect(marked('красный велосипед и красный диван', '"красный велосипед"')).toEqual([
      'красный',
      'велосипед',
      'красный',
    ]);
    expect(marked('красный велосипед', 'красный -велосипед')).toEqual(['красный']);
    expect(marked('кот or собака', 'кот or собака')).toEqual(['кот', 'собака']);
  });

  it('без совпадений возвращает один неподсвеченный кусок', () => {
    expect(highlightParts('Совсем другой текст', 'релиз')).toEqual([
      { text: 'Совсем другой текст', match: false },
    ]);
  });

  it('не воспринимает запрос как регулярное выражение', () => {
    expect(() => highlightParts('текст (скобки) [и] .*', '(.* [')).not.toThrow();
    expect(marked('точка. звезда*', '.*')).toEqual([]);
  });

  it('работает с цифрами и латиницей', () => {
    expect(marked('Версия 2024 вышла, Release notes', 'release 2024')).toEqual(['2024', 'Release']);
  });
});
