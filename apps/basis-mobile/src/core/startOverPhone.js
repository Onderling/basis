/**
 * The phone's adapters for "start this device over from your phrase" (ledger L1115). The order is shared
 * (`basis/src/v2/startOver.js`); the phone hands in only how it clears and how it asks for the confirms.
 */
import { Alert } from 'react-native';
import { wipeKeyValueStorage, START_OVER_PENDING_KEY } from '../../../basis/src/v2/startOver.js';
import { storageName } from '../../../basis/src/v2/storageRegister.js';   // every storage name from the one register
import { makeSecureStoreRootKeyStore } from './secureStoreRootKeyStore.js';

/**
 * This phone's clear: every AsyncStorage key but the mark (the app's own storage), the key door's seed, and the files
 * the app keeps (`<documentDirectory>/attachments/`, the attachment blobs). Files the person saved OUT of the app are
 * not the app's to remove.
 */
export async function wipePhone({ AsyncStorage, SecureStore, FileSystem = null }) {
  await wipeKeyValueStorage(AsyncStorage, `${storageName('vaultOwnerRoot')}${START_OVER_PENDING_KEY}`);
  try { await makeSecureStoreRootKeyStore(SecureStore).deleteSeed(); } catch { /* nothing held there */ }
  if (FileSystem?.documentDirectory) {
    // a failed delete of the folder is a failure of the clear: the shared order keeps the mark and says so
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}attachments`, { idempotent: true });
  }
}

/**
 * The confirm in words (what comes back, what is lost; and, when this device could not name its own root, that it
 * cannot check the phrase is its own): resolves true only for "Start over".
 * @param {Function} t
 * @param {{known?: boolean}} [o]
 */
export function confirmStartOver(t, { known = true } = {}) {
  const body = known ? t('circle.start_over.confirm_body') : `${t('circle.start_over.confirm_body')}\n\n${t('circle.start_over.confirm_unknown')}`;
  return new Promise((resolve) => {
    Alert.alert(t('circle.start_over.confirm_title'), body, [
      { text: t('circle.start_over.confirm_no'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('circle.start_over.confirm_yes'), style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** Cancel on a start-over cut short AFTER the clear: this device starts as a new identity. True only for that. */
export function confirmCancelCleared(t) {
  return new Promise((resolve) => {
    Alert.alert(t('circle.start_over.cancel_cleared_title'), t('circle.start_over.cancel_cleared_body'), [
      { text: t('circle.start_over.cancel_cleared_no'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('circle.start_over.cancel_cleared_yes'), style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
