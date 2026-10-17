import { Injectable } from '@nestjs/common';

/**
 * Tells the sync engine that the outbox may have grown. Raised inside the writing transaction, so
 * the engine waits a moment before looking; if the transaction rolled back, it simply finds
 * nothing new.
 */
@Injectable()
export class OutboxSignal {
  private readonly listeners = new Set<() => void>();

  raise(): void {
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
