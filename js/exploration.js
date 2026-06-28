import { CHUNK_SIZE } from './world/chunk-manager.js';

export class ExplorationSystem {
  constructor(chunkManager) {
    this.chunkManager = chunkManager;
    this._boredTimers = new Map(); // inh → seconds of low mood
  }

  update(dt, inhabitants) {
    for (const inh of inhabitants) {
      if (!inh.dna) continue;
      if (inh.lifeStage === 'infant' || inh.lifeStage === 'dead') continue;

      // Discover chunks near current position
      this.chunkManager.updateForPosition(inh.pos.x, inh.pos.z);

      // Track boredom / desperation
      const isLow = inh.mood < 0.3 && !inh._override;
      if (isLow) {
        const t = (this._boredTimers.get(inh) || 0) + dt;
        this._boredTimers.set(inh, t);
        if (t > 55) {
          this._boredTimers.set(inh, 0);
          this._sendExploring(inh);
        }
      } else {
        this._boredTimers.delete(inh);
      }

      // Resource scarcity: no food for too long
      if (inh._hungerTimer != null) {
        inh._hungerTimer += dt;
        const goods = Object.values(inh.inventory || {}).reduce((s, v) => s + v, 0);
        if (goods > 0) inh._hungerTimer = 0;
        if (inh._hungerTimer > 110 && !inh._override) {
          inh._hungerTimer = 0;
          this._sendExploring(inh);
        }
      } else {
        inh._hungerTimer = 0;
      }

      // After exploration reach destination, settle
      if (inh.isExploring && inh.fleeTarget) {
        const dx = inh.fleeTarget.x - inh.pos.x;
        const dz = inh.fleeTarget.z - inh.pos.z;
        if (dx * dx + dz * dz < 25) {
          inh.isExploring = false;
          inh.homePos = { x: inh.pos.x, z: inh.pos.z };
          inh.fleeTarget = null;
          inh.clearOverride();
          inh.mood = Math.min(1, inh.mood + 0.3); // relief at new home
        }
      }
    }
  }

  // Called by EventSystem after a disaster to push fleeing inhabitants outward
  onDisasterFlee(inhabitants) {
    for (const inh of inhabitants) {
      if (!inh.dna) continue;
      if (inh.lifeStage === 'infant' || inh.lifeStage === 'dead') continue;
      if (Math.random() < 0.45) this._sendExploring(inh, 120 + Math.random() * 80);
    }
  }

  _sendExploring(inh, dist = 70 + Math.random() * 60) {
    inh.isExploring = true;
    const angle = Math.random() * Math.PI * 2;
    inh.fleeTarget = {
      x: inh.pos.x + Math.cos(angle) * dist,
      z: inh.pos.z + Math.sin(angle) * dist,
    };
    inh.setOverride('fleeing');
  }
}
