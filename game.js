/**
 * RAGDOLL ARCHERS — Tower Defense Horde Edition
 * 1-Player: Defend your tower against waves of enemy archers
 * 2-Player: Classic 1v1 local battle
 */

'use strict';

// ============================================================
// GAME STATE
// ============================================================

const STATE = {
  mode: '1player',
  round: 1,
  maxRounds: 5,
  p1Score: 0,
  p2Score: 0,
  coins: 0,
  paused: false,
  running: false,
  roundOver: false,
  intermission: false,   // between waves (wave cleared, shop open)
  shopOpen: false,
  difficulty: 'normal',
  sfx: true,
  music: true,
  particles: true,
  // Horde mode
  wave: 1,
  kills: 0,
  totalKills: 0,
  score: 0,
  combo: 0,
  comboTimer: 0,
  bestCombo: 0,
  bestWave: 0,
  towerHp: 400,
  towerMax: 400,
  damageTaken: 0,
  deathCause: '',
  runId: 0,
};

// Screen-space effects
let shake = 0;
let hurtFlash = 0;
let waveBanner = null;

const UPGRADES = {
  p1: { armor:0, health:0, stamina:0, staminarefresh:0, pullspeed:0, damage:0, arrowslots:0 },
};

const UPGRADE_COSTS = {
  armor:         [10,20,35,55,80,110,150],
  health:        [10,20,35,55,80,110,150],
  stamina:       [10,20,35,55,80,110,150],
  staminarefresh:[10,20,35,55,80,110,150],
  pullspeed:     [10,20,35,55,80,110,150],
  damage:        [10,20,35,55,80,110,150],
  arrowslots:    [50,100,180,300,500],
};

const SPECIAL_ARROWS = [
  { id:'fire',     name:'FIRE',     emoji:'🔥', cost:40, desc:'Burns over time',  unlocked:false, selected:false },
  { id:'balloon',  name:'BALLOON',  emoji:'🎈', cost:50, desc:'Lifts target up',  unlocked:false, selected:false },
  { id:'shot',     name:'TRISHOT',  emoji:'✨', cost:60, desc:'Shoots 3 arrows',  unlocked:false, selected:false },
  { id:'minigun',  name:'MINIGUN',  emoji:'💣', cost:80, desc:'Rapid fire burst', unlocked:false, selected:false },
  { id:'shuriken', name:'SHURIKEN', emoji:'⭐', cost:70, desc:'Pierces armor',    unlocked:false, selected:false },
  { id:'hook',     name:'HOOK',     emoji:'🪝', cost:60, desc:'Grabs & pulls',    unlocked:false, selected:false },
  { id:'mace',     name:'MACE',     emoji:'🔨', cost:55, desc:'Heavy stun',       unlocked:false, selected:false },
  { id:'axe',      name:'AXE',      emoji:'🪓', cost:65, desc:'Causes bleeding',  unlocked:false, selected:false },
  { id:'telescop', name:'TELEPORT', emoji:'🔭', cost:90, desc:'Teleports target', unlocked:false, selected:false },
  { id:'electric', name:'ELECTRIC', emoji:'⚡', cost:75, desc:'Chain lightning',  unlocked:false, selected:false },
];

// ============================================================
// CANVAS & RESIZE
// ============================================================

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;

function resizeCanvas() {
  const screen = document.getElementById('game-screen');
  W = screen.offsetWidth;
  H = screen.offsetHeight - 40;
  canvas.width  = W;
  canvas.height = H;
}

window.addEventListener('resize', () => {
  resizeCanvas();
  buildPlatforms();
  if (STATE.running && players.length > 0) repositionPlayer();
});

// ============================================================
// PHYSICS
// ============================================================

const GRAVITY    = 0.55;
const FRICTION   = 0.88;
const BOUNCE     = 0.32;
const ARROW_GRAV = 0.28;

// Ballistic solver: returns the launch angle (radians) that makes an arrow
// fired at speed v from (sx,sy) land on (tx,ty). `err` is added to the angle.
function solveAim(sx, sy, tx, ty, v, err) {
  const dx = tx - sx, dy = ty - sy, adx = Math.abs(dx);
  const yAt = th => {
    const vx = Math.cos(th) * v;
    if (vx < 0.2) return 1e9;
    const n = adx / vx;
    return Math.sin(th) * v * n + ARROW_GRAV * n * (n + 1) / 2;
  };
  let best = -0.75, prev = yAt(0.9), pth = 0.9;
  for (let th = 0.88; th >= -1.45; th -= 0.02) {
    const y = yAt(th);
    if (prev > dy && y <= dy) { best = pth + (th - pth) * ((prev - dy) / (prev - y)); break; }
    prev = y; pth = th;
  }
  best += err || 0;
  return dx >= 0 ? best : Math.PI - best;
}

// ============================================================
// TOWER DATA
// ============================================================

let towerData = null; // { x, y, w, h } – visual stone tower rectangle

// ============================================================
// PLAYER CLASS
// ============================================================

class Player {
  constructor(x, y, color, facing, name) {
    this.name    = name;
    this.color   = color;
    this.facing  = facing;
    this.isDead  = false;

    this.maxHp      = 100;
    this.maxStamina = 100;
    this.hp         = this.maxHp;
    this.stamina    = this.maxStamina;
    this.armor      = 0;
    this.damage     = 25;
    this.pullSpeed  = 1.0;
    this.staminaRegen = 0.22;
    this.arrowSlots   = 1;
    this.selectedArrow = null;

    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.w = 22; this.h = 64;
    this.onGround = false;

    this.joints  = this._buildJoints();
    this.isAiming = false;
    this.aimAngle = facing === 1 ? -0.4 : Math.PI + 0.4;
    this.aimPower = 0;
    this.maxPower = 18;

    this.effects   = [];
    this.ragdoll   = false;
    this.ragJoints = null;
    this.walkCycle = 0;
    this.bowPull   = 0;
  }

  _buildJoints() {
    return {
      head:      { ox:0,   oy:-28 }, neck:      { ox:0,   oy:-20 },
      torso:     { ox:0,   oy:0   }, hips:      { ox:0,   oy:16  },
      shoulderL: { ox:-7,  oy:-14 }, shoulderR: { ox: 7,  oy:-14 },
      elbowL:    { ox:-14, oy:-6  }, elbowR:    { ox: 14, oy:-6  },
      handL:     { ox:-20, oy: 2  }, handR:     { ox: 20, oy: 2  },
      hipL:      { ox:-5,  oy: 16 }, hipR:      { ox: 5,  oy: 16 },
      kneeL:     { ox:-7,  oy: 34 }, kneeR:     { ox: 7,  oy: 34 },
      footL:     { ox:-8,  oy: 52 }, footR:     { ox: 8,  oy: 52 },
    };
  }

  applyUpgrades(upg) {
    this.maxHp        = 100 + upg.health * 20;
    this.hp           = Math.min(this.hp, this.maxHp);
    this.maxStamina   = 100 + upg.stamina * 15;
    this.stamina      = Math.min(this.stamina, this.maxStamina);
    this.armor        = upg.armor * 5;
    this.damage       = 25 + upg.damage * 6;
    this.pullSpeed    = 1.0 + upg.pullspeed * 0.25;
    this.staminaRegen = 0.22 + upg.staminarefresh * 0.08;
    this.arrowSlots   = 1 + upg.arrowslots;
  }

  jump() {
    if (!this.onGround || this.stamina < 5 || this.isDead) return;
    this.vy = -13.5;
    this.stamina -= 5;
    this.onGround = false;
    spawnParticles(this.x, this.y + this.h/2, '#60a5fa', 4);
    playSound('jump');
  }

  takeDamage(amount, srcX) {
    if (this.isDead) return 0;
    const blocked = Math.min(amount * 0.35, this.armor);
    const actual  = Math.max(1, Math.round(amount - blocked));
    this.hp = Math.max(0, this.hp - actual);
    const dir = this.x > srcX ? 1 : -1;
    this.vx += dir * 2.5;
    this.vy -= 2;
    showDamageText(this.x, this.y - 30, actual, this.color);
    if (this === players[0]) {
      shake = Math.max(shake, 7);
      hurtFlash = 1;
      STATE.damageTaken += actual;
    }
    playSound('hurt');
    if (this.hp <= 0) { STATE.deathCause = 'shot'; this.die(); }
    return actual;
  }

  die() {
    if (this.isDead) return;
    this.isDead  = true;
    this.ragdoll = true;
    this.ragJoints = JSON.parse(JSON.stringify(this.joints));
    for (const k in this.ragJoints) {
      this.ragJoints[k].vx = (Math.random()-0.5)*6;
      this.ragJoints[k].vy = (Math.random()-0.5)*6 - 3;
    }
    spawnParticles(this.x, this.y, this.color, 14);
    playSound('death');
    if (this === players[0]) shake = 12;
    // Only the horde mode ends on the player's death; duels are handled by end1v1Round()
    if (STATE.mode === '1player' && !STATE.roundOver) endHordeRound(false);
  }

  addEffect(type, duration, value) {
    this.effects.push({ type, duration, value, timer:0 });
  }

  update(dt) {
    if (this.isDead && this.ragdoll) { this._updateRagdoll(); return; }
    if (this.isDead) return;

    this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * dt);

    this.effects = this.effects.filter(e => {
      const prev = Math.floor(e.timer);
      e.timer += dt / 60;                       // timers are in seconds
      if (Math.floor(e.timer) > prev) {
        this.hp = Math.max(0, this.hp - e.value);
        const col = e.type === 'burn' ? '#f97316' : '#ef4444';
        const pfx = e.type === 'burn' ? '🔥' : '🩸';
        showDamageText(this.x, this.y-30, e.value, col, pfx);
        if (this.hp <= 0) { STATE.deathCause = 'burn'; this.die(); }
      }
      return e.timer < e.duration;
    });

    this.vy += GRAVITY * dt;
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.vx *= FRICTION;
    if (Math.abs(this.vx) > 0.5) this.walkCycle += 0.15 * dt;

    this.onGround = false;
    for (const p of platforms) {
      if (this.x + this.w/2 > p.x && this.x - this.w/2 < p.x + p.w) {
        if (this.y + this.h/2 >= p.y && this.y + this.h/2 - this.vy*dt <= p.y + 4) {
          this.y = p.y - this.h/2;
          if (this.vy > 0) { this.vy *= -BOUNCE; if (Math.abs(this.vy)<1) this.vy=0; }
          this.onGround = true;
        }
      }
    }
    if (this.x - this.w/2 < 0)  { this.x = this.w/2;    this.vx *= -0.5; }
    if (this.x + this.w/2 > W)  { this.x = W - this.w/2; this.vx *= -0.5; }
    if (this.y + this.h/2 > H + 60) this.die();

