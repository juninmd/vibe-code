// Ported from multica server/pkg/agent/stderr_tail.go. Captures a bounded
// tail of stderr so error messages can include the last bytes the CLI wrote
// before crashing — without forcing operators to crawl daemon logs.

const DEFAULT_MAX_BYTES = 2048;

/**
 * StderrTail buffers up to `maxBytes` of stderr while also forwarding each
 * chunk to an inner handler (logging, console, broadcaster). On error,
 * callers read `.tail()` and pass it to `withAgentStderr()` to compose a
 * "exit N; <label> stderr: <last bytes>" message.
 */
export class StderrTail {
  private buf = "";
  private readonly maxBytes: number;
  private readonly forward: (chunk: string) => void;

  constructor(forward: (chunk: string) => void, maxBytes = DEFAULT_MAX_BYTES) {
    this.maxBytes = maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
    this.forward = forward;
  }

  write(chunk: string): void {
    if (!chunk) return;
    this.forward(chunk);
    this.buf += chunk;
    if (this.buf.length > this.maxBytes) {
      this.buf = this.buf.slice(this.buf.length - this.maxBytes);
    }
  }

  tail(): string {
    return this.buf.trim();
  }
}

export function withAgentStderr(msg: string, label: string, tail: string): string {
  if (!tail) return msg;
  return `${msg}; ${label} stderr: ${tail}`;
}
