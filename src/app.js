import { createMapController } from './map/mapController.js';
import { createViewTabs } from './ui/viewTabs.js';
import { createDatabase } from './db/database.js';
import { createSpotRepository } from './repositories/spotRepository.js';
import { createSpotService } from './services/spotService.js';
import { createSpotApp } from './ui/spotApp.js';
import { getCurrentLocation } from './services/geolocationService.js';
import { createBackupService } from './services/backupService.js';
import { createPwaUi } from './pwa/pwaUi.js';
import { createSharingUi } from './ui/sharingUi.js';

export async function startApplication(access = null) {
  const root = window.document;
  const mapController = createMapController({ container: root.querySelector('#map'), status: root.querySelector('#map-status') });
  const viewTabs = createViewTabs({ root, onMapVisible: mapController.invalidateSize });
  const db = createDatabase();
  const repository = createSpotRepository(db);
  const spotService = createSpotService(repository);
  const backupService = createBackupService(repository);
  const sharing = access ? createSharingUi({ root, api: access.api, member: access.member, spotRepository: repository, mapController, viewTabs }) : null;
  const backup = sharing ? { ...backupService, async restore(...args) { await sharing.canRestore(); return backupService.restore(...args); } } : backupService;
  const spotApp = createSpotApp({ root, service: spotService, backupService: backup, mapController, viewTabs, locate: getCurrentLocation,
    onSpotChanged: sharing ? sharing.sourceChanged : async () => {} });
  const pwaUi = createPwaUi({ root });
  if (!access) root.querySelector('#account-section').hidden = true;
  return { sharing, destroy() { sharing?.destroy(); pwaUi.destroy(); spotApp.destroy(); viewTabs.destroy(); mapController.destroy(); db.close(); } };
}
