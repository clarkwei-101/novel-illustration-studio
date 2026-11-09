/**
 * Storage abstraction.
 *
 * Two drivers, one interface:
 *   - `blob` — Vercel Blob (private store). Used in production where the
 *     filesystem is ephemeral.
 *   - `fs`   — local filesystem under `data/`. Used for local development and
 *     for the test-suite so tests never touch the network.
 *
 * The driver is chosen by environment: if `BLOB_READ_WRITE_TOKEN` is present we
 * use blob, otherwise we fall back to the filesystem.
 */

import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface StorageDriver {
  readonly name: "blob" | "fs";
  read(pathname: string): Promise<string | null>;
  write(pathname: string, contents: string, contentType?: string): Promise<void>;
  remove(pathname: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** ------------------------------------------------------------------ blob */

class BlobDriver implements StorageDriver {
  readonly name = "blob" as const;
  private token: string;
  private blobApi: typeof import("@vercel/blob");

  constructor(token: string, blobApi: typeof import("@vercel/blob")) {
    this.token = token;
    this.blobApi = blobApi;
  }

  async read(pathname: string): Promise<string | null> {
    try {
      // `useCache: false` is mandatory here. The default (cached) read goes
      // through the edge cache, and a private blob that is *overwritten* —
      // which is exactly what the novel index is — keeps serving the old
      // body for up to `cacheControlMaxAge` (one month by default). Measured
      // on the `nis-data` store: 7 of 12 immediate overwrite→read cycles
      // returned the previous version; with `useCache: false` it was 0 of 12.
      const result = await this.blobApi.get(pathname, {
        access: "private",
        token: this.token,
        useCache: false,
      });
      if (!result) return null;
      return await new Response(result.stream).text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found") || message.includes("404")) return null;
      throw error;
    }
  }

  async write(
    pathname: string,
    contents: string,
    contentType = "application/json",
  ): Promise<void> {
    await this.blobApi.put(pathname, contents, {
      access: "private",
      token: this.token,
      contentType,
      allowOverwrite: true,
      addRandomSuffix: false,
      // Keep the edge cache short so an overwritten blob converges quickly
      // for any consumer that reads it without `useCache: false` (e.g. a
      // browser hitting a media URL). The minimum the API accepts is 60s.
      cacheControlMaxAge: 60,
    });
  }

  async remove(pathname: string): Promise<void> {
    await this.blobApi.del(pathname, { token: this.token });
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.blobApi.list({
        prefix,
        token: this.token,
        cursor,
        limit: 1000,
      });
      out.push(...result.blobs.map((b) => b.pathname));
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return out;
  }
}

/** -------------------------------------------------------------------- fs */

class FsDriver implements StorageDriver {
  readonly name = "fs" as const;
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  private resolve(pathname: string): string {
    const safe = pathname.replace(/^\/+/, "");
    const full = path.join(this.root, safe);
    // Guard against path traversal — pathname always comes from our own code,
    // but a traversal would escape the data directory.
    if (!full.startsWith(this.root)) {
      throw new Error(`Refusing to access path outside the data directory: ${pathname}`);
    }
    return full;
  }

  async read(pathname: string): Promise<string | null> {
    const full = this.resolve(pathname);
    if (!existsSync(full)) return null;
    return readFile(full, "utf8");
  }

  async write(pathname: string, contents: string): Promise<void> {
    const full = this.resolve(pathname);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents, "utf8");
  }

  async remove(pathname: string): Promise<void> {
    const full = this.resolve(pathname);
    await rm(full, { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.resolve(prefix);
    if (!existsSync(base)) return [];
    const out: string[] = [];
    const walk = async (dir: string, rel: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), nextRel);
        } else {
          out.push(`${prefix.replace(/\/$/, "")}/${nextRel}`);
        }
      }
    };
    await walk(base, "");
    return out;
  }
}

/** --------------------------------------------------------------- factory */

let cached: StorageDriver | null = null;

/** Get the active storage driver. */
export async function getStorage(): Promise<StorageDriver> {
  if (cached) return cached;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    const blobApi = await import("@vercel/blob");
    cached = new BlobDriver(token, blobApi);
  } else {
    const root = path.join(process.cwd(), "data");
    await mkdir(root, { recursive: true });
    cached = new FsDriver(root);
  }
  return cached;
}

/** Force a specific driver — used by tests. */
export function setStorage(driver: StorageDriver | null): void {
  cached = driver;
}

/** Build a filesystem driver rooted at a specific directory (tests). */
export function createFsDriver(root: string): StorageDriver {
  return new FsDriver(root);
}
