/**
 * Credential store for Arc.
 * Ported from ~/arc0btc/skills/credentials/store.ts.
 *
 * Storage: ~/.aibtc/credentials.enc
 * Encryption: AES-256-GCM + scrypt KDF
 * Password: ARC_CREDS_PASSWORD env var (Bun auto-loads .env)
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

function getStoreDir(): string {
  return process.env.ARC_CREDS_DIR ?? path.join(homedir(), ".aibtc");
}

function getStoreFile(): string {
  return path.join(getStoreDir(), "credentials.enc");
}

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;
const VERSION = 1;

interface Credential {
  service: string;
  key: string;
  value: string;
  updatedAt: string;
}

interface CredentialStore {
  version: number;
  credentials: Credential[];
  createdAt: string;
  updatedAt: string;
}

interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
  scryptParams: typeof SCRYPT_PARAMS;
  version: number;
}

interface EncryptedFile {
  version: number;
  encrypted: EncryptedData;
}

let _store: CredentialStore | null = null;
let _password: string | null = null;

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_PARAMS.keyLen,
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });
}

async function encrypt(data: string, password: string): Promise<EncryptedData> {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    salt: salt.toString("base64"),
    scryptParams: SCRYPT_PARAMS,
    version: VERSION,
  };
}

async function decrypt(encrypted: EncryptedData, password: string): Promise<string> {
  const key = await deriveKey(password, Buffer.from(encrypted.salt, "base64"));
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function emptyStore(): CredentialStore {
  const now = new Date().toISOString();
  return { version: VERSION, credentials: [], createdAt: now, updatedAt: now };
}

async function save(): Promise<void> {
  if (!_store || !_password) throw new Error("Store not unlocked");
  await fs.mkdir(getStoreDir(), { recursive: true });
  const file: EncryptedFile = {
    version: VERSION,
    encrypted: await encrypt(JSON.stringify(_store), _password),
  };
  await fs.writeFile(getStoreFile(), JSON.stringify(file, null, 2));
}

async function load(password: string): Promise<CredentialStore> {
  const raw = await fs.readFile(getStoreFile(), "utf-8");
  const file: EncryptedFile = JSON.parse(raw) as EncryptedFile;
  return JSON.parse(await decrypt(file.encrypted, password)) as CredentialStore;
}

export async function unlock(password?: string): Promise<void> {
  if (_store) return;
  const pw = password ?? process.env.ARC_CREDS_PASSWORD;
  if (!pw) throw new Error("Password required: pass arg or set ARC_CREDS_PASSWORD");

  // Check whether the store file exists. Only create a new store if missing.
  let fileExists = false;
  try {
    await fs.access(getStoreFile());
    fileExists = true;
  } catch {
    // File does not exist — will create a new store below.
  }

  if (fileExists) {
    // File exists: decrypt it. Any error here (wrong password, corrupt file) propagates.
    _store = await load(pw);
    _password = pw;
  } else {
    // New store: encrypt and persist an empty credential set.
    _store = emptyStore();
    _password = pw;
    await save();
    process.stderr.write("[credentials] New store created\n");
  }
}

export function lock(): void {
  _store = null;
  _password = null;
}

export function isUnlocked(): boolean {
  return _store !== null;
}

export function get(service: string, key: string): string | null {
  if (!_store) throw new Error("Store not unlocked");
  return _store.credentials.find((c) => c.service === service && c.key === key)?.value ?? null;
}

export function getService(service: string): Array<{ key: string; value: string }> {
  if (!_store) throw new Error("Store not unlocked");
  return _store.credentials
    .filter((c) => c.service === service)
    .map((c) => ({ key: c.key, value: c.value }));
}

export async function set(service: string, key: string, value: string): Promise<void> {
  if (!_store) throw new Error("Store not unlocked");
  const now = new Date().toISOString();
  const idx = _store.credentials.findIndex((c) => c.service === service && c.key === key);
  if (idx >= 0) {
    _store.credentials[idx] = { ..._store.credentials[idx], value, updatedAt: now };
  } else {
    _store.credentials.push({ service, key, value, updatedAt: now });
  }
  _store.updatedAt = now;
  await save();
}

export async function del(service: string, key: string): Promise<boolean> {
  if (!_store) throw new Error("Store not unlocked");
  const idx = _store.credentials.findIndex((c) => c.service === service && c.key === key);
  if (idx < 0) return false;
  _store.credentials.splice(idx, 1);
  _store.updatedAt = new Date().toISOString();
  await save();
  return true;
}

export function list(): Array<{ service: string; key: string; updatedAt: string }> {
  if (!_store) throw new Error("Store not unlocked");
  return _store.credentials.map((c) => ({
    service: c.service,
    key: c.key,
    updatedAt: c.updatedAt,
  }));
}

export function storePath(): string {
  return getStoreFile();
}

export const credentials = {
  unlock,
  lock,
  isUnlocked,
  get,
  getService,
  set,
  del,
  list,
  storePath,
};

export default credentials;
