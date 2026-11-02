// src/main/security/secureKeyStore.ts
//
// Provides a per-install symmetric key used to encrypt data-at-rest (currently
// profiles.json, which can contain step payloads with credentials from e.g.
// fillForm tasks). The key itself is never stored in plaintext: it's a random
// 256-bit value, and the *key* is what gets protected by Electron's safeStorage
// API (OS keychain on macOS, DPAPI on Windows, libsecret on Linux) before being
// written to disk. If the OS-level keychain isn't available (some minimal Linux
// setups without a keyring running), encryption is skipped rather than falling
// back to an unprotected static key — a key anyone could read out of the app
// bundle would be security theater, not encryption.
import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import logger from '../logging/logger';

const KEY_FILE_NAME = 'profile-store.key';

function keyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILE_NAME);
}

/**
 * Returns a 32-byte encryption key for use as an AES-256 key, or null if
 * OS-level key protection isn't available on this machine. Generates and
 * persists (safeStorage-encrypted) a new random key on first call.
 */
export function getOrCreateEncryptionKey(): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn(
      'OS-level key storage (safeStorage) is not available on this machine — encryption at rest will be skipped. ' +
        'On Linux this usually means no keyring/libsecret is running.'
    );
    return null;
  }

  const filePath = keyFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const encrypted = fs.readFileSync(filePath);
      const decrypted = safeStorage.decryptString(encrypted);
      return Buffer.from(decrypted, 'base64');
    }
  } catch (error) {
    logger.error('Failed to read/decrypt existing profile store key — generating a new one. Previously encrypted data will be unreadable.', error);
  }

  const key = randomBytes(32);
  try {
    const encrypted = safeStorage.encryptString(key.toString('base64'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, encrypted);
  } catch (error) {
    logger.error('Failed to persist encrypted profile store key — encryption will not survive a restart.', error);
  }
  return key;
}
