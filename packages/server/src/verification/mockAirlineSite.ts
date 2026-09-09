import type { FastifyInstance } from 'fastify';
import { hashUnit, type NormalizedItinerary } from '@kfr/core';
import type { Repositories } from '../repositories/index.js';

/**
 * A small, self-hosted "airline website" used by the reference booking-flow
 * driver and the tests. It mimics the shape of a real flow: fare selection,
 * passenger details, extras, and a payment page whose total is loaded
 * asynchronously by JavaScript. Fees are deterministic per itinerary so the
 * verified price is reproducible.
 */
export function quoteFor(it: NormalizedItinerary, passengers: number, bags: number): { rows: Array<{ label: string; amount: number }>; total: number; currency: string } {
  const issuanceFee = Math.round(hashUnit(`fee:${it.fingerprint}`) * 45);
  const surcharge = Math.round(it.fare * 0.012 * 100) / 100;
  const bagFee = bags * 55;
  const rows = [
    { label: 'Fare incl. taxes', amount: it.fare },
    { label: 'Ticket issuance fee', amount: issuanceFee * passengers },
    { label: 'Payment surcharge', amount: surcharge },
  ];
  if (bagFee > 0) rows.push({ label: 'Extra baggage', amount: bagFee });
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  return { rows, total, currency: it.currency };
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · Mock Airways</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6fa;color:#1a2233;margin:0}header{background:#7a1f3d;color:#fff;padding:14px 28px;font-weight:700}main{max-width:820px;margin:24px auto;background:#fff;padding:24px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08)}h1{font-size:20px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #e5e8ef;text-align:left}td.r{text-align:right}button,.btn{background:#7a1f3d;color:#fff;border:none;padding:10px 18px;border-radius:6px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}label{display:block;margin:8px 0}input[type=text]{padding:8px;border:1px solid #c9d0dc;border-radius:4px;width:240px}.steps{color:#6b7385;font-size:13px;margin-bottom:12px}.total{font-size:22px;font-weight:700}</style></head>
<body><header>Mock Airways — booking</header><main>${body}</main></body></html>`;
}

function flights(it: NormalizedItinerary): string {
  const leg = (segs: NormalizedItinerary['segments']): string => segs.map((s) => `<tr><td>${s.flightNumber}</td><td>${s.origin} ${s.departureLocal.slice(0, 16).replace('T', ' ')}</td><td>${s.destination} ${s.arrivalLocal.slice(0, 16).replace('T', ' ')}</td><td>${s.cabin}</td></tr>`).join('');
  return `<table><tr><th>Flight</th><th>Departs</th><th>Arrives</th><th>Cabin</th></tr>${leg(it.outbound.segments)}${leg(it.inbound.segments)}</table>`;
}

export function registerMockAirlineSite(app: FastifyInstance, repos: Repositories): void {
  const load = async (id: string): Promise<NormalizedItinerary | null> => (await repos.getJourney(id))?.itinerary ?? null;
  const pax = (q: Record<string, unknown>): number => Math.max(1, Math.min(9, Number(q.pax ?? 1) || 1));

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/mock-airline/book/:id', async (req, reply) => {
    const it = await load(req.params.id);
    if (!it) return reply.code(404).type('text/html').send(layout('Not found', '<h1>Itinerary not found</h1>'));
    const html = layout(
      'Select fare',
      `<div class="steps">Step 1 of 4 · Fare</div><h1>${it.originAirport} → ${it.arrivalGateway} return</h1>${flights(it)}
      <p data-testid="fare-summary">Quoted fare: <strong>${it.currency} ${it.fare.toFixed(2)}</strong> for ${req.query.pax ?? 1} passenger(s). Taxes included; issuance fees and payment surcharges are shown at payment.</p>
      <a class="btn" data-testid="select-fare" href="/mock-airline/passengers?it=${encodeURIComponent(it.id)}&pax=${pax(req.query)}">Select this fare</a>`,
    );
    return reply.type('text/html').send(html);
  });

  app.get<{ Querystring: Record<string, string> }>('/mock-airline/passengers', async (req, reply) => {
    const it = await load(req.query.it ?? '');
    if (!it) return reply.code(404).send('not found');
    const n = pax(req.query);
    const fields = Array.from({ length: n }, (_, i) => `<fieldset><legend>Passenger ${i + 1}</legend><label>Given name <input type="text" name="given${i}" data-testid="pax-${i}-given" required></label><label>Family name <input type="text" name="family${i}" data-testid="pax-${i}-family" required></label></fieldset>`).join('');
    const html = layout(
      'Passengers',
      `<div class="steps">Step 2 of 4 · Passengers</div><h1>Passenger details</h1><form data-testid="passenger-form" method="get" action="/mock-airline/extras"><input type="hidden" name="it" value="${esc(it.id)}"><input type="hidden" name="pax" value="${n}">${fields}<button type="submit" data-testid="passengers-continue">Continue</button></form>`,
    );
    return reply.type('text/html').send(html);
  });

  app.get<{ Querystring: Record<string, string> }>('/mock-airline/extras', async (req, reply) => {
    const it = await load(req.query.it ?? '');
    if (!it) return reply.code(404).send('not found');
    const n = pax(req.query);
    const html = layout(
      'Extras',
      `<div class="steps">Step 3 of 4 · Extras</div><h1>Optional extras</h1><form data-testid="extras-form" method="get" action="/mock-airline/payment"><input type="hidden" name="it" value="${esc(it.id)}"><input type="hidden" name="pax" value="${n}">
      <label><input type="checkbox" name="bags" value="1" data-testid="extra-bag"> Extra checked bag (+ ${it.currency} 55)</label>
      <label><input type="checkbox" name="lounge" value="1"> Lounge access (+ ${it.currency} 40)</label>
      <button type="submit" data-testid="extras-continue">Continue to payment</button></form>`,
    );
    return reply.type('text/html').send(html);
  });

  app.get<{ Querystring: Record<string, string> }>('/mock-airline/payment', async (req, reply) => {
    const it = await load(req.query.it ?? '');
    if (!it) return reply.code(404).send('not found');
    const n = pax(req.query);
    const bags = req.query.bags ? 1 : 0;
    const html = layout(
      'Payment',
      `<div class="steps">Step 4 of 4 · Payment</div><h1 data-testid="payment-page">Review and pay</h1>${flights(it)}
      <table id="price-table"><tr><td colspan="2">Loading final price…</td></tr></table>
      <p class="total">Total: <span data-testid="total-price" data-ready="false" data-currency="${it.currency}">…</span></p>
      <button data-testid="pay-button" disabled>Pay now</button>
      <script>
        setTimeout(function () {
          fetch('/mock-airline/api/quote?it=${encodeURIComponent(it.id)}&pax=${n}&bags=${bags}').then(function (r) { return r.json(); }).then(function (q) {
            var t = document.getElementById('price-table');
            t.innerHTML = q.rows.map(function (r) { return '<tr data-testid="price-row" data-label="' + r.label + '" data-amount="' + r.amount + '"><td>' + r.label + '</td><td class="r">' + q.currency + ' ' + r.amount.toFixed(2) + '</td></tr>'; }).join('');
            var el = document.querySelector('[data-testid="total-price"]');
            el.textContent = q.currency + ' ' + q.total.toFixed(2);
            el.setAttribute('data-amount', String(q.total));
            el.setAttribute('data-ready', 'true');
            document.querySelector('[data-testid="pay-button"]').disabled = false;
          });
        }, 400);
      </script>`,
    );
    return reply.type('text/html').send(html);
  });

  app.get<{ Querystring: Record<string, string> }>('/mock-airline/api/quote', async (req, reply) => {
    const it = await load(req.query.it ?? '');
    if (!it) return reply.code(404).send({ error: 'not found' });
    return quoteFor(it, pax(req.query), req.query.bags === '1' ? 1 : 0);
  });
}