    this.bowPull = this.isAiming ? this.aimPower / this.maxPower : 0;
  }

  _updateRagdoll() {
    for (const k in this.ragJoints) {
      const j = this.ragJoints[k];
      j.vy = (j.vy||0) + GRAVITY*0.5;
      j.ox += (j.vx||0); j.oy += (j.vy||0);
      j.vx = (j.vx||0)*0.92; j.vy = (j.vy||0)*0.92;
      if (this.y + j.oy + this.h/2 > H-20) { j.vy*=-0.3; j.oy = H-20-this.y-this.h/2; }
    }
  }

  draw() {
    if (this.isDead && this.ragdoll) { this._drawRagdoll(); return; }
    if (this.isDead) return;
    this._drawStickFigure();
  }

  _drawStickFigure() {
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 3.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const f = this.facing;

    const headX = this.x, headY = this.y - 28;
    const neckX = this.x, neckY = this.y - 20;
    const hipsX = this.x, hipsY = this.y + 14;

    // Legs
    const kLX = hipsX + f*-7, kLY = hipsY + 18 + Math.sin(this.walkCycle)*5;
    const kRX = hipsX + f* 7, kRY = hipsY + 18 + Math.sin(this.walkCycle+Math.PI)*5;
    const fLX = kLX + Math.sin(this.walkCycle)*5,   fLY = this.y + this.h/2 - 2;
    const fRX = kRX + Math.sin(this.walkCycle+Math.PI)*5, fRY = fLY;

    ctx.beginPath(); ctx.moveTo(hipsX,hipsY); ctx.lineTo(kLX,kLY); ctx.lineTo(fLX,fLY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hipsX,hipsY); ctx.lineTo(kRX,kRY); ctx.lineTo(fRX,fRY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(neckX,neckY); ctx.lineTo(this.x,this.y+4); ctx.lineTo(hipsX,hipsY); ctx.stroke();

    // Bow arm
    const bowAngle = this.aimAngle;
    const bowDist  = 28 + this.bowPull*8;
    const elbBowX  = neckX + Math.cos(bowAngle)*14;
    const elbBowY  = neckY + Math.sin(bowAngle)*14;
    const handBowX = neckX + Math.cos(bowAngle)*bowDist;
    const handBowY = neckY + Math.sin(bowAngle)*bowDist;

    // Back arm
    const backAngle = bowAngle + Math.PI*0.6*f;
    const elbBkX = neckX + Math.cos(backAngle)*12, elbBkY = neckY + Math.sin(backAngle)*12;
    const hndBkX = neckX + Math.cos(backAngle)*20, hndBkY = neckY + Math.sin(backAngle)*20;
    ctx.beginPath(); ctx.moveTo(neckX,neckY); ctx.lineTo(elbBkX,elbBkY); ctx.lineTo(hndBkX,hndBkY); ctx.stroke();

    // Bow
    ctx.save();
    ctx.strokeStyle = '#f5c842'; ctx.lineWidth = 2.5;
    ctx.translate(handBowX,handBowY); ctx.rotate(bowAngle+Math.PI);
    ctx.beginPath(); ctx.arc(0,0,14,-Math.PI/2.5,Math.PI/2.5); ctx.stroke();
    ctx.strokeStyle='rgba(200,200,200,0.7)'; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(0,-14*Math.sin(Math.PI/2.5));
    ctx.lineTo(-this.bowPull*14,0);
    ctx.lineTo(0,14*Math.sin(Math.PI/2.5));
    ctx.stroke();
    ctx.restore();

    // Bow arm (front)
    ctx.strokeStyle = this.color; ctx.lineWidth=3.5;
    ctx.beginPath(); ctx.moveTo(neckX,neckY); ctx.lineTo(elbBowX,elbBowY); ctx.lineTo(handBowX,handBowY); ctx.stroke();

    // Head
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(headX,headY,9,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#0d0f1a';
    ctx.beginPath(); ctx.arc(headX+f*3,headY-2,2,0,Math.PI*2); ctx.fill();

    // Effect glow
    if (this.effects.find(e=>e.type==='burn')) {
      ctx.fillStyle='rgba(249,115,22,0.25)';
      ctx.beginPath(); ctx.arc(headX,headY,13,0,Math.PI*2); ctx.fill();
    }

    // Aim guide line
    if (this.isAiming) {
      const pw = this.aimPower/this.maxPower;
      ctx.save(); ctx.strokeStyle=`hsl(${120-pw*120},100%,55%)`;
      ctx.lineWidth=1.5; ctx.setLineDash([4,3]); ctx.globalAlpha=0.55;
      ctx.beginPath(); ctx.moveTo(handBowX,handBowY);
      ctx.lineTo(handBowX+Math.cos(this.aimAngle)*70*pw, handBowY+Math.sin(this.aimAngle)*70*pw);
      ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }

  _drawRagdoll() {
    ctx.save();
    ctx.strokeStyle=this.color; ctx.lineWidth=3; ctx.lineCap='round';
    const j = this.ragJoints;
    const gj = k => ({ x:this.x+j[k].ox, y:this.y+j[k].oy });
    const dl = (a,b)=>{ const pa=gj(a),pb=gj(b); ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke(); };
    dl('head','neck'); dl('neck','torso'); dl('torso','hips');
    dl('hips','hipL'); dl('hipL','kneeL'); dl('kneeL','footL');
    dl('hips','hipR'); dl('hipR','kneeR'); dl('kneeR','footR');
    dl('neck','shoulderL'); dl('shoulderL','elbowL'); dl('elbowL','handL');
    dl('neck','shoulderR'); dl('shoulderR','elbowR'); dl('elbowR','handR');
    const p=gj('head'); ctx.fillStyle=this.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,9,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

// ============================================================
// HORDE ENEMY CLASS
// ============================================================

const ENEMY_COLORS = ['#ff6b6b','#ff9f43','#ee5a24','#e84393','#9b59b6','#c0392b'];

// hp/dmg/speed are multipliers on the per-wave base values.
const ENEMY_TYPES = {
  grunt:  { hp:1,    dmg:1,   speed:1,    scale:1,    coin:1,   score:100,  ranged:true,  range:200 },
  runner: { hp:0.55, dmg:0.6, speed:2.8,  scale:0.9,  coin:1.2, score:150,  ranged:false, color:'#feca57' },
  tank:   { hp:2.6,  dmg:1.2, speed:0.6,  scale:1.35, coin:3,   score:350,  ranged:false, color:'#8395a7' },
  boss:   { hp:7,    dmg:1.2, speed:0.45, scale:1.8,  coin:25,  score:2500, ranged:true,  range:300, color:'#a855f7', triple:true },
};

class HordeEnemy {
  constructor(x, y, facing, waveNum, type) {
    type = type || 'grunt';
    const T = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;
    const diff = { easy:0.8, normal:1, hard:1.3 }[STATE.difficulty] || 1;
    this.type  = type;
    this.def   = T;
    this.scale = T.scale;
    this.x = x; this.y = y;
    this.facing = facing;
    this.color  = T.color || ENEMY_COLORS[Math.floor(Math.random()*ENEMY_COLORS.length)];

    // Scale with wave
    this.maxHp  = Math.round((40 + waveNum * 12) * T.hp * diff);
    this.hp     = this.maxHp;
    this.damage = Math.round((8 + waveNum * 2.5) * T.dmg * diff);
    this.speed  = (0.3 + Math.min(waveNum, 15) * 0.03) * T.speed;

    this.vx = 0; this.vy = 0;
    this.w  = 20 * T.scale; this.h = 60 * T.scale;
    this.onGround = false;
    this.isDead   = false;
    this.ragdoll  = false;
    this.ragJoints = null;

    this.melee    = !T.ranged;      // melee enemies rush the tower and smash it
    this.state    = 'walk';         // 'walk' | 'aim' | 'bash'
    this.atkTimer = 0;
    this.swing    = 0;
    this.stun     = 0;
    this.slowTimer = 0; this.slowMul = 1;
    this.hitFlash = 0;

    // Ranged AI (every time value is in SECONDS)
    this.shootTimer    = 1.5 + Math.random() * 2.5;
    this.shootCooldown = Math.max(2.4, 4.2 + Math.random()*2.2 - waveNum*0.08);
    this.aimTime       = Math.max(0.8, 1.5 + Math.random()*0.7 - waveNum*0.04);
    this.stopRange     = (T.range || 200) + Math.random()*70;
    this.aimSpread     = ({ easy:0.30, normal:0.20, hard:0.12 }[STATE.difficulty] || 0.2) * Math.max(0.5, 1 - waveNum*0.02);
    this.aimError      = 0;
    this.aimAngle      = 0;
    this.aimPower      = 0;
    this.maxPower      = 13 + Math.min(waveNum, 12) * 0.4;
    this.isAiming      = false;
    this.aimDuration   = 0;

    this.walkCycle = Math.random()*Math.PI*2;
    this.bowPull   = 0;
    this.effects   = [];
    this.deathTimer = 0;
  }

  get distToPlayer() {
    const p = players[0];
    if (!p) return 9999;
    return Math.hypot(p.x - this.x, p.y - this.y);
  }

  update(dt) {
    const sec = dt / 60;                       // dt is in 60fps frames, sec is real seconds
    if (this.isDead && this.ragdoll) { this._updateRagdoll(dt); return; }
    if (this.isDead) return;

    if (this.hitFlash > 0) this.hitFlash -= sec;

    // Damage-over-time effects
    this.effects = this.effects.filter(e => {
      const prev = Math.floor(e.timer);
      e.timer += sec;
      if (Math.floor(e.timer) > prev && !this.isDead) {
        this.hp = Math.max(0, this.hp - e.value);
        showDamageText(this.x, this.y-30, e.value, e.type === 'burn' ? '#f97316' : '#ef4444', e.type === 'burn' ? '🔥' : '🩸');
        if (this.hp <= 0) this.die();
      }
      return e.timer < e.duration;
    });
    if (this.isDead) return;

    // Physics
    this.vy += GRAVITY * dt;
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.vx *= 0.85;

    this.onGround = false;
    for (const plat of platforms) {
      if (this.x+this.w/2 > plat.x && this.x-this.w/2 < plat.x+plat.w) {
        if (this.y+this.h/2 >= plat.y && this.y+this.h/2-this.vy*dt <= plat.y+4) {
          this.y = plat.y - this.h/2;
          if (this.vy>0) { this.vy*=-BOUNCE; if(Math.abs(this.vy)<1) this.vy=0; }
          this.onGround = true;
        }
      }
    }
    if (this.x-this.w/2 < 0)  { this.x=this.w/2;    this.vx*=-0.5; }
    if (this.x+this.w/2 > W)  { this.x=W-this.w/2;  this.vx*=-0.5; }
    if (this.y+this.h/2 > H+60) { this.die(); return; }

    if (Math.abs(this.vx) > 0.3) this.walkCycle += 0.15*dt;
    if (this.swing > 0) this.swing -= sec;

    // Stunned (mace / hook): can't act
    if (this.stun > 0) { this.stun -= sec; this.isAiming = false; this.bowPull = 0; return; }

    // Slowed by tar / fire pits
    let spd = this.speed;
    if (this.slowTimer > 0) { spd *= this.slowMul; this.slowTimer -= sec; } else { this.slowMul = 1; }

    const p = players[0];
    if (!p || p.isDead) { this.isAiming = false; return; }

    const dx  = p.x - this.x;
    const adx = Math.abs(dx);

    // --- MELEE: run to the tower base and smash it ---
    if (this.melee) {
      const tx   = towerData ? towerData.x + towerData.w/2 : p.x;
      const tdx  = tx - this.x;
      this.facing = tdx > 0 ? 1 : -1;
      const reach = (towerData ? towerData.w/2 : 10) + this.w/2 + 6;
      if (Math.abs(tdx) > reach) {
        this.state = 'walk';
        if (this.onGround) this.vx += this.facing * spd * 0.8;
      } else {
        this.state = 'bash';
        this.atkTimer += sec;
        if (this.atkTimer >= 1.1) {
          this.atkTimer = 0;
          this.swing = 0.3;
          damageTower(this.damage * 0.6);
        }
      }
      return;
    }

    // --- RANGED: walk into range, stop, aim, shoot ---
    this.facing = dx > 0 ? 1 : -1;

    if (this.state !== 'aim') {
      this.state = 'walk';
      this.isAiming = false; this.bowPull = 0;
      if (adx > this.stopRange && this.onGround) this.vx += this.facing * spd * 0.8;
      this.shootTimer -= sec;
      if (this.shootTimer <= 0 && adx < this.stopRange + 80) {
        this.state = 'aim';
        this.aimDuration = 0;
        this.aimError = (Math.random() - 0.5) * this.aimSpread;
      }
    } else {
      this.aimDuration += sec;
      const frac = Math.min(1, this.aimDuration / this.aimTime);
      this.aimPower = this.maxPower * frac;
      this.bowPull  = frac;
      this.isAiming = true;
      this.aimAngle = solveAim(this.x, this.y - 20, p.x, p.y - 8, this.maxPower, this.aimError);
      if (frac >= 1) {
        this._shoot();
        this.state      = 'walk';
        this.isAiming   = false;
        this.aimPower   = 0;
        this.bowPull    = 0;
        this.shootTimer = this.shootCooldown;
      }
    }
  }

  _shoot() {
    const offsets = this.def.triple ? [-0.14, 0, 0.14] : [0];
    for (const off of offsets) {
      const a = this.aimAngle + off;
      const bowX = this.x + Math.cos(a)*28*this.scale;
      const bowY = (this.y-20) + Math.sin(a)*28*this.scale;
      arrows.push(new Arrow(bowX, bowY, a, this.maxPower, this, 'normal', true));
    }
    this.vx -= Math.cos(this.aimAngle)*1.2;
    spawnParticles(this.x + Math.cos(this.aimAngle)*28, this.y - 20 + Math.sin(this.aimAngle)*28, '#f5c842', 3);
    playSound('shoot');
  }

  takeDamage(amount, arrowType) {
    if (this.isDead) return 0;
    const actual = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - actual);
    this.hitFlash = 0.12;
    showDamageText(this.x, this.y - 30*this.scale, actual, '#ff6b6b');
    // Knockback away from the tower (heavier enemies move less)
    const dir = (players[0] && players[0].x > this.x) ? -1 : 1;
    this.vx += dir * 3 / this.scale;
    this.vy -= 1.5 / this.scale;
    if (this.hp <= 0) this.die();
    return actual;
  }

  addEffect(type, duration, value) {
    this.effects.push({ type, duration, value, timer:0 });
  }

  die() {
    if (this.isDead) return;
    this.isDead  = true;
    this.ragdoll = true;
    this.ragJoints = {
      head:{ ox:0,oy:-28,vx:(Math.random()-0.5)*8,vy:-5+Math.random()*-3 },
      neck:{ ox:0,oy:-20,vx:(Math.random()-0.5)*6,vy:-3 },
      torso:{ ox:0,oy:0,vx:(Math.random()-0.5)*4,vy:-2 },
      hips:{ ox:0,oy:16,vx:(Math.random()-0.5)*4,vy:-1 },
      shoulderL:{ ox:-7,oy:-14,vx:(Math.random()-0.5)*8,vy:-4 },
      shoulderR:{ ox:7,oy:-14,vx:(Math.random()-0.5)*8,vy:-4 },
      elbowL:{ ox:-14,oy:-6,vx:(Math.random()-0.5)*10,vy:-3 },
      elbowR:{ ox:14,oy:-6,vx:(Math.random()-0.5)*10,vy:-3 },
      handL:{ ox:-20,oy:2,vx:(Math.random()-0.5)*12,vy:-2 },
      handR:{ ox:20,oy:2,vx:(Math.random()-0.5)*12,vy:-2 },
      hipL:{ ox:-5,oy:16,vx:(Math.random()-0.5)*6,vy:-1 },
      hipR:{ ox:5,oy:16,vx:(Math.random()-0.5)*6,vy:-1 },
      kneeL:{ ox:-7,oy:34,vx:(Math.random()-0.5)*8,vy:0 },
      kneeR:{ ox:7,oy:34,vx:(Math.random()-0.5)*8,vy:0 },
      footL:{ ox:-8,oy:52,vx:(Math.random()-0.5)*6,vy:1 },
      footR:{ ox:8,oy:52,vx:(Math.random()-0.5)*6,vy:1 },
    };

    spawnParticles(this.x, this.y, this.color, this.type === 'boss' ? 30 : 12);
    playSound('death');
    if (this.type === 'boss') shake = Math.max(shake, 14);

    // Rewards, combo & score
    STATE.kills++;
    STATE.totalKills++;
    STATE.combo++;
    STATE.comboTimer = 4;
    STATE.bestCombo = Math.max(STATE.bestCombo, STATE.combo);
    const mult  = 1 + Math.min(STATE.combo - 1, 9) * 0.1;
    const coins = Math.round((5 + STATE.wave * 2) * this.def.coin) + Math.floor(STATE.combo / 3);
    STATE.coins += coins;
    STATE.score += Math.round(this.def.score * mult);
    floatText(this.x, this.y - 55*this.scale, '+' + coins + ' 💰', '#f5c842');
    if (STATE.combo >= 3) floatText(this.x, this.y - 75*this.scale, 'x' + STATE.combo + ' COMBO', '#fb923c', 13);
    updateHordeHUD();
  }

  _updateRagdoll(dt) {
    this.deathTimer += dt / 60;
    if (this.deathTimer > 2.5) { this.ragdoll = false; return; }
    for (const k in this.ragJoints) {
      const j = this.ragJoints[k];
      j.vy = (j.vy||0) + GRAVITY*0.5;
      j.ox += (j.vx||0)*dt; j.oy += (j.vy||0)*dt;
      j.vx = (j.vx||0)*0.9; j.vy = (j.vy||0)*0.9;
      const groundY = H-25 - this.y - this.h/2;
      if (j.oy > groundY) { j.vy*=-0.25; j.oy=groundY; j.vx*=0.7; }
    }
  }

  draw() {
    if (this.isDead && this.ragdoll) { this._drawRagdoll(); return; }
    if (this.isDead) return;
    this._drawEnemy();
  }

  _drawEnemy() {
    ctx.save();
    const S = this.scale; ctx.translate(this.x, this.y); ctx.scale(S, S); ctx.translate(-this.x, -this.y);
    const C = this.hitFlash > 0 ? '#ffffff' : this.color;
    ctx.strokeStyle = C;
    ctx.lineWidth   = 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const f = this.facing;

    const hX=this.x, hY=this.y-26;
    const nX=this.x, nY=this.y-19;
    const hpX=this.x, hpY=this.y+13;
    const kLX=hpX+f*-6, kLY=hpY+16+Math.sin(this.walkCycle)*5;
    const kRX=hpX+f*6,  kRY=hpY+16+Math.sin(this.walkCycle+Math.PI)*5;
    const fLX=kLX+Math.sin(this.walkCycle)*5, fLY=this.y+28;
    const fRX=kRX+Math.sin(this.walkCycle+Math.PI)*5, fRY=fLY;

    ctx.beginPath(); ctx.moveTo(hpX,hpY); ctx.lineTo(kLX,kLY); ctx.lineTo(fLX,fLY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hpX,hpY); ctx.lineTo(kRX,kRY); ctx.lineTo(fRX,fRY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nX,nY); ctx.lineTo(this.x,this.y+4); ctx.lineTo(hpX,hpY); ctx.stroke();

    if (this.isAiming) {
      const bowA=this.aimAngle, bowD=24+this.bowPull*7;
      const eBX=nX+Math.cos(bowA)*13, eBY=nY+Math.sin(bowA)*13;
      const hBX=nX+Math.cos(bowA)*bowD, hBY=nY+Math.sin(bowA)*bowD;
      const bkA=bowA+Math.PI*0.6*f;
      ctx.beginPath(); ctx.moveTo(nX,nY);
      ctx.lineTo(nX+Math.cos(bkA)*11, nY+Math.sin(bkA)*11);
      ctx.lineTo(nX+Math.cos(bkA)*18, nY+Math.sin(bkA)*18); ctx.stroke();

      // Draw bow
      ctx.save(); ctx.strokeStyle='#ffd700'; ctx.lineWidth=2;
      ctx.translate(hBX,hBY); ctx.rotate(bowA+Math.PI);
      ctx.beginPath(); ctx.arc(0,0,12,-Math.PI/2.5,Math.PI/2.5); ctx.stroke();
      ctx.strokeStyle='rgba(200,200,200,0.6)'; ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(0,-12*Math.sin(Math.PI/2.5));
      ctx.lineTo(-this.bowPull*12,0);
      ctx.lineTo(0,12*Math.sin(Math.PI/2.5));
      ctx.stroke(); ctx.restore();

      ctx.strokeStyle=C; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(nX,nY); ctx.lineTo(eBX,eBY); ctx.lineTo(hBX,hBY); ctx.stroke();
    } else {
      const armA = bowAngleFallback(this);
      ctx.beginPath(); ctx.moveTo(nX,nY);
      ctx.lineTo(nX+Math.cos(armA)*22, nY+Math.sin(armA)*22); ctx.stroke();
      const bkA = armA+Math.PI*0.7;
      ctx.beginPath(); ctx.moveTo(nX,nY);
      ctx.lineTo(nX+Math.cos(bkA)*18, nY+Math.sin(bkA)*18); ctx.stroke();
    }

    // Head
    ctx.fillStyle=C;
    ctx.beginPath(); ctx.arc(hX,hY,8,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#111';
    ctx.beginPath(); ctx.arc(hX+f*3,hY-1,2,0,Math.PI*2); ctx.fill();

    // Weapon for melee enemies
    if (this.melee) {
      const a0  = this.swing > 0 ? -1.3 + (1 - this.swing/0.3) * 2.6 : -0.9;
      const ang = f === 1 ? a0 : Math.PI - a0;
      const sx = nX + Math.cos(ang)*12, sy = nY + Math.sin(ang)*12;
      const ex = nX + Math.cos(ang)*34, ey = nY + Math.sin(ang)*34;
      ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = '#5d4037';
      ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI*2); ctx.fill();
    }
    // Boss crown
    if (this.type === 'boss') {
      ctx.fillStyle = '#f5c842';
      ctx.beginPath();
      ctx.moveTo(hX-8, hY-8); ctx.lineTo(hX-8, hY-17); ctx.lineTo(hX-4, hY-11);
      ctx.lineTo(hX, hY-18); ctx.lineTo(hX+4, hY-11); ctx.lineTo(hX+8, hY-17); ctx.lineTo(hX+8, hY-8);
      ctx.closePath(); ctx.fill();
    }
    // Stun indicator
    if (this.stun > 0) {
      ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('💫', hX, hY - 14);
    }

    // Health bar above head
    const barW=32, barH=4;
    const bx=this.x-barW/2, by=this.y-44;
    ctx.fillStyle='rgba(0,0,0,0.5)';
    ctx.fillRect(bx,by,barW,barH);
    const pct=this.hp/this.maxHp;
    ctx.fillStyle=pct>0.5?'#4ade80':pct>0.25?'#f59e0b':'#ef4444';
    ctx.fillRect(bx,by,barW*pct,barH);

    ctx.restore();
  }

  _drawRagdoll() {
    if (!this.ragJoints || Object.keys(this.ragJoints).length === 0) return;
    ctx.save();
    ctx.strokeStyle=this.color; ctx.lineWidth=2.5; ctx.lineCap='round';
    const j=this.ragJoints;
    const gj=k=>({ x:this.x+(j[k]?.ox||0)*this.scale, y:this.y+(j[k]?.oy||0)*this.scale });
    const dl=(a,b)=>{
      if (!j[a]||!j[b]) return;
      const pa=gj(a),pb=gj(b);
      ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
    };
    dl('head','neck'); dl('neck','torso'); dl('torso','hips');
    dl('hips','hipL'); dl('hipL','kneeL'); dl('kneeL','footL');
    dl('hips','hipR'); dl('hipR','kneeR'); dl('kneeR','footR');
    dl('neck','shoulderL'); dl('shoulderL','elbowL'); dl('elbowL','handL');
    dl('neck','shoulderR'); dl('shoulderR','elbowR'); dl('elbowR','handR');
    const ph=gj('head');
    ctx.fillStyle=this.color; ctx.beginPath(); ctx.arc(ph.x,ph.y,8,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

function bowAngleFallback(enemy) {
  const p = players[0];
  if (!p) return enemy.facing * -0.5;
  return Math.atan2(p.y - enemy.y, p.x - enemy.x);
}

// ============================================================
// ARROW CLASS
// ============================================================

class Arrow {
  constructor(x, y, angle, power, owner, arrowType, isEnemy) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle)*power;
    this.vy = Math.sin(angle)*power;
    this.owner   = owner;
    this.type    = arrowType || 'normal';
    this.isEnemy = !!isEnemy; // true = fired by enemy
    this.hit     = false;
    this.trail   = [];
    this.color   = this._getColor();
    this.age     = 0;
    this.hitSet  = new Set();
  }

  _getColor() {
    if (this.isEnemy) return '#ff8a65';
    const c={normal:'#e8d5a3',fire:'#f97316',balloon:'#ec4899',shot:'#a78bfa',
             minigun:'#94a3b8',shuriken:'#22d3ee',hook:'#f5c842',mace:'#6b7280',
             axe:'#ef4444',telescop:'#8b5cf6',electric:'#facc15'};
    return c[this.type]||'#e8d5a3';
  }

  // Fixed 1-frame sub-steps keep the flight path identical at any frame rate
  update(dt) {
    let rem = dt;
    while (rem > 0.001 && !this.hit) {
      const s = Math.min(1, rem);
      rem -= s;
      this._step(s);
    }
  }

  _step(dt) {
    if (this.hit) return;
    this.age += dt;
    if (STATE.particles) {
      this.trail.push({x:this.x,y:this.y,age:0});
      if (this.trail.length>10) this.trail.shift();
    }
    this.trail.forEach(t=>t.age+=dt);
    this.vy += ARROW_GRAV*dt;
    this.x  += this.vx*dt;
    this.y  += this.vy*dt;

    if (this.x<-50||this.x>W+50||this.y>H+50||this.y<-300){this.hit=true;return;}

    // Platform collision
    for (const p of platforms) {
      // Player arrows fired downward pass through the tower-top so you can shoot into the courtyard
      if (!this.isEnemy && p.isTowerTop && this.vy > 0) continue;
      if (this.x>p.x&&this.x<p.x+p.w&&this.y>=p.y&&this.y<=p.y+10){
        this.hit=true; spawnParticles(this.x,this.y,this.color,3); return;
      }
    }

    if (this.isEnemy) {
      // Enemy arrow hits player
      const p = players[0];
      if (p && !p.isDead) {
        if (Math.abs(this.x-p.x)<18 && Math.abs(this.y-(p.y-10))<40) {
          this._hitPlayer(p);
          return;
        }
      }
      // ...or smacks into the tower
      if (STATE.mode === '1player' && towerData &&
          this.x > towerData.x && this.x < towerData.x + towerData.w &&
          this.y > towerData.y + 6) {
        this.hit = true;
        damageTower((this.owner && this.owner.damage || 10) * 0.25);
        spawnParticles(this.x, this.y, '#6b7bb8', 4);
      }
    } else {
      // Player arrow hits enemies (horde mode)
      if (STATE.mode === '1player') {
        for (const e of enemies) {
          if (e.isDead || this.hitSet.has(e)) continue;
          if (Math.abs(this.x-e.x) < e.w/2 + 8 && this.y > e.y - e.h/2 - 6 && this.y < e.y + e.h/2) {
            this._hitEnemy(e);
            break;
          }
        }
      } else {
        // 1v1: hit the other player
        const target = this.owner === players[0] ? players[1] : players[0];
        if (target && !target.isDead) {
          if (Math.abs(this.x-target.x)<18 && Math.abs(this.y-(target.y-10))<40) {
            this.applyPlayerHit(target);
          }
        }
      }
    }
  }

  _hitPlayer(p) {
    this.hit = true;
    p.takeDamage(this.owner.damage || 12, this.owner.x || this.x);
    spawnParticles(p.x, p.y-20, '#ff6b6b', 5);
    playSound('hit');
  }

  _hitEnemy(e) {
    this.hitSet.add(e);
    this.hit = !(this.type === 'shuriken' && this.hitSet.size < 3);   // shurikens pierce through
    let baseDmg = (this.owner?.damage || 25);

    // Headshots hit harder
    if (this.y < e.y - e.h * 0.3) {
      baseDmg *= 1.75;
      floatText(e.x, e.y - 65*e.scale, 'HEADSHOT!', '#fde047', 14);
    }

    switch(this.type) {
      case 'fire':
        e.takeDamage(baseDmg*1.2, this.type);
        e.addEffect('burn', 3, Math.floor(baseDmg*0.15));
        spawnParticles(e.x,e.y,'#f97316',10); break;
      case 'balloon':
        e.takeDamage(baseDmg*0.4, this.type); e.vy -= 14 / e.scale;
        spawnParticles(e.x,e.y,'#ec4899',8); break;
      case 'shot':
        e.takeDamage(baseDmg*0.9, this.type); break;
      case 'minigun':
        e.takeDamage(baseDmg*0.5, this.type); break;
      case 'shuriken':
        e.takeDamage(baseDmg*1.3, this.type); break;
      case 'hook':
        e.takeDamage(baseDmg*0.8, this.type);
        e.vx += (e.x < W/2 ? -1 : 1) * 14 / e.scale;   // yank them back from the tower
        e.stun = Math.max(e.stun, 0.6); break;
      case 'mace':
        e.takeDamage(baseDmg*1.8, this.type);
        e.stun = Math.max(e.stun, e.type === 'boss' ? 0.5 : 1.5);
        spawnParticles(e.x,e.y,'#6b7280',12); break;
      case 'axe':
        e.takeDamage(baseDmg*1.4, this.type);
        e.addEffect('bleed', 4, Math.max(1, Math.floor(baseDmg*0.1))); break;
      case 'electric': {
        e.takeDamage(baseDmg*1.3, this.type);
        e.vx += (Math.random()-0.5)*10; e.vy -= 6 / e.scale;
        spawnParticles(e.x,e.y,'#facc15',14);
        let chained = 0;                               // chain lightning to 2 nearby enemies
        for (const o of enemies) {
          if (o === e || o.isDead || chained >= 2) continue;
          if (Math.hypot(o.x-e.x, o.y-e.y) < 170) {
            o.takeDamage(baseDmg*0.7, this.type); chained++;
            for (let i = 0; i <= 6; i++) {
              spawnParticles(e.x+(o.x-e.x)*i/6, e.y+(o.y-e.y)*i/6 + (Math.random()-0.5)*14, '#facc15', 1);
            }
          }
        }
        break;
      }
      case 'telescop':
        if (e.type === 'boss') { e.takeDamage(baseDmg*0.8, this.type); break; }
        e.takeDamage(baseDmg*0.6, this.type);
        e.x = e.x<W/2 ? -60 : W+60; // Teleport off screen = kill
        e.die(); break;
      default:
        e.takeDamage(baseDmg, this.type);
    }
    spawnParticles(e.x, e.y-20, this.color, 6);
    playSound('hit');
  }

  applyPlayerHit(target) {
    this.hit = true;
    const baseDmg = this.owner?.damage || 25;
    switch(this.type){
      case 'fire':
        target.takeDamage(baseDmg*1.2, target.x<this.x?target.x+10:target.x-10);
        target.addEffect('burn',3,Math.floor(baseDmg*0.15));
        spawnParticles(target.x,target.y,'#f97316',10); break;
      case 'balloon':
        target.takeDamage(baseDmg*0.4, this.x); target.vy-=14;
        spawnParticles(target.x,target.y,'#ec4899',8); break;
      case 'mace':
        target.takeDamage(baseDmg*1.8, this.x);
        spawnParticles(target.x,target.y,'#6b7280',12); break;
      case 'electric':
        target.takeDamage(baseDmg*1.3, this.x);
        target.vx+=(Math.random()-0.5)*10; target.vy-=6;
        spawnParticles(target.x,target.y,'#facc15',14); break;
      default:
        target.takeDamage(baseDmg, this.x);
    }
    spawnParticles(target.x, target.y-20, this.color, 6);
    playSound('hit');
  }

  draw() {
    if (this.hit) return;
    const angle = Math.atan2(this.vy, this.vx);
    ctx.save();

    // Trail
    if (this.trail.length>1 && STATE.particles) {
      for (let i=0;i<this.trail.length-1;i++){
        const t=this.trail[i];
        ctx.globalAlpha=(i/this.trail.length)*0.4;
        ctx.strokeStyle=this.color; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(t.x,t.y); ctx.lineTo(this.trail[i+1].x,this.trail[i+1].y); ctx.stroke();
      }
    }

    ctx.globalAlpha=1;
    ctx.translate(this.x,this.y); ctx.rotate(angle);
    ctx.strokeStyle=this.color; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(-14,0); ctx.lineTo(8,0); ctx.stroke();
    ctx.fillStyle=this.color;
    ctx.beginPath(); ctx.moveTo(8,0); ctx.lineTo(2,-3); ctx.lineTo(2,3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-14,0); ctx.lineTo(-10,-4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-14,0); ctx.lineTo(-10,4); ctx.stroke();
    if (this.type!=='normal'){
      ctx.shadowColor=this.color; ctx.shadowBlur=8;
      ctx.strokeStyle=this.color; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(-14,0); ctx.lineTo(8,0); ctx.stroke();
    }
    ctx.restore();
  }
}

// ============================================================
// PARTICLES
// ============================================================

const particles = [];

function spawnParticles(x,y,color,count){
  if (!STATE.particles) return;
  for(let i=0;i<count;i++){
    const a=Math.random()*Math.PI*2, s=1.5+Math.random()*5;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2,
      life:1,decay:0.03+Math.random()*0.05,size:2+Math.random()*4,color});
  }
}

function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=GRAVITY*0.3*dt; p.life-=p.decay*dt;
    if(p.life<=0) particles.splice(i,1);
  }
}

