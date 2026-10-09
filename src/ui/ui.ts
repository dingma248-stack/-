import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { input } from '../core/input';
import { settings, saveSettings, resetSettings, ACTION_LABELS, keyLabel, type Action } from '../core/settings';
import { WEAPONS, DIFFICULTY, type Difficulty, type WeaponId, type Quality } from '../config';
import { CHAPTERS, LORE, PURGE_CLOCK, fmtClock, type ChapterMeta } from '../levels/meta';
import { readProgress, readSave } from '../save/save';
import { ITEMS, type Doc, type Slot } from '../player/inventory';
import { pick, clamp } from '../core/math';
import type { Stats } from '../save/save';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

type MenuDef = { label: string; en?: string; act: () => void; disabled?: boolean };

export class UI {
  readonly root: HTMLElement;
  private boot: HTMLElement;
  private title: HTMLElement;
  private panelHost: HTMLElement;
  private loading: HTMLElement;
  private card: HTMLElement;
  private hud: HTMLElement;
  private pause: HTMLElement;
  private inv: HTMLElement;
  private doc: HTMLElement;
  private keypadEl: HTMLElement;
  private death: HTMLElement;
  private ending: HTMLElement;
  private choiceEl: HTMLElement;
  private debugEl: HTMLElement;
  // hud refs
  private ecg!: HTMLCanvasElement;
  private ecgCtx!: CanvasRenderingContext2D;
  private ecgBuf: number[] = [];
  private ecgPhase = 0;
  private hpLabel!: HTMLElement;
  private hpRate!: HTMLElement;
  private stam!: HTMLElement;
  private ammoNum!: HTMLElement;
  private ammoName!: HTMLElement;
  private ammoMeta!: HTMLElement;
  private clock!: HTMLElement;
  private purge!: HTMLElement;
  private loc!: HTMLElement;
  private batt!: HTMLElement;
  private cross!: HTMLElement;
  private hitEl!: HTMLElement;
  private promptEl!: HTMLElement;
  private subsWho!: HTMLElement;
  private subsTxt!: HTMLElement;
  private subsEl!: HTMLElement;
  private objEl!: HTMLElement;
  private toasts!: HTMLElement;
  private grabEl!: HTMLElement;
  private wgetEl!: HTMLElement;
  private lbox!: HTMLElement;
  private skip!: HTMLElement;
  private saveEl!: HTMLElement;
  private healthBlock!: HTMLElement;
  private ammoBlock!: HTMLElement;
  private battBlock!: HTMLElement;
  private crossSpread = 0;
  private hudIdle = 0;
  private lastHp = 100;
  private lastAmmo = '';
  private typing: number | null = null;
  private menuNav: { items: HTMLElement[]; idx: number; back?: () => void } | null = null;
  inventoryOpen = false;
  docOpen = false;
  keypadOpen = false;
  choiceOpen = false;
  private docClose: (() => void) | null = null;

  constructor() {
    this.root = document.getElementById('ui')!;
    this.boot = this.mk('boot', 'screen show');
    this.title = this.mk('title', 'screen grain');
    this.panelHost = this.mk('panels', 'layer');
    this.loading = this.mk('loading', 'screen');
    this.card = this.mk('card', 'screen');
    this.hud = this.mk('hud', 'layer hidden');
    this.pause = this.mk('pause', 'screen');
    this.inv = this.mk('inv', 'screen');
    this.doc = this.mk('doc', 'screen');
    this.keypadEl = this.mk('keypad', 'screen');
    this.death = this.mk('death', 'screen');
    this.ending = this.mk('ending', 'screen grain');
    this.choiceEl = this.mk('choice', 'screen');
    this.debugEl = this.mk('debug', 'hidden');
    this.buildBoot();
    this.buildHud();
    window.addEventListener('keydown', (e) => this.navKey(e));
  }

  private mk(id: string, cls: string) {
    const e = h('div', cls);
    e.id = id;
    this.root.appendChild(e);
    return e;
  }

  private show(e: HTMLElement, on: boolean) {
    e.classList.toggle('show', on);
  }

  hover() {
    ctx.audio?.play('uiHover', { bus: 'ui', vol: 0.6 });
  }
  select() {
    ctx.audio?.play('uiSelect', { bus: 'ui', vol: 0.7 });
  }
  back() {
    ctx.audio?.play('uiBack', { bus: 'ui', vol: 0.7 });
  }

  private menu(host: HTMLElement, items: MenuDef[], backAct?: () => void) {
    host.innerHTML = '';
    const els: HTMLElement[] = [];
    for (const it of items) {
      const e = h('div', 'menu-item interactive' + (it.disabled ? ' disabled' : ''), `${it.label}${it.en ? `<small>${it.en}</small>` : ''}`);
      e.addEventListener('mouseenter', () => {
        if (it.disabled) return;
        this.hover();
        if (this.menuNav) {
          this.menuNav.idx = els.indexOf(e);
          this.focusNav();
        }
      });
      e.addEventListener('click', () => {
        if (it.disabled) return;
        this.select();
        it.act();
      });
      host.appendChild(e);
      if (!it.disabled) els.push(e);
    }
    this.menuNav = { items: els, idx: -1, back: backAct };
  }

  private focusNav() {
    if (!this.menuNav) return;
    this.menuNav.items.forEach((e, i) => e.classList.toggle('focus', i === this.menuNav!.idx));
  }

