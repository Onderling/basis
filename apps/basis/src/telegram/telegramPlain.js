/**
 * The bot's words as Telegram shows them: PLAIN text. Telegram gets no parse mode from this runner, so markdown the model
 * writes arrived with its marks — "**Taken**" with the stars, in a household's chat. This turns the common marks into
 * plain text at the one point a reply leaves for Telegram: bold, italic and code marks go, headings lose their hashes,
 * a list star becomes a bullet, a link keeps its words and its address. Conservative on purpose: a lone star between
 * spaces ("2 * 3") or underscores inside a word ("a_b_c") are not markdown and stay.
 *
 * @param {string} text
 * @returns {string}
 */
export function telegramPlain(text) {
  if (typeof text !== 'string' || !text) return typeof text === 'string' ? text : '';
  return text
    .replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1')                 // code fences → their contents
    .replace(/`([^`\n]+)`/g, '$1')                                 // inline code
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)') // [words](address)
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')                      // headings
    .replace(/^([ \t]*)[*-][ \t]+/gm, '$1• ')                      // list items
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')                           // **bold**
    .replace(/__([^_\n]+)__/g, '$1')                               // __bold__
    .replace(/(^|[^\w*])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?=[^\w*]|$)/g, '$1$2'); // *italic*, never "2 * 3"
}

export default telegramPlain;
