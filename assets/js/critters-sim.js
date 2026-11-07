/*
  Critters and You: simulation core
  ---------------------------------
  A JavaScript port of the ecosystem simulation from Critters and You
  (GameMaker, 2026). Source: github.com/silasstokes-blip/Critters
    scripts/simulate_creatures, scripts/simulate_grass_growth,
    scripts/create_creature, objects/obj_game (Create + Step)

  The port keeps the original rules, constants, update order and quirks
  (including how population counts are sampled). It leaves out the player
  avatar, hunger, shop and house, which is how the game's own title screen
  runs the ecosystem. A "spear" strike can be triggered at any cell.

  No DOM access here, so it runs in the browser or in Node.
*/
(function (root) {
  'use strict';

  var SPECIES = [
    { id: 0, name: 'Rabbit', color: '#ffffff' },
    { id: 1, name: 'Coyote', color: '#ff8228' },
    { id: 2, name: 'Elk',    color: '#ff00ff' },
    { id: 3, name: 'Wolf',   color: '#ff0000' },
    { id: 4, name: 'Mouse',  color: '#00ffff' },
    { id: 5, name: 'Ferret', color: '#0000ff' }
  ];

  // GameMaker helpers
  function random_range(a, b) { return a + Math.random() * (b - a); }
  function irandom_range(a, b) {
    a = Math.trunc(a); b = Math.trunc(b);
    if (a > b) { var t = a; a = b; b = t; }
    return a + Math.floor(Math.random() * (b - a + 1));
  }
  function choose() { return arguments[Math.floor(Math.random() * arguments.length)]; }
  function myMod(a, b) { if (a >= 0) return a % b; while (a < 0) a += b; return a; }
  function inRange(v, lo, hi) { return v >= lo && v <= hi; } // clamp(v,lo,hi) == v

  function Sim(opts) {
    opts = opts || {};
    this.gridWidth = opts.gridWidth || 128;   // room_width / cellSize  (1024 / 8)
    this.gridHeight = opts.gridHeight || 72;  // room_height / cellSize (576 / 8)
    this.gameSpeed = opts.gameSpeed || 2;     // title screen and "Fast" = 2, "Normal" = 4
    this.recordedSteps = opts.recordedSteps || 3000;
    this.onEvent = opts.onEvent || null;      // (type, x, y, speciesId) for particles
    this.reset();
  }

  Sim.SPECIES = SPECIES;
  Sim.SIZE = [0.35, 0.6, 1, 0.85, 0.25, 0.4];

  Sim.prototype.reset = function () {
    var gw = this.gridWidth, gh = this.gridHeight, f, e, s;
    this.grid = [];
    for (f = 0; f < gw + 2; f++) {
      this.grid[f] = new Uint8Array(gh + 2);
      for (e = 0; e < gh + 2; e++) this.grid[f][e] = 4;
    }
    // House sits off-map, as on the title screen
    this.houseX1 = -10000; this.houseY1 = -10000;
    this.houseX2 = this.houseX1 + 10; this.houseY2 = this.houseY1 + 10;

    this.grassSpreadChance = 0.001;
    this.grassGrowthChance = 0.15;
    this.numbOfSpecies = 6;
    this.creaFeed = [1.8, 70, 2, 25, 1.95, 80];
    this.creaChild = [160 * 1.5, 240 * 1.2, 400, 350 * 1.5, 150, 90 * 1.2];
    this.creaStarve = [-400, -200, -20, -250, -10, -300];
    this.reproductiveAge = 5;
    this.baseCount = [50, 4, 7, 1, 40, 4];
    this.creaSize = Sim.SIZE.slice();

    this.spearX = -100; this.spearY = -100; this.spearTime = -1;
    this.plrProfit = 0;
    this.kills = 0;

    this.gameTime = -1;
    this.crea = [];

    var self = this, b = this.baseCount;
    function spawn(type, setHunger) {
      var c = self.create_creature(type, irandom_range(0, gw - 1), irandom_range(0, gh - 1));
      if (setHunger) c.myHunger = irandom_range(0, self.creaChild[type]);
      c.age = irandom_range(0, self.reproductiveAge);
      self.crea.push(c);
    }
    for (f = 0; f < b[0]; f++) spawn(0, true);
    for (f = 0; f < b[1]; f++) spawn(1, false);
    for (f = 0; f < b[2]; f++) spawn(2, true);
    for (f = 0; f < b[3]; f++) spawn(3, false);
    for (f = 0; f < b[4]; f++) spawn(4, true);
    for (f = 0; f < b[5]; f++) spawn(5, false);

    this.grassMax = 0;
    this.creaMax = [0, 0, 0, 0, 0, 0];
    this.grassCount = new Float64Array(this.recordedSteps);
    this.speciesCount = [];
    for (s = 0; s < this.numbOfSpecies; s++) this.speciesCount[s] = new Float64Array(this.recordedSteps);
    this.samples = 0; // how many 16-frame samples have been recorded
  };

  Sim.prototype.create_creature = function (newType, newX, newY) {
    var gw = this.gridWidth, gh = this.gridHeight;
    while (newX >= this.houseX1 && newX <= this.houseX2 && newY >= this.houseY1 && newY <= this.houseY2) {
      newX = irandom_range(0, gw - 1);
      newY = irandom_range(0, gh - 1);
    }
    var fm = random_range(0.7, 1.4) * random_range(0.7, 1.4);
    var isMouse = newType === 4;
    return {
      myType: newType,
      myX: newX,
      myY: newY,
      myDir: irandom_range(0, 3),
      myHunger: isMouse ? random_range(0, 20) : 0,
      childThreshold: this.creaChild[newType] * (isMouse ? random_range(1, 1.25) : random_range(0.75, 1.25)),
      deathThreshold: this.creaStarve[newType] * random_range(0.75, 1.25),
      feedMult: fm,
      eaten: false,
      age: 0
    };
  };

  /* Throw a spear at a cell. In the game the spear tip sweeps for 12 frames
     and kills anything within two cells of it; here the tip holds still. */
  Sim.prototype.strike = function (cx, cy, frames) {
    this.spearX = cx; this.spearY = cy; this.spearTime = frames || 8;
  };

  Sim.prototype.emit = function (type, x, y, species) {
    if (this.onEvent) this.onEvent(type, x, y, species);
  };

  Sim.prototype.spearHits = function (x, y) {
    var sx = Math.floor(this.spearX), sy = Math.floor(this.spearY);
    return inRange(x, sx - 2, sx + 2) && inRange(y, sy - 2, sy + 2);
  };

  Sim.prototype.spearKill = function (c, x, y) {
    var t = c.myType;
    c.eaten = true;
    this.plrProfit += Math.ceil(Math.pow(this.creaSize[t] * 4, 2));
    this.kills++;
    this.emit('spear', x, y, t);
  };

  Sim.prototype.simulate_grass_growth = function () {
    var gw = this.gridWidth, gh = this.gridHeight, grid = this.grid;
    var spreadMax = 1 / this.grassSpreadChance, growMax = 1 / this.grassGrowthChance;
    var total = 0, f, e;
    for (f = 0; f < gw; f++) {
      var col = grid[f];
      for (e = 0; e < gh; e++) {
        if (col[e] >= 3) {
          if (f > 0 && irandom_range(1, spreadMax) === 1) grid[f - 1][e] = Math.max(1, grid[f - 1][e]);
          if (f < gw - 1 && irandom_range(1, spreadMax) === 1) grid[f + 1][e] = Math.max(1, grid[f + 1][e]);
          if (e > 0 && irandom_range(1, spreadMax) === 1) col[e - 1] = Math.max(1, col[e - 1]);
          if (e < gh - 1 && irandom_range(1, spreadMax) === 1) col[e + 1] = Math.max(1, col[e + 1]);
        }
        if (col[e] >= 1) {
          if (irandom_range(1, growMax) === 1) col[e] = Math.min(4, col[e] + 1);
        }
        total += col[e];
      }
    }
    this.grassCount[0] += total;
  };

  Sim.prototype.simulate_creatures = function (turnType) {
    var crea = this.crea, sc = this.speciesCount, base = this.baseCount;
    var gw = this.gridWidth, gh = this.gridHeight, gs = this.gameSpeed, grid = this.grid;
    var f, e;
    for (f = 0; f < crea.length; f++) {
      var myCrea = crea[f];
      var creaX = myCrea.myX, creaY = myCrea.myY, creaType = myCrea.myType;

      if (!myCrea.eaten && this.spearHits(creaX, creaY)) this.spearKill(myCrea, creaX, creaY);

      if (!myCrea.eaten) {
        sc[creaType][0] += 1;

        if (turnType === false) {
          // Rabbits and elk graze
          if (creaType === 0 || creaType === 2) {
            if (grid[Math.floor(creaX)][Math.floor(creaY)] > 0) {
              myCrea.myHunger += this.creaFeed[creaType] * myCrea.feedMult;
              grid[Math.floor(creaX)][Math.floor(creaY)] -= 1;
            }
          }

          // Predators: coyotes, wolves, ferrets
          if (creaType === 1 || creaType === 3 || creaType === 5) {
            var nearestPrey = -1;
            var antiprey = false;
            // Search radius shrinks when prey is scarce and becomes unlimited when prey booms
            var preyDistance = 5 + ((sc[0][1] > base[0] * 2) * 1000) - ((sc[0][1] < base[0] * 0.6) * 3);
            var chaseTargets = [0];
            var foodTargets = [0, 4];

            if (creaType === 3) { // Wolf
              preyDistance = 15 + ((sc[2][1] > base[2] * 2) * 1000) - ((sc[2][1] < base[2] * 0.6) * 10);
              chaseTargets = [2];
              foodTargets = [0, 1, 2];
              if (sc[1][1] <= 2) foodTargets = [0, 2];
            }
            if (creaType === 5) { // Ferret
              preyDistance = 10 + ((sc[4][1] > base[4] * 2) * 1000) - ((sc[4][1] < base[4] * 0.6) * 7);
              chaseTargets = [4];
              foodTargets = [4];
              antiprey = false;
            }

            var searchLoops = 0;
            do {
              for (e = 0; e < crea.length; e++) {
                var other = crea[e];
                if (!other.eaten) {
                  var dist = Math.abs(other.myX - myCrea.myX) + Math.abs(other.myY - myCrea.myY);
                  if (dist < preyDistance && chaseTargets.indexOf(other.myType) !== -1) {
                    preyDistance = dist;
                    nearestPrey = e;
                    // Predators back off a species that has fallen below a quarter of its base count
                    antiprey = sc[other.myType][1] < base[other.myType] * 0.25;
                  }
                  if (Math.abs(other.myX - myCrea.myX) <= 1 && Math.abs(other.myY - myCrea.myY) <= 1 &&
                      foodTargets.indexOf(other.myType) !== -1) {
                    other.eaten = true;
                    this.emit('eaten', other.myX, other.myY, other.myType);
                    myCrea.myHunger += this.creaFeed[myCrea.myType] * (1 + ((myCrea.myHunger < 0) * 0.5)) *
                                       myCrea.feedMult * this.creaSize[other.myType];
                    e = crea.length;
                  }
                }
              }
              searchLoops += 1;
              chaseTargets = [0, 2];
            } while (!(creaType !== 3 || searchLoops >= 2 || nearestPrey !== -1));

            if (nearestPrey !== -1) {
              var p = crea[nearestPrey];
              var vertical = Math.abs(p.myX - creaX) < Math.abs(p.myY - creaY);
              if (!antiprey) {
                if (vertical) myCrea.myDir = p.myY > creaY ? 3 : 1;
                else myCrea.myDir = p.myX > creaX ? 0 : 2;
              } else {
                if (vertical) myCrea.myDir = p.myY > creaY ? 1 : 3;
                else myCrea.myDir = p.myX > creaX ? 2 : 0;
              }
            }
          }

          // Mice graze a third of the time, but eat more when they do
          if (creaType === 4) {
            if (irandom_range(1, 3) === 1 && grid[Math.floor(creaX)][Math.floor(creaY)] > 0) {
              myCrea.myHunger += this.creaFeed[creaType] * myCrea.feedMult * 3;
              grid[Math.floor(creaX)][Math.floor(creaY)] -= 1;
            }
          }

          // Random turn
          if (irandom_range(1, 10) === 1) myCrea.myDir = myMod(myCrea.myDir + choose(1, -1), 4);

          // Well fed and mature: have a child
          if (myCrea.myHunger >= myCrea.childThreshold && myCrea.age > this.reproductiveAge && crea.length < 1500) {
            myCrea.myHunger = -2;
            myCrea.age = 0;
            var child = this.create_creature(creaType, creaX, creaY);
            while (child.myDir === myCrea.myDir) child.myDir = irandom_range(0, 3);
            crea.push(child);
          }

          myCrea.age += 2 / gs;

          // Turn away from walls
          var guard = 0;
          for (;;) {
            var projX = myCrea.myX, projY = myCrea.myY;
            if (myCrea.myDir === 0) projX += 1;
            if (myCrea.myDir === 1) projY -= 1;
            if (myCrea.myDir === 2) projX -= 1;
            if (myCrea.myDir === 3) projY += 1;
            var blocked = !inRange(projX, 0, gw - 1) || !inRange(projY, 0, gh - 1) ||
              (inRange(projX, this.houseX1, this.houseX2 - 1) && inRange(projY, this.houseY1, this.houseY2 - 1));
            if (!blocked || ++guard > 64) break;
            myCrea.myDir = myMod(myCrea.myDir + choose(1, -1), 4);
          }
        }

        // Move a fraction of a tile every frame
        if (myCrea.myDir === 0) myCrea.myX += 1 / gs;
        if (myCrea.myDir === 1) myCrea.myY -= 1 / gs;
        if (myCrea.myDir === 2) myCrea.myX -= 1 / gs;
        if (myCrea.myDir === 3) myCrea.myY += 1 / gs;

        myCrea.myHunger -= 1 / gs;

        if (this.spearHits(creaX, creaY) && !myCrea.eaten) this.spearKill(myCrea, creaX, creaY);

        // Starvation, with guards that keep the last few predators alive
        if (!myCrea.eaten && myCrea.myHunger < myCrea.deathThreshold &&
            (creaType !== 3 || sc[creaType][0] > 1 || (sc[0][1] === 0 && sc[2][1] === 0)) &&
            (creaType !== 1 || sc[creaType][0] > 2) &&
            (creaType !== 5 || sc[creaType][0] > 2 || sc[4][1] === 0)) {
          myCrea.eaten = true;
          this.emit('starved', creaX, creaY, creaType);
        }
      }
    }
  };

  Sim.prototype.step = function () {
    var s, f, n = this.numbOfSpecies, sc = this.speciesCount, rs = this.recordedSteps;
    this.gameTime += 1;

    if (this.spearTime > -1) {
      this.spearTime -= 1;
      if (this.spearTime < 0) { this.spearX = -100; this.spearY = -100; }
    }

    // Shift the history every 16 frames for graphing
    if (this.gameTime % 16 === 0) {
      this.grassCount.copyWithin(1, 0, rs - 1);
      for (s = 0; s < n; s++) sc[s].copyWithin(1, 0, rs - 1);
      this.samples = Math.min(this.samples + 1, rs);
    }
    for (s = 0; s < n; s++) sc[s][0] = 0;

    if (this.gameTime % this.gameSpeed === 0) {
      this.grassCount[0] = 0;
      this.simulate_grass_growth();
    }

    this.simulate_creatures(this.gameTime % this.gameSpeed !== 0);

    // Remove the dead
    var alive = [];
    for (f = 0; f < this.crea.length; f++) {
      var c = this.crea[f];
      if (c.eaten) sc[c.myType][0] -= 1;
      else alive.push(c);
    }
    this.crea = alive;

    this.grassMax = Math.max(this.grassMax, this.grassCount[0]);
    for (s = 0; s < n; s++) this.creaMax[s] = Math.max(this.creaMax[s], sc[s][0]);

    // When coyotes and wolves are both gone, the original nudges the grazers down
    if (sc[1][5] === 0 && sc[3][5] === 0 && this.gameTime > 60) {
      if (sc[0][5] > 2000) this.grassSpreadChance *= 0.999;
      this.grassGrowthChance *= 0.9995;
      this.creaFeed[0] *= 1.0002;
      this.creaFeed[2] *= 0.9995;
      this.creaFeed[4] *= 0.9995;
    }
  };

  Sim.prototype.counts = function () {
    var out = [0, 0, 0, 0, 0, 0];
    for (var i = 0; i < this.crea.length; i++) out[this.crea[i].myType]++;
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
  else root.CrittersSim = Sim;
})(typeof window !== 'undefined' ? window : this);
