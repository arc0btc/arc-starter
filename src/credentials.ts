/**
 * Re-export helper for the credentials skill.
 * Other skills import from here instead of the skill path directly:
 *
 *   import { getCredential, credentials } from "../../src/credentials.ts";
 *   const apiKey = await getCredential("openrouter", "api_key");
 *
 * ARC_CREDS_PASSWORD must be set in .env (Bun auto-loads it).
 */

import { credentials } from "../skills/credentials/store.ts";

export { credentials };

export const {
  unlock,
  lock,
  isUnlocked,
  get,
  getService,
  set,
  del,
  list,
  storePath,
} = credentials;

/**
 * Convenience function: unlock the store and retrieve a single credential value.
 * Returns null if the credential does not exist.
 * Reads ARC_CREDS_PASSWORD from the environment automatically.
 */
export async function getCredential(service: string, key: string): Promise<string | null> {
  await credentials.unlock();
  return credentials.get(service, key);
}

/**
 * Convenience function: unlock the store and set a single credential value.
 * Creates or updates the credential, then persists to disk.
 * Reads ARC_CREDS_PASSWORD from the environment automatically.
 */
export async function setCredential(service: string, key: string, value: string): Promise<void> {
  await credentials.unlock();
  await credentials.set(service, key, value);
}
