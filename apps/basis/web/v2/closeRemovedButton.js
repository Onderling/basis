/** The close a circle one was removed from offers, beside the note that says so (the chat composer's place and the noticeboard's). */
export function closeRemovedButton(tr, onClose) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cc-btn cc-btn--primary circle-view__close-removed';
  btn.dataset.testid = 'close-removed-circle';
  btn.textContent = tr('circle.membership.removed_close');
  btn.addEventListener('click', () => { btn.disabled = true; Promise.resolve(onClose()).finally(() => { btn.disabled = false; }); });
  return btn;
}
