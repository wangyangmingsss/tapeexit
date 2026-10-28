// Self-contained so Playwright can execute the same bounded reader in the page.
export async function readGatewayResource(input: { url: string; maxBytes: number; timeoutMs?: number }) {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0 || input.maxBytes > 64 * 1024 * 1024 ||
      (input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 60000)))
    throw new Error('Invalid gateway resource bound');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 60000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(input.url, { cache: 'no-store', credentials: 'omit', redirect: 'error',
      signal: controller.signal });
    reader = response.body?.getReader();
    if (!response.ok || !reader) throw new Error(`Gateway HTTP ${response.status} or missing body`);
    const length = response.headers.get('content-length');
    if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || BigInt(length) > BigInt(input.maxBytes)))
      throw new Error('Gateway resource exceeds declared limit');
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new Error('Gateway resource timed out');
      if (done) break;
      size += value.length;
      if (size > input.maxBytes) throw new Error('Gateway resource exceeds byte limit');
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return { url: response.url, headers: Object.fromEntries(response.headers), bytes: Array.from(bytes) };
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
