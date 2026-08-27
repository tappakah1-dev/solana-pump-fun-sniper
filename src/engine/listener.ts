import type { TokenCreate } from "./models.ts";

/**
 * Pump.fun program create events.
 * Program id (mainnet): 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
 *
 * The running desk uses HTTP polling of frontend-api-v3.pump.fun (see live-runner).
 * These classes remain for replay injection and tests.
 */
export interface CreateListener {
  start(onCreate: (c: TokenCreate) => void): void;
  stop(): void;
  connected(): boolean;
}

export class SimulatedListener implements CreateListener {
  private timer: ReturnType<typeof setInterval> | null = null;
  private onCreate: ((c: TokenCreate) => void) | null = null;
  private _connected = false;

  start(onCreate: (c: TokenCreate) => void) {
    this.onCreate = onCreate;
    this._connected = true;
  }

  stop() {
    this._connected = false;
    this.onCreate = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  connected() {
    return this._connected;
  }

  /** Inject a create (replay / demo). */
  inject(c: TokenCreate) {
    if (this._connected) this.onCreate?.(c);
    else this.onCreate?.(c);
  }
}

export class LiveCreateListener implements CreateListener {
  private _connected = false;
  private readonly wsUrl: string;
  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  start(_onCreate: (c: TokenCreate) => void) {
    // Stub: subscribe to Pump.fun program logs over ws_url and decode
    // create instruction accounts (mint, creator, metadata URI).
    this._connected = Boolean(this.wsUrl);
  }

  stop() {
    this._connected = false;
  }

  connected() {
    return this._connected;
  }
}
