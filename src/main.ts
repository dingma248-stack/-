import 'virtual:fonts.css'; // subset @fontsource faces, see build/fonts.mjs
import './ui/styles.css';
import { Game } from './game';
import { ctx } from './core/ctx';

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
  (window as unknown as { __game: Game; __ctx: typeof ctx }).__game = game;
  (window as unknown as { __ctx: typeof ctx }).__ctx = ctx;
}
