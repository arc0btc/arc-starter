import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Import the store. Since getStoreDir() reads process.env.ARC_CREDS_DIR lazily
// on each call, we can redirect the store to a temp dir by setting the env var
// before calling any store functions.
import {
  unlock,
  lock,
  isUnlocked,
  get,
  getService,
  set,
  del,
  list,
  storePath,
} from "../skills/credentials/store.ts";

// Save original env value so we can restore it between tests.
const ORIGINAL_CREDS_DIR = process.env.ARC_CREDS_DIR;
const ORIGINAL_CREDS_PASSWORD = process.env.ARC_CREDS_PASSWORD;

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "arc-creds-test-"));
}

function cleanTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// After every test: lock the store and restore env vars.
afterEach(() => {
  lock();
  if (ORIGINAL_CREDS_DIR === undefined) {
    delete process.env.ARC_CREDS_DIR;
  } else {
    process.env.ARC_CREDS_DIR = ORIGINAL_CREDS_DIR;
  }
  if (ORIGINAL_CREDS_PASSWORD === undefined) {
    delete process.env.ARC_CREDS_PASSWORD;
  } else {
    process.env.ARC_CREDS_PASSWORD = ORIGINAL_CREDS_PASSWORD;
  }
});

describe("encrypt/decrypt round-trip", () => {
  test("data survives unlock → set → lock → unlock cycle", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;

      // First unlock: creates a new empty store.
      await unlock("roundtrip-password");
      expect(isUnlocked()).toBe(true);

      // Write a credential.
      await set("myservice", "apikey", "secret123");
      expect(get("myservice", "apikey")).toBe("secret123");

      // Lock and re-unlock from disk.
      lock();
      expect(isUnlocked()).toBe(false);
      await unlock("roundtrip-password");
      expect(isUnlocked()).toBe(true);

      // Data must still be present after re-load from disk.
      expect(get("myservice", "apikey")).toBe("secret123");
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("storePath returns path inside ARC_CREDS_DIR", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      expect(storePath()).toBe(join(tempDir, "credentials.enc"));
    } finally {
      cleanTempDir(tempDir);
    }
  });
});

describe("CRUD operations", () => {
  test("set and get a credential", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("crud-password");

      await set("svc", "key1", "value1");
      expect(get("svc", "key1")).toBe("value1");
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("updating an existing key replaces value", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("crud-password");

      await set("svc", "key1", "old-value");
      await set("svc", "key1", "new-value");
      expect(get("svc", "key1")).toBe("new-value");
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("list returns all stored keys without values", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("crud-password");

      await set("alpha", "x", "1");
      await set("beta", "y", "2");
      await set("gamma", "z", "3");

      const entries = list();
      expect(entries.length).toBe(3);

      const services = entries.map((e) => e.service);
      expect(services).toContain("alpha");
      expect(services).toContain("beta");
      expect(services).toContain("gamma");

      // list() must not expose values
      const keys = Object.keys(entries[0]);
      expect(keys).toContain("service");
      expect(keys).toContain("key");
      expect(keys).toContain("updatedAt");
      expect(keys).not.toContain("value");
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("del removes a credential and returns true", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("crud-password");

      await set("svc", "key1", "val");
      const removed = await del("svc", "key1");
      expect(removed).toBe(true);
      expect(get("svc", "key1")).toBeNull();
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("del on nonexistent key returns false", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("crud-password");

      const removed = await del("nosuchsvc", "nosuchkey");
      expect(removed).toBe(false);
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("get on nonexistent key returns null", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("crud-password");

      expect(get("nosvc", "nokey")).toBeNull();
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("getService returns all keys for a service", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("crud-password");

      await set("openrouter", "api_key", "or-key");
      await set("openrouter", "org_id", "or-org");
      await set("other", "token", "t");

      const entries = getService("openrouter");
      expect(entries.length).toBe(2);

      const keys = entries.map((e) => e.key);
      expect(keys).toContain("api_key");
      expect(keys).toContain("org_id");

      // Entries for a different service are not included.
      const otherEntries = getService("other");
      expect(otherEntries.length).toBe(1);
      expect(otherEntries[0].key).toBe("token");
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });
});

describe("error cases", () => {
  test("unlock throws if no password and no env var", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      delete process.env.ARC_CREDS_PASSWORD;

      await expect(unlock()).rejects.toThrow("Password required");
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("unlock with wrong password throws on existing store", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;

      // Create store with correct password.
      await unlock("correct-password");
      await set("svc", "k", "v");
      lock();

      // Try to open with wrong password — must throw.
      await expect(unlock("wrong-password")).rejects.toThrow();
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("get on locked store throws 'Store not unlocked'", () => {
    // Ensure locked state.
    lock();
    expect(() => get("svc", "key")).toThrow("Store not unlocked");
  });

  test("set on locked store throws 'Store not unlocked'", async () => {
    lock();
    await expect(set("svc", "key", "val")).rejects.toThrow("Store not unlocked");
  });

  test("del on locked store throws 'Store not unlocked'", async () => {
    lock();
    await expect(del("svc", "key")).rejects.toThrow("Store not unlocked");
  });

  test("list on locked store throws 'Store not unlocked'", () => {
    lock();
    expect(() => list()).toThrow("Store not unlocked");
  });

  test("getService on locked store throws 'Store not unlocked'", () => {
    lock();
    expect(() => getService("svc")).toThrow("Store not unlocked");
  });
});

describe("persistence across lock/unlock cycles", () => {
  test("multiple credentials persist after re-unlock", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("persist-password");

      await set("github", "token", "ghp_abc");
      await set("openai", "api_key", "sk-xyz");
      await set("github", "username", "whoabuddy");

      lock();
      await unlock("persist-password");

      expect(get("github", "token")).toBe("ghp_abc");
      expect(get("openai", "api_key")).toBe("sk-xyz");
      expect(get("github", "username")).toBe("whoabuddy");

      const all = list();
      expect(all.length).toBe(3);
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });

  test("delete persists after re-unlock", async () => {
    const tempDir = makeTempDir();
    try {
      process.env.ARC_CREDS_DIR = tempDir;
      await unlock("persist-password");

      await set("svc", "key1", "val1");
      await set("svc", "key2", "val2");
      await del("svc", "key1");

      lock();
      await unlock("persist-password");

      expect(get("svc", "key1")).toBeNull();
      expect(get("svc", "key2")).toBe("val2");
    } finally {
      lock();
      cleanTempDir(tempDir);
    }
  });
});
