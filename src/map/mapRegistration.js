import { createLongPressGesture } from './longPressGesture.js';

export function bindMapRegistration({ container, map, onRegister }) {
  const root = container.ownerDocument;
  const events = new globalThis.AbortController();
  const options = { signal: events.signal, capture: true };
  const eligible = (target) => container.contains(target)
    && !target.closest('.leaflet-control, .leaflet-marker-icon, .leaflet-interactive');
  const register = (point) => {
    if (!container.getClientRects().length || root.querySelector('dialog[open]')) return;
    const coordinate = map.mouseEventToLatLng(point).wrap();
    onRegister({ latitude: coordinate.lat, longitude: coordinate.lng, zoom: map.getZoom() });
  };
  const gesture = createLongPressGesture({ onLongPress: register });
  root.addEventListener('pointerdown', (event) => gesture.down(event, eligible(event.target)), options);
  root.addEventListener('pointermove', gesture.move, options);
  root.addEventListener('pointerup', gesture.up, options);
  root.addEventListener('pointercancel', gesture.cancelPointer, options);
  container.addEventListener('pointerleave', gesture.cancel, options);
  container.addEventListener('lostpointercapture', gesture.cancel, options);
  root.addEventListener('visibilitychange', gesture.reset, options);
  root.defaultView.addEventListener('blur', gesture.reset, options);
  root.defaultView.addEventListener('pagehide', gesture.reset, options);
  container.addEventListener('contextmenu', (event) => {
    if (!eligible(event.target)) return;
    event.preventDefault();
    // iPhoneのネイティブメニューやLeaflet互換イベントから二重登録しない。
    if (event.pointerType === 'touch' || event.pointerType === 'pen' || gesture.suppressContextMenu()) return;
    gesture.cancel();
    register(event);
  }, options);
  const cancel = () => gesture.cancel();
  map.on('dragstart zoomstart movestart', cancel);
  return {
    destroy() {
      gesture.reset();
      events.abort();
      map.off('dragstart zoomstart movestart', cancel);
    },
  };
}