function drawParticles(){
  for(const p of particles){
    ctx.save(); ctx.globalAlpha=p.life; ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2); ctx.fill(); ctx.restore();
  }
}

// ============================================================
// DAMAGE TEXT
// ============================================================

const dmgTexts = [];

function showDamageText(x,y,amount,color,prefix=''){
  dmgTexts.push({x,y,text:prefix+'-'+amount,color,life:1.0});
}

function floatText(x,y,text,color,size){
  dmgTexts.push({x,y,text,color,life:1.3,size:size||15});
}

function updateDmgTexts(dt){
  for(let i=dmgTexts.length-1;i>=0;i--){
    dmgTexts[i].y-=1.2*dt; dmgTexts[i].life-=0.025*dt;
    if(dmgTexts[i].life<=0) dmgTexts.splice(i,1);
  }
}

function drawDmgTexts(){
  for(const t of dmgTexts){
    ctx.save(); ctx.globalAlpha=t.life; ctx.fillStyle=t.color;
    ctx.font='bold '+(t.size||15)+'px "Orbitron",monospace'; ctx.textAlign='center';
    ctx.strokeStyle='rgba(0,0,0,0.8)'; ctx.lineWidth=3;
    ctx.strokeText(t.text,t.x,t.y); ctx.fillText(t.text,t.x,t.y); ctx.restore();
  }
}

// ============================================================
// DEFENCE SYSTEM
// ============================================================

const DEFENCE_CATALOGUE = [
  { id:'spike',    name:'SPIKE TRAP',   emoji:'⚡', cost:30,  desc:'Damages enemies that walk over it',  damage:18, slowAmt:0,    w:48, h:12, color:'#c0392b', glowColor:'#ff6b6b' },
  { id:'slow',     name:'TAR PIT',      emoji:'🌑', cost:45,  desc:'Slows enemies by 60% in its area',   damage:2,  slowAmt:0.6,  w:60, h:14, color:'#2c3e50', glowColor:'#7f8c8d' },
  { id:'wall',     name:'STONE WALL',   emoji:'🪨', cost:55,  desc:'Blocks enemy path temporarily',       damage:0,  slowAmt:0,    w:20, h:60, color:'#546e7a', glowColor:'#90a4ae' },
  { id:'fire',     name:'FIRE PIT',     emoji:'🔥', cost:70,  desc:'Burns enemies for 4 seconds',         damage:6,  slowAmt:0.2,  w:52, h:14, color:'#e67e22', glowColor:'#f39c12' },
  { id:'electric', name:'TESLA COIL',   emoji:'⚡', cost:90,  desc:'Zaps nearby enemies for big damage',  damage:30, slowAmt:0,    w:22, h:50, color:'#9b59b6', glowColor:'#e056fd' },
  { id:'barricade',name:'BARRICADE',    emoji:'🪵', cost:40,  desc:'Sturdy wooden barricade (100 HP)',    damage:0,  slowAmt:0,    w:24, h:52, color:'#795548', glowColor:'#a1887f' },
];

