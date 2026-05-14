import { EventEmitter } from "node:events";

export type ProgressLevel = "info" | "warn" | "error";

export type ProgressEvent =
  | { kind: "stage-start"; id: string; label: string; ts: number }
  | { kind: "stage-end"; id: string; durationMs: number; ts: number }
  | {
      kind: "log";
      level: ProgressLevel;
      source: string;
      msg: string;
      ts: number;
    }
  | { kind: "done"; dashboardUrl: string; ts: number }
  | { kind: "error"; msg: string; ts: number };

export interface ProgressEmitter {
  stageStart(id: string, label: string): void;
  stageEnd(id: string): void;
  log(msg: string, source?: string, level?: ProgressLevel): void;
  done(dashboardUrl: string): void;
  error(msg: string): void;
  onEvent(listener: (e: ProgressEvent) => void): () => void;
  history(): ProgressEvent[];
}

export function createProgress(): ProgressEmitter {
  const bus = new EventEmitter();
  const buffer: ProgressEvent[] = [];
  const stageStartedAt = new Map<string, number>();

  const emit = (e: ProgressEvent) => {
    buffer.push(e);
    bus.emit("event", e);
  };

  return {
    stageStart(id, label) {
      stageStartedAt.set(id, Date.now());
      emit({ kind: "stage-start", id, label, ts: Date.now() });
    },
    stageEnd(id) {
      const started = stageStartedAt.get(id) ?? Date.now();
      emit({
        kind: "stage-end",
        id,
        durationMs: Date.now() - started,
        ts: Date.now(),
      });
    },
    log(msg, source = "pipeline", level = "info") {
      emit({ kind: "log", level, source, msg, ts: Date.now() });
    },
    done(dashboardUrl) {
      emit({ kind: "done", dashboardUrl, ts: Date.now() });
    },
    error(msg) {
      emit({ kind: "error", msg, ts: Date.now() });
    },
    onEvent(listener) {
      bus.on("event", listener);
      return () => bus.off("event", listener);
    },
    history() {
      return buffer.slice();
    },
  };
}

let _singleton: ProgressEmitter | null = null;

export function setProgress(p: ProgressEmitter | null): void {
  _singleton = p;
}

export function getProgress(): ProgressEmitter | null {
  return _singleton;
}
