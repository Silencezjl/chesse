let theme=localStorage.getItem('platform_theme')==='dark'?'dark':'light';
function apply(){document.documentElement.dataset.theme=theme;document.querySelectorAll('[data-theme-toggle]').forEach(button=>{button.textContent=theme==='light'?'☾':'☀';button.setAttribute('aria-label',`切换为${theme==='light'?'暗':'亮'}色主题`);});document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#1b1729':'#f6f5fc');}
apply();
export function toggleTheme(){theme=theme==='light'?'dark':'light';localStorage.setItem('platform_theme',theme);apply();}
export function themeButton(){return `<button class="secondary theme-toggle" data-theme-toggle aria-label="切换为${theme==='light'?'暗':'亮'}色主题" title="切换主题">${theme==='light'?'☾':'☀'}</button>`;}
window.addEventListener('storage',e=>{if(e.key==='platform_theme'){theme=e.newValue==='dark'?'dark':'light';apply();}});
