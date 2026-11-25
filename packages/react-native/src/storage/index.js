/**
 * @onderling/react-native/storage — RN storage adapters + helpers.
 *
 *   - `AsyncStorageAdapter`  — `core.DataSource` over AsyncStorage.
 *   - `FileSystemAdapter`    — `core.DataSource` over `expo-file-system`.
 *   - `firstLaunchFlag`      — boolean gate keyed in AsyncStorage.
 */

export { AsyncStorageAdapter } from './AsyncStorageAdapter.js';
export { FileSystemAdapter }   from './FileSystemAdapter.js';
export { firstLaunchFlag }     from './firstLaunchFlag.js';
