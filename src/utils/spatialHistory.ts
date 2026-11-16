export interface SpatialHistoryEntry<T> {
  id: number;
  label: string;
  before: T;
  after: T;
  mergeKey?: string;
  timestamp: number;
}

export class SpatialHistoryManager<T> {
  private undoStack: SpatialHistoryEntry<T>[] = [];
  private redoStack: SpatialHistoryEntry<T>[] = [];
  private nextId = 1;
  private readonly maxEntries: number;
  private readonly coalesceMs: number;

  constructor(maxEntries: number = 50, coalesceMs: number = 600) {
    this.maxEntries = Math.max(1, maxEntries);
    this.coalesceMs = Math.max(0, coalesceMs);
  }

  public record(
    before: T,
    after: T,
    label: string,
    mergeKey?: string,
    now: number = Date.now()
  ): boolean {
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return false;
    }

    const top = this.undoStack[this.undoStack.length - 1];
    if (
      mergeKey &&
      top &&
      top.mergeKey === mergeKey &&
      now - top.timestamp <= this.coalesceMs
    ) {
      top.after = after;
      top.timestamp = now;
      top.label = label;
      this.redoStack = [];
      return true;
    }

    this.undoStack.push({
      id: this.nextId++,
      label,
      before,
      after,
      mergeKey,
      timestamp: now
    });

    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }

    this.redoStack = [];
    return true;
  }

  public undo(): { entry: SpatialHistoryEntry<T>; state: T } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return { entry, state: entry.before };
  }

  public redo(): { entry: SpatialHistoryEntry<T>; state: T } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return { entry, state: entry.after };
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoLabel(): string | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].label : null;
  }

  public getRedoLabel(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].label : null;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
