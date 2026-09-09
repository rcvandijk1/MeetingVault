import { expect, test, type Page } from '@playwright/test';

/**
 * Core Playwright flows (spec §55): create/edit profile, run search, change
 * scoring weights, filter results, compare journeys, inspect score breakdown.
 * Runs against the mock provider; no external credentials needed.
 */

async function runSearchAndOpenResults(page: Page): Promise<void> {
  await page.goto('/search');
  await expect(page.getByTestId('search-config')).toBeVisible();
  await page.getByTestId('search-run').click();
  await expect(page).toHaveURL(/\/search\/[0-9a-f-]+/, { timeout: 30000 });
  await expect(page.getByTestId('results-table')).toBeVisible();
  await expect(page.getByTestId('result-row').first()).toBeVisible();
}

test.describe('Krabi Flight Radar', () => {
  test('creates and edits a trip profile', async ({ page }) => {
    const name = `E2E business trip ${Date.now()}`;
    await page.goto('/profiles');
    await page.getByTestId('profile-new').click();
    await expect(page).toHaveURL(/\/profiles\/new/);
    await page.getByTestId('profile-name').fill(name);
    await page.getByTestId('profile-passengers').fill('1');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toHaveText(/saved/i);
    await expect(page).toHaveURL(/\/profiles\/(?!new)[^/]+$/);

    // Edit return constraints independently from outbound.
    await page.getByTestId('tab-constraints').click();
    await page.getByTestId('return-maxIndividualLayoverMinutes').fill('150');
    await page.getByTestId('outbound-maxIndividualLayoverMinutes').fill('240');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toHaveText(/saved/i);

    await page.reload();
    await page.getByTestId('tab-constraints').click();
    await expect(page.getByTestId('return-maxIndividualLayoverMinutes')).toHaveValue('150');
    await expect(page.getByTestId('outbound-maxIndividualLayoverMinutes')).toHaveValue('240');

    // The profile appears in the list.
    await expect(page.getByTestId('profile-item').filter({ hasText: name })).toBeVisible();

    // Flight-time weighting can be edited from the UI.
    await page.getByTestId('tab-timing').click();
    await page.getByTestId('outboundDeparture-band-0-score').fill('35');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toHaveText(/saved/i);

    // Clean up so reruns stay deterministic.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('profile-delete').click();
    await expect(page).toHaveURL(/\/profiles$/);
    await expect(page.getByTestId('profile-item').filter({ hasText: name })).toHaveCount(0);
  });

  test('runs a search and shows true journey cost next to the airfare', async ({ page }) => {
    await runSearchAndOpenResults(page);
    const first = page.getByTestId('result-row').first();
    await expect(first.getByTestId('row-airfare')).toContainText('€');
    await expect(first.getByTestId('row-true-cost')).toContainText('€');
    const airfare = Number((await first.getByTestId('row-airfare').innerText()).replace(/[^\d]/g, ''));
    const trueCost = Number((await first.getByTestId('row-true-cost').innerText()).replace(/[^\d]/g, ''));
    expect(trueCost).toBeGreaterThan(airfare);
    await expect(page.getByTestId('label-BEST_OVERALL').first()).toBeVisible();
    await expect(page.getByTestId('run-summary')).toContainText('rejected by hard rules');
    // Rejected itineraries are explained.
    await page.getByTestId('rejected-toggle').click();
    await expect(page.getByTestId('run-summary')).toContainText(/exceeds maximum/);
  });

  test('changing scoring weights re-scores results immediately', async ({ page }) => {
    await runSearchAndOpenResults(page);
    const firstBefore = await page.getByTestId('result-row').first().getAttribute('data-itinerary-id');
    const scoreBefore = await page.getByTestId('result-row').first().getByTestId('score-pill').innerText();
    // No network request must be needed: count search API calls.
    let searchCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/search') && r.method() === 'POST') searchCalls++;
    });
    await page.getByTestId('weight-input-journeyTime').fill('80');
    await page.getByTestId('weight-input-trueCost').fill('2');
    await page.getByTestId('weight-input-fareAnomaly').fill('0');
    await expect
      .poll(async () => {
        const id = await page.getByTestId('result-row').first().getAttribute('data-itinerary-id');
        const score = await page.getByTestId('result-row').first().getByTestId('score-pill').innerText();
        return id !== firstBefore || score !== scoreBefore;
      })
      .toBe(true);
    expect(searchCalls).toBe(0);
    await expect(page.getByTestId('label-FASTEST').first()).toBeVisible();
    // Reset restores the profile weights.
    await page.getByTestId('weights-reset').click();
    await expect(page.getByTestId('weight-input-journeyTime')).toHaveValue('20');
  });

  test('filters and sorts results', async ({ page }) => {
    await runSearchAndOpenResults(page);
    const total = await page.getByTestId('result-row').count();
    expect(total).toBeGreaterThan(3);

    await page.getByTestId('filter-collapse').uncheck();
    const expanded = await page.getByTestId('result-row').count();
    expect(expanded).toBeGreaterThanOrEqual(total);

    await page.getByTestId('filter-nondominated').check();
    const nonDominated = await page.getByTestId('result-row').count();
    expect(nonDominated).toBeLessThan(expanded);
    await page.getByTestId('filter-nondominated').uncheck();

    await page.getByTestId('filter-hotel').selectOption('no');
    await expect(page.getByTestId('results-table')).not.toContainText('hotel', { timeout: 5000 });

    await page.getByTestId('chip-DUS').click();
    const rows = page.getByTestId('result-row');
    const n = await rows.count();
    for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText('DUS');

    await page.getByTestId('filters-reset').click();
    await page.getByTestId('sort-select').selectOption('airfare');
    const a = Number((await page.getByTestId('result-row').nth(0).getByTestId('row-airfare').innerText()).replace(/[^\d]/g, ''));
    const b = Number((await page.getByTestId('result-row').nth(1).getByTestId('row-airfare').innerText()).replace(/[^\d]/g, ''));
    expect(a).toBeLessThanOrEqual(b);
    await expect(page.getByTestId('label-CHEAPEST').first()).toBeVisible();

    // Origin matrix toggles metrics.
    await page.getByTestId('tab-matrix').click();
    await expect(page.getByTestId('origin-matrix')).toBeVisible();
    await page.getByTestId('matrix-metric-score').click();
    await expect(page.getByTestId('matrix-row-AMS')).toBeVisible();
  });

  test('inspects the score breakdown and journey detail', async ({ page }) => {
    await runSearchAndOpenResults(page);
    await page.getByTestId('result-row').first().getByTestId('score-pill').click();
    const modal = page.getByTestId('score-breakdown-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('breakdown-trueCost')).toContainText('× 30%');
    await expect(modal.getByTestId('breakdown-final')).toBeVisible();
    await expect(modal).toContainText('Why');
    await page.keyboard.press('Escape');
    await modal.locator('..').click({ position: { x: 5, y: 5 } });
    await expect(modal).toBeHidden();

    await page.getByTestId('result-row').first().click();
    const drawer = page.getByTestId('journey-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('detail-true-cost')).toContainText('€');
    await expect(drawer.getByTestId('detail-timeline')).toContainText('Leave home');
    await expect(drawer.getByTestId('detail-timeline')).toContainText('Arrive in Krabi');
    await drawer.getByTestId('tab-flights').click();
    await expect(drawer).toContainText('Outbound');
    await drawer.getByTestId('tab-score').click();
    await expect(drawer.getByTestId('score-breakdown')).toBeVisible();
    await drawer.getByTestId('detail-refresh').click();
    await expect(drawer).toContainText(/Re-priced/);
    await page.getByTestId('drawer-close').click();
    await expect(drawer).toBeHidden();
  });

  test('compares journeys side by side', async ({ page }) => {
    await runSearchAndOpenResults(page);
    const rows = page.getByTestId('result-row');
    await rows.nth(0).getByTestId('row-compare').click();
    await rows.nth(1).getByTestId('row-compare').click();
    await rows.nth(2).getByTestId('row-compare').click();
    await page.getByTestId('nav-compare').click();
    await expect(page.getByTestId('compare-table')).toBeVisible();
    const header = page.getByTestId('compare-table').locator('thead th');
    await expect(header).toHaveCount(4);
    await expect(page.getByTestId('compare-row-True journey cost')).toBeVisible();
    await expect(page.getByTestId('compare-row-Saving per extra hour')).toBeVisible();
    await expect(page.getByTestId('compare-table').locator('td.best').first()).toBeVisible();
    await page.getByTestId('compare-remove').first().click();
    await expect(header).toHaveCount(3);
    await page.getByTestId('compare-clear').click();
    await expect(page.getByTestId('compare-table')).toBeHidden();
  });

  test('radar shows deal levels and settings are editable', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('deal-counts')).toBeVisible();
    await expect(page.getByTestId('deal-count-NORMAL')).toBeVisible();
    await expect(page.getByTestId('stat-best')).toContainText('/ 100');

    await page.goto('/settings');
    await page.getByTestId('tab-origins').click();
    await page.getByTestId('origin-row-FRA').click();
    await page.getByTestId('origin-hotel-cost').fill('160');
    await page.getByTestId('origin-save').click();
    await expect(page.getByTestId('origin-status')).toHaveText(/saved/i);
    await page.reload();
    await page.getByTestId('tab-origins').click();
    await expect(page.getByTestId('origin-row-FRA')).toContainText('€160');

    await page.getByTestId('tab-destination').click();
    await expect(page.getByTestId('ground-minutes-HKT-KRABI')).toHaveValue('180');

    await page.getByTestId('tab-providers').click();
    await expect(page.getByTestId('providers-card')).toContainText('mock');

    await page.goto('/history');
    await expect(page.getByTestId('history-summary')).toContainText('KBV');
    await expect(page.getByTestId('history-chart')).toContainText(/observations/);
  });
});
