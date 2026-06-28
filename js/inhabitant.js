import * as THREE from 'three';

const ERA_NAMES = [
  'Aldric','Bessa','Coran','Dwyn','Edda','Feren','Gala','Hadwin',
  'Idris','Jenna','Kael','Lyra','Maren','Noel','Oswin','Petra',
  'Quinn','Rona','Sela','Thorn','Uma','Vega','Wren','Xyra','Yara','Zale',
  'Bryn','Cael','Dara','Elva','Finn','Gwen','Holt','Iris','Jax','Kira',
];
let _nameIdx = 0;

export class Inhabitant {
  constructor(career, home, scene, barter, pathfinding, opts = {}) {
    // Genesis-provided name overrides pool
    this.name = opts.name || ERA_NAMES[_nameIdx++ % ERA_NAMES.length];
    this.career = career;
    this.scene = scene;
    this.barter = barter;
    this.pathfinding = pathfinding; // null in genesis mode

    this.inventory = {};
    this.mood = 0.7 + Math.random() * 0.3;
    this.state = 'sleeping';
    this._override = null;
    this.isPlagued   = false;
    this.isOnStrike  = false;
    this.isExploring = false;
    this.socialTarget = null;
    this.fleeTarget   = null;

    this._path = []; this._pathTarget = null; this._waypointIdx = 0;
    this._stateTimer = 0; this._barterCooldown = 0;
    this._produceTimer = 0; this._animTimer = 0;
    this._hungerTimer = 0;

    // ── Genesis lifecycle props ──────────────────────────────────────────────
    this.dna         = opts.dna   ?? null;
    this.age         = opts.age   ?? 25;
    this.lifeStage   = opts.lifeStage ?? 'adult';
    this.gender      = opts.gender ?? (Math.random() < 0.5 ? 'male' : 'female');
    this.generation  = opts.generation ?? 0;
    this.spouse      = null;
    this.isPregnant  = false;
    this.pregnancyTimer = 0;
    this._deathAge   = opts.deathAge ?? (68 + Math.random() * 22);
    this._courtshipCooldown = 0;
    this._biomePressure = null;
    this.parents     = opts.parents ?? null;

    // ── Position ─────────────────────────────────────────────────────────────
    this._genesisMode = !pathfinding;
    if (this._genesisMode) {
      this.homePos = typeof home === 'object' ? home : { x: 0, z: 0 };
      this.home    = null;
      this.pos     = { x: this.homePos.x + (Math.random()-0.5)*4, z: this.homePos.z + (Math.random()-0.5)*4 };
      this._targetPos = null;
    } else {
      this.home    = home;
      this.homePos = null;
      const hp     = pathfinding.waypointPos(home);
      this.pos     = { x: hp.x + (Math.random()-0.5)*2, z: hp.z + (Math.random()-0.5)*2 };
    }

    this.body = this._buildPixelBody();
    this.body.position.set(this.pos.x, 0, this.pos.z);
    scene.add(this.body);

    // Apply stage scale for non-adult genesis starters
    if (this.dna) {
      const ss = { infant:0.28, child:0.52, teen:0.76, adult:1.0, elder:0.90 };
      this.body.scale.setScalar((ss[this.lifeStage] ?? 1.0) * this.dna.height);
    }

    const { produces } = career;
    if (produces) {
      for (const [g, amt] of Object.entries(produces)) this.inventory[g] = Math.floor(amt * 1.5);
    }
  }