  private navKey(e: KeyboardEvent) {
    const n = this.menuNav;
    if (!n || input.locked || input.capture) return;
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS') {
      n.idx = (n.idx + 1) % n.items.length;
      this.focusNav();
      this.hover();
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'KeyW') {
      n.idx = (n.idx - 1 + n.items.length) % n.items.length;
      this.focusNav();
      this.hover();
    } else if (e.code === 'Enter' && n.idx >= 0) {
      n.items[n.idx].click();
    }
  }

  // =================================================== BOOT
  private bootBar!: HTMLElement;
  private bootPress!: HTMLElement;
  private buildBoot() {
    this.boot.innerHTML = `
      <div class="warn">本作包含血腥暴力与惊吓内容 · 建议佩戴耳机</div>
      <div class="mark">雾港 · 长夜</div>
      <div class="bar"><i></i></div>
      <div class="press">Press any key<small>按任意键开始</small></div>
      <div class="hint">WASD 移动 · 鼠标瞄准 · 左键射击 · 右键瞄准 · E 交互 · F 手电</div>`;
    this.bootBar = this.boot.querySelector('.bar i')!;
    this.bootPress = this.boot.querySelector('.press')!;
  }
  bootProgress(p: number) {
    this.bootBar.style.width = `${Math.round(p * 100)}%`;
  }
  bootReady(onStart: () => void) {
    this.bootPress.classList.add('ready');
    (this.boot.querySelector('.bar') as HTMLElement).style.opacity = '0';
    const go = () => {
      window.removeEventListener('keydown', go);
      window.removeEventListener('mousedown', go);
      this.boot.classList.remove('show');
      setTimeout(() => this.boot.remove(), 900);
      onStart();
    };
    window.addEventListener('keydown', go);
    window.addEventListener('mousedown', go);
  }

  // =================================================== TITLE
  private glitchTimer: number | null = null;
  showTitle() {
    const prog = readProgress();
    const save = readSave();
    this.title.innerHTML = `
      <div class="left-shade"></div><div class="vignette"></div>
      <div class="logo">
        <h1 class="glitch" data-text="雾港·长夜">雾港<span class="dot">·</span>长夜</h1>
        <div class="en">MISTPORT : THE LONG NIGHT</div>
        <div class="rule"></div>
      </div>
      <div class="menu"></div>
      <div class="clock"><b>22:40</b> · 距离净化还有 <span class="red">6 小时 20 分</span></div>
      <div class="ver">v0.1 · ${prog.cleared ? 'CLEARED' : 'FIRST NIGHT'}</div>`;
    const items: MenuDef[] = [];
    if (save) items.push({ label: '继续', en: 'Continue', act: () => ctx.game.continueGame() });
    items.push({ label: '新游戏', en: 'New Game', act: () => this.showDifficulty() });
    items.push({ label: '章节选择', en: 'Chapters', act: () => this.showChapters() });
    if (prog.endings.length) items.push({ label: '结局画廊', en: 'Endings', act: () => this.showGallery() });
    items.push({ label: '设置', en: 'Settings', act: () => this.showSettings(() => this.showTitle()) });
    items.push({ label: '制作人员', en: 'Credits', act: () => this.showCredits() });
    this.menu(this.title.querySelector('.menu')!, items);
    this.show(this.title, true);
    this.panelHost.innerHTML = '';
    const h1 = this.title.querySelector('h1') as HTMLElement;
    if (this.glitchTimer) clearInterval(this.glitchTimer);
    let burst = 0;
    this.glitchTimer = window.setInterval(() => {
      if (burst > 0 || Math.random() < 0.025) {
        if (burst <= 0) burst = 4 + Math.floor(Math.random() * 6);
        burst--;
        const r = () => `${Math.floor(Math.random() * 90)}%`;
        h1.style.setProperty('--g1', r());
        h1.style.setProperty('--g2', r());
        h1.style.setProperty('--g3', r());
        h1.style.setProperty('--g4', r());
        h1.style.transform = `translateX(${(Math.random() - 0.5) * 6}px)`;
        h1.style.opacity = Math.random() < 0.2 ? '0.6' : '1';
      } else {
        h1.style.setProperty('--g1', '100%');
        h1.style.setProperty('--g2', '0%');
        h1.style.setProperty('--g3', '100%');
        h1.style.setProperty('--g4', '0%');
        h1.style.transform = '';
        h1.style.opacity = '1';
      }
    }, 60);
  }
  hideTitle() {
    this.show(this.title, false);
    this.panelHost.innerHTML = '';
    if (this.glitchTimer) clearInterval(this.glitchTimer);
    this.glitchTimer = null;
    this.menuNav = null;
  }

  private panel(titleCn: string, sub: string, onBack: () => void) {
    this.show(this.title, false);
    this.panelHost.innerHTML = '';
    const p = h('div', 'panel interactive grain');
    p.innerHTML = `<h2>${titleCn}</h2><div class="sub">${sub}</div><div class="back">返回</div>`;
    const back = () => {
      this.back();
      this.panelHost.innerHTML = '';
      onBack();
    };
    p.querySelector('.back')!.addEventListener('click', back);
    p.querySelector('.back')!.addEventListener('mouseenter', () => this.hover());
    this.panelHost.appendChild(p);
    this.menuNav = null;
    const esc = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && p.isConnected && !input.capture) {
        window.removeEventListener('keydown', esc);
        back();
      }
    };
    window.addEventListener('keydown', esc);
    return p;
  }

  private showDifficulty() {
    const prog = readProgress();
    const p = this.panel('难度', 'Choose your night', () => this.showTitle());
    const cards = h('div', 'cards difficulty');
    const defs: [Difficulty, string, string, boolean][] = [
      ['easy', '简单', '更多物资，敌人更脆弱。适合想体验故事的人。', true],
      ['normal', '普通', '推荐。资源紧张，每一发子弹都有分量。', true],
      ['nightmare', '噩梦', prog.cleared ? '敌人更强，物资更少。没有人会来救你。' : '通关后解锁。', prog.cleared],
    ];
    defs.forEach(([id, nm, ds, ok], i) => {
      const c = h('div', 'card' + (ok ? '' : ' locked'), `<div class="no">0${i + 1}</div><div class="nm">${nm}</div><div class="ds">${ds}</div>`);
      if (ok) {
        c.addEventListener('mouseenter', () => this.hover());
        c.addEventListener('click', () => {
          this.select();
          this.panelHost.innerHTML = '';
          ctx.game.newGame(id);
        });
      }
      cards.appendChild(c);
    });
    p.appendChild(cards);
  }

  private showChapters() {
    const prog = readProgress();
    const p = this.panel('章节选择', 'Chapters', () => this.showTitle());
    const cards = h('div', 'cards');
    CHAPTERS.forEach((c: ChapterMeta) => {
      const ok = prog.chapters.includes(c.id);
      const el = h('div', 'card' + (ok ? '' : ' locked'), `<div class="no">${c.no}</div><div class="tm">${c.time}</div><div class="nm">${ok ? c.name : '——'}</div><div class="ds">${ok ? c.en + ' · ' + c.place : '尚未解锁'}</div>`);
      if (ok) {
        el.addEventListener('mouseenter', () => this.hover());
        el.addEventListener('click', () => {
          this.select();
          this.panelHost.innerHTML = '';
          ctx.game.selectChapter(c.id, 'normal');
        });
      }
      cards.appendChild(el);
    });
    p.appendChild(cards);
  }

  private showGallery() {
    const prog = readProgress();
    const p = this.panel('结局画廊', 'Endings', () => this.showTitle());
    const cards = h('div', 'cards');
    const ends = [
      ['dawn', '结局 A', '黎明', '她把那管疫苗攥在手心里，像攥着一个还没有被烧掉的城市。'],
      ['alone', '结局 B', '独行', '直升机上只有一个人。舱门边放着一只沾血的硬盘。'],
    ];
    for (const [id, no, nm, ds] of ends) {
      const ok = prog.endings.includes(id);
      cards.appendChild(h('div', 'card' + (ok ? '' : ' locked'), `<div class="no">${no}</div><div class="nm">${ok ? nm : '？？？'}</div><div class="ds">${ok ? ds : '尚未达成'}</div>`));
    }
    p.appendChild(cards);
    if (prog.bestTime) p.appendChild(h('div', 'sub', `<br>最佳通关时间 ${fmtTime(prog.bestTime)} · 最高评价 ${prog.bestRank ?? '-'}`));
  }

  private showCredits() {
    const p = this.panel('制作人员', 'Credits', () => this.showTitle());
    p.appendChild(
      h(
        'div',
        'credits',
        `<b>DESIGN · CODE · SOUND</b>全部程序化生成：模型、贴图、音效与配乐均在浏览器中实时合成。
        <b>TECHNOLOGY</b>Three.js · Rapier · Web Audio API · TypeScript · Vite
        <b>TYPEFACES</b>Noto Serif SC · Cormorant Garamond · JetBrains Mono
        <b>A NOTE</b>本作所有人物、地名、机构、病毒与怪物均为虚构。<br>如有雷同，那只能说明雾太大了。`,
      ),
    );
  }

  // =================================================== SETTINGS
  showSettings(onBack: () => void) {
    const p = this.panel('设置', 'Settings', onBack);
    const tabs = h('div', 'tabs');
    const body = h('div', 'rows');
    const names = ['画面', '操作', '音频', '键位'];
    let cur = 0;
    const render = () => {
      tabs.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('on', i === cur));
      body.innerHTML = '';
      if (cur === 0) {
        this.choiceRow(body, '画质', [['low', '低'], ['medium', '中'], ['high', '高']], settings.quality, (v) => {
          settings.quality = v as Quality;
          ctx.game?.applyQuality();
        });
        this.choiceRow(body, '内部分辨率', [['270', '270p'], ['360', '360p'], ['540', '540p']], String(settings.resScale), (v) => (settings.resScale = Number(v)));
        this.slider(body, '视野 FOV', 70, 100, 1, settings.fov, (v) => (settings.fov = v), (v) => `${v}°`);
        this.slider(body, '顶点抖动', 0, 1, 0.05, settings.vertexSnap, (v) => (settings.vertexSnap = v), (v) => `${Math.round(v * 100)}%`);
        this.toggle(body, 'CRT 滤镜', settings.crt, (v) => (settings.crt = v));
        this.toggle(body, '镜头晃动', settings.headBob, (v) => (settings.headBob = v));
        this.toggle(body, '字幕', settings.subtitles, (v) => (settings.subtitles = v));
      } else if (cur === 1) {
        this.slider(body, '鼠标灵敏度', 0.2, 3, 0.05, settings.sensitivity, (v) => (settings.sensitivity = v), (v) => v.toFixed(2));
        this.toggle(body, '反转 Y 轴', settings.invertY, (v) => (settings.invertY = v));
        this.toggle(body, '蹲下：切换模式', settings.crouchToggle, (v) => (settings.crouchToggle = v));
      } else if (cur === 2) {
        this.slider(body, '主音量', 0, 1, 0.01, settings.master, (v) => (settings.master = v), pct);
        this.slider(body, '音乐', 0, 1, 0.01, settings.music, (v) => (settings.music = v), pct);
        this.slider(body, '音效', 0, 1, 0.01, settings.sfx, (v) => (settings.sfx = v), pct);
        this.slider(body, '语音 / 界面', 0, 1, 0.01, settings.voice, (v) => (settings.voice = v), pct);
      } else {
        for (const a of Object.keys(ACTION_LABELS) as Action[]) {
          const r = h('div', 'row');
          r.innerHTML = `<label>${ACTION_LABELS[a]}</label>`;
          const k = h('div', 'keybind interactive', keyLabel(settings.bindings[a]));
          k.addEventListener('click', () => {
            this.select();
            k.classList.add('wait');
            k.textContent = '按下新按键…';
            input.capture = (code) => {
              k.classList.remove('wait');
              if (code !== 'Escape' || a === 'pause') {
                // swap if another action already uses this key
                const other = (Object.keys(settings.bindings) as Action[]).find((x) => x !== a && settings.bindings[x] === code);
                if (other) settings.bindings[other] = settings.bindings[a];
                settings.bindings[a] = code;
                saveSettings();
              }
              render();
            };
          });
          r.appendChild(k);
          r.appendChild(h('div', 'val'));
          body.appendChild(r);
        }
        const reset = h('div', 'btn-line interactive', '恢复默认设置');
        reset.addEventListener('click', () => {
          resetSettings();
          this.select();
          render();
        });
        body.appendChild(reset);
      }
    };
    names.forEach((n, i) => {
      const t = h('div', 'tab interactive', n);
      t.addEventListener('click', () => {
        cur = i;
        this.hover();
        render();
      });
      tabs.appendChild(t);
    });
    p.appendChild(tabs);
    p.appendChild(body);
    render();
  }

  private slider(host: HTMLElement, label: string, min: number, max: number, step: number, val: number, set: (v: number) => void, fmt: (v: number) => string) {
    const r = h('div', 'row');
    r.innerHTML = `<label>${label}</label>`;
    const inp = h('input', 'interactive') as HTMLInputElement;
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(val);
    const v = h('div', 'val', fmt(val));
    inp.addEventListener('input', () => {
      const n = Number(inp.value);
      set(n);
      v.textContent = fmt(n);
      saveSettings();
    });
    inp.addEventListener('change', () => this.hover());
    r.append(inp, v);
    host.appendChild(r);
  }

  private toggle(host: HTMLElement, label: string, val: boolean, set: (v: boolean) => void) {
    this.choiceRow(host, label, [['1', '开'], ['0', '关']], val ? '1' : '0', (v) => set(v === '1'));
  }

  private choiceRow(host: HTMLElement, label: string, opts: [string, string][], cur: string, set: (v: string) => void) {
    const r = h('div', 'row');
    r.innerHTML = `<label>${label}</label>`;
    const c = h('div', 'choice');
    for (const [v, l] of opts) {
      const s = h('span', 'interactive' + (v === cur ? ' on' : ''), l);
      s.addEventListener('click', () => {
        c.querySelectorAll('span').forEach((x) => x.classList.remove('on'));
        s.classList.add('on');
        set(v);
        saveSettings();
        this.hover();
      });
      c.appendChild(s);
    }
    r.append(c, h('div', 'val'));
    host.appendChild(r);
  }

  // =================================================== LOADING / CARD
  showLoading(on: boolean) {
    if (on) this.loading.innerHTML = `<div class="frag"><em>— 档案碎片 —</em>${pick(LORE)}</div><div class="spin">LOADING</div>`;
    this.show(this.loading, on);
  }

  async chapterCard(meta: ChapterMeta) {
    this.card.innerHTML = `<div class="t1"></div><div class="t2"></div><div class="t3"></div>`;
    this.show(this.card, true);
    await sleep(700);
    const t1 = this.card.querySelector('.t1') as HTMLElement;
    const t2 = this.card.querySelector('.t2') as HTMLElement;
    const t3 = this.card.querySelector('.t3') as HTMLElement;
    await this.typeInto(t1, `${meta.time}  ·  ${meta.no}`, 55);
    await sleep(250);
    await this.typeInto(t2, meta.place, 90);
    await sleep(200);
    await this.typeInto(t3, `${meta.place2}  —  ${meta.en}`, 45);
    ctx.audio.play('typeBell', { bus: 'ui', vol: 0.8 });
    await sleep(1700);
    this.show(this.card, false);
    await sleep(600);
  }

  private async typeInto(el: HTMLElement, text: string, ms: number) {
    el.classList.add('caret');
    for (let i = 1; i <= text.length; i++) {
      el.textContent = text.slice(0, i);
      if (text[i - 1] !== ' ') ctx.audio.play('type', { bus: 'ui', vol: 0.9 });
      await sleep(ms * (text[i - 1] === '·' ? 3 : 1));
    }
    el.classList.remove('caret');
  }

  // =================================================== HUD
  private buildHud() {
    this.hud.innerHTML = `
      <div class="hud-batt fadeable"><span>手电</span><div class="cell"><i></i></div><span class="pc"></span></div>
      <div class="objective"></div>
      <div class="hud-time"><div class="clk"></div><div class="purge"></div><div class="loc"></div></div>
      <div class="savepulse">已存档</div>
      <div class="hud-health fadeable">
        <div class="lbl"><b>稳定</b><span class="hr">HR 72</span></div>
        <canvas width="200" height="46"></canvas>
        <div class="stam"><i></i></div>
      </div>
      <div class="hud-ammo fadeable"><div class="wn"></div><div class="num"></div><div class="meta"></div></div>
      <div class="crosshair"><div class="dot"></div><div class="tk t"></div><div class="tk b"></div><div class="tk l"></div><div class="tk r"></div></div>
      <div class="hitmark"></div>
      <div class="prompt"></div>
      <div class="subs"><div class="who"></div><div class="txt"></div></div>
      <div class="toasts"></div>
      <div class="grab"><div class="t">连按 <b>E</b> 挣脱</div><div class="bar"><i></i></div></div>
      <div class="wget"><div class="a">ACQUIRED</div><div class="b"></div><div class="c"></div></div>
      <div class="layer letterbox"></div>
      <div class="skiphint">ENTER · 跳过</div>`;
    const q = (s: string) => this.hud.querySelector(s) as HTMLElement;
    this.ecg = q('.hud-health canvas') as HTMLCanvasElement;
    this.ecgCtx = this.ecg.getContext('2d')!;
    this.hpLabel = q('.hud-health .lbl b');
    this.hpRate = q('.hud-health .hr');
    this.stam = q('.hud-health .stam');
    this.ammoNum = q('.hud-ammo .num');
    this.ammoName = q('.hud-ammo .wn');
    this.ammoMeta = q('.hud-ammo .meta');
    this.clock = q('.hud-time .clk');
    this.purge = q('.hud-time .purge');
    this.loc = q('.hud-time .loc');
    this.batt = q('.hud-batt');
    this.cross = q('.crosshair');
    this.hitEl = q('.hitmark');
    this.promptEl = q('.prompt');
    this.subsEl = q('.subs');
    this.subsWho = q('.subs .who');
    this.subsTxt = q('.subs .txt');
    this.objEl = q('.objective');
    this.toasts = q('.toasts');
    this.grabEl = q('.grab');
    this.wgetEl = q('.wget');
    this.lbox = q('.letterbox');
    this.skip = q('.skiphint');
    this.saveEl = q('.savepulse');
    this.healthBlock = q('.hud-health');
    this.ammoBlock = q('.hud-ammo');
    this.battBlock = this.batt;
  }

  showHud(on: boolean) {
    this.hud.classList.toggle('hidden', !on);
  }

  setLocation(text: string) {
    this.loc.textContent = text;
  }

  /** Per-frame HUD refresh. */
  update(dt: number) {
    const p = ctx.player;
    if (!p) return;
    // ---- ECG ----
    const hp = p.health;
    const state = hp > 60 ? 0 : hp > 25 ? 1 : 2;
    const bpm = p.dead ? 0 : 64 + (1 - hp / 100) * 70 + (p.sprinting || p.exhausted ? 25 : 0) + ctx.director.tension * 15;
    this.ecgPhase += (dt * bpm) / 60;
    const beat = this.ecgPhase % 1;
    const ecgV = (b: number) => {
      if (p.dead) return 0;
      if (b < 0.06) return Math.sin((b / 0.06) * Math.PI) * 0.12;
      if (b < 0.1) return 0;
      if (b < 0.12) return -0.18;
      if (b < 0.15) return 1;
      if (b < 0.18) return -0.42;
      if (b < 0.32) return 0;
      if (b < 0.44) return Math.sin(((b - 0.32) / 0.12) * Math.PI) * 0.22;
      return 0;
    };
    const samples = Math.max(1, Math.round(dt * 110));
    for (let i = 0; i < samples; i++) this.ecgBuf.push(ecgV((beat - ((samples - 1 - i) * dt) / samples / Math.max(0.3, 60 / Math.max(bpm, 1))) % 1));
    while (this.ecgBuf.length > 200) this.ecgBuf.shift();
    const c = this.ecgCtx;
    const col = state === 0 ? '214,226,206' : state === 1 ? '214,161,74' : '224,71,58';
    c.clearRect(0, 0, 200, 46);
    c.strokeStyle = 'rgba(233,227,213,0.06)';
    c.lineWidth = 1;
    for (let x = 0; x < 200; x += 20) {
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, 46);
      c.stroke();
    }
    const n = this.ecgBuf.length;
    for (let i = 1; i < n; i++) {
      const a = i / n;
      c.strokeStyle = `rgba(${col},${a * a})`;
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(i - 1, 30 - this.ecgBuf[i - 1] * 22);
      c.lineTo(i, 30 - this.ecgBuf[i] * 22);
      c.stroke();
    }
    c.fillStyle = `rgba(${col},1)`;
    c.fillRect(n - 2, 29 - this.ecgBuf[n - 1] * 22, 3, 3);
    this.hpLabel.textContent = p.dead ? '——' : ['稳定', '警戒', '危险'][state];
    this.hpLabel.className = state === 1 ? 'warn' : state === 2 ? 'danger' : '';
    this.hpRate.textContent = `HR ${Math.round(bpm)}`;
    const st = this.stam.firstElementChild as HTMLElement;
    st.style.width = `${(p.stamina / 100) * 100}%`;
    this.stam.classList.toggle('ex', p.exhausted);
    this.stam.style.opacity = p.stamina < 99 ? '1' : '0';
    // ---- ammo ----
    const w = ctx.weapons;
    const am = w.ammoText();
    const key = `${w.current}:${am?.mag}:${am?.reserve}`;
    if (key !== this.lastAmmo) {
      this.lastAmmo = key;
      this.hudIdle = 0;
      this.ammoName.textContent = WEAPONS[w.current].name;
      if (am) {
        this.ammoNum.innerHTML = `${am.mag}<small>/ ${am.reserve}</small>`;
        this.ammoNum.classList.toggle('low', am.mag <= Math.ceil(WEAPONS[w.current].mag * 0.25));
        this.ammoMeta.textContent = WEAPONS[w.current].nameEn;
      } else {
        this.ammoNum.innerHTML = '—';
        this.ammoNum.classList.remove('low');
        this.ammoMeta.textContent = 'MELEE';
      }
    }
    // ---- clock ----
    const clk = ctx.game.clock;
    const t = fmtClock(clk);
    this.clock.innerHTML = `${t.slice(0, 2)}<span class="colon">:</span>${t.slice(3)}`;
    const left = Math.max(0, PURGE_CLOCK - clk);
    this.purge.textContent = `净化倒计时 ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    // ---- battery ----
    const b = p.battery;
    (this.batt.querySelector('.cell i') as HTMLElement).style.width = `${b}%`;
    (this.batt.querySelector('.pc') as HTMLElement).textContent = p.flashOn ? `${Math.ceil(b)}%` : 'OFF';
    this.batt.classList.toggle('low', b < 20);
    // ---- idle fade ----
    if (Math.abs(hp - this.lastHp) > 0.1 || ctx.director.inCombat || ctx.weapons.state !== 'idle' || hp < 40 || p.stamina < 99) this.hudIdle = 0;
    this.lastHp = hp;
    this.hudIdle += dt;
    const idle = this.hudIdle > 4.5;
    this.healthBlock.classList.toggle('idle', idle);
    this.ammoBlock.classList.toggle('idle', idle);
    this.battBlock.classList.toggle('idle', idle && b > 20);
    // ---- crosshair ----
    this.crossSpread = Math.max(0, this.crossSpread - dt * 3);
    const moving = Math.hypot(p.vel.x, p.vel.z) / 3.3;
    const spread = 6 + this.crossSpread * 16 + moving * 6 * (1 - w.adsT) + (1 - w.adsT) * 2;
    const tk = this.cross.querySelectorAll('.tk') as NodeListOf<HTMLElement>;
    tk[0].style.transform = `translateY(${-spread - 5}px)`;
    tk[1].style.transform = `translateY(${spread}px)`;
    tk[2].style.transform = `translateX(${-spread - 5}px)`;
    tk[3].style.transform = `translateX(${spread}px)`;
    this.cross.style.opacity = w.current === 'knife' ? '0.5' : w.adsT > 0.8 ? '0.25' : p.sprinting ? '0' : '1';
    this.skip.classList.toggle('on', ctx.story.inCutscene);
  }

  prompt(text: string | null, pos?: THREE.Vector3) {
    if (!text || !pos) {
      this.promptEl.classList.remove('on');
      return;
    }
    const cam = ctx.player.camera;
    const v = pos.clone().project(cam);
    if (v.z > 1) {
      this.promptEl.classList.remove('on');
      return;
    }
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.promptEl.style.left = `${clamp(x, 80, window.innerWidth - 80)}px`;
    this.promptEl.style.top = `${clamp(y - 18, 60, window.innerHeight - 60)}px`;
    const m = /^\[(.+?)\]\s*(.*)$/.exec(text);
    const k = keyLabel(settings.bindings.interact);
    this.promptEl.innerHTML = m ? `<span class="k">${m[1] === 'E' ? k : m[1]}</span>${m[2]}` : text;
    this.promptEl.classList.add('on');
  }

  toast(text: string) {
    const t = h('div', 'toast', text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => t.remove(), 3300);
  }

  /** Returns how long the typewriter will take (seconds). */
  subtitle(who: string | null, text: string, radio: boolean): number {
    if (this.typing) clearInterval(this.typing);
    this.typing = null;
    if (!who || !settings.subtitles) {
      this.subsEl.style.opacity = '0';
      return text.length * 0.035;
    }
    this.subsEl.style.opacity = '1';
    this.subsWho.textContent = who;
    this.subsWho.className = 'who' + (radio ? ' radio' : '');
    this.subsTxt.className = 'txt' + (radio ? ' radio' : '');
    let i = 0;
    this.subsTxt.textContent = '';
    const step = 35;
    this.typing = window.setInterval(() => {
      i++;
      this.subsTxt.textContent = text.slice(0, i);
      if (i % 2 === 0) ctx.audio.play('type', { bus: 'voice', vol: 0.35, rate: radio ? 0.7 : 1.1 });
      if (i >= text.length || ctx.story.skipping) {
        this.subsTxt.textContent = text;
        if (this.typing) clearInterval(this.typing);
        this.typing = null;
      }
    }, step);
    return (text.length * step) / 1000;
  }

  objective(text: string) {
    this.objEl.classList.remove('on');
    setTimeout(() => {
      this.objEl.textContent = text;
      if (text) this.objEl.classList.add('on');
    }, 300);
    if (text) ctx.audio.play('typeBell', { bus: 'ui', vol: 0.5 });
  }

  hitmarker(head: boolean) {
    this.hitEl.className = 'hitmark' + (head ? ' head' : '');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('on');
  }

  crosshairKick(k: number) {
    this.crossSpread = Math.min(1.5, this.crossSpread + k);
  }

  weaponChanged() {
    this.hudIdle = 0;
  }

  weaponGet(id: WeaponId) {
    const d = WEAPONS[id];
    (this.wgetEl.querySelector('.b') as HTMLElement).textContent = d.name;
    (this.wgetEl.querySelector('.c') as HTMLElement).textContent = d.nameEn;
    this.wgetEl.classList.remove('on');
    void this.wgetEl.offsetWidth;
    this.wgetEl.classList.add('on');
  }

  grabPrompt(on: boolean) {
    this.grabEl.classList.toggle('on', on);
    (this.grabEl.querySelector('.t b') as HTMLElement).textContent = keyLabel(settings.bindings.interact);
  }
  grabProgress(p: number) {
    (this.grabEl.querySelector('.bar i') as HTMLElement).style.width = `${p * 100}%`;
  }

  letterbox(on: boolean) {
    this.lbox.classList.toggle('on', on);
    this.cross.style.visibility = on ? 'hidden' : '';
    this.healthBlock.style.visibility = on ? 'hidden' : '';
    this.ammoBlock.style.visibility = on ? 'hidden' : '';
  }

  savePulse() {
    this.saveEl.classList.remove('on');
    void this.saveEl.offsetWidth;
    this.saveEl.classList.add('on');
  }

  // =================================================== PAUSE
  showPause(on: boolean, stats?: Stats) {
    if (on) {
      const lvl = ctx.level;
      const meta = CHAPTERS.find((c) => c.id === ctx.game.chapterId);
      this.pause.innerHTML = `
        <div class="head"><div class="a">PAUSED · ${fmtClock(ctx.game.clock)}</div><div class="b">暂停</div><div class="c">${meta ? meta.no + ' · ' + meta.name : ''}${lvl?.objective ? ' — ' + lvl.objective : ''}</div></div>
        <div class="menu"></div>
        <div class="stats">
          <div>游戏时间<b>${fmtTime(stats?.time ?? 0)}</b></div>
          <div>击杀<b>${stats?.kills ?? 0}</b></div>
          <div>命中率<b>${stats && stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0}%</b></div>
          <div>难度<b>${DIFFICULTY[ctx.difficulty].label}</b></div>
        </div>`;
      this.menu(this.pause.querySelector('.menu')!, [
        { label: '继续', en: 'Resume', act: () => ctx.game.resume() },
        { label: '设置', en: 'Settings', act: () => this.showSettings(() => this.showPause(true, stats)) },
        { label: '从检查点重试', en: 'Retry checkpoint', act: () => ctx.game.restartCheckpoint() },
        { label: '返回标题', en: 'Quit to title', act: () => ctx.game.quitToTitle() },
      ]);
    } else {
      this.panelHost.innerHTML = '';
      this.menuNav = null;
    }
    this.show(this.pause, on);
  }

  // =================================================== INVENTORY / MAP / DOCS
  private invTab = 0;
  private selSlot: Slot | null = null;
  showInventory(on: boolean) {
    this.inventoryOpen = on;
    this.show(this.inv, on);
    if (on) {
      ctx.audio.play('inventory', { bus: 'ui' });
      this.renderInventory();
    }
  }

  private renderInventory() {
    const tabs = ['背包', '地图', '档案'];
    this.inv.innerHTML = '';
    const tb = h('div', 'tabs');
    tabs.forEach((t, i) => {
      const e = h('div', 'tab interactive' + (i === this.invTab ? ' on' : ''), t);
      e.addEventListener('click', () => {
        this.invTab = i;
        this.hover();
        this.renderInventory();
      });
      tb.appendChild(e);
    });
    this.inv.appendChild(tb);
    const body = h('div', 'body');
    this.inv.appendChild(body);
    if (this.invTab === 0) this.renderBag(body);
    else if (this.invTab === 1) this.renderMap(body);
    else this.renderDocs(body);
    const hint = h('div', '', `<div style="position:absolute;bottom:5vh;left:7vw;font-family:var(--mono);font-size:10px;letter-spacing:.3em;color:rgba(233,227,213,.3)">TAB · 关闭　　点击物品查看 / 使用 / 丢弃</div>`);
    this.inv.appendChild(hint);
  }

  private renderBag(body: HTMLElement) {
    const inv = ctx.inventory;
    const S = 74, G = 4;
    const wrap = h('div');
    wrap.appendChild(h('h3', '', '', ));
    (wrap.firstChild as HTMLElement).style.cssText = 'font-weight:400;font-size:13px;letter-spacing:.5em;color:var(--bone-faint);margin:0 0 14px';
    (wrap.firstChild as HTMLElement).textContent = `背包 ${inv.cols}×${inv.rows}`;
    const grid = h('div', 'grid');
    grid.style.gridTemplateColumns = `repeat(${inv.cols}, ${S}px)`;
    for (let i = 0; i < inv.cols * inv.rows; i++) grid.appendChild(h('div', 'cellbg'));
    for (const s of inv.slots) {
      const d = ITEMS[s.item];
      const it = h('div', 'it interactive' + (s === this.selSlot ? ' sel' : ''), `<div class="n">${d.short}</div>${itemIcon(d.icon)}<div class="c">${d.stack > 1 ? s.count : ''}</div>`);
      it.style.left = `${s.x * (S + G)}px`;
      it.style.top = `${s.y * (S + G)}px`;
      it.style.width = `${d.w * S + (d.w - 1) * G}px`;
      it.style.height = `${d.h * S + (d.h - 1) * G}px`;
      it.addEventListener('mouseenter', () => this.hover());
      it.addEventListener('click', () => {
        this.selSlot = s;
        this.select();
        this.renderInventory();
      });
      grid.appendChild(it);
    }
    wrap.appendChild(grid);
    // weapons strip
    const wr = h('div', 'weapons-row');
    for (const id of ctx.weapons.owned) {
      const d = WEAPONS[id];
      const mag = ctx.weapons.mags[id];
      wr.appendChild(h('div', id === ctx.weapons.current ? 'on' : '', `<b>${d.slot || 'V'}</b>${d.name}${d.ammo ? ` · ${mag}` : ''}`));
    }
    wrap.appendChild(wr);
    body.appendChild(wrap);
    const side = h('div', 'inv-side');
    side.appendChild(h('h3', '', '关键物品'));
    const keys = h('div', 'keys');
    if (!inv.keys.length) keys.appendChild(h('div', '', '<span style="color:var(--bone-faint)">（无）</span>'));
    for (const k of inv.keys) {
      const e = h('div', '', k.name);
      e.title = k.desc;
      keys.appendChild(e);
    }
    side.appendChild(keys);
    side.appendChild(h('h3', '', '详情'));
    const desc = h('div', 'inv-desc');
    const s = this.selSlot && inv.slots.includes(this.selSlot) ? this.selSlot : null;
    if (s) {
      const d = ITEMS[s.item];
      desc.innerHTML = `<div class="nm">${d.name}</div><div class="ds">${d.desc}<br><span style="font-family:var(--mono);font-size:11px;color:var(--bone-faint)">数量 ${s.count} / ${d.stack} · 占用 ${d.w}×${d.h}</span></div>`;
      const acts = h('div', 'acts');
      if (s.item === 'bandage' || s.item === 'medkit' || s.item === 'battery') {
        const u = h('span', 'interactive', '使用');
        u.addEventListener('click', () => {
          if (s.item === 'battery') ctx.player.useBattery();
          else ctx.game.useHeal(s.item);
          this.renderInventory();
        });
        acts.appendChild(u);
      }
      const dis = h('span', 'interactive', '丢弃');
      dis.addEventListener('click', () => {
        inv.discard(s);
        this.selSlot = null;
        this.back();
        this.renderInventory();
      });
      acts.appendChild(dis);
      desc.appendChild(acts);
    } else desc.innerHTML = `<div class="ds" style="color:var(--bone-faint)">生命 ${Math.ceil(ctx.player.health)} / 100　·　手电 ${Math.ceil(ctx.player.battery)}%</div>`;
    side.appendChild(desc);
    body.appendChild(side);
  }

  private renderMap(body: HTMLElement) {
    const lvl = ctx.level;
    if (!lvl) return;
    const cv = h('canvas') as HTMLCanvasElement;
    cv.id = 'mapc';
    const maxW = Math.min(window.innerWidth * 0.62, 900), maxH = window.innerHeight * 0.66;
    const cs = Math.max(4, Math.floor(Math.min(maxW / lvl.w, maxH / lvl.h)));
    cv.width = lvl.w * cs + 40;
    cv.height = lvl.h * cs + 40;
    body.appendChild(cv);
    drawMap(cv, cs);
    const side = h('div', 'inv-side');
    const meta = CHAPTERS.find((c) => c.id === ctx.game.chapterId);
    side.innerHTML = `<h3>${meta?.place ?? ''}</h3><div style="font-size:22px;letter-spacing:.25em">${lvl.mapTitle || meta?.place2 || ''}</div>
      <div class="inv-desc" style="margin-top:22px"><div class="ds">${lvl.objective ? '当前目标：' + lvl.objective : '探索周围区域。'}</div>
      <div class="ds" style="font-family:var(--mono);font-size:11px;color:var(--bone-faint);margin-top:16px">▲ 你的位置　● 目标　▒ 已探索</div></div>`;
    body.appendChild(side);
  }

  private renderDocs(body: HTMLElement) {
    const docs = ctx.inventory.docs;
    const list = h('div', 'doclist inv-side');
    list.appendChild(h('h3', '', `已收集 ${docs.length} 份`));
    const view = h('div', 'docview');
    for (const d of docs) {
      const e = h('div', 'interactive', d.title);
      e.addEventListener('click', () => {
        this.select();
        view.innerHTML = `<div style="background:#d9d1bd;color:#2a2620;padding:40px 46px;max-height:62vh;overflow:auto"><h4 style="margin:0 0 18px;font-size:19px;letter-spacing:.25em">${d.title}</h4><pre style="white-space:pre-wrap;font-family:var(--serif);font-size:14px;line-height:2;margin:0">${d.body}</pre></div>`;
      });
      list.appendChild(e);
    }
    if (!docs.length) list.appendChild(h('div', '', '<span style="color:var(--bone-faint)">尚未找到任何文件。</span>'));
    body.append(list, view);
  }

  showDoc(d: Doc) {
    this.docOpen = true;
    this.doc.innerHTML = `<div class="paper interactive"><h4>${d.title}</h4><pre>${d.body}</pre></div><div class="close">E / ESC · 合上</div>`;
    this.show(this.doc, true);
    ctx.game.setOverlayPause(true);
    this.docClose = () => {
      this.docOpen = false;
      this.show(this.doc, false);
      ctx.game.setOverlayPause(false);
    };
  }
  closeDoc() {
    this.docClose?.();
    this.docClose = null;
  }

  // =================================================== KEYPAD
  keypad(label: string, code: string, onOk: () => void) {
    this.keypadOpen = true;
    ctx.game.setOverlayPause(true);
    let entry = '';
    this.keypadEl.innerHTML = `<div class="pad interactive"><div class="lbl">${label}</div><div class="lcd"></div><div class="keys2"></div><div class="btn-line interactive" style="margin-top:18px">ESC · 离开</div></div>`;
    const lcd = this.keypadEl.querySelector('.lcd') as HTMLElement;
    const keys = this.keypadEl.querySelector('.keys2') as HTMLElement;
    const close = () => {
      this.keypadOpen = false;
      this.show(this.keypadEl, false);
      ctx.game.setOverlayPause(false);
      window.removeEventListener('keydown', kd);
    };
    const press = (k: string) => {
      ctx.audio.play('beep', { bus: 'ui' });
      lcd.classList.remove('err');
      if (k === 'C') entry = '';
      else if (k === 'OK') {
        if (entry === code) {
          ctx.audio.play('beepOk', { bus: 'ui' });
          lcd.textContent = 'OPEN';
          setTimeout(() => {
            close();
            onOk();
          }, 450);
          return;
        }
        ctx.audio.play('beepErr', { bus: 'ui' });
        lcd.classList.add('err');
        lcd.textContent = 'ERROR';
        entry = '';
        return;
      } else if (entry.length < code.length) entry += k;
      lcd.textContent = entry.padEnd(code.length, '_');
    };
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
      const b = h('div', '', k);
      b.addEventListener('click', () => press(k));
      keys.appendChild(b);
    }
    const kd = (e: KeyboardEvent) => {
      if (/^Digit\d$/.test(e.code)) press(e.code.slice(5));
      else if (/^Numpad\d$/.test(e.code)) press(e.code.slice(6));
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') press('OK');
      else if (e.code === 'Backspace') press('C');
      else if (e.code === 'Escape') close();
    };
    window.addEventListener('keydown', kd);
    (this.keypadEl.querySelector('.btn-line') as HTMLElement).addEventListener('click', close);
    lcd.textContent = ''.padEnd(code.length, '_');
    this.show(this.keypadEl, true);
  }

  // =================================================== CHOICE
  choice(q: string, opts: string[]): Promise<number> {
    this.choiceOpen = true;
    ctx.game.setOverlayPause(true);
    return new Promise((resolve) => {
      this.choiceEl.innerHTML = `<div class="q">${q}</div><div class="opts"></div>`;
      this.menu(
        this.choiceEl.querySelector('.opts')!,
        opts.map((o, i) => ({
          label: o,
          act: () => {
            this.choiceOpen = false;
            this.show(this.choiceEl, false);
            this.menuNav = null;
            ctx.game.setOverlayPause(false);
            resolve(i);
          },
        })),
      );
      this.show(this.choiceEl, true);
    });
  }

  // =================================================== DEATH / ENDING
  showDeath(on: boolean) {
    if (on) {
      this.death.innerHTML = `<div class="big">你没能看到黎明</div><div class="en">You did not live to see the dawn</div><div class="menu"></div>`;
      this.menu(this.death.querySelector('.menu')!, [
        { label: '从检查点重试', act: () => ctx.game.restartCheckpoint() },
        { label: '返回标题', act: () => ctx.game.quitToTitle() },
      ]);
    } else this.menuNav = null;
    this.show(this.death, on);
  }

  showEnding(o: { id: string; title: string; en: string; text: string; stats: Stats; rank: string; unlock: string[] }) {
    const s = o.stats;
    this.ending.innerHTML = `
      <div>
        <div class="a">ENDING ${o.id === 'dawn' ? 'A' : 'B'} · 05:00</div>
        <div class="b">${o.title}</div>
        <div class="c">${o.en}</div>
        <div class="d">${o.text}</div>
        <div class="stats">
          <div>通关时间<b>${fmtTime(s.time)}</b></div>
          <div>击杀<b>${s.kills}</b></div>
          <div>命中率<b>${s.shots ? Math.round((s.hits / s.shots) * 100) : 0}%</b></div>
          <div>死亡<b>${s.deaths}</b></div>
        </div>
        ${o.unlock.length ? `<div class="unlock">已解锁：${o.unlock.join(' · ')}</div>` : ''}
        <div class="menu"></div>
      </div>
      <div class="rank">${o.rank}<small>RANK</small></div>`;
    this.menu(this.ending.querySelector('.menu')!, [{ label: '返回标题', act: () => ctx.game.quitToTitle() }]);
    this.show(this.ending, true);
  }
  hideEnding() {
    this.show(this.ending, false);
  }

  hideAllOverlays() {
    for (const e of [this.pause, this.inv, this.doc, this.keypadEl, this.death, this.choiceEl, this.card, this.loading]) this.show(e, false);
    this.inventoryOpen = this.docOpen = this.keypadOpen = this.choiceOpen = false;
    this.panelHost.innerHTML = '';
    this.prompt(null);
    this.subtitle(null, '', false);
    this.grabPrompt(false);
    this.letterbox(false);
  }

  // =================================================== DEBUG
  debug(text: string | null, buttons?: [string, () => void][]) {
    if (text === null) {
      this.debugEl.classList.add('hidden');
      return;
    }
    this.debugEl.classList.remove('hidden');
    if (buttons && !this.debugEl.dataset.built) {
      this.debugEl.dataset.built = '1';
      this.debugEl.innerHTML = '<div class="txt"></div><div class="btns"></div>';
      const b = this.debugEl.querySelector('.btns')!;
      for (const [l, fn] of buttons) {
        const e = h('button', '', l);
        e.addEventListener('click', fn);
        b.appendChild(e);
      }
    }
    const t = this.debugEl.querySelector('.txt');
    if (t) t.textContent = text;
  }
}

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function itemIcon(kind: string) {
  const c = 'rgba(233,227,213,0.55)';
  const icons: Record<string, string> = {
    ammo9: `<svg width="34" height="20" viewBox="0 0 34 20"><g fill="${c}"><rect x="2" y="7" width="7" height="11"/><path d="M2 7 Q5.5 1 9 7z"/><rect x="13" y="7" width="7" height="11"/><path d="M13 7 Q16.5 1 20 7z"/><rect x="24" y="7" width="7" height="11"/><path d="M24 7 Q27.5 1 31 7z"/></g></svg>`,
    shells: `<svg width="34" height="24" viewBox="0 0 34 24"><g fill="${c}"><rect x="3" y="2" width="8" height="16"/><rect x="3" y="18" width="8" height="4" fill="#b08a3a"/><rect x="14" y="2" width="8" height="16"/><rect x="14" y="18" width="8" height="4" fill="#b08a3a"/></g></svg>`,
    ammo357: `<svg width="24" height="24" viewBox="0 0 24 24"><g fill="${c}"><circle cx="12" cy="12" r="10" fill="none" stroke="${c}"/><circle cx="12" cy="6" r="2.2"/><circle cx="17" cy="9.5" r="2.2"/><circle cx="17" cy="15" r="2.2"/><circle cx="12" cy="18" r="2.2"/><circle cx="7" cy="15" r="2.2"/><circle cx="7" cy="9.5" r="2.2"/></g></svg>`,
    grenade: `<svg width="20" height="28" viewBox="0 0 20 28"><g fill="${c}"><path d="M3 10 Q10 -2 17 10 V24 H3z"/><rect x="3" y="22" width="14" height="4" fill="#b08a3a"/></g></svg>`,
    bandage: `<svg width="30" height="22" viewBox="0 0 30 22"><g fill="none" stroke="${c}" stroke-width="2"><circle cx="11" cy="11" r="8"/><circle cx="11" cy="11" r="3"/><path d="M11 3 H28"/></g></svg>`,
    medkit: `<svg width="34" height="34" viewBox="0 0 34 34"><rect x="3" y="7" width="28" height="22" fill="none" stroke="${c}" stroke-width="2"/><path d="M17 11 V25 M10 18 H24" stroke="#b3261e" stroke-width="4"/></svg>`,
    battery: `<svg width="30" height="16" viewBox="0 0 30 16"><rect x="1" y="2" width="24" height="12" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="25" y="5" width="3" height="6" fill="${c}"/><rect x="4" y="5" width="12" height="6" fill="${c}"/></svg>`,
  };
  return `<div class="ico">${icons[kind] ?? ''}</div>`;
}

/** Hand-drawn style map of explored cells. */
function drawMap(cv: HTMLCanvasElement, cs: number) {
  const lvl = ctx.level!;
  const c = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  // paper
  c.fillStyle = '#d6cdb6';
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    c.fillStyle = `rgba(${90 + Math.random() * 40},${70 + Math.random() * 30},${40},${Math.random() * 0.06})`;
    c.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(70,50,20,0.35)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const ox = 20, oy = 20;
  const ex = (x: number, z: number) => x >= 0 && z >= 0 && x < lvl.w && z < lvl.h && lvl.explored[z * lvl.w + x] === 1;
  const floor = (x: number, z: number) => x >= 0 && z >= 0 && x < lvl.w && z < lvl.h && lvl.cells[z * lvl.w + x].t === 'floor';
  // hatch explored floor
  c.fillStyle = 'rgba(60,45,25,0.12)';
  for (let z = 0; z < lvl.h; z++)
    for (let x = 0; x < lvl.w; x++) {
      if (!ex(x, z) || !floor(x, z)) continue;
      c.fillRect(ox + x * cs, oy + z * cs, cs, cs);
    }
  // pencil edges
  const jit = () => (Math.random() - 0.5) * cs * 0.18;
  c.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    c.strokeStyle = pass ? 'rgba(40,30,20,0.55)' : 'rgba(40,30,20,0.25)';
    c.lineWidth = pass ? 1.3 : 2.2;
    c.beginPath();
    for (let z = 0; z < lvl.h; z++)
      for (let x = 0; x < lvl.w; x++) {
        if (!ex(x, z) || !floor(x, z)) continue;
        const X = ox + x * cs, Z = oy + z * cs;
        const edge = (nx: number, nz: number, x1: number, y1: number, x2: number, y2: number) => {
          if (!floor(nx, nz)) {
            c.moveTo(x1 + jit(), y1 + jit());
            c.lineTo(x2 + jit(), y2 + jit());
          }
        };
        edge(x, z - 1, X, Z, X + cs, Z);
        edge(x, z + 1, X, Z + cs, X + cs, Z + cs);
        edge(x - 1, z, X, Z, X, Z + cs);
        edge(x + 1, z, X + cs, Z, X + cs, Z + cs);
      }
    c.stroke();
  }
  // doors
  for (const d of lvl.doors) {
    const [x, z] = d.cells[0];
    if (!ex(x, z)) continue;
    c.strokeStyle = d.locked ? 'rgba(160,30,20,0.85)' : 'rgba(40,30,20,0.7)';
    c.lineWidth = 2;
    c.strokeRect(ox + x * cs + cs * 0.25, oy + z * cs + cs * 0.25, cs * 0.5, cs * 0.5);
  }
  // objective marker
  const obj = ctx.game.objectivePos;
  if (obj) {
    c.strokeStyle = 'rgba(160,30,20,0.9)';
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < 2; i++) c.arc(ox + obj.x * cs + jit(), oy + obj.z * cs + jit(), cs * 1.2 + i * 2, 0, Math.PI * 2);
    c.stroke();
  }
  // player
  const p = ctx.player;
  const px = ox + p.pos.x * cs, pz = oy + p.pos.z * cs;
  c.save();
  c.translate(px, pz);
  c.rotate(-p.yaw);
  c.fillStyle = '#9a1a12';
  c.beginPath();
  c.moveTo(0, -cs * 1.1);
  c.lineTo(cs * 0.6, cs * 0.6);
  c.lineTo(-cs * 0.6, cs * 0.6);
  c.closePath();
  c.fill();
  c.restore();
}
