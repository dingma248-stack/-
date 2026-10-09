import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/700.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/jetbrains-mono/300.css';
import '@fontsource/jetbrains-mono/400.css';
import './ui/styles.css';
import { Game } from './game';

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

if (!hasWebGL2()) {
  (document.getElementById('nogl') as HTMLElement).style.display = 'flex';
} else {
  const game = new Game();
  game.boot().catch((e) => {
    console.error(e);
    const el = document.getElementById('nogl') as HTMLElement;
    el.innerHTML = '启动失败：' + String(e?.message ?? e);
    el.style.display = 'flex';
  });
  (window as unknown as { __game: Game }).__game = game;
}
