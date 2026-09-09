import path from 'node:path';
import type { Page } from 'playwright-core';
import type { NormalizedItinerary } from '@kfr/core';
import type { VerificationStep } from '../../db/schema.js';
import { VerificationError, type BookingFlowDriver, type VerificationContext, type VerificationResult } from '../types.js';

/**
 * Reference browser driver. Walks the locally hosted mock airline booking site
 * (see `mockAirlineSite.ts`) exactly like a real airline flow: select fare →
 * passenger details → extras → payment page, reading the dynamically loaded
 * total on the payment page and stopping there. Real airline drivers follow
 * the same shape with their own selectors.
 */
export class MockAirlineDriver implements BookingFlowDriver {
  readonly name = 'mock-airline';
  readonly kind = 'BROWSER' as const;

  supports(it: NormalizedItinerary): boolean {
    return it.provider === 'mock' || it.provider.startsWith('mock');
  }

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const steps: VerificationStep[] = [];
    const browser = await ctx.browser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const shot = async (name: string): Promise<string> => {
      const file = `${String(steps.length + 1).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: path.join(ctx.screenshotDir, file), fullPage: true });
      return file;
    };
    const step = async (name: string, fn: () => Promise<void>, note?: string): Promise<void> => {
      try {
        await fn();
        steps.push({ name, at: new Date().toISOString(), ok: true, url: page.url(), screenshot: await shot(name), note: note ?? null });
        ctx.log(`${this.name}: ${name} ok`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        let screenshot: string | null = null;
        try {
          screenshot = await shot(`${name}-failed`);
        } catch {
          /* ignore */
        }
        steps.push({ name, at: new Date().toISOString(), ok: false, url: page.url(), screenshot, note: message });
        throw new VerificationError(`${name} failed: ${message}`, steps);
      }
    };

    try {
      const base = `${ctx.selfBaseUrl}/mock-airline`;
      await step('open-fare', async () => {
        await page.goto(`${base}/book/${encodeURIComponent(ctx.itinerary.id)}?pax=${ctx.passengers}`, { waitUntil: 'networkidle' });
        await page.getByTestId('fare-summary').waitFor();
      });
      await step('select-fare', async () => {
        await page.getByTestId('select-fare').click();
        await page.getByTestId('passenger-form').waitFor();
      });
      await step('passenger-details', async () => {
        for (let i = 0; i < ctx.passengers; i++) {
          await page.getByTestId(`pax-${i}-given`).fill('Test');
          await page.getByTestId(`pax-${i}-family`).fill(`Traveller${i + 1}`);
        }
        await page.getByTestId('passengers-continue').click();
        await page.getByTestId('extras-form').waitFor();
      });
      await step('extras', async () => {
        // Keep the itinerary as quoted: no paid extras.
        await page.getByTestId('extras-continue').click();
        await page.getByTestId('payment-page').waitFor();
      });
      let finalPrice = NaN;
      let currency = 'EUR';
      const breakdown: Array<{ label: string; amount: number }> = [];
      await step(
        'payment-page',
        async () => {
          // The total is rendered by the page's own JavaScript after a quote request; wait for it.
          const total = page.locator('[data-testid="total-price"][data-ready="true"]');
          await total.waitFor();
          finalPrice = Number((await total.getAttribute('data-amount')) ?? 'NaN');
          currency = (await total.getAttribute('data-currency')) ?? 'EUR';
          for (const row of await page.getByTestId('price-row').all()) {
            breakdown.push({ label: (await row.getAttribute('data-label')) ?? '', amount: Number((await row.getAttribute('data-amount')) ?? '0') });
          }
          if (!Number.isFinite(finalPrice)) throw new Error('Total price not found on payment page');
          // Never proceed past this point: the pay button is deliberately not clicked.
          await page.getByTestId('pay-button').waitFor();
        },
        'Stopped before payment',
      );
      return { finalPrice, currency, breakdown, steps };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

export type { Page };
