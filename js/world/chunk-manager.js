import { getBiome } from './biomes.js';

export const CHUNK_SIZE = 80;

export class ChunkManager {
  constructor(scene) {
    this.scene    = scene;
    this._chunks  = new Map(); // key "cx,cz" → { group, biome, cx, cz }
    this._bounds  = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }

  get discoveredCount() { return this._chunks.size; }

  chunkCoords(wx, wz) {
    return [Math.round(wx / CHUNK_SIZE), Math.round(wz / CHUNK_SIZE)];
  }

  chunkCenter(cx, cz) {
    return { x: cx * CHUNK_SIZE, z: cz * CHUNK_SIZE };
  }

  discover(cx, cz) {
    const key = `${cx},${cz}`;
    if (this._chunks.has(key)) return this._chunks.get(key);

    const biome = getBiome(cx, cz);
    const group = biome.buildTerrain(cx, cz, CHUNK_SIZE);
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.scene.add(group);

    const chunk = { group, biome, cx, cz };
    this._chunks.set(key, chunk);

    this._bounds.minX = Math.min(this._bounds.minX, cx);
    this._bounds.maxX = Math.max(this._bounds.maxX, cx);
    this._bounds.minZ = Math.min(this._bounds.minZ, cz);
    this._bounds.maxZ = Math.max(this._bounds.maxZ, cz);

    return chunk;
  }

  biomeAt(wx, wz) {
    const [cx, cz] = this.chunkCoords(wx, wz);
    return this._chunks.get(`${cx},${cz}`)?.biome ?? null;
  }

  // Discover current chunk + adjacent ones when an inhabitant moves near edge
  updateForPosition(wx, wz) {
    const [cx, cz] = this.chunkCoords(wx, wz);
    this.discover(cx, cz);
    const half = CHUNK_SIZE / 2;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    if (Math.abs(lx) > half * 0.7) this.discover(cx + Math.sign(lx), cz);
    if (Math.abs(lz) > half * 0.7) this.discover(cx, cz + Math.sign(lz));
  }

  disposeAll() {
    for (const { group } of this._chunks.values()) {
      this.scene.remove(group);
      group.traverse(obj => {
        obj.geometry?.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    }
    this._chunks.clear();
  }
}
