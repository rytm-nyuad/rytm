const RETRYABLE_PATTERNS = [
  "fetch failed",
  "connect timeout",
  "und_err_connect_timeout",
  "network error",
  "etimedout",
  "econnreset",
  "enotfound",
];

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  if (typeof error === "string") {
    return error.toLowerCase();
  }
  try {
    return JSON.stringify(error).toLowerCase();
  } catch {
    return String(error).toLowerCase();
  }
}

function isRetryableTransportError(error: unknown): boolean {
  const text = getErrorText(error);
  return RETRYABLE_PATTERNS.some((pattern) => text.includes(pattern));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withSupabaseRetry<T>(
  operationName: string,
  fn: () => T,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await Promise.resolve(fn());
    } catch (error) {
      lastError = error;
      const retryable = isRetryableTransportError(error);
      const shouldRetry = retryable && attempt < maxAttempts;

      console.error(`${operationName} failed`, {
        attempt,
        maxAttempts,
        retryable,
        error,
      });

      if (!shouldRetry) {
        throw error;
      }

      const backoffMs = attempt === 1 ? 300 : 900;
      await delay(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${operationName} failed`);
}
