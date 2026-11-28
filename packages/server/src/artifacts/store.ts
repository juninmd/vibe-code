/**
 * Session artifact files (issue #262).
 *
 * Files live under a dedicated root (`VIBE_CODE_ARTIFACTS_DIR`, default
 * `<data>/artifacts`), one directory per account/task, and the database keeps
 * only the relative path, size, MIME and checksum. Serving resolves the real
 * path, refuses symlinks and anything outside the root, and enforces per-file
 * size, per-account quota and retention.
 */

import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { TaskArtifact } from "@vibe-code/shared";
import type { Db } from "../db";

export const DEFAULT_MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_ACCOUNT_QUOTA_BYTES = 1024 * 1024 * 1024;

const INLINE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".log": "text/plain",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export type ArtifactErrorCode =
  | "not_found"
  | "forbidden"
  | "too_large"
  | "quota_exceeded"
  | "expired"
  | "invalid";

export class ArtifactError extends Error {
  constructor(
    readonly code: ArtifactErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface ArtifactLimits {
  root: string;
  maxBytes: number;
  retentionDays: number;
  quotaBytes: number;
}

export function artifactLimits(
  dataDir: string,
  env: Record<string, string | undefined> = process.env
): ArtifactLimits {
  const number = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    root: resolve(env.VIBE_CODE_ARTIFACTS_DIR || join(dataDir, "artifacts")),
    maxBytes: number(env.VIBE_CODE_ARTIFACT_MAX_BYTES, DEFAULT_MAX_ARTIFACT_BYTES),
    retentionDays: number(env.VIBE_CODE_ARTIFACT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
    quotaBytes: number(env.VIBE_CODE_ARTIFACT_QUOTA_BYTES, DEFAULT_ACCOUNT_QUOTA_BYTES),
  };
}

export function mimeForFile(name: string, provided?: string): string {
  if (provided?.startsWith("image/") || provided) return provided;
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? "application/octet-stream";
}

export function isInlineMime(mime: string): boolean {
  return INLINE_MIME.has(mime);
}

/** Strip directory components and control characters from a display name. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "artifact";
  const cleaned = Array.from(base)
    .map((char) => {
      const code = char.codePointAt(0) ?? 32;
      return code < 32 || '<>:"|?*'.includes(char) ? "_" : char;
    })
    .join("")
    .trim();
  return cleaned || "artifact";
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function extensionOf(name: string): string {
  const ext = extname(name).toLowerCase();
  return /^[.][a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

export interface RegisterFileInput {
  taskId: string;
  runId?: string | null;
  accountId?: string | null;
  /** Absolute or worktree-relative path of the source file. */
  sourcePath: string;
  /** Directory the source must live in (usually the session worktree). */
  allowedRoot: string;
  title?: string;
  kind?: TaskArtifact["kind"];
  mimeType?: string;
}

export class ArtifactStore {
  constructor(
    private readonly db: Db,
    readonly limits: ArtifactLimits
  ) {}

  private bucket(accountId: string | null | undefined): string {
    return accountId || "_operator";
  }

  private expiresAt(): string {
    const ms = this.limits.retentionDays * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ms).toISOString();
  }

  private async assertQuota(accountId: string | null | undefined, size: number): Promise<void> {
    const used = this.db.artifacts.sumBytesByAccount(accountId ?? null);
    if (used + size > this.limits.quotaBytes) {
      throw new ArtifactError(
        "quota_exceeded",
        "Artifact quota for this account is full. Remove old artifacts and try again."
      );
    }
  }

  /** Copies a file produced by the session into the artifact root. */
  async registerFile(input: RegisterFileInput): Promise<TaskArtifact> {
    const allowedReal = await realpath(input.allowedRoot).catch(() => null);
    if (!allowedReal) throw new ArtifactError("forbidden", "Session workspace is not available");
    const requested = isAbsolute(input.sourcePath)
      ? resolve(input.sourcePath)
      : resolve(allowedReal, input.sourcePath);
    const real = await realpath(requested).catch(() => null);
    if (!real || !isInside(allowedReal, real)) {
      throw new ArtifactError("forbidden", "Artifact path is outside the session workspace");
    }
    const info = await stat(real);
    if (!info.isFile()) throw new ArtifactError("invalid", "Artifact source is not a file");
    if (info.size > this.limits.maxBytes) {
      throw new ArtifactError(
        "too_large",
        `Artifact exceeds the ${Math.round(this.limits.maxBytes / (1024 * 1024))} MiB limit`
      );
    }
    await this.assertQuota(input.accountId, info.size);
    const fileName = safeFileName(input.sourcePath);
    const { id, storagePath, absolute } = this.allocate(input.taskId, input.accountId, fileName);
    await mkdir(join(absolute, ".."), { recursive: true });
    await copyFile(real, absolute);
    return this.record(input, id, fileName, storagePath, absolute, info.size);
  }

