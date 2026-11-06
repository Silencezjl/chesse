// Suppress the native long-press menu on game content, but keep editing controls usable.
document.addEventListener('contextmenu', event => {
  if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches || event.pointerType === 'mouse') return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  event.preventDefault();
});
