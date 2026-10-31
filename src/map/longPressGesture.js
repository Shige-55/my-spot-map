// DOMやLeafletに依存しない長押し判定。1ジェスチャーにつき最大1回だけ通知する。
export function createLongPressGesture({ onLongPress, delay = 600, threshold = 10 }) {
  const pointers = new Map();
  let candidate = null;
  let timer;
  let suppressUntil = 0;
  const cancel = () => {
    globalThis.clearTimeout(timer);
    candidate = null;
  };
  const finish = (event) => {
    if (pointers.get(event.pointerId) !== 'mouse' && pointers.has(event.pointerId)) {
      suppressUntil = Date.now() + 1000;
    }
    pointers.delete(event.pointerId);
    cancel();
  };
  return {
    down(event, eligible) {
      const wasEmpty = pointers.size === 0;
      pointers.set(event.pointerId, event.pointerType);
      cancel();
      if (event.pointerType !== 'mouse') suppressUntil = Date.now() + 1000;
      if (!wasEmpty || !eligible || event.isPrimary === false || event.button !== 0) return;
      candidate = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
      timer = globalThis.setTimeout(() => {
        if (!candidate || pointers.size !== 1) return;
        const point = candidate;
        candidate = null;
        suppressUntil = Date.now() + 1000;
        onLongPress(point);
      }, delay);
    },
    move(event) {
      if (candidate?.pointerId === event.pointerId
        && Math.hypot(event.clientX - candidate.clientX, event.clientY - candidate.clientY) > threshold) cancel();
    },
    up: finish,
    cancelPointer: finish,
    cancel,
    reset() { cancel(); pointers.clear(); },
    suppressContextMenu() {
      return Date.now() < suppressUntil || [...pointers.values()].some((type) => type !== 'mouse');
    },
  };
}
