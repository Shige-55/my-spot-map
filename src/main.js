import 'leaflet/dist/leaflet.css';
import './styles.css';
import { createAccessGate } from './access/accessGate.js';

let application;
const start = async (access) => (await import('./app.js')).startApplication(access);
if (import.meta.env.APP_TEST_PUBLIC === true) {
  // Viteが検証専用出力先にだけ許すモード。本番ビルドには残らない。
  application = await start();
  window.document.querySelector('#access-gate').hidden = true;
  window.document.querySelector('#private-app').hidden = false;
} else {
  application = createAccessGate({ root: window.document, publicJwk: import.meta.env.VITE_OFFLINE_PUBLIC_JWK, start });
}
if (import.meta.hot) import.meta.hot.dispose(() => application?.destroy());
