import { chromium, type Browser } from 'playwright-core';

export interface BrowserManagerOptions {
  executablePath?: string;
  headless?: boolean;
}

/** Lazily launches one shared headless Chromium and hands out isolated contexts. */
export class BrowserManager {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  public lastError: string | null = null;

  constructor(private readonly opts: BrowserManagerOptions = {}) {}

  get isRunning(): boolean {
    return Boolean(this.browser?.isConnected());
  }

  executablePath(): string | undefined {
    return this.opts.executablePath || undefined;
  }

  async get(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium
        .launch({ headless: this.opts.headless ?? true, executablePath: this.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        .then((b) => {
          this.browser = b;
          this.lastError = null;
          b.on('disconnected', () => {
            this.browser = null;
          });
          return b;
        })
        .catch((e: unknown) => {
          this.lastError = e instanceof Error ? e.message : String(e);
          throw e;
        })
        .finally(() => {
          this.launching = null;
        });
    }
    return this.launching;
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => undefined);
  }
}