let placedDefences = [];

class DefenceTrap {
  constructor(type, x, y) {
    const def = DEFENCE_CATALOGUE.find(d => d.id === type);
    Object.assign(this, def);
    this.x = x; this.y = y;
    this.hp = type === 'barricade' ? 100 : (type === 'wall' ? 80 : 999);
    this.maxHp = this.hp;
    this.age = 0;
    this.pulseTimer = 0;
    this.isDead = false;
    // Per-enemy cooldown for spike/fire/electric
    this.damageCooldowns = new Map();
    this.zaps = [];
  }

  update(dt) {
    if (this.isDead) return;
    const sec = dt / 60;
    this.age += sec;
    this.pulseTimer += sec;

    for (let i = this.zaps.length-1; i >= 0; i--) {
      this.zaps[i].life -= sec;
      if (this.zaps[i].life <= 0) this.zaps.splice(i, 1);
    }

    for (const e of enemies) {
      if (e.isDead) continue;

      let inRange;
      if (this.id === 'electric') {
        inRange = Math.hypot(e.x - this.x, e.y - this.y) < 150;
      } else {
        const ex1 = e.x - e.w/2, ex2 = e.x + e.w/2;
        const ey1 = e.y - e.h/2, ey2 = e.y + e.h/2;
        const tx1 = this.x - this.w/2, tx2 = this.x + this.w/2;
        const ty1 = this.y - this.h/2, ty2 = this.y + this.h/2;
        inRange = ex2 > tx1 && ex1 < tx2 && ey2 > ty1 && ey1 < ty2;
      }
      if (!inRange) continue;

      // Damage tick once per second per enemy
      const last = this.damageCooldowns.get(e);
      if (last === undefined || this.age - last >= 1.0) {
        this.damageCooldowns.set(e, this.age);
        if (this.damage > 0) {
          e.takeDamage(this.damage, this.id);
          if (this.id === 'fire') e.addEffect('burn', 4, 4);
          if (this.id === 'electric') {
            e.vy -= 3;
            this.zaps.push({ x1:this.x, y1:this.y - this.h/2 - 6, x2:e.x, y2:e.y - 20, life:0.25 });
            spawnParticles(e.x, e.y-20, '#e056fd', 8);
            playSound('hit');
          }
          spawnParticles(e.x, e.y, this.glowColor, 4);
        }
      }

      // Slow
      if (this.slowAmt > 0) {
        e.slowTimer = 0.25;
        e.slowMul = Math.min(e.slowMul || 1, 1 - this.slowAmt);
      }

      // Walls block movement and get chewed up
      if (this.id === 'wall' || this.id === 'barricade') {
        const pushDir = e.x > this.x ? 1 : -1;
        e.x = this.x + pushDir * (this.w/2 + e.w/2 + 1);
        e.vx = 0;
        this._chew = (this._chew || 0) + e.damage * 0.3 * sec;
        if (this._chew >= 1) {
          const whole = Math.floor(this._chew);
          this.hp -= whole; this._chew -= whole;
          if (this.hp <= 0) {
            this.isDead = true;
            spawnParticles(this.x, this.y, this.glowColor, 10);
            return;
          }
        }
      }
    }
  }

