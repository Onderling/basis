/**
 * A task named in a person's words: "wie doet de lamp?" reads the open tasks whose words hold "lamp". One rule for the
 * task type's open read (`listOpen {text}`), wherever the tasks live — this app's circles, or a household bot's store.
 */

/**
 * Do the task's words hold these words (case and surrounding spaces aside)? No words: every task.
 * @param {{text?: string, title?: string}} task
 * @param {string} words
 * @returns {boolean}
 */
export function taskHasWords(task, words) {
  const want = String(words ?? '').trim().toLowerCase();
  if (!want) return true;
  return String(task?.text ?? task?.title ?? '').toLowerCase().includes(want);
}
