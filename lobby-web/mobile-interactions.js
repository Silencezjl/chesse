// Suppress the native long-press menu on game content, but keep editing controls usable.
document.addEventListener('contextmenu', event => {
  if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches || event.pointerType === 'mouse') return;
  if (event.composedPath().some(target => target instanceof Element && target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
  event.preventDefault();
});