  /** Stores bytes uploaded through the API. */
  async registerBytes(input: {
    taskId: string;
    runId?: string | null;
    accountId?: string | null;
    fileName: string;
    bytes: Uint8Array;
    title?: string;
    kind?: TaskArtifact["kind"];
    mimeType?: string;
  }): Promise<TaskArtifact> {
    const fileName = safeFileName(input.fileName);
    if (input.bytes.byteLength === 0) throw new ArtifactError("invalid", "Empty artifact");
    if (input.bytes.byteLength > this.limits.maxBytes) {
      throw new ArtifactError(
        "too_large",
        `Artifact exceeds the ${Math.round(this.limits.maxBytes / (1024 * 1024))} MiB limit`
      );
    }
    await this.assertQuota(input.accountId, input.bytes.byteLength);
    const { id, storagePath, absolute } = this.allocate(input.taskId, input.accountId, fileName);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, input.bytes);
    return this.record(input, id, fileName, storagePath, absolute, input.bytes.byteLength);
  }

  private allocate(
    taskId: string,
    accountId: string | null | undefined,
    fileName: string
  ): { id: string; storagePath: string; absolute: string } {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    const bucket = this.bucket(accountId);
    const storagePath = [bucket, safeFileName(taskId), `${id}${extensionOf(fileName)}`].join("/");
    return { id, storagePath, absolute: join(this.limits.root, ...storagePath.split("/")) };
  }

  private async record(
    input: {
      taskId: string;
      runId?: string | null;
      accountId?: string | null;
      title?: string;
      kind?: TaskArtifact["kind"];
      mimeType?: string;
    },
    id: string,
    fileName: string,
    storagePath: string,
    absolute: string,
    size: number
  ): Promise<TaskArtifact> {
    const bytes = await Bun.file(absolute).arrayBuffer();
    const sha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    return this.db.artifacts.createFile({
      id,
      taskId: input.taskId,
      runId: input.runId ?? null,
      kind: input.kind ?? "other",
      title: input.title?.trim() || fileName,
      fileName,
      storagePath,
      mimeType: mimeForFile(fileName, input.mimeType),
      sizeBytes: size,
      sha256,
      expiresAt: this.expiresAt(),
      accountId: input.accountId ?? null,
    });
  }

  /**
   * Resolves a stored artifact for streaming. Refuses symlinks and any path
   * outside the root, even if the row was tampered with.
   */
  async open(
    taskId: string,
    artifactId: string
  ): Promise<{
    artifact: TaskArtifact;
    absolutePath: string;
    size: number;
    mimeType: string;
    inline: boolean;
  }> {
    const artifact = this.db.artifacts.getById(taskId, artifactId);
    if (!artifact?.storagePath) throw new ArtifactError("not_found", "Artifact not found");
    if (artifact.expiresAt && artifact.expiresAt <= new Date().toISOString()) {
      throw new ArtifactError("expired", "Artifact expired and is no longer available");
    }
    const rootReal = await realpath(this.limits.root).catch(() => null);
    if (!rootReal) throw new ArtifactError("not_found", "Artifact root is not available");
    const direct = resolve(rootReal, ...artifact.storagePath.split("/"));
    const directInfo = await stat(direct).catch(() => null);
    // lstat/stat: a symlink at the stored path is rejected instead of followed.
    if (!directInfo || !directInfo.isFile()) {
      throw new ArtifactError("not_found", "Artifact file is missing");
    }
    const real = await realpath(direct);
    if (!isInside(rootReal, real)) {
      throw new ArtifactError("forbidden", "Artifact path escapes the artifact root");
    }
    // Open the resolved file and confirm the descriptor still points at a
    // regular file inside the root (TOCTOU protection).
    const handle = await open(real, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new ArtifactError("forbidden", "Artifact is not a regular file");
      if (info.size > this.limits.maxBytes) {
        throw new ArtifactError("too_large", "Artifact exceeds the size limit");
      }
      return {
        artifact,
        absolutePath: real,
        size: info.size,
        mimeType: artifact.mimeType ?? "application/octet-stream",
        inline: isInlineMime(artifact.mimeType ?? ""),
      };
    } finally {
      await handle.close();
    }
  }

  /** Deletes expired rows and their files; returns how many rows were removed. */
  async cleanupExpired(now = new Date()): Promise<number> {
    const expired = this.db.artifacts.listExpired(now.toISOString());
    let removed = 0;
    for (const artifact of expired) {
      if (artifact.storagePath) {
        const target = join(this.limits.root, ...artifact.storagePath.split("/"));
        await rm(target, { force: true }).catch(() => {});
        // Remove the per-task directory when it became empty.
        const parent = join(target, "..");
        await readdir(parent)
          .then(async (entries) => {
            if (entries.length === 0) await rm(parent, { recursive: true, force: true });
          })
          .catch(() => {});
      }
      this.db.artifacts.removeById(artifact.id);
      removed += 1;
    }
    return removed;
  }

  /** Storage used by one account, for the API status. */
  usage(accountId: string | null | undefined): { usedBytes: number; quotaBytes: number } {
    return {
      usedBytes: this.db.artifacts.sumBytesByAccount(accountId ?? null),
      quotaBytes: this.limits.quotaBytes,
    };
  }
}

export function artifactDownloadUrl(taskId: string, artifactId: string): string {
  return `/api/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/file`;
}

let activeStore: ArtifactStore | null = null;

/** Server wiring; optional so tests and CLI tools can run without a store. */
export function setActiveArtifactStore(store: ArtifactStore | null): void {
  activeStore = store;
}

export function getActiveArtifactStore(): ArtifactStore | null {
  return activeStore;
}

/** Adds `downloadUrl` to an artifact returned by the API. */
export function withDownloadUrl(artifact: TaskArtifact): TaskArtifact {
  if (!artifact.storagePath) return artifact;
  return { ...artifact, downloadUrl: artifactDownloadUrl(artifact.taskId, artifact.id) };
}

/** Directory separator is exported for tests that build path assertions. */
export const pathSeparator = sep;
