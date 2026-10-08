export type Language = 'de' | 'en' | 'uk';
export { BRAND, languages, locales, languageValue, translate } from './translations.mjs';
export function countLabel(count:number, kind:'task'|'entry'|'block', language:Language) {
  const forms = {
    uk: {task:{one:'завдання',few:'завдання',many:'завдань',other:'завдання'},entry:{one:'запис',few:'записи',many:'записів',other:'запису'},block:{one:'блок',few:'блоки',many:'блоків',other:'блоку'}},
    en: {task:{one:'task',other:'tasks'},entry:{one:'entry',other:'entries'},block:{one:'block',other:'blocks'}},
    de: {task:{one:'Aufgabe',other:'Aufgaben'},entry:{one:'Eintrag',other:'Einträge'},block:{one:'Block',other:'Blöcke'}},
  };
  const form = new Intl.PluralRules(language).select(count);
  const words:Record<string,string> = forms[language][kind];
  return `${count} ${words[form] ?? words.other}`;
}
