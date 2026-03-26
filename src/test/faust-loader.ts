/// <reference types="node" />

/**
 * Faust WASM loader — shared by all offline DSP test files.
 *
 * faustwasm's `instantiateFaustModuleFromFile` writes a temp `.mjs` file,
 * dynamically imports it, then unlinks it. When multiple Vitest workers run
 * simultaneously (one per test file), they race on the same `.mjs` path,
 * causing ENOENT / "FaustModule is not a function" errors.
 *
 * This wrapper serializes calls across all workers with a cross-process
 * file lock (atomic O_EXCL open), so only one worker runs the
 * write → import → unlink sequence at a time.
 */

import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const LOCK_PATH = join(tmpdir(), "arcturus-faust-loader.lock");
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_RETRY_MS = 50;

// Clean up stale lock on process exit (handles Ctrl+C and test runner exits)
import { unlinkSync } from "fs";
process.on("exit", () => { try { unlinkSync(LOCK_PATH); } catch { /* ignore */ } });
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

/** Max age of a lock file before it's considered stale (crashed process). */
const STALE_LOCK_AGE_MS = 120_000;

async function acquireLock(): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(LOCK_PATH, "wx"); // fails if file exists
      await handle.close();
      return;
    } catch {
      // Check if the existing lock is stale (from a crashed process)
      try {
        const stat = await fs.stat(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_AGE_MS) {
          await fs.unlink(LOCK_PATH).catch(() => { /* race-safe */ });
          continue; // retry immediately
        }
      } catch { /* lock was released between stat attempts */ }
      await new Promise(r => setTimeout(r, LOCK_RETRY_MS + Math.random() * LOCK_RETRY_MS));
    }
  }
  throw new Error(`Timeout (${LOCK_TIMEOUT_MS}ms) waiting for Faust loader lock`);
}

async function releaseLock(): Promise<void> {
  await fs.unlink(LOCK_PATH).catch(() => { /* already released */ });
}

/**
 * Load libfaust-wasm and instantiate the Faust module.
 * Serializes calls across concurrent Vitest workers via a file lock.
 */
export async function loadFaustModule(jsFile: string): Promise<unknown> {
  const faustwasm = await import("@grame/faustwasm/dist/esm/index.js");
  await acquireLock();
  try {
    return await faustwasm.instantiateFaustModuleFromFile(jsFile);
  } finally {
    await releaseLock();
  }
}
