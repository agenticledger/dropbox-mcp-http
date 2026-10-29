import { createHash } from "node:crypto";
export const MAX_BYTES = 8 * 1024 * 1024;
export class SafeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
    public requestId?: string,
    public retryAfterSeconds?: number,
    public correctOffset?: number,
  ) {
    super(message);
  }
}
export class ConnectionRequired extends Error {
  constructor(public connectUrl?: string) {
    super("Connect Dropbox through the Connections Broker.");
  }
}
export type Resolver = () => Promise<string>;
export function contentHash(data: Buffer): string {
  const blocks: Buffer[] = [];
  for (let i = 0; i < data.length; i += 4 * 1024 * 1024)
    blocks.push(
      createHash("sha256")
        .update(data.subarray(i, i + 4 * 1024 * 1024))
        .digest(),
    );
  return createHash("sha256").update(Buffer.concat(blocks)).digest("hex");
}
export function decodeBase64(input: string): Buffer {
  if (
    input.length > Math.ceil(MAX_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      input,
    )
  )
    throw new SafeError(
      "invalid_content",
      "Use canonical base64, at most 8 MiB decoded per call.",
    );
  const data = Buffer.from(input, "base64");
  if (data.length > MAX_BYTES)
    throw new SafeError("too_large", "Maximum content per call is 8 MiB.");
  return data;
}
async function bounded(response: Response, cap: number): Promise<Buffer> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > cap) {
    await response.body?.cancel();
    throw new SafeError(
      "too_large",
      "Response exceeds the configured cap; use a temporary link or smaller page.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      total += r.value.byteLength;
      if (total > cap) {
        await reader.cancel();
        throw new SafeError(
          "too_large",
          "Response exceeds the configured cap; use a temporary link or smaller page.",
        );
      }
      chunks.push(Buffer.from(r.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export interface CallOptions {
  write?: boolean;
  upload?: Buffer;
  download?: boolean;
  expectedHash?: string;
  pathRoot?: string;
}
export class DropboxClient {
  constructor(
    private resolve: Resolver,
    private fetcher: typeof fetch = fetch,
    private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  async call(
    route: string,
    args: unknown,
    options: CallOptions = {},
  ): Promise<unknown> {
    // Only catalogued, fixed routes are exposed by tools. No arbitrary hosts or paths.
    if (!/^(users|files|sharing)\/[a-z0-9_]+(?:\/[a-z0-9_]+)?$/.test(route))
      throw new SafeError("invalid_route", "Invalid Dropbox API route.");
    if (options.upload && options.upload.length > MAX_BYTES)
      throw new SafeError(
        "too_large",
        "Upload chunks are capped at 8 MiB, below Dropbox 150 MiB per request.",
      );
    const token = await this.resolve();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (options.pathRoot)
      headers["Dropbox-API-Path-Root"] = JSON.stringify({
        ".tag": "namespace_id",
        namespace_id: options.pathRoot,
      });
    const content = options.upload !== undefined || options.download;
    if (content)
      headers["Dropbox-API-Arg"] = JSON.stringify(args).replace(
        /[\u007f-\uffff]/g,
        (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
      );
    if (!options.download)
      headers["Content-Type"] =
        options.upload !== undefined
          ? "application/octet-stream"
          : "application/json";
    const url = `https://${content ? "content" : "api"}.dropboxapi.com/2/${route}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "POST",
          headers,
          body:
            options.upload !== undefined
              ? new Uint8Array(options.upload)
              : content
                ? undefined
                : JSON.stringify(args),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw new SafeError(
          "transport_unavailable",
          "Dropbox request failed or timed out. No write was retried.",
        );
      }
      const requestId =
        (response.headers.get("x-dropbox-request-id") ?? "")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .slice(0, 128) || undefined;
      const retryRaw = response.headers.get("retry-after");
      const delay =
        retryRaw && /^\d+$/.test(retryRaw)
          ? Number(retryRaw)
          : Math.max(
              0,
              Math.ceil((Date.parse(retryRaw ?? "") - Date.now()) / 1000),
            );
      if (
        !options.write &&
        (response.status === 429 || response.status >= 500) &&
        attempt < 2
      ) {
        await response.body?.cancel();
        if (Number.isFinite(delay) && delay > 10)
          throw new SafeError(
            "rate_limited",
            "Retry later after the provider delay.",
            response.status,
            requestId,
            delay,
          );
        await this.sleep(
          Math.max(
            Number.isFinite(delay) ? delay * 1000 : 0,
            250 * 2 ** attempt,
          ),
        );
        continue;
      }
      if (!response.ok) {
        const raw = await bounded(response, 1024 * 1024);
        let summary = "";
        let correctOffset: number | undefined;
        try {
          const parsed = JSON.parse(raw.toString());
          summary = String(parsed.error_summary ?? "");
          const candidate =
            parsed.error?.correct_offset ??
            parsed.error?.lookup_failed?.correct_offset;
          if (Number.isSafeInteger(candidate) && candidate >= 0)
            correctOffset = candidate;
        } catch {}
        const category =
          summary
            .split("/")
            .filter((x) => /^[a-z_]+$/.test(x))
            .slice(0, 3)
            .join("/") || "provider_error";
        throw new SafeError(
          response.status === 401
            ? "reauthentication_required"
            : response.status === 429
              ? "rate_limited"
              : category,
          response.status === 401
            ? "Dropbox authorization expired or was revoked. Reconnect through the broker."
            : `Dropbox rejected this request (${response.status}; ${category}).`,
          response.status,
          requestId,
          Number.isFinite(delay) ? delay : undefined,
          correctOffset,
        );
      }
      if (response.status === 204) {
        await response.body?.cancel();
        return null;
      }
      if (options.download) {
        const data = await bounded(response, MAX_BYTES);
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(
            response.headers.get("dropbox-api-result") ?? "{}",
          );
        } catch {
          throw new SafeError(
            "malformed_response",
            "Invalid Dropbox content metadata.",
          );
        }
        const actual = contentHash(data);
        const expected =
          options.expectedHash ??
          (route === "files/download" ? metadata.content_hash : undefined);
        if (expected && expected !== actual)
          throw new SafeError(
            "content_hash_mismatch",
            "Downloaded content hash did not match expected hash.",
          );
        return {
          metadata,
          base64: data.toString("base64"),
          size: data.length,
          contentHash: actual,
          hashVerified: expected ? true : null,
          untrustedContent: true,
        };
      }
      const data = await bounded(response, 1024 * 1024);
      if (!data.length) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        throw new SafeError(
          "malformed_response",
          "Dropbox returned invalid JSON.",
        );
      }
      if (
        options.upload !== undefined &&
        route === "files/upload" &&
        typeof parsed === "object" &&
        parsed !== null &&
        "content_hash" in parsed &&
        (parsed as { content_hash: unknown }).content_hash !==
          contentHash(options.upload)
      )
        throw new SafeError(
          "content_hash_mismatch",
          "Uploaded file metadata hash does not match input. File may already be committed; inspect before retry.",
        );
      return parsed;
    }
    throw new SafeError("retry_exhausted", "Dropbox retry budget exhausted.");
  }
}
