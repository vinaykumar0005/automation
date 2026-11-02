// src/main/automation/profileStore.ts
//
// Persists ProfileRecord[] to disk. Two backends:
//  - Plaintext (default, security.enableEncryption = false): the existing
//    profiles.json in process.cwd(), unchanged behavior.
//  - Encrypted (security.enableEncryption = true, and OS key protection is
//    available): electron-store with an encryptionKey derived from
//    secureKeyStore. Profile step payloads can carry credentials (e.g. a
//    fillForm task's username/password), so this is the data that actually
//    benefits from encryption at rest.
//
// If encryption is requested but the OS keychain isn't available, we fall
// back to the plaintext backend rather than failing to start — and log
// loudly so it isn't a silent downgrade.
import * as fs from 'fs';
import * as path from 'path';
import type { ProfileRecord } from '../../shared/types';
import logger from '../logging/logger';
import { getOrCreateEncryptionKey } from '../security/secureKeyStore';

export interface ProfileStore {
  load(): Promise<ProfileRecord[]>;
  save(profiles: ProfileRecord[]): Promise<void>;
}

class PlaintextProfileStore implements ProfileStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ProfileRecord[]> {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const content = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      logger.error('Failed to load profiles.json', error);
      return [];
    }
  }

  async save(profiles: ProfileRecord[]): Promise<void> {
    await fs.promises.writeFile(this.filePath, JSON.stringify(profiles, null, 2), 'utf8');
  }
}

class EncryptedProfileStore implements ProfileStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private storePromise: Promise<any> | null = null;

  constructor(private readonly encryptionKey: Buffer) {}

  // electron-store is ESM-only; dynamic import is the supported way to
  // consume it from this CommonJS-bundled main process.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getStore(): Promise<any> {
    if (!this.storePromise) {
      this.storePromise = (async () => {
        const { default: Store } = await import('electron-store');
        return new Store({
          name: 'profiles',
          encryptionKey: this.encryptionKey,
        });
      })();
    }
    return this.storePromise;
  }

  async load(): Promise<ProfileRecord[]> {
    const store = await this.getStore();
    return store.get('profiles', []) as ProfileRecord[];
  }

  async save(profiles: ProfileRecord[]): Promise<void> {
    const store = await this.getStore();
    store.set('profiles', profiles);
  }
}

/**
 * Builds the right ProfileStore for the current config, and migrates an
 * existing plaintext profiles.json into the encrypted store the first time
 * encryption is turned on (so switching the setting doesn't look like data
 * loss). The old plaintext file is renamed, not deleted, in case migration
 * needs to be redone.
 */
export async function createProfileStore(options: {
  enableEncryption: boolean;
  plaintextFilePath: string;
}): Promise<ProfileStore> {
  const plaintextStore = new PlaintextProfileStore(options.plaintextFilePath);

  if (!options.enableEncryption) {
    return plaintextStore;
  }

  const key = getOrCreateEncryptionKey();
  if (!key) {
    logger.warn('security.enableEncryption is on but OS key protection is unavailable — falling back to plaintext profile storage.');
    return plaintextStore;
  }

  const encryptedStore = new EncryptedProfileStore(key);

  try {
    const alreadyEncrypted = await encryptedStore.load();
    if (alreadyEncrypted.length === 0 && fs.existsSync(options.plaintextFilePath)) {
      const legacyProfiles = await plaintextStore.load();
      if (legacyProfiles.length > 0) {
        await encryptedStore.save(legacyProfiles);
        const migratedPath = `${options.plaintextFilePath}.migrated`;
        await fs.promises.rename(options.plaintextFilePath, migratedPath);
        logger.info(
          `Migrated ${legacyProfiles.length} profile(s) from plaintext ${path.basename(options.plaintextFilePath)} ` +
            `into encrypted storage. The old file was renamed to ${path.basename(migratedPath)}.`
        );
      }
    }
  } catch (error) {
    logger.error('Profile encryption migration failed — falling back to plaintext profile storage for this session.', error);
    return plaintextStore;
  }

  return encryptedStore;
}
