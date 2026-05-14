import { screen } from 'electron';

let interval: NodeJS.Timeout | null = null;
let tickImpl: (() => void) | null = null;

function loadWindowsTick(): (() => void) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    const fn = lib.func(
      'void __stdcall mouse_event(uint32 dwFlags, int32 dx, int32 dy, uint32 dwData, uintptr_t dwExtraInfo)'
    );
    return () => fn(0x0001, 0, 0, 0, 0);
  } catch {
    return null;
  }
}

function loadDarwinTick(): (() => void) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
    koffi.struct('CGPoint', { x: 'double', y: 'double' });
    const create = cg.func(
      'void* CGEventCreateMouseEvent(void* source, uint32 mouseType, CGPoint position, uint32 mouseButton)'
    );
    const post = cg.func('void CGEventPost(uint32 tap, void* event)');
    const release = cf.func('void CFRelease(void* cf)');
    return () => {
      const { x, y } = screen.getCursorScreenPoint();
      const e1 = create(null, 5, { x: x + 1, y }, 0);
      post(0, e1);
      release(e1);
      const e2 = create(null, 5, { x, y }, 0);
      post(0, e2);
      release(e2);
    };
  } catch {
    return null;
  }
}

function tick(): void {
  if (!tickImpl) return;
  try {
    tickImpl();
  } catch {
    // swallow
  }
}

export function startDisplayKeepalive(): void {
  if (interval) return;
  if (!tickImpl) {
    if (process.platform === 'win32') tickImpl = loadWindowsTick();
    else if (process.platform === 'darwin') tickImpl = loadDarwinTick();
  }
  if (!tickImpl) return;
  tick();
  interval = setInterval(tick, 60_000);
}

export function stopDisplayKeepalive(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
