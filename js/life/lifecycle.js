// Life years per real second at speed=60.  At 600x → 0.05 ly/s → ~20s per year.
const LIFE_YEAR_RATE = 0.003;

const STAGE_SCALES = { infant: 0.28, child: 0.52, teen: 0.76, adult: 1.0, elder: 0.90 };

const MALE_NAMES   = ['Cain','Seth','Enos','Kenan','Jared','Enoch','Bar','Kael','Dun','Elm',
                       'Farr','Gorm','Hael','Iren','Jorl','Kyth','Lorn','Mael','Nyr','Oswin'];
const FEMALE_NAMES = ['Lilith','Naama','Asha','Bera','Cyra','Deva','Elva','Fira','Gala','Hira',
                       'Iona','Jera','Kira','Lyra','Mara','Nara','Ora','Pyra','Rena','Sela'];
let _nameRng = 2; // 0=Adam,1=Eve used up

export function genesisName(gender) {
  const pool = gender === 'male' ? MALE_NAMES : FEMALE_NAMES;
  return pool[_nameRng++ % pool.length];
}

export class LifecycleSystem {
  tick(dt, gameSpeed, inhabitants, onBirth, onDeath) {
    const lyDt = dt * LIFE_YEAR_RATE * (gameSpeed / 60);

    for (const inh of inhabitants.slice()) {
      if (!inh.dna) continue;

      inh.age += lyDt;

      const newStage = _getStage(inh.age, inh._deathAge);
      if (newStage !== inh.lifeStage) {
        inh.lifeStage = newStage;
        _applyScale(inh);
        if (newStage === 'dead') { onDeath(inh); continue; }
      }

      if (inh.lifeStage === 'dead') continue;

      // Biome adaptation
      if (inh._biomePressure) inh.dna.adaptTo(inh._biomePressure);

      // Survival penalty from harsh biome
      if (inh._biomePressure) {
        const penalty = inh.dna.survivalPenalty(inh._biomePressure);
        if (penalty > 0) inh.mood = Math.max(0, inh.mood - penalty);
      }

      // Courtship (only adults who are alone)
      if (inh.lifeStage === 'adult' && !inh.spouse && inh.mood > 0.35) {
        inh._courtshipCooldown = Math.max(0, (inh._courtshipCooldown || 0) - lyDt);
        if (inh._courtshipCooldown <= 0) {
          const partner = _findPartner(inh, inhabitants);
          if (partner) {
            _marry(inh, partner);
            const [f, m] = inh.gender === 'female' ? [inh, partner] : [partner, inh];
            if (!f.isPregnant && f.dna.fertility > 0.25) {
              f.isPregnant   = true;
              f.pregnancyTimer = 0.6 + Math.random() * 0.3;
              f._pregnancyPartner = m;
            }
          } else {
            inh._courtshipCooldown = 0.8;
          }
        }
      }

      // Remarriage after spouse death
      if (inh.lifeStage === 'adult' && inh.spouse?.lifeStage === 'dead') {
        inh.spouse = null;
        inh._courtshipCooldown = 2;
      }

      // Pregnancy
      if (inh.isPregnant) {
        inh.pregnancyTimer -= lyDt;
        if (inh.pregnancyTimer <= 0) {
          inh.isPregnant = false;
          inh.pregnancyTimer = 0;
          // Spacing: can get pregnant again after ~2 life years
          inh._courtshipCooldown = 2;
          onBirth(inh, inh._pregnancyPartner || null);
        }
      }
    }
  }
}

function _getStage(age, deathAge) {
  if (age >= deathAge) return 'dead';
  if (age < 2)  return 'infant';
  if (age < 13) return 'child';
  if (age < 18) return 'teen';
  if (age < 65) return 'adult';
  return 'elder';
}

function _applyScale(inh) {
  const s = STAGE_SCALES[inh.lifeStage] ?? 1.0;
  inh.body.scale.setScalar(s * (inh.dna?.height ?? 1.0));
}

function _findPartner(inh, inhabitants) {
  for (const o of inhabitants) {
    if (o === inh || o.lifeStage !== 'adult' || o.spouse || o.isPregnant || !o.dna) continue;
    if (o.gender === inh.gender) continue;
    const dx = o.pos.x - inh.pos.x, dz = o.pos.z - inh.pos.z;
    if (dx * dx + dz * dz < 144) return o; // within 12 units
  }
  return null;
}

function _marry(a, b) {
  a.spouse = b; b.spouse = a;
  a.mood = Math.min(1, a.mood + 0.25);
  b.mood = Math.min(1, b.mood + 0.25);
  a._courtshipCooldown = 999;
  b._courtshipCooldown = 999;
}

