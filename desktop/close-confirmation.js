document.getElementById('keep').addEventListener('click', () => window.closeDialog.answer(false));
document.getElementById('dismiss').addEventListener('click', () => window.closeDialog.answer(false));
document.getElementById('stop').addEventListener('click', () => window.closeDialog.answer(true));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.closeDialog.answer(false);
});
window.addEventListener('DOMContentLoaded', () => document.getElementById('keep').focus());
