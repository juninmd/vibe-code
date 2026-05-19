// Ported from multica server/internal/daemonws/hub.go (markSeen).
// Per-client bounded ring buffer of event IDs to prevent re-delivery after
// reconnect or stream resync. Ready to wire into BroadcastHub when the WS
// protocol grows an `id` field on events.

const DEFAULT_CAPACITY = 128;

export class EventDedup {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private readonly capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity > 0 ? capacity : DEFAULT_CAPACITY;
  }

  /**
   * Records `id` as seen. Returns `true` if this is the first time (caller
   * should deliver), `false` if it was already in the buffer (drop).
   * Empty IDs always return true — that disables dedup for legacy events
   * without an id, matching multica's semantics.
   */
  markSeen(id: string | undefined | null): boolean {
    if (!id) return true;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) {
      const drop = this.order.shift();
      if (drop !== undefined) this.seen.delete(drop);
    }
    return true;
  }

  size(): number {
    return this.order.length;
  }

  clear(): void {
    this.seen.clear();
    this.order.length = 0;
  }
}
