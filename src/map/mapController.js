import L from 'leaflet';
import { mapConfig } from '../config.js';
import { bindMapRegistration } from './mapRegistration.js';

export function createMapController({ container, status }) {
  const map = L.map(container, {
    zoomControl: false, worldCopyJump: true, trackResize: false, tapHold: false,
  }).setView(mapConfig.center, mapConfig.zoom);
  L.control.zoom({ zoomInTitle: '拡大', zoomOutTitle: '縮小' }).addTo(map);
  container.querySelector('.leaflet-control-zoom-in').setAttribute('aria-label', '拡大');
  container.querySelector('.leaflet-control-zoom-out').setAttribute('aria-label', '縮小');

  let hasTileError = false;
  const tiles = L.tileLayer(mapConfig.tileUrl, {
    attribution: mapConfig.attribution,
    maxZoom: mapConfig.maxZoom,
  });

  tiles.on('loading', () => {
    hasTileError = false;
  });
  tiles.on('tileerror', () => {
    hasTileError = true;
    status.textContent = '背景地図を読み込めません。通信状態を確認してください。一覧は引き続き表示できます。';
    status.hidden = !window.navigator.onLine;
  });
  tiles.on('load', () => {
    if (!hasTileError) status.hidden = true;
  });
  tiles.addTo(map);
  const offline = () => { status.hidden = true; };
  const online = () => { if (hasTileError) status.hidden = false; };
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);

  let frame;
  const invalidateSize = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      if (container.clientWidth && container.clientHeight) {
        map.invalidateSize({ pan: true, animate: false });
      }
    });
  };
  const observer = new window.ResizeObserver(invalidateSize);
  observer.observe(container);

  const markers = new Map();
  const locationLayers = L.layerGroup().addTo(map);
  const sharedSpotLayers = L.layerGroup().addTo(map);
  const sharedLocationLayers = L.layerGroup().addTo(map);
  let onRegister = () => {};
  const registration = bindMapRegistration({ container, map, onRegister: (view) => onRegister(view) });
  let onSpotSelect = () => {};
  let focusFrame;
  let zooming = false;
  let pendingSpot = null;
  const scheduleFocus = () => {
    window.cancelAnimationFrame(focusFrame);
    focusFrame = window.requestAnimationFrame(() => {
      if (zooming || !pendingSpot) return;
      const spot = pendingSpot;
      pendingSpot = null;
      map.invalidateSize({ pan: true, animate: false });
      map.setView([spot.latitude, spot.longitude], spot.zoom, { animate: false });
    });
  };
  // Leafletはズームアニメーション中のsetViewを無視するため、終了後に適用する。
  map.on('zoomstart', () => { zooming = true; });
  map.on('zoomend', () => {
    zooming = false;
    if (pendingSpot) scheduleFocus();
  });
  const icon = L.divIcon({
    className: 'spot-marker',
    html: '<span class="spot-pin"></span>',
    iconSize: [44, 44], iconAnchor: [22, 38],
  });

  return {
    setSharedSpots(spots) {
      sharedSpotLayers.clearLayers();
      for (const item of spots) {
        const marker = L.circleMarker([item.spot.latitude, item.spot.longitude], { radius: 9, color: '#7e2e84', fillOpacity: 0.7 });
        const label = window.document.createElement('span'); label.textContent = `${item.spot.name}（${item.ownerName}から共有）`;
        marker.bindTooltip(label); marker.addTo(sharedSpotLayers);
      }
    },
    setSharedLocations(positions) {
      sharedLocationLayers.clearLayers();
      for (const item of positions) {
        const marker = L.circleMarker([item.latitude, item.longitude], { radius: 9, color: '#7e2e84', fillOpacity: 0.9, className: 'shared-location-marker' });
        const label = window.document.createElement('span'); label.textContent = `${item.name}／${new Date(item.capturedAt).toLocaleTimeString('ja-JP')}／精度 約${Math.round(item.accuracy)}m`;
        marker.bindTooltip(label); marker.addTo(sharedLocationLayers);
        L.circle([item.latitude, item.longitude], { radius: Math.min(item.accuracy, 1000000), color: '#7e2e84', weight: 1, fillOpacity: 0.05 }).addTo(sharedLocationLayers);
      }
    },
    invalidateSize,
    getView() {
      const center = map.getCenter().wrap();
      return { latitude: center.lat, longitude: center.lng, zoom: map.getZoom() };
    },
    onSpotSelect(handler) { onSpotSelect = handler; },
    onRegister(handler) { onRegister = handler; },
    setSpots(spots, selectedId) {
      const ids = new Set(spots.map((spot) => spot.id));
      if (pendingSpot?.id && !ids.has(pendingSpot.id)) pendingSpot = null;
      for (const [id, marker] of markers) {
        if (!ids.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
      for (const spot of spots) {
        let marker = markers.get(spot.id);
        if (!marker) {
          marker = L.marker([spot.latitude, spot.longitude], { icon, keyboard: true });
          marker.on('click', () => onSpotSelect(spot.id));
          marker.addTo(map);
          markers.set(spot.id, marker);
        } else marker.setLatLng([spot.latitude, spot.longitude]);
        const element = marker.getElement();
        element.setAttribute('aria-label', `${spot.name}を選択`);
        element.setAttribute('title', spot.name);
        element.setAttribute('aria-pressed', String(spot.id === selectedId));
        element.classList.toggle('is-selected', spot.id === selectedId);
        marker.setZIndexOffset(spot.id === selectedId ? 1000 : 0);
      }
    },
    focusSpot(spot) {
      pendingSpot = spot;
      scheduleFocus();
    },
    showLocation(position) {
      locationLayers.clearLayers();
      const coordinate = [position.latitude, position.longitude];
      L.circle(coordinate, {
        radius: position.accuracy, color: '#2269b3', fillOpacity: 0.1,
        weight: 1, interactive: false, className: 'location-accuracy',
      }).addTo(locationLayers);
      const marker = L.circleMarker(coordinate, {
        radius: 8, color: '#fff', weight: 3, fillColor: '#2269b3', fillOpacity: 1,
        interactive: false, className: 'current-location-marker',
      }).addTo(locationLayers);
      marker.getElement()?.setAttribute('aria-label', '現在地');
      pendingSpot = { ...position, zoom: Math.max(map.getZoom(), 15) };
      scheduleFocus();
    },
    destroy() {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      registration.destroy();
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(focusFrame);
      map.remove();
    },
  };
}