  draw() {
    if (this.isDead) return;
    ctx.save();
    const pulse = 0.7 + 0.3 * Math.sin(this.pulseTimer * 3);
    for (const z of this.zaps) {
      ctx.save();
      ctx.strokeStyle = '#e056fd'; ctx.lineWidth = 2; ctx.globalAlpha = Math.min(1, z.life * 4);
      ctx.shadowColor = '#e056fd'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(z.x1, z.y1);
      for (let s = 1; s < 6; s++) {
        ctx.lineTo(z.x1 + (z.x2-z.x1)*s/6 + (Math.random()-0.5)*16, z.y1 + (z.y2-z.y1)*s/6 + (Math.random()-0.5)*16);
      }
      ctx.lineTo(z.x2, z.y2); ctx.stroke();
      ctx.restore();
    }

    if (this.id === 'spike') {
      // Draw spiky metal teeth
      ctx.fillStyle = this.color;
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 1.5;
      const count = Math.floor(this.w / 10);
      const sx = this.x - this.w/2;
      const sy = this.y - this.h/2;
      ctx.fillRect(sx, sy + this.h/2, this.w, this.h/2);
      for (let i = 0; i < count; i++) {
        const tx = sx + i * (this.w / count) + (this.w / count / 2);
        ctx.beginPath();
        ctx.moveTo(tx - 4, sy + this.h);
        ctx.lineTo(tx, sy);
        ctx.lineTo(tx + 4, sy + this.h);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.shadowColor = this.glowColor; ctx.shadowBlur = 8 * pulse;
      ctx.strokeStyle = this.glowColor; ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, this.w, this.h);

    } else if (this.id === 'slow') {
      // Tar pit
      const grad = ctx.createRadialGradient(this.x, this.y, 4, this.x, this.y, this.w/2);
      grad.addColorStop(0, 'rgba(44,62,80,0.9)');
      grad.addColorStop(1, 'rgba(30,30,30,0.4)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, this.w/2, this.h/2+4, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(127,140,141,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Bubbles
      for (let b = 0; b < 3; b++) {
        const bx = this.x + Math.sin(this.pulseTimer*2 + b*2)*12;
        const by = this.y - 4 + Math.cos(this.pulseTimer + b)*3;
        ctx.globalAlpha = 0.5 + 0.3*Math.sin(this.pulseTimer+b);
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI*2); ctx.fillStyle='#7f8c8d'; ctx.fill();
      }

    } else if (this.id === 'wall' || this.id === 'barricade') {
      // Stone/wood wall
      ctx.fillStyle = this.color;
      const sx = this.x - this.w/2, sy = this.y - this.h/2;
      ctx.fillRect(sx, sy, this.w, this.h);
      // Brick pattern
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
      const bh = 14;
      for (let row = 0; row < Math.ceil(this.h/bh); row++) {
        const off = row % 2 === 0 ? 0 : this.w/2;
        ctx.beginPath(); ctx.moveTo(sx, sy + row*bh); ctx.lineTo(sx+this.w, sy+row*bh); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx+off, sy+row*bh); ctx.lineTo(sx+off, sy+row*bh+bh); ctx.stroke();
      }
      // HP bar
      if (this.maxHp < 999) {
        const pct = this.hp / this.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sx, sy-6, this.w, 4);
        ctx.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#f59e0b' : '#ef4444';
        ctx.fillRect(sx, sy-6, this.w*pct, 4);
      }
      ctx.shadowColor = this.glowColor; ctx.shadowBlur = 6;
      ctx.strokeStyle = this.glowColor; ctx.lineWidth = 1.5;
      ctx.strokeRect(sx, sy, this.w, this.h);

    } else if (this.id === 'fire') {
      // Fire pit base
      const sx = this.x - this.w/2, sy = this.y - this.h/2;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(sx, sy, this.w, this.h);
      // Flames
      const flameCount = 6;
      for (let f = 0; f < flameCount; f++) {
        const fx = sx + (f + 0.5) * (this.w / flameCount);
        const fh = 12 + 10*Math.sin(this.pulseTimer*4 + f);
        const alpha = 0.6 + 0.4*Math.sin(this.pulseTimer*3+f);
        ctx.globalAlpha = alpha;
        const flameGrad = ctx.createLinearGradient(fx, sy, fx, sy - fh);
        flameGrad.addColorStop(0, '#f39c12');
        flameGrad.addColorStop(0.5, '#e74c3c');
        flameGrad.addColorStop(1, 'rgba(231,76,60,0)');
        ctx.fillStyle = flameGrad;
        ctx.beginPath();
        ctx.ellipse(fx, sy, 6, fh, 0, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#f39c12'; ctx.shadowBlur = 15 * pulse;
      ctx.strokeStyle = '#e67e22'; ctx.lineWidth = 1.5;
      ctx.strokeRect(sx, sy, this.w, this.h);

    } else if (this.id === 'electric') {
      // Tesla coil
      const sx = this.x - this.w/2, sy = this.y - this.h/2;
      const coilGrad = ctx.createLinearGradient(sx, sy, sx, sy+this.h);
      coilGrad.addColorStop(0, '#9b59b6');
      coilGrad.addColorStop(1, '#4a235a');
      ctx.fillStyle = coilGrad;
      ctx.fillRect(sx, sy, this.w, this.h);
      // Lightning bolts
      ctx.strokeStyle = '#e056fd'; ctx.lineWidth = 2;
      ctx.shadowColor = '#e056fd'; ctx.shadowBlur = 14 * pulse;
      ctx.globalAlpha = 0.6 + 0.4*Math.sin(this.pulseTimer*7);
      const lx = this.x, ly = this.y - this.h/2;
      ctx.beginPath(); ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 8, ly - 10); ctx.lineTo(lx - 4, ly - 20);
      ctx.lineTo(lx + 6, ly - 32); ctx.stroke();
      ctx.globalAlpha = 1;
      // Orb at top
      ctx.fillStyle = '#e056fd';
      ctx.beginPath(); ctx.arc(lx, sy-6, 7, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowColor = '#e056fd'; ctx.shadowBlur = 20 * pulse;
      ctx.fill();
    }

    // Label
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px Inter,sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.fillText(this.emoji, this.x, this.y - this.h/2 - 8);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// How many of each defence the player owns (unused inventory)
const DEFENCE_INVENTORY = {
  spike: 0, slow: 0, wall: 0, fire: 0, electric: 0, barricade: 0,
};

let defencePlacementMode = null; // id of defence being placed, or null

function buyDefence(id) {
  const def = DEFENCE_CATALOGUE.find(d => d.id === id);
  if (!def) return;
  if (STATE.coins < def.cost) {
    const el = document.getElementById('coins-display');
    el.style.color = 'var(--accent-red)';
    setTimeout(() => el.style.color = '', 600);
    return;
  }
  STATE.coins -= def.cost;
  DEFENCE_INVENTORY[id] = (DEFENCE_INVENTORY[id] || 0) + 1;
  saveProgress();
  playSound('upgrade');
  updateUpgradeUI();
  updateDefenceUI();
}

function defenceSpot(def, x, y) {
  // Snap to ground or a nearby platform
  let placedY = H - 25 - def.h/2;
  for (const p of platforms) {
    if (!p.isGround && x > p.x && x < p.x + p.w && Math.abs(y - p.y) < 80) {
      placedY = p.y - def.h/2;
      break;
    }
  }
  return placedY;
}

function startPlacingDefence(id) {
  if (!DEFENCE_INVENTORY[id]) return;
  defencePlacementMode = id;
  ghostPos = null;
  closeUpgrades(true);   // keep the game paused while choosing a spot
  const hint = document.getElementById('aim-hint');
  if (hint) {
    hint.textContent = '🏗️ Click the battlefield to place it  •  Esc to cancel';
    hint.style.color = '#f5c842';
  }
}

function endPlacement() {
  defencePlacementMode = null;
  ghostPos = null;
  setHint();
  releaseShopPause();
  if (STATE.intermission && !STATE.shopOpen) document.getElementById('round-over').classList.remove('hidden');
}

function cancelPlacement() { endPlacement(); }

function placeDefenceAt(x, y) {
  if (!defencePlacementMode) return;
  const id = defencePlacementMode;
  const def = DEFENCE_CATALOGUE.find(d => d.id === id);
  placedDefences.push(new DefenceTrap(id, x, defenceSpot(def, x, y)));
  DEFENCE_INVENTORY[id]--;
  spawnParticles(x, defenceSpot(def, x, y), def.glowColor, 8);
  playSound('upgrade');
  saveProgress();
  endPlacement();
  updateDefenceUI();
}

function updateDefenceUI() {
  const grid = document.getElementById('defences-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const def of DEFENCE_CATALOGUE) {
    const inv = DEFENCE_INVENTORY[def.id] || 0;
    const card = document.createElement('div');
    card.className = 'special-arrow-card' + (inv > 0 ? ' unlocked' : '');
    card.innerHTML = `
      <div class="arrow-emoji">${def.emoji}</div>
      <div class="arrow-info">
        <div class="arrow-name">${def.name}</div>
        <div class="arrow-cost">${def.desc}</div>
        ${inv > 0 ? `<div class="arrow-cost" style="color:#4ade80">In bag: ${inv}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <button class="unlock-btn" onclick="buyDefence('${def.id}')">BUY 💰${def.cost}</button>
        ${inv > 0 ? `<button class="select-btn active" onclick="startPlacingDefence('${def.id}')">PLACE</button>` : ''}
      </div>`;
    grid.appendChild(card);
  }
  document.getElementById('coins-display').textContent = STATE.coins;
}



let platforms = [];

function buildPlatforms() {
  platforms = [];
  if (STATE.mode === '1player') {
    buildHordePlatforms();
  } else {
    build1v1Platforms();
  }
}

function buildHordePlatforms() {
  // Ground level — enemies walk here
  platforms.push({ x:0, y:H-25, w:W, h:25, color:'#1a2e20', isGround:true });

  // Tower top platform (where player stands)
  const towerTopW = 90;
  const towerTopX = W/2 - towerTopW/2;
  const towerTopY = H - 25 - Math.floor(H * 0.42);
  platforms.push({ x:towerTopX-10, y:towerTopY, w:towerTopW+20, h:14, color:'#2a3560', isTowerTop:true });

  // Store tower data for rendering
  const tH = H - 25 - towerTopY;
  towerData = { x: W/2 - 28, y: towerTopY, w: 56, h: tH };
}

function build1v1Platforms() {
  platforms.push({ x:0, y:H-25, w:W, h:25, color:'#1a2e20' });
  platforms.push({ x:30,        y:H-120, w:W*0.22, h:18, color:'#1e2a3f' });
  platforms.push({ x:W-30-W*0.22, y:H-120, w:W*0.22, h:18, color:'#1e2a3f' });
  platforms.push({ x:W/2-W*0.1,  y:H-200, w:W*0.2,  h:14, color:'#2a1e3f' });
  towerData = null;
}

function drawPlatforms() {
  // Draw stone tower first (behind platforms)
  if (towerData) drawTower();

  for (const p of platforms) {
    if (p.isGround) continue; // draw ground separately

    ctx.fillStyle='rgba(0,0,0,0.3)';
    ctx.fillRect(p.x+3,p.y+4,p.w,p.h);
    const grad=ctx.createLinearGradient(p.x,p.y,p.x,p.y+p.h);
    grad.addColorStop(0, p.color||'#1e3a2f');
    grad.addColorStop(1,'rgba(0,0,0,0.5)');
    ctx.fillStyle=grad;
    ctx.beginPath(); ctx.roundRect(p.x,p.y,p.w,p.h,4); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.07)'; ctx.fillRect(p.x,p.y,p.w,3);
  }
}

function drawGround() {
  const g = platforms.find(p=>p.isGround);
  if (!g) {
    // 1v1 mode ground
    const grad=ctx.createLinearGradient(0,H-25,0,H);
    grad.addColorStop(0,'#1a2e20'); grad.addColorStop(1,'#0d1a10');
    ctx.fillStyle=grad; ctx.fillRect(0,H-25,W,25);
    return;
  }
  const grad=ctx.createLinearGradient(0,g.y,0,H);
  grad.addColorStop(0,'#1a3020'); grad.addColorStop(1,'#0a120a');
  ctx.fillStyle=grad; ctx.fillRect(0,g.y,W,H-g.y);

  // Ground detail line
  ctx.fillStyle='rgba(100,200,80,0.15)'; ctx.fillRect(0,g.y,W,3);
}

function drawTower() {
  if (!towerData) return;
  const {x,y,w,h} = towerData;

  // Shadow
  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.fillRect(x+6,y+6,w,h);

  // Tower body gradient
  const grad=ctx.createLinearGradient(x,y,x+w,y);
  grad.addColorStop(0,'#1c2544');
  grad.addColorStop(0.4,'#263060');
  grad.addColorStop(0.6,'#1e2a55');
  grad.addColorStop(1,'#141e3a');
  ctx.fillStyle=grad;
  ctx.fillRect(x,y,w,h);

  // Stone brick pattern
  const brickH=18, brickW=22;
  ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1;
  for (let row=0; row<Math.ceil(h/brickH)+1; row++) {
    const by=y+row*brickH;
    const offset=(row%2===0)?0:brickW/2;
    for (let col=-1; col<Math.ceil(w/brickW)+1; col++) {
      const bx=x+col*brickW-offset;
      ctx.strokeRect(bx,by,brickW,brickH);
    }
  }

  // Left highlight edge
  ctx.fillStyle='rgba(255,255,255,0.05)';
  ctx.fillRect(x,y,3,h);

  // Right shadow edge
  ctx.fillStyle='rgba(0,0,0,0.25)';
  ctx.fillRect(x+w-3,y,3,h);

  // Battlements at top
  const merlonW=14, merlonH=14, gap=8;
  const count=Math.floor(w/(merlonW+gap));
  const totalW=count*(merlonW+gap)-gap;
  const startX=x+(w-totalW)/2;
  ctx.fillStyle='#263060';
  for (let i=0;i<count;i++){
    const mx=startX+i*(merlonW+gap);
    ctx.fillRect(mx, y-merlonH, merlonW, merlonH+4);
    ctx.fillStyle='rgba(255,255,255,0.06)';
    ctx.fillRect(mx, y-merlonH, merlonW, 2);
    ctx.fillStyle='#263060';
  }

  // Window slits
  ctx.fillStyle='rgba(0,0,0,0.6)';
  const winY1=y+Math.floor(h*0.25), winY2=y+Math.floor(h*0.6);
  [W/2-3,W/2+3].forEach(wx=>{
    ctx.fillRect(wx-2, winY1, 4, 12);
    ctx.fillRect(wx-2, winY2, 4, 12);
  });
  // Small glow in windows
  ctx.fillStyle='rgba(200,160,60,0.15)';
  ctx.fillRect(W/2-5, winY1-2, 10, 16);
  ctx.fillRect(W/2-5, winY2-2, 10, 16);

  // Tower health bar + cracks (horde mode)
  if (STATE.mode === '1player') {
    const pct = Math.max(0, STATE.towerHp / STATE.towerMax);
    const bw = w - 14, bx = x + 7, by = y + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx-1, by-1, bw+2, 8);
    ctx.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(bx, by, bw*pct, 6);
    ctx.fillStyle = '#e8eaf0'; ctx.font = 'bold 8px Orbitron,monospace'; ctx.textAlign = 'center';
    ctx.fillText('TOWER', x + w/2, by + 20);
    if (pct < 0.6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x+8, y+h*0.45); ctx.lineTo(x+20, y+h*0.52); ctx.lineTo(x+14, y+h*0.62); ctx.stroke();
      if (pct < 0.3) {
        ctx.beginPath(); ctx.moveTo(x+w-8, y+h*0.7); ctx.lineTo(x+w-22, y+h*0.78); ctx.lineTo(x+w-16, y+h*0.9); ctx.stroke();
      }
    }
  }
}

// ============================================================
// BACKGROUND / STARS
// ============================================================

let stars = [];

function buildStars() {
  stars=[];
  for(let i=0;i<130;i++){
    stars.push({x:Math.random()*W,y:Math.random()*H*0.8,r:0.5+Math.random()*1.5,
      alpha:0.2+Math.random()*0.6,twinkle:Math.random()*Math.PI*2,speed:0.01+Math.random()*0.02});
  }
}

function drawBackground(t) {
  const sky=ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#050710'); sky.addColorStop(0.65,'#0c0e1a'); sky.addColorStop(1,'#131624');
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,H);

  // Stars
  for(const s of stars){
    s.twinkle+=s.speed;
    const alpha=s.alpha*(0.7+0.3*Math.sin(s.twinkle));
    ctx.globalAlpha=alpha; ctx.fillStyle='#ffffff';
    ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;

  // Moon
  const mX=W*0.84, mY=H*0.11;
  ctx.fillStyle='rgba(245,230,185,0.92)';
  ctx.beginPath(); ctx.arc(mX,mY,26,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(13,15,26,0.93)';
  ctx.beginPath(); ctx.arc(mX+7,mY-4,21,0,Math.PI*2); ctx.fill();

  // Distant forest silhouette (horde mode)
  if (STATE.mode==='1player') drawForest();
}

function drawForest() {
  ctx.fillStyle='rgba(10,18,12,0.85)';
  const treeH=H*0.2;
  // Left side trees
  for(let i=0;i<8;i++){
    const tx=i*(W*0.08), tw=28+i*4, th=treeH*(0.7+Math.sin(i)*0.3);
    ctx.beginPath();
    ctx.moveTo(tx,H-25);
    ctx.lineTo(tx+tw/2,H-25-th);
    ctx.lineTo(tx+tw,H-25);
    ctx.closePath(); ctx.fill();
  }
  // Right side trees
  for(let i=0;i<8;i++){
    const tx=W-i*(W*0.08)-32, tw=28+i*4, th=treeH*(0.7+Math.sin(i+3)*0.3);
    ctx.beginPath();
    ctx.moveTo(tx,H-25);
    ctx.lineTo(tx+tw/2,H-25-th);
    ctx.lineTo(tx+tw,H-25);
    ctx.closePath(); ctx.fill();
  }
}

// ============================================================
// WAVE / HORDE SYSTEM
// ============================================================

let enemies       = [];
let waveSpawnQueue = [];
let waveSpawnTimer = 0;
let waveClearDelay = 0;
let waveActive     = false;

function pickEnemyType(n) {
  const r = Math.random();
  if (n >= 4 && r < 0.14) return 'tank';
  if (n >= 3 && r < 0.38) return 'runner';
  return 'grunt';
}

function startWave(waveNum) {
  STATE.wave        = waveNum;
  STATE.kills       = 0;
  STATE.damageTaken = 0;
  STATE.intermission = false;
  waveActive     = true;
  waveClearDelay = 0;

  const boss = true;   // every wave has a boss
  let count = Math.min(3 + (waveNum - 1) * 2, 22); // Wave 1=3, W2=5, W3=7 …
  const types = [];
  if (boss) { types.push('boss'); count = Math.max(3, Math.floor(count * 0.5)); }
  for (let i = 0; i < count; i++) types.push(pickEnemyType(waveNum));

  waveSpawnQueue = [];
  const gap = Math.max(0.45, 1.6 - waveNum * 0.06);   // seconds between spawns
  types.forEach((type, i) => {
    const fromLeft = Math.random() < 0.5;
    waveSpawnQueue.push({
      type,
      x: fromLeft ? -40 : W + 40,
      y: H - 25 - 30 * ENEMY_TYPES[type].scale - 4,   // feet just above the ground line
      facing: fromLeft ? 1 : -1,
      delay: 0.5 + i * gap,
    });
  });

  waveSpawnTimer = 0;
  updateWaveHUD(waveNum, types.length);
  waveBanner = {
    text: boss ? `BOSS WAVE ${waveNum}` : `WAVE ${waveNum}`,
    sub:  boss ? 'A warlord approaches!' : `${types.length} enemies incoming`,
    t: 0, boss,
  };
  playSound('horn');
  document.getElementById('round-display').textContent = `WAVE ${waveNum}`;
}

function updateWave(dt) {
  const sec = dt / 60;

  // Combo decays if you stop killing
  if (STATE.comboTimer > 0) {
    STATE.comboTimer -= sec;
    if (STATE.comboTimer <= 0) STATE.combo = 0;
  }

  if (!waveActive) return;

  // Spawn queued enemies
  waveSpawnTimer += sec;
  for (let i = waveSpawnQueue.length-1; i>=0; i--) {
    const item = waveSpawnQueue[i];
    if (waveSpawnTimer >= item.delay) {
      enemies.push(new HordeEnemy(item.x, item.y, item.facing, STATE.wave, item.type));
      waveSpawnQueue.splice(i, 1);
      spawnParticles(item.x < 0 ? 0 : W, item.y, '#ff6b6b', 8);
    }
  }

  // Update all enemies
  for (const e of enemies) e.update(dt);

  // Clean up truly gone ragdolls
  for (let i=enemies.length-1;i>=0;i--) {
    if (enemies[i].isDead && !enemies[i].ragdoll) enemies.splice(i,1);
  }

  // Check if wave is cleared
  const alive = enemies.filter(e => !e.isDead).length;
  if (alive === 0 && waveSpawnQueue.length === 0 && !STATE.roundOver) {
    waveClearDelay += sec;
    if (waveClearDelay > 2.2) {
      waveActive = false;
      const flawless = STATE.damageTaken === 0;
      let coinsEarned = 15 + STATE.wave * 10;
      if (flawless) coinsEarned += Math.round(coinsEarned * 0.5);
      STATE.coins += coinsEarned;
      STATE.score += STATE.wave * 250 + (flawless ? 500 : 0);
      STATE.bestWave = Math.max(STATE.bestWave, STATE.wave);
      saveProgress();
      showWaveClearScreen(coinsEarned, flawless);
    }
  }
}

function damageTower(amount) {
  if (STATE.mode !== '1player' || STATE.roundOver) return;
  STATE.towerHp = Math.max(0, STATE.towerHp - amount);
  shake = Math.max(shake, 4);
  if (towerData) {
    spawnParticles(towerData.x + Math.random()*towerData.w, towerData.y + Math.random()*towerData.h, '#6b7bb8', 4);
  }
  playSound('hit');
  if (STATE.towerHp <= 0 && players[0] && !players[0].isDead) {
    STATE.deathCause = 'tower';
    shake = 18;
    players[0].die();
  }
}

function showWaveClearScreen(coins, flawless) {
  if (STATE.roundOver) return;
  STATE.roundOver    = true;
  STATE.intermission = true;

  const el     = document.getElementById('round-over');
  const title  = document.getElementById('round-result-title');
  const msg    = document.getElementById('round-result-msg');
  const earned = document.getElementById('coins-earned-amount');
  const nextBtn = document.getElementById('next-round-btn');

  const towerPct = Math.round(STATE.towerHp / STATE.towerMax * 100);
  title.textContent = `⚔️ WAVE ${STATE.wave} CLEARED!`;
  title.style.color = 'var(--accent-green)';
  msg.textContent   = `${flawless ? '⭐ FLAWLESS! ' : ''}Kills: ${STATE.kills}  |  Total: ${STATE.totalKills}  |  Score: ${STATE.score}  |  Tower: ${towerPct}%`;
  earned.textContent = `+${coins} 💰 COINS EARNED!`;
  const nextIsBoss = true;
  nextBtn.textContent = `NEXT WAVE (${STATE.wave+1}) ▶${nextIsBoss ? '  ⚠ BOSS' : ''}`;
  el.classList.remove('hidden');
  updateUpgradeUI();
}

function endHordeRound() {
  if (STATE.roundOver) return;
  STATE.roundOver = true;
  waveActive = false;
  const runId = STATE.runId;

  setTimeout(() => {
    if (runId !== STATE.runId || !STATE.running) return;   // player already left / restarted
    const el    = document.getElementById('game-over');
    const title = document.getElementById('gameover-title');
    const msg   = document.getElementById('gameover-msg');
    const score = document.getElementById('final-score-display');

    const full = Math.max(0, STATE.wave - 1);
    title.textContent = STATE.deathCause === 'tower' ? '🏰 TOWER DESTROYED!' : '💀 YOU FELL!';
    title.style.color = 'var(--accent-red)';
    msg.textContent   = `You survived ${full} full wave${full === 1 ? '' : 's'} and slew ${STATE.totalKills} enemies! Best combo: x${STATE.bestCombo}`;
    score.textContent = `SCORE ${STATE.score} | WAVE ${STATE.wave}`;
    el.classList.remove('hidden');
    saveLeaderboard(STATE.totalKills, STATE.wave);
    saveProgress();
  }, 1500);
}

// ============================================================
// AIMING INPUT
// ============================================================

let aimState = { active:false, startX:0, startY:0, curX:0, curY:0, player:null };
let ghostPos = null;   // hover position while placing a defence

function getEventPos(e,el){
  const rect=el.getBoundingClientRect();
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  if (t) return {x:t.clientX-rect.left,y:t.clientY-rect.top};
  return {x:e.clientX-rect.left,y:e.clientY-rect.top};
}

function onPointerDown(e){
  if(!STATE.running) return;
  e.preventDefault();
  const pos=getEventPos(e,canvas);
  // Defence placement mode intercept (works while the shop has the game paused)
  if (defencePlacementMode) {
    placeDefenceAt(pos.x, pos.y);
    return;
  }
  if(STATE.paused||STATE.roundOver||STATE.shopOpen) return;
  let tp=players[0];
  if(STATE.mode==='2player') tp=pos.x<W/2?players[0]:players[1];
  if(tp&&!tp.isAI&&!tp.isDead){
    aimState={active:true,startX:pos.x,startY:pos.y,curX:pos.x,curY:pos.y,player:tp};
    tp.isAiming=true; tp.aimPower=0;
  }
}

function onPointerMove(e){
  const pos=getEventPos(e,canvas);
  if (defencePlacementMode) ghostPos = pos;
  if(!aimState.active) return;
  e.preventDefault();
  const p=aimState.player;
  aimState.curX=pos.x; aimState.curY=pos.y;
  const dx=aimState.startX-pos.x, dy=aimState.startY-pos.y;
  p.aimAngle=Math.atan2(-dy,-dx);
  p.facing=Math.cos(p.aimAngle)>=0?1:-1;
  p.aimPower=Math.min(p.maxPower,Math.sqrt(dx*dx+dy*dy)/10*p.pullSpeed);
}

function onPointerUp(e){
  if(!aimState.active) return;
  e.preventDefault();
  const p=aimState.player;
  if(p&&p.isAiming&&p.aimPower>0.5&&!STATE.paused) shootArrow(p);
  if(p){p.isAiming=false;p.aimPower=0;}
  aimState.active=false; aimState.player=null;
}

canvas.addEventListener('mousedown',  onPointerDown, {passive:false});
canvas.addEventListener('mousemove',  onPointerMove, {passive:false});
canvas.addEventListener('mouseup',    onPointerUp,   {passive:false});
window.addEventListener('mouseup',    onPointerUp,   {passive:false});   // released outside the canvas
canvas.addEventListener('touchstart', onPointerDown, {passive:false});
canvas.addEventListener('touchmove',  onPointerMove, {passive:false});
canvas.addEventListener('touchend',   onPointerUp,   {passive:false});
canvas.addEventListener('contextmenu',e=>e.preventDefault());

// ============================================================
// SHOOTING
// ============================================================

const arrows = [];

function shootArrow(player) {
  if (player.isDead) return false;
  let type  = player.selectedArrow || 'normal';
  // Special arrows use limited ammo that respawns over time (player 1 only)
  let spent = null;
  if (type !== 'normal' && player === players[0]) {
    const sa = SPECIAL_ARROWS.find(a => a.id === type);
    if (sa && sa.ammo === undefined) sa.ammo = ammoMax();
    if (!sa || sa.ammo <= 0) {
      floatText(player.x, player.y - 70, 'OUT OF AMMO', '#f87171', 13);
      type = 'normal';
    } else spent = sa;
  }
  // Arrow slots = extra arrows per shot (fan). Shooting costs stamina.
  const count = (type === 'shot' ? 3 : 1) + (player.arrowSlots - 1);
  const cost  = 6 + (count - 1) * 2 + (type === 'minigun' ? 6 : 0);
  if (player.stamina < cost) {
    floatText(player.x, player.y - 55, 'NO STAMINA', '#60a5fa', 13);
    return false;
  }
  player.stamina -= cost;
  if (spent) spent.ammo--;

  const bA = player.aimAngle, bD = 28, power = player.aimPower;
  const ox = player.x + Math.cos(bA)*bD, oy = (player.y-20) + Math.sin(bA)*bD;

  if (type === 'minigun') {
    const burst = 5 + (player.arrowSlots - 1) * 2;
    let c = 0;
    const b = setInterval(() => {
      if (c >= burst || player.isDead || !STATE.running) { clearInterval(b); return; }
      if (STATE.paused) return;
      arrows.push(new Arrow(ox+(Math.random()-0.5)*4, oy+(Math.random()-0.5)*4,
        bA+(Math.random()-0.5)*0.25, power, player, 'minigun', false));
      c++;
    }, 80);
  } else {
    const spread = type === 'shot' ? 0.18 : 0.1;
    for (let i = 0; i < count; i++) {
      const off = (i - (count-1)/2) * spread;
      arrows.push(new Arrow(ox, oy, bA + off, power, player, type, false));
    }
  }

  spawnParticles(ox,oy,'#f5c842',4);
  playSound('shoot');
  return true;
}

// ============================================================
// SOUND
// ============================================================

let audioCtx=null;

function getAudioCtx(){
  if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type){
  if(!STATE.sfx) return;
  try{
    const ac=getAudioCtx(); if(ac.state==='suspended') ac.resume(); const osc=ac.createOscillator(), gain=ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    const now=ac.currentTime;
    switch(type){
      case 'shoot':
        osc.type='sawtooth'; osc.frequency.setValueAtTime(260,now);
        osc.frequency.exponentialRampToValueAtTime(75,now+0.18);
        gain.gain.setValueAtTime(0.15,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.18);
        osc.start(now); osc.stop(now+0.18); break;
      case 'hit':
        osc.type='square'; osc.frequency.setValueAtTime(150,now);
        osc.frequency.exponentialRampToValueAtTime(40,now+0.15);
        gain.gain.setValueAtTime(0.22,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.15);
        osc.start(now); osc.stop(now+0.15); break;
      case 'jump':
        osc.type='sine'; osc.frequency.setValueAtTime(200,now);
        osc.frequency.exponentialRampToValueAtTime(480,now+0.12);
        gain.gain.setValueAtTime(0.08,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.12);
        osc.start(now); osc.stop(now+0.12); break;
      case 'death':
        osc.type='sawtooth'; osc.frequency.setValueAtTime(180,now);
        osc.frequency.exponentialRampToValueAtTime(25,now+0.7);
        gain.gain.setValueAtTime(0.28,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.7);
        osc.start(now); osc.stop(now+0.7); break;
      case 'hurt':
        osc.type='triangle'; osc.frequency.setValueAtTime(220,now);
        osc.frequency.exponentialRampToValueAtTime(70,now+0.2);
        gain.gain.setValueAtTime(0.2,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.2);
        osc.start(now); osc.stop(now+0.2); break;
      case 'horn':
        osc.type='sawtooth'; osc.frequency.setValueAtTime(110,now);
        osc.frequency.linearRampToValueAtTime(165,now+0.5);
        gain.gain.setValueAtTime(0.12,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.7);
        osc.start(now); osc.stop(now+0.7); break;
      case 'upgrade':
        osc.type='sine'; osc.frequency.setValueAtTime(380,now);
        osc.frequency.setValueAtTime(560,now+0.1); osc.frequency.setValueAtTime(760,now+0.2);
        gain.gain.setValueAtTime(0.13,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.3);
        osc.start(now); osc.stop(now+0.3); break;
    }
  }catch(e){}
}

// ============================================================
// GAME LOOP
// ============================================================

// ---- Procedural background music ----
let musicTimer = null, musicStep = 0;
const BASS_LINE = [55, 55, 65.41, 49, 55, 55, 73.42, 65.41];
const LEAD_LINE = [220, 261.63, 293.66, 261.63, 329.63, 293.66, 261.63, 196];

function tone(freq, dur, type, vol) {
  const ac = getAudioCtx();
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = type; osc.frequency.value = freq;
  osc.connect(g); g.connect(ac.destination);
  const now = ac.currentTime;
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.start(now); osc.stop(now + dur + 0.02);
}

function musicTick() {
  if (!STATE.music || !STATE.running || STATE.paused) return;
  try {
    const ac = getAudioCtx();
    if (ac.state === 'suspended') ac.resume();
    const i = musicStep % 8;
    const horde = STATE.mode === '1player';
    const boss = horde;
    tone(BASS_LINE[i], 0.3, 'triangle', 0.06);
    if (i % 2 === 0) tone(48, 0.12, 'sine', 0.08);
    if ((!horde || STATE.wave >= 3) && i % 2 === 1) tone(LEAD_LINE[i], 0.2, 'square', 0.015);
    if (boss && i % 4 === 2) tone(BASS_LINE[i] * 2, 0.15, 'sawtooth', 0.03);
    musicStep++;
  } catch (e) {}
}

function startMusic() { stopMusic(); if (STATE.music) musicTimer = setInterval(musicTick, 280); }
function stopMusic()  { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

let players  = [];
let lastTime = 0;
let animId   = null;

function gameLoop(ts){
  if(!STATE.running) return;
  const dt=Math.max(0,Math.min((ts-lastTime)/16.67,3));
  lastTime=ts;
  if(!STATE.paused){
    if(!STATE.roundOver) update(dt); else updatePassive(dt);
  }
  render(ts/1000);
  animId=requestAnimationFrame(gameLoop);
}

// ============================================================
// KEYBOARD INPUT
// ============================================================

const keysHeld = {};

function togglePause() {
  if (!STATE.running) return;
  if (STATE.paused) { if (!STATE.shopOpen && !defencePlacementMode) resumeGame(); }
  else showPause();
}

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (STATE.running && (k === ' ' || k.startsWith('arrow'))) e.preventDefault();
  const first = !keysHeld[k];
  keysHeld[k] = true;
  if (!STATE.running || !first) return;

  if (k === 'escape') {
    if (defencePlacementMode) cancelPlacement();
    else if (STATE.shopOpen) closeUpgrades();
    else togglePause();
  } else if (k === 'p') {
    if (!STATE.shopOpen && !defencePlacementMode) togglePause();
  } else if (k === ' ' || k === 'w') {
    player1Jump();
  } else if (k === 'arrowup') {
    if (STATE.mode === '2player') player2Jump(); else player1Jump();
  } else if (k === 'q') {
    cycleArrow(-1);
  } else if (k === 'e') {
    cycleArrow(1);
  } else if (k === 'b') {
    if (defencePlacementMode) return;
    if (STATE.shopOpen) closeUpgrades();
    else if (!STATE.paused && document.getElementById('game-over').classList.contains('hidden')) showUpgrades();
  }
});
document.addEventListener('keyup', e => {
  keysHeld[e.key.toLowerCase()] = false;
});
window.addEventListener('blur', () => { for (const k in keysHeld) keysHeld[k] = false; });

// On-screen hold buttons (touch)
function bindHold(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const down = e => { e.preventDefault(); keysHeld[key] = true; };
  const up   = e => { e.preventDefault(); keysHeld[key] = false; };
  ['touchstart','mousedown'].forEach(ev => el.addEventListener(ev, down, {passive:false}));
  ['touchend','touchcancel','mouseup','mouseleave'].forEach(ev => el.addEventListener(ev, up, {passive:false}));
}

function applyKeyboardMovement(dt) {
  if (!STATE.running || STATE.paused || STATE.roundOver) return;
  const accel = 0.6 * dt;
  const twoP  = STATE.mode === '2player';

  const p = players[0];
  if (p && !p.isDead) {
    const L = keysHeld['a'] || (!twoP && keysHeld['arrowleft']);
    const R = keysHeld['d'] || (!twoP && keysHeld['arrowright']);
    if (L) p.vx -= accel;
    if (R) p.vx += accel;
    if (L || R) p.walkCycle += 0.18 * dt;

    // Clamp player to tower-top platform bounds (1-player mode)
    if (STATE.mode === '1player') {
      const tower = platforms.find(pl => pl.isTowerTop);
      if (tower) {
        const minX = tower.x + p.w / 2;
        const maxX = tower.x + tower.w - p.w / 2;
        if (p.x < minX) { p.x = minX; p.vx = Math.max(0, p.vx); }
        if (p.x > maxX) { p.x = maxX; p.vx = Math.min(0, p.vx); }
      }
    }
  }

  const p2 = players[1];
  if (twoP && p2 && !p2.isDead) {
    if (keysHeld['arrowleft'])  p2.vx -= accel;
    if (keysHeld['arrowright']) p2.vx += accel;
    if (keysHeld['arrowleft'] || keysHeld['arrowright']) p2.walkCycle += 0.18 * dt;
  }
}

// Idle bow arm tracks the closest enemy
function autoAimPlayer(dt) {
  const p = players[0];
  if (!p || p.isDead || p.isAiming) return;
  let best = null, bd = 1e9;
  for (const e of enemies) {
    if (e.isDead) continue;
    const d = Math.abs(e.x - p.x);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  const tgt = Math.atan2((best.y - 20) - (p.y - 20), best.x - p.x);
  let d = tgt - p.aimAngle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  p.aimAngle += d * Math.min(1, 0.15 * dt);
  p.facing = best.x > p.x ? 1 : -1;
}

// ---- Arrow ammo: specials have limited ammo that respawns one at a time ----
const AMMO_GAP = { fire:5, balloon:6, shot:6, minigun:8, shuriken:5, hook:6, mace:7, axe:6, telescop:12, electric:7 };

function ammoMax() {
  const p = players[0];
  return 4 + 2 * ((p ? p.arrowSlots : 1) - 1);
}

function refillAmmo() {
  const max = ammoMax();
  for (const a of SPECIAL_ARROWS) { a.ammo = max; a.ammoTimer = 0; }
}

function tickAmmo(dt) {
  if (!players[0]) return;
  const max = ammoMax(), sec = dt / 60;
  for (const a of SPECIAL_ARROWS) {
    if (!a.unlocked) continue;
    if (a.ammo === undefined) { a.ammo = max; a.ammoTimer = 0; }
    if (a.ammo >= max) { a.ammoTimer = 0; continue; }
    a.ammoTimer += sec;
    if (a.ammoTimer >= (AMMO_GAP[a.id] || 6)) { a.ammo++; a.ammoTimer = 0; }
  }
}

// Floating quick-select menu above the player
function buildAmmoMenu() {
  const el = document.getElementById('ammo-menu');
  if (!el) return;
  el.innerHTML = '';
  const slots = [{ id:'normal', emoji:'🏹', name:'NORMAL', desc:'Unlimited' }, ...SPECIAL_ARROWS.filter(a => a.unlocked)];
  for (const s of slots) {
    const b = document.createElement('button');
    b.className = 'ammo-slot';
    b.dataset.id = s.id;
    b.title = `${s.name} — ${s.desc}` + (AMMO_GAP[s.id] ? ` (+1 ammo every ${AMMO_GAP[s.id]}s)` : '');
    b.innerHTML = `<span class="ammo-emoji">${s.emoji}</span><span class="ammo-count">∞</span><span class="ammo-fill"></span>`;
    b.onclick = () => { chooseArrow(s.id); b.blur(); };
    el.appendChild(b);
  }
}

function chooseArrow(id) {
  if (id === 'normal') {
    SPECIAL_ARROWS.forEach(a => { a.selected = false; });
    if (players[0]) players[0].selectedArrow = null;
    document.getElementById('p1-special-display').textContent = '';
    saveProgress();
  } else selectArrow(id);
}

function updateAmmoMenu() {
  const el = document.getElementById('ammo-menu');
  if (!el) return;
  const p = players[0];
  if (!STATE.running || !p || p.isDead) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.style.left = Math.max(80, Math.min(W - 80, p.x)) + 'px';
  el.style.top  = Math.max(110, p.y - 100) + 'px';
  const max = ammoMax();
  for (const b of el.children) {
    const id = b.dataset.id;
    const sel = id === 'normal' ? !p.selectedArrow : p.selectedArrow === id;
    b.classList.toggle('selected', sel);
    if (id === 'normal') continue;
    const a = SPECIAL_ARROWS.find(x => x.id === id);
    if (!a) continue;
    const have = a.ammo === undefined ? max : a.ammo;
    b.querySelector('.ammo-count').textContent = `${have}/${max}`;
    b.classList.toggle('empty', have <= 0);
    b.querySelector('.ammo-fill').style.width = (have >= max ? 100 : (a.ammoTimer || 0) / (AMMO_GAP[id] || 6) * 100) + '%';
  }
}

function tickScreenFx(dt) {
  tickAmmo(dt);
  shake *= Math.pow(0.88, dt);
  if (shake < 0.2) shake = 0;
  hurtFlash = Math.max(0, hurtFlash - 0.05 * dt);
  if (waveBanner) {
    waveBanner.t += dt / 60;
    if (waveBanner.t > 2.6) waveBanner = null;
  }
}

function stepArrows(dt) {
  for(let i=arrows.length-1;i>=0;i--){
    arrows[i].update(dt);
    if(arrows[i].hit&&arrows[i].age>0.4) arrows.splice(i,1);
  }
}

// Runs while the round is over (ragdolls, flying arrows & particles keep moving)
function updatePassive(dt) {
  for (const p of players) p.update(dt);
  for (const e of enemies) e.update(dt);
  stepArrows(dt);
  updateParticles(dt);
  updateDmgTexts(dt);
  tickScreenFx(dt);
}

function update(dt){
  applyKeyboardMovement(dt);
  for(const p of players) p.update(dt);
  if(STATE.mode==='1player'){ updateWave(dt); autoAimPlayer(dt); }
  if(simpleAI) simpleAI.update(dt);
  stepArrows(dt);
  updateParticles(dt);
  updateDmgTexts(dt);
  tickScreenFx(dt);
  // Update placed defences
  for (let i = placedDefences.length-1; i >= 0; i--) {
    placedDefences[i].update(dt);
    if (placedDefences[i].isDead) placedDefences.splice(i, 1);
  }
  updateHUD();

  // 1v1 end condition
  if(STATE.mode!=='1player'){
    const p1=players[0],p2=players[1];
    if((p1?.isDead||p2?.isDead)&&!STATE.roundOver) end1v1Round();
  }
}

function render(t){
  ctx.clearRect(0,0,W,H);
  ctx.save();
  if (shake > 0.3) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
  drawBackground(t);
  drawGround();
  drawPlatforms();
  for (const d of placedDefences) d.draw();
  drawParticles();
  for(const a of arrows) a.draw();
  if(STATE.mode==='1player') for(const e of enemies) e.draw();
  for(const p of players) p.draw();
  drawDmgTexts();
  if(aimState.active&&aimState.player&&!aimState.player.isDead) { drawAimGuide(aimState.player); drawDragLine(); }
  if(defencePlacementMode && ghostPos) drawPlacementGhost();
  ctx.restore();
  drawScreenOverlays();
  updateAmmoMenu();
}

function drawDragLine() {
  const p = aimState.player;
  ctx.save();
  ctx.strokeStyle = 'rgba(245,200,66,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([6,5]);
  ctx.beginPath(); ctx.moveTo(aimState.startX, aimState.startY); ctx.lineTo(aimState.curX, aimState.curY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(aimState.startX, aimState.startY, 5, 0, Math.PI*2); ctx.stroke();
  // Power ring around the archer
  const pw = Math.min(1, p.aimPower / p.maxPower);
  ctx.strokeStyle = `hsl(${120 - pw*120},100%,55%)`; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(p.x, p.y - 10, 36, -Math.PI/2, -Math.PI/2 + pw*Math.PI*2); ctx.stroke();
  ctx.restore();
}

function drawPlacementGhost() {
  const def = DEFENCE_CATALOGUE.find(d => d.id === defencePlacementMode);
  if (!def) return;
  const x = ghostPos.x, y = defenceSpot(def, ghostPos.x, ghostPos.y);
  ctx.save();
  ctx.globalAlpha = 0.55; ctx.fillStyle = def.color; ctx.strokeStyle = def.glowColor; ctx.lineWidth = 2;
  ctx.fillRect(x - def.w/2, y - def.h/2, def.w, def.h);
  ctx.strokeRect(x - def.w/2, y - def.h/2, def.w, def.h);
  ctx.globalAlpha = 1; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(def.emoji, x, y - def.h/2 - 6);
  ctx.restore();
}

function drawScreenOverlays() {
  // Hurt flash + low-health vignette
  const p = players[0];
  let a = hurtFlash * 0.35;
  if (p && !p.isDead) {
    const low = p.hp / p.maxHp;
    if (low < 0.3) a = Math.max(a, (0.3 - low) * 0.9 * (0.6 + 0.4*Math.sin(Date.now()/180)));
  }
  if (a > 0.01) {
    const g = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.35, W/2, H/2, Math.max(W,H)*0.75);
    g.addColorStop(0, 'rgba(220,30,30,0)');
    g.addColorStop(1, `rgba(220,30,30,${Math.min(0.7, a*1.6)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (STATE.mode === '1player') {
    drawHordeHUD();
    drawWaveBanner();
    if (waveSpawnQueue.length > 0 && !STATE.roundOver) drawSpawnAlert();
  }
}

function drawHordeHUD() {
  const left = enemies.filter(e => !e.isDead).length + waveSpawnQueue.length;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px "Orbitron",monospace';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.fillStyle = '#e8eaf0';
  const txt = `SCORE ${STATE.score.toLocaleString()}    ☠ ${left} LEFT`;
  ctx.strokeText(txt, W/2, 96); ctx.fillText(txt, W/2, 96);
  if (STATE.combo >= 2) {
    const f = Math.max(0, STATE.comboTimer / 4);
    ctx.font = 'bold 20px "Orbitron",monospace';
    ctx.fillStyle = `hsl(${40 - Math.min(STATE.combo,10)*3},100%,60%)`;
    const ct = `x${STATE.combo} COMBO`;
    ctx.strokeText(ct, W/2, 122); ctx.fillText(ct, W/2, 122);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W/2 - 50, 130, 100, 4);
    ctx.fillStyle = '#fb923c'; ctx.fillRect(W/2 - 50, 130, 100 * f, 4);
  }
  ctx.restore();
}

function drawWaveBanner() {
  if (!waveBanner) return;
  const t = waveBanner.t;
  const a  = t < 0.3 ? t / 0.3 : t > 2.1 ? Math.max(0, (2.6 - t) / 0.5) : 1;
  const sc = 1 + Math.max(0, 0.3 - t) * 1.5;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(W/2, H*0.3); ctx.scale(sc, sc);
  ctx.textAlign = 'center';
  ctx.font = '900 44px "Orbitron",monospace';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.fillStyle = waveBanner.boss ? '#c084fc' : '#f5c842';
  ctx.strokeText(waveBanner.text, 0, 0); ctx.fillText(waveBanner.text, 0, 0);
  ctx.font = '600 16px Inter,sans-serif';
  ctx.fillStyle = '#e8eaf0';
  ctx.strokeText(waveBanner.sub, 0, 30); ctx.fillText(waveBanner.sub, 0, 30);
  ctx.restore();
}


function drawAimGuide(p){
  if(!p.isAiming||p.aimPower<0.5) return;
  const pw = p.aimPower / p.maxPower;

  // Simulate trajectory until it hits ground/platform or goes offscreen
  let gx  = p.x  + Math.cos(p.aimAngle)*28;
  let gy  = (p.y-20) + Math.sin(p.aimAngle)*28;
  let gvx = Math.cos(p.aimAngle)*p.aimPower;
  let gvy = Math.sin(p.aimAngle)*p.aimPower;

  // Exactly the same per-frame physics and collision rules as Arrow.update,
  // so the dots are the real flight path.
  const maxPts = 400;
  const dots = [];
  let landX = null, landY = null;

  for (let i = 0; i < maxPts; i++) {
    gvy += ARROW_GRAV;
    gx  += gvx;
    gy  += gvy;

    let landed = false;
    for (const plat of platforms) {
      if (plat.isTowerTop && gvy > 0) continue;   // player arrows pass through the tower top going down
      if (gx > plat.x && gx < plat.x + plat.w && gy >= plat.y && gy <= plat.y + 10) {
        landX = gx; landY = plat.y;
        landed = true;
        break;
      }
    }
    if (gx < -50 || gx > W + 50 || gy > H + 50) landed = true;

    dots.push({ x: gx, y: gy, i });
    if (landed) break;
  }

  ctx.save();
  // Draw dots with fade
  for (let d = 0; d < dots.length; d++) {
    // Only draw every few dots for spacing
    if (d % 4 !== 0) continue;
    const { x, y, i } = dots[d];
    const alpha = (1 - d / dots.length) * 0.85;
    const radius = 3.5 - (d / dots.length) * 2.5;
    // Colour shifts from green (low power) to gold (high power) to red (max)
    const hue = pw < 0.5 ? 100 - pw * 80 : 60 - (pw - 0.5) * 80;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
    ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, radius), 0, Math.PI * 2);
    ctx.fill();
  }

  // Landing impact marker
  if (landX !== null) {
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 120);
    ctx.globalAlpha = 0.9 * pulse;
    ctx.shadowColor = '#f5c842';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#f5c842';
    ctx.lineWidth = 2;
    // X cross
    const r = 7;
    ctx.beginPath();
    ctx.moveTo(landX - r, landY - r); ctx.lineTo(landX + r, landY + r);
    ctx.moveTo(landX + r, landY - r); ctx.lineTo(landX - r, landY + r);
    ctx.stroke();
    // Circle
    ctx.beginPath();
    ctx.arc(landX, landY, r * 1.4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSpawnAlert() {
  // Flashing markers at the screen edges showing where enemies are about to appear
  const alpha = 0.35 + 0.35 * Math.sin(Date.now() / 160);
  const left  = waveSpawnQueue.some(q => q.x < 0);
  const right = waveSpawnQueue.some(q => q.x > 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ff6b6b';
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'center';
  if (left)  { ctx.fillRect(0, 0, 8, H); ctx.fillText('◀ INCOMING', 80, H/2); }
  if (right) { ctx.fillRect(W-8, 0, 8, H); ctx.fillText('INCOMING ▶', W-80, H/2); }
  ctx.restore();
}

// ============================================================
// HUD
// ============================================================

function updateHUD(){
  const p1=players[0];
  if(!p1) return;
  if(STATE.mode==='1player') updateHordeHUD();
  const hpPct=Math.max(0,p1.hp/p1.maxHp*100).toFixed(0);
  const stPct=Math.max(0,p1.stamina/p1.maxStamina*100).toFixed(0);
  document.getElementById('p1-hp-fill').style.width=hpPct+'%';
  document.getElementById('p1-stamina-fill').style.width=stPct+'%';
  document.getElementById('p1-hp-label').textContent=Math.ceil(p1.hp);
  document.getElementById('p1-stamina-label').textContent=Math.ceil(p1.stamina);

  if(STATE.mode!=='1player'){
    const p2=players[1];
    if(!p2) return;
    document.getElementById('p2-hp-fill').style.width=Math.max(0,p2.hp/p2.maxHp*100)+'%';
    document.getElementById('p2-stamina-fill').style.width=Math.max(0,p2.stamina/p2.maxStamina*100)+'%';
    document.getElementById('p2-hp-label').textContent=Math.ceil(p2.hp);
    document.getElementById('p2-stamina-label').textContent=Math.ceil(p2.stamina);
  }
}

function updateHordeHUD(){
  document.getElementById('p1-score').textContent=STATE.kills;
  document.getElementById('p2-score').textContent=STATE.totalKills;
  document.getElementById('round-display').textContent=`WAVE ${STATE.wave}`;
  const nm = document.getElementById('p2-name');
  if (nm && STATE.mode === '1player') nm.textContent = `💰 ${STATE.coins}`;
}

function updateWaveHUD(wNum, total){
  document.getElementById('p1-score').textContent='0';
  document.getElementById('round-display').textContent=`WAVE ${wNum}`;
}

function repositionPlayer(){
  if(!players[0]) return;
  const p=players[0];
  if(STATE.mode==='1player'){
    const top=platforms.find(pl=>pl.isTowerTop);
    if(top){ p.x=top.x+top.w/2; p.y=top.y-p.h/2; }
  }
}

// ============================================================
// 1v1 ROUND
// ============================================================

let p2AI = null;

function end1v1Round(){
  if(STATE.roundOver) return;
  STATE.roundOver=true;
  const p1Dead=players[0]?.isDead, p2Dead=players[1]?.isDead;
  let winner=0;
  if(p1Dead&&!p2Dead) winner=2;
  else if(!p1Dead&&p2Dead) winner=1;

  if(winner===1) STATE.p1Score++;
  else if(winner===2) STATE.p2Score++;

  const coinsEarned=winner===1?(10+STATE.round*5):5;
  if(winner===1) STATE.coins+=coinsEarned;

  document.getElementById('p1-score').textContent=STATE.p1Score;
  document.getElementById('p2-score').textContent=STATE.p2Score;

  setTimeout(()=>{
    const el=document.getElementById('round-over');
    const title=document.getElementById('round-result-title');
    const msg=document.getElementById('round-result-msg');
    const earned=document.getElementById('coins-earned-amount');
    title.textContent=winner===0?'DRAW!':winner===1?'YOU WIN!':(STATE.mode==='2player'?'PLAYER 2 WINS!':'ENEMY WINS!');
    title.style.color=winner===1?'var(--accent-green)':winner===2?'var(--accent-red)':'var(--accent-gold)';
    msg.textContent=`Round ${STATE.round} of ${STATE.maxRounds}`;
    earned.textContent=winner===1?`+${coinsEarned} 💰 COINS`:'No coins';
    document.getElementById('next-round-btn').textContent=
      (STATE.p1Score>=3||STATE.p2Score>=3||STATE.round>=STATE.maxRounds)?'VIEW RESULTS':'NEXT ROUND ▶';
    el.classList.remove('hidden');
    updateUpgradeUI();
  },1200);
}

function init1v1Round(){
  STATE.roundOver=false;
  arrows.length=0; particles.length=0; dmgTexts.length=0;
  const tops=[platforms[1],platforms[2]];
  [players[0],players[1]].forEach((p,i)=>{
    p.x=tops[i].x+tops[i].w/2; p.y=tops[i].y-p.h/2;
    p.hp=p.maxHp; p.stamina=p.maxStamina;
    p.isDead=false; p.ragdoll=false;
    p.vx=p.vy=0; p.isAiming=false; p.aimPower=0; p.effects=[];
  });
}

// ============================================================
// SIMPLE AI FOR 1V1
// ============================================================

class SimpleAI {
  constructor(player,target){ this.player=player; this.target=target; this.timer=0; this.aimDur=0; this.aimTime=1; this.err=0; }
  update(dt){
    const me=this.player, tgt=this.target, sec=dt/60;
    if(me.isDead||tgt.isDead){ me.isAiming=false; return; }
    const lvl={easy:{wait:2.2,err:0.30},normal:{wait:1.3,err:0.16},hard:{wait:0.7,err:0.07}}[STATE.difficulty]||{wait:1.3,err:0.16};
    if(!me.isAiming){
      this.timer+=sec;
      if(this.timer>=lvl.wait){
        this.timer=0; me.isAiming=true; me.aimPower=0; this.aimDur=0;
        this.err=(Math.random()-0.5)*lvl.err*2;
        this.aimTime=0.8+Math.random()*0.5;
      }
    } else {
      this.aimDur+=sec;
      me.aimPower=Math.min(me.maxPower, me.maxPower*this.aimDur/this.aimTime);
      me.aimAngle=solveAim(me.x,me.y-20,tgt.x,tgt.y-8,me.maxPower,this.err);
      me.facing=Math.cos(me.aimAngle)>=0?1:-1;
      if(this.aimDur>=this.aimTime){
        me.aimPower=me.maxPower;
        shootArrow(me);
        me.isAiming=false; me.aimPower=0; this.timer=0;
      }
    }
  }
}

let simpleAI = null;

// ============================================================
// GAME FLOW
// ============================================================

function setHint(){
  const hint=document.getElementById('aim-hint');
  if(!hint) return;
  hint.style.color='';
  hint.textContent =
    STATE.mode==='1player' ? 'A/D move • Space jump • Drag to aim, release to shoot • Q/E arrows • B shop • P pause' :
    STATE.mode==='2player' ? 'P1: A/D + W  •  P2: ←/→ + ↑  •  Drag on your half to aim, release to shoot' :
                             'A/D move • Space jump • Drag to aim, release to shoot • Q/E arrows • P pause';
}

function revivePlayer(p){
  p.isDead=false; p.ragdoll=false; p.ragJoints=null;
  p.hp=p.maxHp; p.stamina=p.maxStamina; p.effects=[];
  p.vx=0; p.vy=0; p.isAiming=false; p.aimPower=0;
}

function resetRunState(){
  STATE.round=1; STATE.p1Score=0; STATE.p2Score=0;
  STATE.roundOver=false; STATE.intermission=false; STATE.shopOpen=false;
  STATE.wave=1; STATE.kills=0; STATE.totalKills=0;
  STATE.score=0; STATE.combo=0; STATE.comboTimer=0; STATE.bestCombo=0;
  STATE.towerHp=STATE.towerMax; STATE.damageTaken=0; STATE.deathCause='';
  STATE.runId++;
  refillAmmo();
  shake=0; hurtFlash=0; waveBanner=null;
  defencePlacementMode=null; shopPausedGame=false;
  arrows.length=0; particles.length=0; dmgTexts.length=0; enemies.length=0;
  waveSpawnQueue.length=0; waveActive=false; waveClearDelay=0;
}

function startGame(mode){
  STATE.mode=mode; STATE.paused=false;
  resetRunState();
  placedDefences.length=0;

  ['pause-screen','round-over','game-over','upgrades-panel','leaderboard-screen','settings-screen'].forEach(id=>{
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById('main-menu').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');

  const horde = mode==='1player';
  document.getElementById('p2-jump-btn').style.display=mode==='2player'?'block':'none';
  document.querySelectorAll('#p2-hud .bar-wrap').forEach(el=>{ el.style.display=horde?'none':''; });
  document.querySelector('#p1-hud .hud-name').textContent = horde ? 'ARCHER' : 'PLAYER 1';
  document.getElementById('p2-name').textContent = horde ? `💰 ${STATE.coins}` : mode==='2player' ? 'PLAYER 2' : 'AI ARCHER';
  document.getElementById('p1-score').textContent='0';
  document.getElementById('p2-score').textContent='0';
  document.getElementById('round-display').textContent = horde ? 'WAVE 1' : 'ROUND 1';
  document.getElementById('next-round-btn').textContent = horde ? 'NEXT WAVE ▶' : 'NEXT ROUND ▶';
  setHint();

  resizeCanvas(); buildPlatforms(); buildStars();

  const p1Color='#e8d5a3';
  if(horde){
    const top=platforms.find(p=>p.isTowerTop);
    const px=top?top.x+top.w/2:W/2;
    const py=top?top.y-32:H-200;
    players=[new Player(px,py,p1Color,1,'PLAYER 1')];
    players[0].applyUpgrades(UPGRADES.p1);
    simpleAI=null; p2AI=null;
    const runId=STATE.runId;
    setTimeout(()=>{ if(runId===STATE.runId&&STATE.running) startWave(1); }, 800);
  } else {
    players=[
      new Player(platforms[1].x+platforms[1].w/2, platforms[1].y-32, p1Color,1,'PLAYER 1'),
      new Player(platforms[2].x+platforms[2].w/2, platforms[2].y-32,'#6bb8ff',-1, mode==='2player'?'PLAYER 2':'AI ARCHER'),
    ];
    players[0].applyUpgrades(UPGRADES.p1);
    simpleAI = mode==='pvp' ? new SimpleAI(players[1],players[0]) : null;
  }

  // Selected arrow
  const sel=SPECIAL_ARROWS.find(a=>a.selected);
  document.getElementById('p1-special-display').textContent = sel ? sel.emoji : '';
  if(sel&&players[0]) players[0].selectedArrow=sel.id;

  STATE.running=true; lastTime=performance.now();
  if(animId) cancelAnimationFrame(animId);
  animId=requestAnimationFrame(gameLoop);
  startMusic();
  updateUpgradeUI();
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

function player1Jump(){ if(!STATE.running||STATE.paused) return; players[0]?.jump(); }
function player2Jump(){ if(!STATE.running||STATE.paused) return; if(STATE.mode==='2player') players[1]?.jump(); }

function showPause(){
  if(!STATE.running || STATE.shopOpen || defencePlacementMode) return;
  STATE.paused=true;
  document.getElementById('pause-screen').classList.remove('hidden');
}

function resumeGame(){
  STATE.paused=false; document.getElementById('pause-screen').classList.add('hidden');
  lastTime=performance.now();
}

// The shop pauses the game while it is open (unless the wave is already over)
let shopPausedGame = false;

function releaseShopPause(){
  if(shopPausedGame){ shopPausedGame=false; STATE.paused=false; lastTime=performance.now(); }
}

function showUpgrades(){
  document.getElementById('round-over').classList.add('hidden');
  document.getElementById('upgrades-panel').classList.remove('hidden');
  STATE.shopOpen=true;
  if(STATE.running && !STATE.paused && !STATE.roundOver){ STATE.paused=true; shopPausedGame=true; }
  updateUpgradeUI();
}

function closeUpgrades(keepPaused){
  document.getElementById('upgrades-panel').classList.add('hidden');
  STATE.shopOpen=false;
  if(keepPaused===true) return;     // placing a defence: stay paused for now
  releaseShopPause();
  // Back to the "wave cleared" screen so the next wave can be started
  if(STATE.intermission) document.getElementById('round-over').classList.remove('hidden');
}

function nextRound(){
  if(STATE.mode==='1player'){
    document.getElementById('round-over').classList.add('hidden');
    STATE.roundOver=false; STATE.intermission=false;
    enemies.length=0; arrows.length=0; particles.length=0; dmgTexts.length=0;
    waveSpawnQueue.length=0; waveActive=false; waveClearDelay=0;
    // Recover between waves
    const p=players[0];
    if(p&&!p.isDead){
      p.hp=Math.min(p.maxHp, p.hp + Math.round(p.maxHp*0.4));
      p.stamina=p.maxStamina; p.effects=[];
    }
    STATE.towerHp=Math.min(STATE.towerMax, STATE.towerHp + Math.round(STATE.towerMax*0.4));
    const runId=STATE.runId;
    setTimeout(()=>{ if(runId===STATE.runId&&STATE.running&&!STATE.roundOver) startWave(STATE.wave+1); }, 500);
  } else {
    if(STATE.p1Score>=3||STATE.p2Score>=3||STATE.round>=STATE.maxRounds){
      showGameOver(); return;
    }
    document.getElementById('round-over').classList.add('hidden');
    STATE.round++; document.getElementById('round-display').textContent=`ROUND ${STATE.round}`;
    init1v1Round();
  }
}

function restartRound(){
  document.getElementById('pause-screen').classList.add('hidden');
  STATE.paused=false; lastTime=performance.now();
  if(STATE.mode==='1player'){
    STATE.runId++;
    STATE.roundOver=false; STATE.intermission=false; STATE.kills=0;
    STATE.combo=0; STATE.towerHp=STATE.towerMax; STATE.damageTaken=0; STATE.deathCause='';
    enemies.length=0; arrows.length=0; waveSpawnQueue.length=0;
    waveActive=false; waveClearDelay=0; waveBanner=null;
    repositionPlayer();
    if(players[0]) revivePlayer(players[0]);
    const runId=STATE.runId;
    setTimeout(()=>{ if(runId===STATE.runId&&STATE.running&&!STATE.roundOver) startWave(STATE.wave); }, 300);
  } else {
    STATE.roundOver=false; init1v1Round();
  }
}

function restartGame(){
  document.getElementById('game-over').classList.add('hidden');
  document.getElementById('round-over').classList.add('hidden');
  STATE.paused=false; lastTime=performance.now();
  resetRunState();
  placedDefences.length=0;
  document.getElementById('p1-score').textContent=0;
  document.getElementById('p2-score').textContent=0;
  document.getElementById('round-display').textContent=STATE.mode==='1player'?'WAVE 1':'ROUND 1';
  document.getElementById('next-round-btn').textContent=STATE.mode==='1player'?'NEXT WAVE ▶':'NEXT ROUND ▶';
  if(STATE.mode==='1player'){
    repositionPlayer();
    if(players[0]) revivePlayer(players[0]);
    const runId=STATE.runId;
    setTimeout(()=>{ if(runId===STATE.runId&&STATE.running) startWave(1); }, 500);
  } else {
    init1v1Round();
  }
}

function showGameOver(){
  document.getElementById('round-over').classList.add('hidden');
  const el=document.getElementById('game-over');
  const title=document.getElementById('gameover-title');
  const msg=document.getElementById('gameover-msg');
  const score=document.getElementById('final-score-display');
  if(STATE.p1Score>STATE.p2Score){
    title.textContent='🏆 VICTORY!'; title.style.color='var(--accent-gold)';
    msg.textContent='You defeated your opponent!';
  } else if(STATE.p1Score<STATE.p2Score){
    title.textContent='DEFEATED'; title.style.color='var(--accent-red)';
    msg.textContent='Better luck next time!';
  } else {
    title.textContent='DRAW!'; title.style.color='var(--accent-cyan)';
    msg.textContent='Perfectly matched!';
  }
  score.textContent=`${STATE.p1Score} - ${STATE.p2Score}`;
  el.classList.remove('hidden');
  saveProgress();
}

function backToMenu(){
  STATE.running=false; STATE.paused=false; STATE.shopOpen=false; STATE.intermission=false;
  STATE.runId++;
  defencePlacementMode=null; shopPausedGame=false;
  stopMusic();
  if(animId) cancelAnimationFrame(animId);
  ['pause-screen','round-over','game-over','upgrades-panel'].forEach(id=>{
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById('game-screen').classList.remove('active');
  document.getElementById('main-menu').classList.add('active');
  enemies.length=0; waveSpawnQueue.length=0; waveActive=false;
  saveProgress();
  updateBestLine();
}

// ============================================================
// UPGRADES
// ============================================================

function upgrade(type){
  const upg=UPGRADES.p1, lvl=upg[type]||0;
  const cost=UPGRADE_COSTS[type]?.[lvl];
  if(cost===undefined) return;
  if(STATE.coins<cost){
    const el=document.getElementById('coins-display');
    el.style.color='var(--accent-red)'; setTimeout(()=>el.style.color='',600); return;
  }
  STATE.coins-=cost; upg[type]=lvl+1;
  players[0]?.applyUpgrades(upg);
  playSound('upgrade'); updateUpgradeUI(); saveProgress();
}

function updateUpgradeUI(){
  document.getElementById('coins-display').textContent=STATE.coins;
  buildAmmoMenu();
  for(const[key,levels] of Object.entries(UPGRADE_COSTS)){
    const lvl=UPGRADES.p1[key]||0, cost=levels[lvl];
    const le=document.getElementById(`${key}-level`), ce=document.getElementById(`${key}-cost`);
    if(le) le.textContent='+'+lvl;
    if(ce){
      if(cost===undefined){
        ce.textContent='MAX'; ce.closest('.upg-btn').disabled=true;
      } else {
        ce.textContent=`⚙️${cost}`;
        ce.closest('.upg-btn').disabled=STATE.coins<cost;
        ce.closest('.upg-btn').style.opacity=STATE.coins>=cost?'1':'0.5';
      }
    }
  }
  buildSpecialArrowsUI();
  updateDefenceUI();
}

function switchTab(tab) {
  document.getElementById('tab-content-upgrades').style.display = tab === 'upgrades' ? '' : 'none';
  document.getElementById('tab-content-defences').style.display  = tab === 'defences'  ? '' : 'none';
  document.getElementById('tab-upgrades').classList.toggle('active', tab === 'upgrades');
  document.getElementById('tab-defences').classList.toggle('active',  tab === 'defences');
  if (tab === 'defences') updateDefenceUI();
}

function buildSpecialArrowsUI(){
  const grid=document.getElementById('special-arrows-grid');
  grid.innerHTML='';
  for(const arrow of SPECIAL_ARROWS){
    const card=document.createElement('div');
    card.className=`special-arrow-card ${arrow.unlocked?'unlocked':'locked'}`;
    card.innerHTML=`
      <div class="arrow-emoji">${arrow.emoji}</div>
      <div class="arrow-info">
        <div class="arrow-name">${arrow.name}</div>
        <div class="arrow-cost">${arrow.unlocked?arrow.desc:'💰'+arrow.cost}</div>
      </div>
      ${arrow.unlocked
        ?`<button class="select-btn ${arrow.selected?'active':''}" onclick="selectArrow('${arrow.id}')">${arrow.selected?'✓':'USE'}</button>`
        :`<button class="unlock-btn" onclick="unlockArrow('${arrow.id}')">BUY</button>`}`;
    grid.appendChild(card);
  }
}

function unlockArrow(id){
  const arrow=SPECIAL_ARROWS.find(a=>a.id===id);
  if(!arrow||arrow.unlocked) return;
  if(STATE.coins<arrow.cost){
    const el=document.getElementById('coins-display');
    el.style.color='var(--accent-red)'; setTimeout(()=>el.style.color='',600); return;
  }
  STATE.coins-=arrow.cost; arrow.unlocked=true;
  playSound('upgrade'); updateUpgradeUI(); saveProgress();
}

function selectArrow(id){
  const arrow=SPECIAL_ARROWS.find(a=>a.id===id);
  if(!arrow||!arrow.unlocked) return;
  SPECIAL_ARROWS.forEach(a=>a.selected=false); arrow.selected=true;
  if(players[0]){
    players[0].selectedArrow=id;
    document.getElementById('p1-special-display').textContent=arrow.emoji;
  }
  updateUpgradeUI(); saveProgress();
}

// ============================================================
// LEADERBOARD / SETTINGS
// ============================================================

function saveLeaderboard(score, wave){
  const lb=JSON.parse(localStorage.getItem('ragdollArchersLB')||'[]');
  lb.push({name:'Player',score,wave:wave||0,date:Date.now()});
  lb.sort((a,b)=>b.score-a.score);
  localStorage.setItem('ragdollArchersLB',JSON.stringify(lb.slice(0,10)));
}

function loadLeaderboard(){ return JSON.parse(localStorage.getItem('ragdollArchersLB')||'[]'); }

function showLeaderboard(){
  const lb=loadLeaderboard();
  const list=document.getElementById('leaderboard-list');
  list.innerHTML=lb.length===0
    ?'<div style="text-align:center;color:var(--text-muted);padding:20px;">No games played yet!</div>'
    :lb.map((e,i)=>{
        const rc=i===0?'gold':i===1?'silver':i===2?'bronze':'';
        const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
        return `<div class="lb-row"><span class="lb-rank ${rc}">${medal}</span><span class="lb-name">${e.name}</span><span class="lb-score">${e.score} kills${e.wave?` · wave ${e.wave}`:''}</span></div>`;
      }).join('');
  document.getElementById('leaderboard-screen').classList.remove('hidden');
}

function showGameLeaderboard(){ showLeaderboard(); }
function closeLeaderboard(){ document.getElementById('leaderboard-screen').classList.add('hidden'); }

function syncSettingsUI(){
  [['sfx-toggle',STATE.sfx],['music-toggle',STATE.music],['particles-toggle',STATE.particles]].forEach(([id,on])=>{
    const btn=document.getElementById(id);
    if(btn){ btn.textContent=on?'ON':'OFF'; btn.classList.toggle('off',!on); }
  });
  const sel=document.getElementById('difficulty-select');
  if(sel) sel.value=STATE.difficulty;
}
function toggleSFX(){ STATE.sfx=!STATE.sfx; syncSettingsUI(); saveProgress(); }
function toggleMusic(){
  STATE.music=!STATE.music; syncSettingsUI(); saveProgress();
  if(STATE.music&&STATE.running) startMusic(); else stopMusic();
}
function toggleParticles(){ STATE.particles=!STATE.particles; syncSettingsUI(); saveProgress(); }
function changeDifficulty(val){ STATE.difficulty=val; saveProgress(); }
function showSettings(){ document.getElementById('settings-screen').classList.remove('hidden'); }
function closeSettings(){ document.getElementById('settings-screen').classList.add('hidden'); }
function resetProgress(){
  if(!confirm('Erase all coins, upgrades, arrows, defences and the leaderboard?')) return;
  try{ localStorage.removeItem(SAVE_KEY); localStorage.removeItem('ragdollArchersLB'); }catch(e){}
  location.reload();
}

// ============================================================
// INIT
// ============================================================

// ============================================================
// SAVE / LOAD (progress persists between sessions)
// ============================================================

const SAVE_KEY = 'ragdollArchersSave_v2';

function saveProgress(){
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      coins: STATE.coins,
      upgrades: UPGRADES.p1,
      arrows: SPECIAL_ARROWS.map(a=>({id:a.id,u:a.unlocked,s:a.selected})),
      defences: DEFENCE_INVENTORY,
      bestWave: STATE.bestWave,
      difficulty: STATE.difficulty,
      sfx: STATE.sfx, music: STATE.music, particles: STATE.particles,
    }));
  }catch(e){}
}

function loadProgress(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw) return;
    const d=JSON.parse(raw);
    if(typeof d.coins==='number') STATE.coins=d.coins;
    if(d.upgrades) for(const k in UPGRADES.p1){
      if(typeof d.upgrades[k]==='number') UPGRADES.p1[k]=Math.min(d.upgrades[k], UPGRADE_COSTS[k].length);
    }
    if(Array.isArray(d.arrows)) d.arrows.forEach(s=>{
      const a=SPECIAL_ARROWS.find(x=>x.id===s.id);
      if(a){ a.unlocked=!!s.u; a.selected=!!s.s&&!!s.u; }
    });
    if(d.defences) for(const k in DEFENCE_INVENTORY){
      if(typeof d.defences[k]==='number') DEFENCE_INVENTORY[k]=d.defences[k];
    }
    STATE.bestWave=d.bestWave||0;
    if(d.difficulty) STATE.difficulty=d.difficulty;
    if(typeof d.sfx==='boolean') STATE.sfx=d.sfx;
    if(typeof d.music==='boolean') STATE.music=d.music;
    if(typeof d.particles==='boolean') STATE.particles=d.particles;
  }catch(e){}
}

function updateBestLine(){
  const el=document.getElementById('best-line');
  if(el) el.textContent = STATE.bestWave>0
    ? `🏆 Best wave: ${STATE.bestWave}   •   💰 Coins: ${STATE.coins}`
    : 'Survive the horde — defend your tower!';
}

function cycleArrow(dir){
  const p=players[0];
  if(!p) return;
  const list=[null,...SPECIAL_ARROWS.filter(a=>a.unlocked).map(a=>a.id)];
  if(list.length<2) return;
  let i=list.indexOf(p.selectedArrow||null);
  i=(i+dir+list.length)%list.length;
  const id=list[i];
  SPECIAL_ARROWS.forEach(a=>{ a.selected=(a.id===id); });
  p.selectedArrow=id;
  const a=SPECIAL_ARROWS.find(x=>x.id===id);
  document.getElementById('p1-special-display').textContent=a?a.emoji:'';
  floatText(p.x,p.y-60,a?a.name:'NORMAL','#e8d5a3',12);
  saveProgress();
}

document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&STATE.running&&!STATE.paused&&!STATE.roundOver&&!STATE.shopOpen) showPause();
});
window.addEventListener('beforeunload', saveProgress);

loadProgress();
syncSettingsUI();
bindHold('btn-left','a');
bindHold('btn-right','d');
buildSpecialArrowsUI();
updateUpgradeUI();
updateBestLine();
