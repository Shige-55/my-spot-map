import 'leaflet/dist/leaflet.css';
import './styles.css';
import { createMapController } from './map/mapController.js';
import { createViewTabs } from './ui/viewTabs.js';
import { createDatabase } from './db/database.js';
import { createSpotRepository } from './repositories/spotRepository.js';
import { createSpotService } from './services/spotService.js';
import { createSpotApp } from './ui/spotApp.js';
import { getCurrentLocation } from './services/geolocationService.js';
import { createBackupService } from './services/backupService.js';
import { createPwaUi } from './pwa/pwaUi.js';

const mapController = createMapController({
  container: window.document.querySelector('#map'),
  status: window.document.querySelector('#map-status'),
});

const viewTabs = createViewTabs({
  root: window.document,
  onMapVisible: mapController.invalidateSize,
});

const db = createDatabase();
const repository = createSpotRepository(db);
const spotApp = createSpotApp({
  root: window.document,
  service: createSpotService(repository),
  backupService: createBackupService(repository),
  mapController,
  viewTabs,
  locate: getCurrentLocation,
});
const pwaUi = createPwaUi({ root: window.document });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    pwaUi.destroy();
    spotApp.destroy();
    viewTabs.destroy();
    mapController.destroy();
    db.close();
  });
}
