export class PathfindingSystem {
  constructor(waypoints, edges) {
    this.waypoints = waypoints;
    this.graph = {};
    for (const [a, b] of edges) {
      (this.graph[a] = this.graph[a] || []).push(b);
      (this.graph[b] = this.graph[b] || []).push(a);
    }
  }

  findPath(from, to) {
    if (from === to) return [from];
    if (!this.waypoints[from] || !this.waypoints[to]) return [from];
    const open = new Set([from]);
    const cameFrom = {};
    const g = { [from]: 0 };
    const f = { [from]: this._dist(from, to) };
    while (open.size > 0) {
      let cur = [...open].reduce((a, b) => (f[a] || Infinity) < (f[b] || Infinity) ? a : b);
      if (cur === to) {
        const path = [cur];
        while (cameFrom[cur]) { cur = cameFrom[cur]; path.unshift(cur); }
        return path;
      }
      open.delete(cur);
      for (const nb of (this.graph[cur] || [])) {
        const tg = (g[cur] || 0) + this._dist(cur, nb);
        if (tg < (g[nb] || Infinity)) {
          cameFrom[nb] = cur;
          g[nb] = tg;
          f[nb] = tg + this._dist(nb, to);
          open.add(nb);
        }
      }
    }
    return [from];
  }

  _dist(a, b) {
    const wa = this.waypoints[a], wb = this.waypoints[b];
    if (!wa || !wb) return 999;
    return Math.sqrt((wa.x - wb.x) ** 2 + (wa.z - wb.z) ** 2);
  }

  waypointPos(name) {
    return this.waypoints[name] || this.waypoints[Object.keys(this.waypoints)[0]];
  }

  nearestWaypoint(x, z) {
    let best = null, bestD = Infinity;
    for (const [k, v] of Object.entries(this.waypoints)) {
      const d = (v.x - x) ** 2 + (v.z - z) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  randomWaypoint(prefix) {
    const keys = prefix ? Object.keys(this.waypoints).filter(k => k.startsWith(prefix)) : Object.keys(this.waypoints);
    return keys[Math.floor(Math.random() * keys.length)];
  }
}

export class EraManager {
  constructor(scene, eraConfigs) {
    this.scene = scene;
    this.eras = Object.fromEntries(eraConfigs.map(e => [e.id, e]));
    this.eraList = eraConfigs;
    this.current = null;
    this.pathfinding = null;
    this._sceneGroup = null;
  }

  load(eraId) {
    const era = this.eras[eraId];
    if (!era) return null;

    // Remove previous scene group
    if (this._sceneGroup) {
      this.scene.remove(this._sceneGroup);
      this._disposeGroup(this._sceneGroup);
      this._sceneGroup = null;
    }

    this.current = era;
    this.pathfinding = new PathfindingSystem(era.waypoints, era.edges);
    this._sceneGroup = era.buildScene(this.scene);

    return era;
  }

  _disposeGroup(group) {
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  get homeWaypoints() {
    if (!this.current) return [];
    const { homePrefix, homeCount } = this.current;
    const result = [];
    for (let i = 1; i <= homeCount; i++) {
      const key = homePrefix + i;
      if (this.current.waypoints[key]) result.push(key);
    }
    return result;
  }

  get socialWaypoints() { return this.current?.socialWaypoints || []; }
  get gatherWaypoint()  { return this.current?.gatherWaypoint  || Object.keys(this.current?.waypoints || {})[0]; }
}
