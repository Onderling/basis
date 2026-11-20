/**
 * The phone's adapters for "start this device over from your phrase" (ledger L1115). The order is shared
 * (`basis/src/v2/startOver.js`); the phone hands in only how it wipes and how it asks for the confirm.
 */
import { Alert } from 'react-native';
import { wipeKeyValueStorage, START_OVER_PENDING_KEY } from '../../../basis/src/v2/startOver.js';
import { makeSecureStoreRootKeyStore } from './secureStoreRootKeyStore.js';

/** This phone's wipe: every AsyncStorage key but the mark, and the key door's seed. */
export async function wipePhone({ AsyncStorage, SecureStore }) {
  await wipeKeyValueStorage(AsyncStorage, `cc-owner-root:${START_OVER_PENDING_KEY}`);
  try { await makeSecureStoreRootKeyStore(SecureStore).deleteSeed(); } catch { /* nothing held there */ }
}

/** The confirm in words (what comes back, what is lost): resolves true only for "Start over". */
export function confirmStartOver(t) {
  return new Promise((resolve) => {
    Alert.alert(t('circle.start_over.confirm_title'), t('circle.start_over.confirm_body'), [
      { text: t('circle.start_over.confirm_no'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('circle.start_over.confirm_yes'), style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
