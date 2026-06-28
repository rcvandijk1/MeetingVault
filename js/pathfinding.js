// Waypoint graph for village navigation
export const WAYPOINTS = {
  market:       { x:   0, z:   0 },
  well:         { x:  -4, z:  -4 },
  smithy:       { x:  18, z:  -5 },
  bakery:       { x: -18, z:  -5 },
  tavern:       { x:   2, z:  16 },
  fields_near:  { x:   0, z: -28 },
  fields:       { x:   0, z: -40 },
  forest_edge:  { x:  30, z: -20 },
  forest:       { x:  38, z: -30 },
  dock:         { x: -10, z:  36 },
  pond:         { x: -15, z:  42 },
  pasture:      { x:  28, z:  20 },
  healers_hut:  { x: -26, z:  10 },
  pottery:      { x:  26, z:   6 },
  weavery:      { x: -22, z: -18 },
  home_1:       { x: -12, z:   8 },
  home_2:       { x:  12, z:   8 },
  home_3:       { x: -14, z:  22 },
  home_4:       { x:  14, z:  22 },
  home_5:       { x:  -6, z:  28 },
  home_6:       { x:   8, z:  28 },
  home_7:       { x: -24, z:   0 },
  home_8:       { x:  24, z:  -2 },
  home_9:       { x:  -4, z: -16 },
  home_10:      { x:   6, z: -16 },
  home_11:      { x: -30, z:  22 },
  home_12:      { x:  32, z:  10 },
};

// Adjacency list (connected waypoints)
export const EDGES = [
  ['market','well'],['market','smithy'],['market','bakery'],['market','tavern'],
  ['market','fields_near'],['market','pottery'],['market','home_2'],['market','home_1'],
  ['well','healers_hut'],['well','home_1'],['well','home_9'],['well','home_10'],
  ['smithy','pottery'],['smithy','forest_edge'],['smithy','home_8'],
  ['bakery','weavery'],['bakery','healers_hut'],['bakery','home_7'],
  ['tavern','home_3'],['tavern','home_4'],['tavern','home_5'],['tavern','home_6'],
  ['tavern','dock'],
  ['fields_near','fields'],['fields_near','home_9'],['fields_near','home_10'],
  ['fields_near','weavery'],
  ['forest_edge','forest'],['forest_edge','pasture'],
  ['pasture','home_12'],['pasture','dock'],
  ['dock','pond'],['dock','home_5'],['dock','home_6'],
  ['healers_hut','home_7'],['healers_hut','home_11'],
  ['weavery','home_7'],['weavery','home_9'],
  ['pottery','home_8'],['pottery','home_2'],
  ['home_3','home_11'],['home_11','home_7'],
  ['home_12','home_8'],['home_4','home_12'],
];

// Build adjacency map
const graph = {};
for (const [a, b] of EDGES) {
  (graph[a] = graph[a] || []).push(b);
  (graph[b] = graph[b] || []).push(a);
}
export { graph };

function dist(a, b) {
  const wa = WAYPOINTS[a], wb = WAYPOINTS[b];
  const dx = wa.x - wb.x, dz = wa.z - wb.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function findPath(from, to) {
  if (from === to) return [from];
  const open = new Set([from]);
  const cameFrom = {};
  const g = { [from]: 0 };
  const f = { [from]: dist(from, to) };

  while (open.size > 0) {
    let cur = [...open].reduce((a, b) => (f[a] || Infinity) < (f[b] || Infinity) ? a : b);
    if (cur === to) {
      const path = [cur];
      while (cameFrom[cur]) { cur = cameFrom[cur]; path.unshift(cur); }
      return path;
    }
    open.delete(cur);
    for (const nb of (graph[cur] || [])) {
      const tg = (g[cur] || 0) + dist(cur, nb);
      if (tg < (g[nb] || Infinity)) {
        cameFrom[nb] = cur;
        g[nb] = tg;
        f[nb] = tg + dist(nb, to);
        open.add(nb);
      }
    }
  }
  return [from]; // no path found, stay put
}

export function waypointPos(name) {
  return WAYPOINTS[name] || WAYPOINTS.market;
}

export function nearestWaypoint(x, z) {
  let best = null, bestD = Infinity;
  for (const [k, v] of Object.entries(WAYPOINTS)) {
    const d = (v.x - x) ** 2 + (v.z - z) ** 2;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}
