import { settings, type Action } from './settings';

/**
 * Raw input state with action mapping. Mouse look uses Pointer Lock deltas
 * with no smoothing. Pressed/released edges are consumed once per frame.
 */
class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** When set, the next key/mouse press is delivered here instead (key rebinding). */
  capture: ((code: string) => void) | null = null;
  anyKeyListeners = new Set<(code: string) => void>();
  canvas: HTMLElement | null = null;

  init(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.ctrlKey && (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'KeyD')) e.preventDefault();
      // while the mouse is captured, keep accidental Ctrl / Alt / Cmd shortcuts (Ctrl+E, Ctrl+U,
      // Ctrl+F, Ctrl+S, Alt+D...) from leaving the game; the few the browser reserves can't be blocked
      if (this.locked && (e.ctrlKey || e.altKey || e.metaKey)) e.preventDefault();
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code);
        return;
      }
      if (!e.repeat) {
        this.pressed.add(e.code);
        for (const l of this.anyKeyListeners) l(e.code);
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (this.locked && e.key === 'Alt') e.preventDefault(); // Firefox: Alt shows the menu bar
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(code);
        return;
      }
      this.down.add(code);
      this.pressed.add(code);
      for (const l of this.anyKeyListeners) l(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = 'Mouse' + e.button;
      this.down.delete(code);
      this.released.add(code);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.down.clear();
    });
  }

  requestLock() {
    if (!this.canvas || this.locked) return;
    try {
      const p = (this.canvas as any).requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          try {
            (this.canvas as any).requestPointerLock();
          } catch {
            /* ignored */
          }
        });
      }
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        /* ignored */
      }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(a: Action) {
    return this.down.has(settings.bindings[a]);
  }
  wasPressed(a: Action) {
    return this.pressed.has(settings.bindings[a]);
  }
  wasReleased(a: Action) {
    return this.released.has(settings.bindings[a]);
  }
  codePressed(code: string) {
    return this.pressed.has(code);
  }

  /** Called at the end of each frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  resetAll() {
    this.down.clear();
    this.endFrame();
  }
}

export const input = new Input();