  // ── Body builder ─────────────────────────────────────────────────────────
  _buildPixelBody() {
    const app = this._resolveAppearance();
    const g   = new THREE.Group();
    const m   = (hex) => new THREE.MeshLambertMaterial({ color: hex });

    this._leftLeg  = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.45,0.22), m(app.bottomColor||0x333333));
    this._rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.45,0.22), m(app.bottomColor||0x333333));
    this._leftLeg.position.set(-0.12,0.22,0);
    this._rightLeg.position.set(0.12,0.22,0);
    g.add(this._leftLeg, this._rightLeg);

    this._torso = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.55,0.3), m(app.topColor));
    this._torso.position.set(0,0.72,0);
    g.add(this._torso);

    const armGeo = new THREE.BoxGeometry(0.18,0.45,0.18);
    this._leftArm  = new THREE.Mesh(armGeo, m(app.topColor));
    this._rightArm = new THREE.Mesh(armGeo, m(app.topColor));
    this._leftArm.position.set(-0.34,0.68,0);
    this._rightArm.position.set(0.34,0.68,0);
    g.add(this._leftArm, this._rightArm);

    this._head = new THREE.Mesh(new THREE.BoxGeometry(0.44,0.44,0.44), m(app.skinColor));
    this._head.position.set(0,1.2,0);
    g.add(this._head);

    const eyeM = m(0x111111), eyeG = new THREE.BoxGeometry(0.08,0.08,0.05);
    for (const ex of [-0.1,0.1]) {
      const eye = new THREE.Mesh(eyeG, eyeM);
      eye.position.set(ex,1.22,0.22);
      g.add(eye);
    }

    if (app.hat) {
      const { w=0.5, h=0.22, d=0.5, color, brim } = app.hat;
      const hat = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m(color));
      hat.position.set(0, 1.42+h/2, 0);
      g.add(hat);
      if (brim) {
        const brimM = new THREE.Mesh(new THREE.BoxGeometry(brim.w||w+0.3, 0.06, brim.d||d+0.3), m(color));
        brimM.position.set(0, 1.42, 0);
        g.add(brimM);
      }
    }

    for (const acc of (app.accessories||[])) {
      let geo = acc.geo === 'cylinder'
        ? new THREE.CylinderGeometry(acc.size[0],acc.size[1],acc.size[2],6)
        : new THREE.BoxGeometry(...acc.size);
      const mesh = new THREE.Mesh(geo, m(acc.color));
      mesh.position.set(...acc.pos);
      if (acc.rot) mesh.rotation.set(...acc.rot);
      g.add(mesh);
    }

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.35,8),
      new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:0.2,depthWrite:false})
    );
    shadow.rotation.x = -Math.PI/2;
    shadow.position.y = 0.01;
    g.add(shadow);

    g.castShadow = true;
    return g;
  }

  _resolveAppearance() {
    if (this.career.appearance) {
      const a = { ...this.career.appearance };
      if (this.dna) a.skinColor = this.dna.skinHex; // DNA overrides skin
      return a;
    }
    return {
      skinColor:   this.dna ? this.dna.skinHex : (this.career.skinColor || 0xf4c88a),
      topColor:    this.career.tunicColor || 0x888888,
      bottomColor: this.career.pantsColor || 0x333333,
      hat:         this.career.hatColor != null ? { w:0.5,h:0.22,d:0.5,color:this.career.hatColor } : null,
      accessories: [],
    };
  }

  // ── State machine ─────────────────────────────────────────────────────────
  setState(s)      { if (!this._override && this.state!==s) { this.state=s; this._stateTimer=0; } }
  setOverride(s)   { this._override=s; this.state=s; this._stateTimer=0; }
  clearOverride()  { this._override=null; this._path=[]; this._pathTarget=null; this.fleeTarget=null; }

  // ── Main update ───────────────────────────────────────────────────────────
  update(dt, timeSystem, weatherSystem, inhabitants, socialWPs) {
    this._stateTimer += dt;
    this._animTimer  += dt;

    if (this._genesisMode) {
      this._updateGenesis(dt, timeSystem, weatherSystem, inhabitants);
      return;
    }

    // ── Era-mode (waypoint-based) ──────────────────────────────────────────
    const weatherMult = weatherSystem?.speedMultiplier ?? 1.0;
    const speed = (this.isPlagued ? 0.4 : 1.0) * weatherMult;
    this._barterCooldown = Math.max(0, this._barterCooldown - dt);
    this._produceTimer += dt;

    if (this.state==='working' && this._produceTimer>20) {
      this._produceTimer=0;
      for (const [g, rate] of Object.entries(this.career.produces||{})) {
        if ((this.inventory[g]||0)<12) this.inventory[g]=(this.inventory[g]||0)+1;
      }
    }

    if (this._override) { this._handleOverride(dt,speed); this._animate(); return; }
    if (this.isOnStrike) { this._handleStrike(dt,speed,socialWPs); this._animate(); return; }

    const h=timeSystem.hour, ws=this.career.workStart??7, we=this.career.workEnd??17;
    if (h>=23||h<6)             this._doSleep(dt,speed);
    else if (h>=6&&h<7)         this._doWakeUp();
    else if (h>=ws&&h<Math.min(ws+3,12)) this._doWork(dt,speed);
    else if (h>=12&&h<13)       this._doEat(dt,speed);
    else if (h>=13&&h<we)       {
      if (this._stateTimer>90&&Math.random()<0.25&&this._barterCooldown<=0) this._doBarter(dt,speed,inhabitants);
      else this._doWork(dt,speed);
    }
    else if (h>=we&&h<21)       this._doSocialize(dt,speed,socialWPs);
    else                        this._doReturnHome(dt,speed);

    if (weatherSystem?.shouldSeekShelter&&Math.random()<0.0005) {
      this._schedulePath(this.home); this.setState('seeking_shelter');
    }
    this._animate();
  }

  // ── Genesis mode movement ─────────────────────────────────────────────────
  _updateGenesis(dt, timeSystem, weatherSystem, inhabitants) {
    if (this.lifeStage==='dead') return;
    if (this.lifeStage==='infant') { this.setState('sleeping'); this._animate(); return; }

    const speed = 1.0 + (this.dna?.speed ?? 0.5) * 1.2;
    this._barterCooldown = Math.max(0, this._barterCooldown-dt);
    this._produceTimer += dt;
    this._hungerTimer  += dt;

    if (this._override) { this._handleOverride(dt,speed); this._animate(); return; }

    const h = timeSystem?.hour ?? 12;
    if (h>=22||h<5) {
      this._genesisSleep(dt,speed);
    } else if (this.mood<0.25 && this._barterCooldown<=0) {
      // Try to barter/get food from nearby inhabitant
      this._genesisSeekFood(dt,speed,inhabitants);
    } else {
      this._genesisWander(dt,speed,inhabitants,h);
    }

    // Produce while working outdoors
    if (this.state==='working' && this._produceTimer>25) {
      this._produceTimer=0;
      for (const [g, rate] of Object.entries(this.career.produces||{})) {
        if ((this.inventory[g]||0)<8) this.inventory[g]=(this.inventory[g]||0)+1;
      }
    }

    // Update biome pressure for adaptation
    this._animate();
  }

  _genesisSleep(dt, speed) {
    this.setState('sleeping');
    this._genesisMoveToward(this.homePos, dt, speed*0.6);
    if (this._genesisDist(this.homePos)<1.5) {
      this.body.position.y = -0.85;
      this.mood = Math.min(1, this.mood+dt*0.012);
    }
  }

  _genesisWander(dt, speed, inhabitants, hour) {
    // Reset wander target when reached or stale
    if (!this._targetPos || this._genesisDist(this._targetPos)<2 || this._stateTimer>45) {
      const isElder = this.lifeStage==='elder';
      const radius  = isElder ? 8 : this.lifeStage==='child' ? 10 : 22;
      const angle   = Math.random()*Math.PI*2;
      const dist    = 3 + Math.random()*radius;
      this._targetPos = {
        x: this.homePos.x + Math.cos(angle)*dist,
        z: this.homePos.z + Math.sin(angle)*dist,
      };
      this._stateTimer = 0;

      // Decide activity
      const r = Math.random();
      if (r<0.30)      this.setState('working');
      else if (r<0.45) { this.setState('eating'); this._barterCooldown=12; }
      else if (r<0.65) this.setState('socializing');
      else             this.setState('working');
    }
    this._genesisMoveToward(this._targetPos, dt, speed*(this.state==='socializing'?1.8:2.4));

    // Consume goods while eating
    if (this.state==='eating' && this._stateTimer>15) {
      this.barter.consume(this);
      this.mood = Math.min(1, this.mood+0.04);
      this._hungerTimer = 0;
      this._stateTimer = 0;
    }

    // Random barter with a nearby peer
    if (this.state==='socializing' && this._stateTimer>18 && this._barterCooldown<=0) {
      const near = inhabitants.filter(o=>o!==this&&!['sleeping','dead'].includes(o.lifeStage)&&
        Math.abs(o.pos.x-this.pos.x)<14&&Math.abs(o.pos.z-this.pos.z)<14);
      for (const o of near) {
        if (this.barter.canTrade(this,o)) { this.barter.trade(this,o); this._barterCooldown=20; break; }
      }
      this._stateTimer=0;
    }
  }

  _genesisSeekFood(dt, speed, inhabitants) {
    this.setState('bartering');
    const near = inhabitants.filter(o=>o!==this&&o.lifeStage!=='infant'&&
      Object.values(o.inventory||{}).some(v=>v>0)&&
      Math.abs(o.pos.x-this.pos.x)<30&&Math.abs(o.pos.z-this.pos.z)<30);
    if (near.length>0) {
      const target = near[0];
      this._genesisMoveToward(target.pos, dt, speed*2.8);
      if (this._genesisDist(target.pos)<4) {
        if (this.barter.canTrade(this,target)) { this.barter.trade(this,target); this._barterCooldown=25; }
        this._stateTimer=0;
      }
    } else {
      // No food nearby — desperation wander
      this._genesisWander(dt, speed, inhabitants, 12);
    }
  }

  _genesisMoveToward(target, dt, speed) {
    if (!target) return;
    const dx=target.x-this.pos.x, dz=target.z-this.pos.z;
    const d=Math.sqrt(dx*dx+dz*dz);
    if (d<0.4) return;
    const s=Math.min(speed*dt, d);
    this.pos.x+=dx/d*s; this.pos.z+=dz/d*s;
    this.body.rotation.y = Math.atan2(dx,dz);
    this.body.position.set(this.pos.x, this.body.position.y, this.pos.z);
  }

  _genesisDist(pos) {
    if (!pos) return Infinity;
    return Math.sqrt((pos.x-this.pos.x)**2+(pos.z-this.pos.z)**2);
  }

  // ── Era-mode helper methods ───────────────────────────────────────────────
  _workplaceWP() {
    const wp=this.career.workplace;
    return this.pathfinding.waypoints[wp] ? wp : this.pathfinding.randomWaypoint();
  }

  _schedulePath(targetWP) {
    if (this._pathTarget===targetWP&&this._path.length>this._waypointIdx) return;
    const cur=this.pathfinding.nearestWaypoint(this.pos.x,this.pos.z);
    this._path=this.pathfinding.findPath(cur,targetWP);
    this._pathTarget=targetWP; this._waypointIdx=0;
  }

  _atTarget(wp) {
    const t=this.pathfinding.waypointPos(wp);
    return (t.x-this.pos.x)**2+(t.z-this.pos.z)**2<4;
  }

  _doSleep(dt,speed) {
    this.setState('sleeping');
    this._walkAlongPath(dt,speed*0.5);
    if (this._atTarget(this.home)) this.body.position.y=-0.8;
    this.mood=Math.min(1,this.mood+dt*0.008);
    if (!this._pathTarget) this._schedulePath(this.home);
  }

  _doWakeUp() {
    this.body.position.y=0; this.setState('waking');
    this._path=[]; this._pathTarget=null;
  }

  _doWork(dt,speed) {
    this.setState('working');
    this._schedulePath(this._workplaceWP());
    this._walkAlongPath(dt,speed);
  }

  _doEat(dt,speed) {
    this.setState('eating');
    const dest=Math.random()<0.6?this.home:(this.pathfinding.waypoints['tavern']?'tavern':this.home);
    this._schedulePath(dest);
    this._walkAlongPath(dt,speed*0.8);
    if (this._stateTimer>35&&this._atTarget(dest)) { this.barter.consume(this); this._stateTimer=0; }
  }

  _doBarter(dt,speed,inhabitants) {
    this.setState('bartering');
    const mkt=this.pathfinding.waypoints['market']?'market':this.pathfinding.randomWaypoint();
    this._schedulePath(mkt); this._walkAlongPath(dt,speed);
    if (this._atTarget(mkt)&&this._barterCooldown<=0) {
      const near=inhabitants.filter(i=>i!==this&&i.state!=='sleeping'&&
        Math.abs(i.pos.x-this.pos.x)<18&&Math.abs(i.pos.z-this.pos.z)<18);
      for (const o of near) {
        if (this.barter.canTrade(this,o)) { this.barter.trade(this,o); this._barterCooldown=18; this._stateTimer=0; break; }
      }
      if (this._stateTimer>50) { this._pathTarget=null; this._stateTimer=0; }
    }
  }

  _doSocialize(dt,speed,socialWPs) {
    this.setState('socializing');
    if (!this._pathTarget||this._atTarget(this._pathTarget)) {
      const spots=socialWPs?.length?socialWPs:['market'];
      this._schedulePath(spots[Math.floor(Math.random()*spots.length)]);
    }
    this._walkAlongPath(dt,speed*0.7);
    if (this._atTarget(this._pathTarget)&&this._stateTimer>28) { this._pathTarget=null; this._stateTimer=0; }
  }

  _doReturnHome(dt,speed) {
    this.setState('returning_home');
    this._schedulePath(this.home); this._walkAlongPath(dt,speed*0.8);
  }

  _handleStrike(dt,speed,socialWPs) {
    this.state='striking';
    const mkt=this.pathfinding.waypoints['market']?'market':
      (this.pathfinding.waypoints['city_center']?'city_center':Object.keys(this.pathfinding.waypoints)[0]);
    this._schedulePath(mkt); this._walkAlongPath(dt,speed*0.8);
    if (this._atTarget(mkt)&&this._stateTimer>15) { this._pathTarget=null; this._stateTimer=0; }
  }

  _handleOverride(dt,speed) {
    switch (this._override) {
      case 'fleeing':
        if (this.fleeTarget) {
          const dx=this.fleeTarget.x-this.pos.x, dz=this.fleeTarget.z-this.pos.z;
          const dist=Math.sqrt(dx*dx+dz*dz);
          if (dist>1) {
            const s=Math.min(speed*4.5,dist)/dist;
            this.pos.x+=dx*s*dt; this.pos.z+=dz*s*dt;
            this.body.rotation.y=Math.atan2(dx,dz);
          }
        }
        break;
      case 'cowering':
        this.body.rotation.z=Math.sin(this._animTimer*18)*0.12;
        break;
      case 'celebrating':
        if (this.socialTarget) {
          if (this._genesisMode) {
            this._genesisMoveToward(this.socialTarget, dt, speed*2.2);
          } else if (this.pathfinding) {
            const key=Object.keys(this.pathfinding.waypoints).find(k=>this.pathfinding.waypoints[k]===this.socialTarget)||'market';
            this._walkToward(key,dt,speed*0.85);
          }
        }
        this.body.position.y=0.1*Math.abs(Math.sin(this._animTimer*4));
        break;
      case 'bartering': case 'meeting': case 'socializing': case 'marching':
        if (this.socialTarget) {
          if (this._genesisMode) {
            this._genesisMoveToward(this.socialTarget, dt, speed*2.0);
          } else if (this.pathfinding) {
            const key=Object.keys(this.pathfinding.waypoints).find(k=>this.pathfinding.waypoints[k]===this.socialTarget)||'market';
            this._walkToward(key,dt,speed*0.85);
          }
        }
        break;
    }
    this.body.position.set(this.pos.x, this.body.position.y, this.pos.z);
  }

  _walkToward(wp,dt,speed) {
    const t=this.pathfinding.waypointPos(wp);
    if (!t) return;
    const dx=t.x-this.pos.x, dz=t.z-this.pos.z, d=Math.sqrt(dx*dx+dz*dz);
    if (d<0.5) return;
    const s=Math.min(speed*2.5*dt,d);
    this.pos.x+=dx/d*s; this.pos.z+=dz/d*s;
    this.body.rotation.y=Math.atan2(dx,dz);
    this.body.position.set(this.pos.x,this.body.position.y,this.pos.z);
  }

  _walkAlongPath(dt,speed) {
    if (!this._path||this._waypointIdx>=this._path.length) return;
    const wp=this._path[this._waypointIdx];
    const t=this.pathfinding.waypointPos(wp);
    if (!t) { this._waypointIdx++; return; }
    const dx=t.x-this.pos.x, dz=t.z-this.pos.z, d=Math.sqrt(dx*dx+dz*dz);
    if (d<0.8) { this._waypointIdx++; return; }
    const s=Math.min(speed*2.5*dt,d);
    this.pos.x+=dx/d*s; this.pos.z+=dz/d*s;
    this.body.rotation.y=Math.atan2(dx,dz);
    this.body.position.set(this.pos.x,this.body.position.y,this.pos.z);
  }

  _animate() {
    if (['sleeping','cowering'].includes(this.state)||this._override==='cowering') return;
    const t=this._animTimer;
    const ss=this.state==='working'?6:4;
    const sa=this.state==='working'?0.5:0.35;
    if (this.state!=='sleeping') this.body.position.y=Math.max(0,this.body.position.y)+0.04*Math.abs(Math.sin(t*ss))-0.02;
    this._leftLeg.rotation.x  =  sa*Math.sin(t*ss);
    this._rightLeg.rotation.x = -sa*Math.sin(t*ss);
    this._leftArm.rotation.x  = -sa*Math.sin(t*ss);
    this._rightArm.rotation.x =  sa*Math.sin(t*ss);
    if (this.state==='working') this._head.rotation.x=-0.15*Math.abs(Math.sin(t*ss));
  }

  get stateLabel() {
    return {sleeping:'💤',working:'⚒️',eating:'🍽️',bartering:'🤝',socializing:'💬',
      returning_home:'🏠',seeking_shelter:'🏠',waking:'☀️',celebrating:'🎉',
      fleeing:'😱',cowering:'😨',meeting:'📣',striking:'✊',marching:'📢',
      infant:'👶',child:'🧒',teen:'🧑'}[this.lifeStage==='infant'?'infant':
      this.lifeStage==='child'?'child':this.lifeStage==='teen'?'teen':this.state]||'❓';
  }

  get moodColor() {
    return `rgb(${Math.floor((1-this.mood)*255)},${Math.floor(this.mood*200)},50)`;
  }

  dispose() { this.scene.remove(this.body); }
}

export function resetNameIndex() { _nameIdx=0; }
