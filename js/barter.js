export class BarterSystem {
  constructor() {
    this.ledger = []; // recent trades
    this.globalStock = {}; // village-wide approximate stock
  }

  canTrade(buyer, seller) {
    if (buyer === seller) return false;
    const buyerNeeds = buyer.career.needs || [];
    const sellerProduces = Object.keys(seller.career.produces || {});
    const buyerProduces = Object.keys(buyer.career.produces || {});
    const sellerNeeds = seller.career.needs || [];

    const want = buyerNeeds.find(n => sellerProduces.includes(n) && (seller.inventory[n] || 0) > 0);
    const offer = buyerProduces.find(p => sellerNeeds.includes(p) && (buyer.inventory[p] || 0) > 0);
    return want && offer ? { want, offer } : null;
  }

  trade(buyer, seller) {
    const deal = this.canTrade(buyer, seller);
    if (!deal) return false;

    const { want, offer } = deal;
    const qty = 1;

    buyer.inventory[want] = (buyer.inventory[want] || 0) + qty;
    seller.inventory[want] = (seller.inventory[want] || 0) - qty;
    seller.inventory[offer] = (seller.inventory[offer] || 0) + qty;
    buyer.inventory[offer] = (buyer.inventory[offer] || 0) - qty;

    this.ledger.push({ buyer: buyer.name, seller: seller.name, want, offer, qty, time: Date.now() });
    if (this.ledger.length > 50) this.ledger.shift();

    buyer.setState('bartering');
    seller.setState('bartering');
    buyer.mood = Math.min(1, buyer.mood + 0.1);
    seller.mood = Math.min(1, seller.mood + 0.1);

    return { want, offer };
  }

  produce(inhabitant, dt) {
    const { produces } = inhabitant.career;
    if (!produces) return;
    inhabitant._produceTimer = (inhabitant._produceTimer || 0) + dt;
    if (inhabitant._produceTimer < 30) return; // produce every 30s game-time... but we use real dt
    // Actually produce based on work state
    if (inhabitant.state !== 'working') return;
    inhabitant._produceTimer = 0;
    for (const [good, rate] of Object.entries(produces)) {
      const current = inhabitant.inventory[good] || 0;
      if (current < 10) {
        inhabitant.inventory[good] = current + rate;
      }
    }
  }

  consume(inhabitant) {
    const needs = inhabitant.career.needs || [];
    for (const need of needs) {
      if ((inhabitant.inventory[need] || 0) > 0) {
        inhabitant.inventory[need]--;
        inhabitant.mood = Math.min(1, inhabitant.mood + 0.05);
        return;
      }
    }
    // Unmet need
    inhabitant.mood = Math.max(0, inhabitant.mood - 0.05);
  }

  getLastTrades(n = 5) {
    return this.ledger.slice(-n);
  }
}
