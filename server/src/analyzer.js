'use strict';
/**
 * Analyzer: computes all statistics from rrrocket JSON (header + network frames).
 * All units: positions/distances in Unreal units (uu, 100 uu = 1 m),
 * speeds in uu/s, time in seconds.
 */

const FIELD = {
  X: 4096, Y: 5120, // half width / half length of a standard field
  THIRD: 10240 / 6, // third boundary
  GRID_X: 20, GRID_Y: 26, // heatmap resolution
};

const SPEED = { BOOST: 1400, SUPERSONIC: 2200 };
const HEIGHT = { GROUND: 120, HIGH_AIR: 840 };
const TOUCH = { DV: 500, RADIUS: 360, COOLDOWN: 0.35 };
const GOAL = { HALF_W: 893, HEIGHT: 642, Y: 5120, GRAVITY: 650 };
const CHALLENGE_WINDOW = 1.5; // s — quick alternating touches = 50/50 duel
const ANALYZER_VERSION = 14;

const MAP_NAMES = {
  Stadium_P: 'DFH Stadium', Stadium_Winter_P: 'DFH Stadium (Snowy)', Stadium_Day_P: 'DFH Stadium (Day)',
  EuroStadium_P: 'Mannfield', EuroStadium_Night_P: 'Mannfield (Night)', EuroStadium_Rainy_P: 'Mannfield (Stormy)',
  cs_p: 'Champions Field', cs_day_p: 'Champions Field (Day)', cs_hw_p: "Rivals Arena",
  TrainStation_P: 'Urban Central', TrainStation_Night_P: 'Urban Central (Night)', TrainStation_Dawn_P: 'Urban Central (Dawn)',
  Park_P: 'Beckwith Park', Park_Night_P: 'Beckwith Park (Midnight)', Park_Rainy_P: 'Beckwith Park (Stormy)',
  UtopiaStadium_P: 'Utopia Coliseum', UtopiaStadium_Dusk_P: 'Utopia Coliseum (Dusk)', UtopiaStadium_Snow_P: 'Utopia Coliseum (Snowy)',
  Wasteland_S_P: 'Wasteland', Wasteland_Night_S_P: 'Wasteland (Night)',
  NeoTokyo_Standard_P: 'Neo Tokyo', NeoTokyo_Toon_P: 'Tokyo Underpass',
  arc_standard_p: 'Starbase ARC', ARC_Darc_P: 'Starbase ARC (Aftermath)',
  Underwater_P: 'AquaDome', UnderwaterGrottoAmbient_P: 'AquaDome (Grotto)',
  farm_p: 'Farmstead', Farm_Night_P: 'Farmstead (Night)',
  beach_P: 'Salty Shores', beach_night_p: 'Salty Shores (Night)',
  CHN_Stadium_P: 'Forbidden Temple', CHN_Stadium_Day_P: 'Forbidden Temple (Day)',
  bb_p: 'Champions Field (NFL)', outlaw_p: 'Deadeye Canyon', outlaw_oasis_p: 'Deadeye Canyon (Oasis)',
  street_p: 'Sovereign Heights', Street_Night_P: 'Sovereign Heights (Night)',
  fni_stadium_p: 'Estadio Vida', music_p: 'Neon Fields',
  UF_Day_P: 'Futura Garden', swoosh_p: 'Drift Woods', woods_p: 'Drift Woods', woods_night_p: 'Drift Woods (Night)',
  eurostadium_dusk_p: 'Mannfield (Dusk)', stadium_foggy_p: 'DFH Stadium (Stormy)',
  Labs_CirclePillars_P: 'Pillars (Lab)', Labs_Corridor_P: 'Corridor (Lab)',
};

function prettyMap(raw) {
  if (!raw) return 'Unknown Arena';
  return MAP_NAMES[raw] || MAP_NAMES[raw.toLowerCase()] || raw;
}

function propVal(p) {
  // rrrocket properties are either direct values or wrapped
  return p && typeof p === 'object' && 'value' in p ? p.value : p;
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function newHeatmap() {
  return Array.from({ length: FIELD.GRID_Y }, () => new Array(FIELD.GRID_X).fill(0));
}

function heatmapAdd(hm, x, y) {
  const gx = Math.min(FIELD.GRID_X - 1, Math.max(0, Math.floor(((x + FIELD.X) / (2 * FIELD.X)) * FIELD.GRID_X)));
  const gy = Math.min(FIELD.GRID_Y - 1, Math.max(0, Math.floor(((y + FIELD.Y) / (2 * FIELD.Y)) * FIELD.GRID_Y)));
  hm[gy][gx]++;
}

function newPlayerStats() {
  return {
    // time
    timePlayed: 0,
    // boost
    boost: {
      avgAmountNum: 0, avgAmountDen: 0,
      used: 0, collected: 0, overfill: 0, stolenAmount: 0,
      bigPads: 0, smallPads: 0, bigPadsStolen: 0,
      timeZero: 0, timeFull: 0, time0to25: 0, time25to50: 0, time50to75: 0, time75to100: 0,
    },
    // movement
    movement: {
      distance: 0, avgSpeedNum: 0,
      timeSlow: 0, timeBoostSpeed: 0, timeSupersonic: 0,
      timeGround: 0, timeLowAir: 0, timeHighAir: 0,
      powerslides: 0, powerslideTime: 0, flipResets: 0,
      maxSpeed: 0,
    },
    // positioning
    positioning: {
      timeDefHalf: 0, timeOffHalf: 0,
      timeDefThird: 0, timeNeutThird: 0, timeOffThird: 0,
      timeBehindBall: 0, timeAheadOfBall: 0,
      avgDistToBallNum: 0,
      timeMostBack: 0, timeMostForward: 0, timeClosestToBall: 0, timeFurthestFromBall: 0,
      // average position per rotation role (back / mid / front player)
      _rp: { back: { x: 0, y: 0, t: 0 }, mid: { x: 0, y: 0, t: 0 }, front: { x: 0, y: 0, t: 0 } },
      avgTeammateDistNum: 0, avgTeammateDistDen: 0,
      doubleCommits: 0, _dcTimer: 0, _dcActive: false,
      // rotation / discipline metrics
      abandoned2v1: 0, _abandonCd: -10,      // left a teammate alone in defense
      concededWhileAhead: 0,                  // goal conceded while ahead of the ball
      _aheadStreak: 0, aheadStreakSum: 0, aheadStreakCount: 0, aheadStreakMax: 0,
      timeLostForward: 0,                     // in the attacking third while the ball is in own half
    },
    // possession / touches
    possession: {
      touches: 0, aerialTouches: 0, possessionTime: 0,
      passes: 0, passesReceived: 0, dribbles: 0, turnovers: 0, steals: 0,
      firstTouches: 0, kickoffs: 0,
      clears: 0, pressureClears: 0, fiftiesWon: 0, fiftiesLost: 0,
      kickoffsWon: 0, kickoffsLost: 0, kickoffsNeutral: 0,
      concededAsLastMan: 0,
    },
    demos: { inflicted: 0, taken: 0 },
    heatmap: newHeatmap(),
    touchPoints: [],
  };
}

/** Main analysis of a single parsed replay. */
function analyze(data, fileName) {
  const objs = data.objects || [];
  const names = data.names || [];
  const props = data.properties || {};
  const P = (k) => propVal(props[k]);

  const frames = (data.network_frames && data.network_frames.frames) || [];
  if (!frames.length) throw new Error('Replay has no network frames');

  // ---------- actor tracking ----------
  const carActors = new Map();   // actorId -> { pos, vel, alive }
  const ballActors = new Set();
  const teamActors = new Map();  // actorId -> 0|1
  const priActors = new Map();   // actorId -> { name, uid, teamActor, mvp }
  const carToPri = new Map();    // carActorId -> priActorId
  const boostToCar = new Map();  // boostActorId -> carActorId
  const boostAmount = new Map(); // carActorId -> pct (0-100)
  const handbrakeOn = new Map(); // carActorId -> bool (powerslide tracking)

  // players: key -> { key, name, team, stats }
  const players = new Map();

  let gameState = 'WaitingForPlayers';
  let ball = { pos: { x: 0, y: 0, z: 93 }, vel: { x: 0, y: 0, z: 0 } };
  const ballHeatmap = newHeatmap();

  let lastTouch = null; // { playerKey, team, time }
  let prevTouch = null;
  let kickoffPending = false;
  let kickoffCount = 0;
  let activeTime = 0;
  const fieldTilt = []; // sampled every second: ball position along the field length (team 0 perspective)
  let lastTiltSample = -1;
  const touchLog = []; // for detecting kickoff wins etc.
  const demoEvents = [];
  const shots = []; // detected shots with xG
  const tlSamples = []; // downsample for the 2D viewer (~10 fps)
  let lastTl = -1;
  let openChallenge = null; // active 50/50 duel
  const pendingKickoffs = []; // kickoffs awaiting outcome evaluation (t+3s)

  // goals from the header — needed up front for "conceded as last man"
  const goals = (P('Goals') || []).map((g) => {
    const gv = (k) => propVal(g[k]);
    const frame = gv('frame') || 0;
    return {
      frame,
      time: frames[Math.min(frame, frames.length - 1)] ? Math.round(frames[Math.min(frame, frames.length - 1)].time * 10) / 10 : 0,
      player: gv('PlayerName'), team: gv('PlayerTeam'),
    };
  });
  const goalByFrame = new Map(goals.map((g) => [g.frame, g]));

  const resolveChallenge = (ch) => {
    if (!ch || !ch.a || !ch.b || ch.a.key === ch.b.key) return;
    const winner = ch.lastToucher.team === ch.a.team ? ch.a : ch.b;
    const loser = winner === ch.a ? ch.b : ch.a;
    winner.stats.possession.fiftiesWon++;
    loser.stats.possession.fiftiesLost++;
  };

  const playerKeyOfPri = (priId) => {
    const pri = priActors.get(priId);
    if (!pri) return null;
    return pri.uid || pri.name || null;
  };

  const ensurePlayer = (priId) => {
    const pri = priActors.get(priId);
    if (!pri || !pri.name) return null;
    const key = pri.uid || pri.name;
    if (!players.has(key)) {
      // migration: record created under the name before the UniqueId arrived
      if (pri.uid && players.has(pri.name)) {
        const old = players.get(pri.name);
        players.delete(pri.name);
        old.key = key;
        players.set(key, old);
      } else {
        players.set(key, { key, name: pri.name, team: pri.team ?? null, stats: newPlayerStats(), mvp: false });
      }
    }
    const pl = players.get(key);
    pl.name = pri.name; // last seen name
    if (pri.team != null) pl.team = pri.team;
    if (pri.mvp) pl.mvp = true;
    if (pri.tier) pl.tier = pri.tier;
    return pl;
  };

  const playerOfCar = (carId) => {
    const priId = carToPri.get(carId);
    if (priId == null) return null;
    return ensurePlayer(priId);
  };

  // ---------- frame loop ----------
  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi];
    const t = f.time;
    const delta = f.delta || 0;

    // new actors
    for (const na of f.new_actors) {
      const arch = objs[na.object_id] || '';
      if (arch.startsWith('Archetypes.Car.')) {
        const loc = na.initial_trajectory && na.initial_trajectory.location;
        carActors.set(na.actor_id, { pos: loc ? { ...loc } : { x: 0, y: 0, z: 17 }, vel: { x: 0, y: 0, z: 0 } });
      } else if (arch.startsWith('Archetypes.Ball.')) {
        ballActors.add(na.actor_id);
      } else if (arch === 'Archetypes.Teams.Team0') teamActors.set(na.actor_id, 0);
      else if (arch === 'Archetypes.Teams.Team1') teamActors.set(na.actor_id, 1);
      else if (arch === 'TAGame.Default__PRI_TA') {
        if (!priActors.has(na.actor_id)) priActors.set(na.actor_id, { name: null, uid: null, team: null, mvp: false });
      }
    }

    // deleted actors (demolitions, leavers)
    for (const del of f.deleted_actors || []) {
      carActors.delete(del);
      ballActors.delete(del);
      handbrakeOn.delete(del);
    }

    // updated attributes
    for (const u of f.updated_actors) {
      const name = objs[u.object_id];
      const a = u.attribute;
      switch (name) {
        case 'TAGame.GameEvent_TA:ReplicatedStateName': {
          const s = names[a.Int];
          if (s) gameState = s;
          if (s === 'Countdown') kickoffPending = true;
          break;
        }
        case 'Engine.PlayerReplicationInfo:PlayerName': {
          const pri = priActors.get(u.actor_id) || { name: null, uid: null, team: null, mvp: false };
          pri.name = a.String;
          priActors.set(u.actor_id, pri);
          ensurePlayer(u.actor_id);
          break;
        }
        case 'Engine.PlayerReplicationInfo:UniqueId': {
          const pri = priActors.get(u.actor_id) || { name: null, uid: null, team: null, mvp: false };
          const rid = a.UniqueId && a.UniqueId.remote_id;
          if (rid) {
            const v = Object.values(rid)[0];
            pri.uid = typeof v === 'object' ? JSON.stringify(v) : String(v);
          }
          priActors.set(u.actor_id, pri);
          break;
        }
        case 'Engine.PlayerReplicationInfo:Team': {
          const pri = priActors.get(u.actor_id) || { name: null, uid: null, team: null, mvp: false };
          if (a.ActiveActor && a.ActiveActor.active) {
            const team = teamActors.get(a.ActiveActor.actor);
            if (team != null) pri.team = team;
          }
          priActors.set(u.actor_id, pri);
          ensurePlayer(u.actor_id);
          break;
        }
        case 'TAGame.PRI_TA:bMatchMVP': {
          const pri = priActors.get(u.actor_id);
          if (pri) { pri.mvp = true; ensurePlayer(u.actor_id); }
          break;
        }
        case 'TAGame.PRI_TA:SkillTier': {
          // real rank — replicated only in ranked matches
          const pri = priActors.get(u.actor_id);
          if (pri && a.Int > 0) { pri.tier = a.Int; ensurePlayer(u.actor_id); }
          break;
        }
        case 'Engine.Pawn:PlayerReplicationInfo': {
          if (a.ActiveActor && a.ActiveActor.active && carActors.has(u.actor_id)) {
            carToPri.set(u.actor_id, a.ActiveActor.actor);
          }
          break;
        }
        case 'TAGame.CarComponent_TA:Vehicle': {
          if (a.ActiveActor && a.ActiveActor.active) boostToCar.set(u.actor_id, a.ActiveActor.actor);
          break;
        }
        case 'TAGame.CarComponent_Boost_TA:ReplicatedBoost': {
          const carId = boostToCar.get(u.actor_id);
          if (carId == null) break;
          const pct = (a.ReplicatedBoost.boost_amount / 255) * 100;
          const prev = boostAmount.get(carId);
          boostAmount.set(carId, pct);
          if (prev == null || gameState !== 'Active') break;
          const pl = playerOfCar(carId);
          if (!pl) break;
          const diff = pct - prev;
          const car = carActors.get(carId);
          if (diff < 0) {
            // consumption (large drops are treated as a reset — demo/respawn)
            if (-diff <= 45) pl.stats.boost.used += -diff;
          } else if (diff > 0.5) {
            pl.stats.boost.collected += diff;
            const ySigned = car ? car.pos.y * (pl.team === 0 ? 1 : -1) : 0;
            const stolen = ySigned > 0;
            if (pct >= 99.5 && diff > 30) {
              pl.stats.boost.bigPads++;
              pl.stats.boost.overfill += prev; // a big pad always gives 100 — the excess is wasted
              if (stolen) { pl.stats.boost.bigPadsStolen++; pl.stats.boost.stolenAmount += diff; }
            } else {
              const pads = Math.max(1, Math.round(diff / 12));
              pl.stats.boost.smallPads += pads;
              if (pct >= 99.5) pl.stats.boost.overfill += Math.max(0, prev + 12 - 100);
              if (stolen) pl.stats.boost.stolenAmount += diff;
            }
          }
          break;
        }
        case 'TAGame.Vehicle_TA:bReplicatedHandbrake': {
          // powerslide: rising edge of the handbrake while the car is on the ground (in the air = wavedash prep)
          const on = !!a.Boolean;
          const prev = handbrakeOn.get(u.actor_id) || false;
          handbrakeOn.set(u.actor_id, on);
          if (on && !prev && gameState === 'Active') {
            const pl = playerOfCar(u.actor_id);
            const car = carActors.get(u.actor_id);
            if (pl && car && car.pos.z <= HEIGHT.GROUND + 30) pl.stats.movement.powerslides++;
          }
          break;
        }
        case 'TAGame.RBActor_TA:ReplicatedRBState': {
          const rb = a.RigidBody;
          if (ballActors.has(u.actor_id)) {
            const prevVel = ball.vel;
            const newVel = rb.linear_velocity || { x: 0, y: 0, z: 0 };
            const newPos = rb.location;
            // touch detection: sudden change in ball velocity + nearest car
            if (gameState === 'Active' && prevVel) {
              const dv = Math.hypot(newVel.x - prevVel.x, newVel.y - prevVel.y, newVel.z - prevVel.z);
              if (dv > TOUCH.DV) {
                let best = null, bestD = TOUCH.RADIUS;
                for (const [cid, car] of carActors) {
                  const d = dist3(car.pos, newPos);
                  if (d < bestD) { bestD = d; best = cid; }
                }
                if (best != null) {
                  const pl = playerOfCar(best);
                  if (pl) {
                    const last = pl.stats._lastTouchTime || -10;
                    if (t - last > TOUCH.COOLDOWN) {
                      pl.stats._lastTouchTime = t;
                      pl.stats.possession.touches++;
                      if (newPos.z > 500) pl.stats.possession.aerialTouches++;
                      // flip reset (heuristic): touching the ball with the WHEEL side high in the air —
                      // car above 250 uu, ball above 400 uu, ball on the -up side of the car body
                      {
                        const carA = carActors.get(best);
                        if (carA && carA.quat && newPos.z > 400 && carA.pos.z > 250) {
                          const up = quatUp(carA.quat);
                          const dx = newPos.x - carA.pos.x, dy = newPos.y - carA.pos.y, dz = newPos.z - carA.pos.z;
                          const dl = Math.hypot(dx, dy, dz) || 1;
                          if ((up.x * dx + up.y * dy + up.z * dz) / dl < -0.55) pl.stats.movement.flipResets++;
                        }
                      }
                      if (pl.stats.touchPoints.length < 600) pl.stats.touchPoints.push([Math.round(newPos.x), Math.round(newPos.y)]);
                      const touch = { playerKey: pl.key, team: pl.team, time: t, pos: newPos };
                      touchLog.push(touch);
                      // shot-on-goal detection → xG (with opponent positions for defense assessment;
                      // demolished cars are not in carActors → demolished keeper = empty net)
                      const oppPos = [];
                      for (const [ocid2, ocar2] of carActors) {
                        const opl2 = playerOfCar(ocid2);
                        if (opl2 && opl2.team != null && opl2.team !== pl.team) oppPos.push(ocar2.pos);
                      }
                      const shot = detectShot(pl, newPos, newVel, t, oppPos);
                      if (shot) shots.push(shot);
                      // clear: touch in the defensive third that sends the ball toward the opponent's half
                      const teamSign = pl.team === 0 ? 1 : -1;
                      if (newPos.y * teamSign < -FIELD.THIRD && newVel.y * teamSign > 400) {
                        pl.stats.possession.clears++;
                        // clear under pressure: opponents in our third
                        let oppsInThird = 0;
                        for (const [ocid, ocar] of carActors) {
                          const opl = playerOfCar(ocid);
                          if (opl && opl.team !== pl.team && ocar.pos.y * teamSign < -FIELD.THIRD) oppsInThird++;
                        }
                        if (oppsInThird >= 1) pl.stats.possession.pressureClears++;
                      }
                      // teammate abandoned in a 2v1: an opponent touches the ball deep in the other team's defense
                      // while a defending-team player is in the ATTACKING half (didn't rotate back)
                      {
                        const defTeam = pl.team === 0 ? 1 : 0;
                        const defSign = defTeam === 0 ? 1 : -1;
                        if (newPos.y * defSign < -FIELD.THIRD) {
                          for (const [dcid, dcar] of carActors) {
                            const dpl = playerOfCar(dcid);
                            if (!dpl || dpl.team !== defTeam) continue;
                            const st2 = dpl.stats.positioning;
                            if (dcar.pos.y * defSign > 800 && t - st2._abandonCd > 6) {
                              st2._abandonCd = t;
                              st2.abandoned2v1++;
                            }
                          }
                        }
                      }
                      // 50/50 duels: quick alternating touches by opposing teams
                      if (openChallenge && t - openChallenge.lastTime <= CHALLENGE_WINDOW) {
                        openChallenge.lastToucher = pl;
                        openChallenge.lastTime = t;
                      } else {
                        if (openChallenge) { resolveChallenge(openChallenge); openChallenge = null; }
                        if (lastTouch && pl.team !== lastTouch.team && t - lastTouch.time <= CHALLENGE_WINDOW) {
                          const prevPl = players.get(lastTouch.playerKey);
                          if (prevPl) openChallenge = { a: prevPl, b: pl, lastToucher: pl, lastTime: t };
                        }
                      }
                      // kickoff first touch + outcome evaluation after 3 s.
                      // Symmetric: besides the first toucher, the nearest opponent is also
                      // evaluated (the opposing kickoff taker) — otherwise the sample contains
                      // only first-touch winners and the league average ends up 53-57% instead of 50%.
                      if (kickoffPending) {
                        kickoffPending = false;
                        kickoffCount++;
                        pl.stats.possession.firstTouches++;
                        pendingKickoffs.push({ taker: pl, team: pl.team, evalT: t + 3 });
                        let oppTaker = null, oppD = Infinity;
                        for (const [ocid3, ocar3] of carActors) {
                          const opl3 = playerOfCar(ocid3);
                          if (!opl3 || opl3.team === pl.team) continue;
                          const d3 = dist3(ocar3.pos, newPos);
                          if (d3 < oppD) { oppD = d3; oppTaker = opl3; }
                        }
                        if (oppTaker) pendingKickoffs.push({ taker: oppTaker, team: oppTaker.team, evalT: t + 3 });
                      }
                      // pass / dribble / turnover chain
                      if (lastTouch && t - lastTouch.time < 6) {
                        const prevPl = players.get(lastTouch.playerKey);
                        if (prevPl) {
                          if (lastTouch.playerKey === pl.key) {
                            if (t - lastTouch.time < 2) pl.stats.possession.dribbles++;
                          } else if (lastTouch.team === pl.team) {
                            prevPl.stats.possession.passes++;
                            pl.stats.possession.passesReceived++;
                          } else {
                            prevPl.stats.possession.turnovers++;
                            pl.stats.possession.steals++;
                          }
                        }
                      }
                      prevTouch = lastTouch;
                      lastTouch = touch;
                    }
                  }
                }
              }
            }
            ball = { pos: newPos, vel: newVel };
          } else if (carActors.has(u.actor_id)) {
            const car = carActors.get(u.actor_id);
            car.pos = rb.location;
            car.vel = rb.linear_velocity || { x: 0, y: 0, z: 0 };
            if (rb.rotation) { car.yaw = quatYaw(rb.rotation); car.quat = rb.rotation; }
          }
          break;
        }
        case 'TAGame.Car_TA:ReplicatedDemolishExtended':
        case 'TAGame.Car_TA:ReplicatedDemolish': {
          const dd = a.DemolishExtended || a.Demolish;
          if (!dd) break;
          const attackerCar = dd.attacker && dd.attacker.actor;
          const victimCar = dd.victim && dd.victim.actor;
          const atk = attackerCar != null && attackerCar >= 0 ? playerOfCar(attackerCar) : null;
          const vic = victimCar != null && victimCar >= 0 ? playerOfCar(victimCar) : null;
          if (atk && vic && atk.key !== vic.key) {
            atk.stats.demos.inflicted++;
            vic.stats.demos.taken++;
            demoEvents.push({ time: t, attacker: atk.name, victim: vic.name });
          }
          break;
        }
      }
    }

    // goal in this frame: who on the conceding team was the last man + close the duel
    const goalNow = goalByFrame.get(fi);
    if (goalNow) {
      if (openChallenge) { resolveChallenge(openChallenge); openChallenge = null; }
      const concedingTeam = goalNow.team === 0 ? 1 : 0;
      const sign = concedingTeam === 0 ? 1 : -1;
      let lastMan = null, minY = Infinity;
      for (const [cid, car] of carActors) {
        const pl = playerOfCar(cid);
        if (!pl || pl.team !== concedingTeam) continue;
        const ys = car.pos.y * sign;
        if (ys < minY) { minY = ys; lastMan = pl; }
        // "where were you when the goal went in?" — caught in the attacking half
        if (ys > 500) pl.stats.positioning.concededWhileAhead++;
      }
      if (lastMan) lastMan.stats.possession.concededAsLastMan++;
      // a goal within 3 s of the kickoff decides the kickoff outcome directly
      while (pendingKickoffs.length) {
        const ko = pendingKickoffs.shift();
        if (goalNow.team === ko.team) ko.taker.stats.possession.kickoffsWon++;
        else ko.taker.stats.possession.kickoffsLost++;
      }
    }

    // kickoff outcome evaluation: where the ball is 3 s after the first touch
    while (pendingKickoffs.length && t >= pendingKickoffs[0].evalT) {
      const ko = pendingKickoffs.shift();
      const ys = ball.pos.y * (ko.team === 0 ? 1 : -1);
      if (ys > 800) ko.taker.stats.possession.kickoffsWon++;
      else if (ys < -800) ko.taker.stats.possession.kickoffsLost++;
      else ko.taker.stats.possession.kickoffsNeutral++;
    }

    // ---------- per-frame accumulation (active play only) ----------
    if (gameState === 'Active' && delta > 0) {
      activeTime += delta;

      heatmapAdd(ballHeatmap, ball.pos.x, ball.pos.y);

      // sample for the 2D replay viewer (~10 fps)
      if (t - lastTl >= 0.1) {
        lastTl = t;
        const cars = {};
        for (const [cid, car] of carActors) {
          const pl = playerOfCar(cid);
          if (!pl) continue;
          cars[pl.key] = [
            Math.round(car.pos.x), Math.round(car.pos.y), Math.round(car.pos.z),
            Math.round((car.yaw || 0) * 100) / 100,
            findBoostByCarId(cid, boostAmount),
          ];
        }
        tlSamples.push({
          t: Math.round(t * 10) / 10,
          b: [Math.round(ball.pos.x), Math.round(ball.pos.y), Math.round(ball.pos.z)],
          c: cars,
        });
      }

      if (Math.floor(t) > lastTiltSample) {
        lastTiltSample = Math.floor(t);
        fieldTilt.push([Math.round(activeTime), Math.round((ball.pos.y / FIELD.Y) * 100) / 100]);
      }

      // possession
      if (lastTouch) {
        const holder = players.get(lastTouch.playerKey);
        if (holder) holder.stats.possession.possessionTime += delta;
      }

      // per team: sorting for most back/forward, closest/furthest
      const byTeam = new Map();
      for (const [cid, car] of carActors) {
        const pl = playerOfCar(cid);
        if (!pl || pl.team == null) continue;
        if (!byTeam.has(pl.team)) byTeam.set(pl.team, []);
        byTeam.get(pl.team).push({ pl, car, carId: cid });
      }

      for (const [team, list] of byTeam) {
        const sign = team === 0 ? 1 : -1;
        let mostBack = null, mostFwd = null, closest = null, furthest = null;
        for (const e of list) {
          e.ySigned = e.car.pos.y * sign;
          e.dBall = dist3(e.car.pos, ball.pos);
          if (!mostBack || e.ySigned < mostBack.ySigned) mostBack = e;
          if (!mostFwd || e.ySigned > mostFwd.ySigned) mostFwd = e;
          if (!closest || e.dBall < closest.dBall) closest = e;
          if (!furthest || e.dBall > furthest.dBall) furthest = e;
        }
        const ballYSigned = ball.pos.y * sign;

        for (const e of list) {
          const s = e.pl.stats;
          const spd = Math.hypot(e.car.vel.x, e.car.vel.y, e.car.vel.z);
          s.timePlayed += delta;

          // movement
          s.movement.distance += spd * delta;
          s.movement.avgSpeedNum += spd * delta;
          if (spd > s.movement.maxSpeed) s.movement.maxSpeed = spd;
          if (spd < SPEED.BOOST) s.movement.timeSlow += delta;
          else if (spd < SPEED.SUPERSONIC) s.movement.timeBoostSpeed += delta;
          else s.movement.timeSupersonic += delta;
          const z = e.car.pos.z;
          if (z <= HEIGHT.GROUND) s.movement.timeGround += delta;
          else if (z <= HEIGHT.HIGH_AIR) s.movement.timeLowAir += delta;
          else s.movement.timeHighAir += delta;
          // time in powerslide (handbrake held + on the ground)
          {
            const cid = getCarId(e, carActors);
            if (cid != null && handbrakeOn.get(cid) && z <= HEIGHT.GROUND) s.movement.powerslideTime += delta;
          }

          // boost timers
          const amount = findBoost(e, carActors, boostAmount);
          if (amount != null) {
            s.boost.avgAmountNum += amount * delta;
            s.boost.avgAmountDen += delta;
            if (amount < 1) s.boost.timeZero += delta;
            if (amount >= 99.5) s.boost.timeFull += delta;
            if (amount < 25) s.boost.time0to25 += delta;
            else if (amount < 50) s.boost.time25to50 += delta;
            else if (amount < 75) s.boost.time50to75 += delta;
            else s.boost.time75to100 += delta;
          }

          // positioning
          if (e.ySigned < 0) s.positioning.timeDefHalf += delta; else s.positioning.timeOffHalf += delta;
          if (e.ySigned < -FIELD.THIRD) s.positioning.timeDefThird += delta;
          else if (e.ySigned > FIELD.THIRD) s.positioning.timeOffThird += delta;
          else s.positioning.timeNeutThird += delta;
          if (e.ySigned < ballYSigned) {
            s.positioning.timeBehindBall += delta;
            // end of an ahead-of-ball streak → record the duration (speed of rotating back)
            if (s.positioning._aheadStreak > 0.5) {
              s.positioning.aheadStreakSum += s.positioning._aheadStreak;
              s.positioning.aheadStreakCount++;
              if (s.positioning._aheadStreak > s.positioning.aheadStreakMax) s.positioning.aheadStreakMax = s.positioning._aheadStreak;
            }
            s.positioning._aheadStreak = 0;
          } else {
            s.positioning.timeAheadOfBall += delta;
            s.positioning._aheadStreak += delta;
          }
          // "lost forward": in the attacking third while the ball is in own half
          if (e.ySigned > FIELD.THIRD && ballYSigned < -800) s.positioning.timeLostForward += delta;
          s.positioning.avgDistToBallNum += e.dBall * delta;
          if (e === mostBack) s.positioning.timeMostBack += delta;
          if (e === mostFwd) s.positioning.timeMostForward += delta;
          if (e === closest) s.positioning.timeClosestToBall += delta;
          if (e === furthest) s.positioning.timeFurthestFromBall += delta;
          // position per role (for the rotation map)
          {
            const role = e === mostBack ? 'back' : e === mostFwd ? 'front' : 'mid';
            const rp = s.positioning._rp[role];
            rp.x += e.car.pos.x * delta; rp.y += e.car.pos.y * delta; rp.t += delta;
          }

          // distance to the nearest teammate (team modes)
          if (list.length > 1) {
            let nearest = Infinity;
            for (const o of list) {
              if (o === e) continue;
              const dd = dist3(e.car.pos, o.car.pos);
              if (dd < nearest) nearest = dd;
            }
            if (nearest < Infinity) {
              s.positioning.avgTeammateDistNum += nearest * delta;
              s.positioning.avgTeammateDistDen += delta;
            }
          }

          heatmapAdd(s.heatmap, e.car.pos.x, e.car.pos.y);
        }

        // double commit: two teammates RIGHT next to the ball at the same time (>0.9 s) — bad rotation
        if (list.length > 1) {
          const onBall = list.filter((e) => e.dBall < 850);
          const both = onBall.length >= 2;
          for (const e of list) {
            const s = e.pl.stats.positioning;
            if (both && onBall.includes(e)) {
              s._dcTimer += delta;
              if (s._dcTimer > 0.9 && !s._dcActive) { s._dcActive = true; s.doubleCommits++; }
            } else {
              s._dcTimer = 0; s._dcActive = false;
            }
          }
        }
      }
    }
  }

  // ---------- header stats + merging ----------
  const headerStats = (P('PlayerStats') || []).map((ps) => {
    const f = ps; // rrrocket returns plain fields
    const g = (k) => propVal(f[k]);
    let epicId = null;
    try { epicId = f.PlayerID.fields.EpicAccountId || null; } catch (_) { /* old format */ }
    return {
      name: g('Name'), team: g('Team'), score: g('Score') || 0, goals: g('Goals') || 0,
      assists: g('Assists') || 0, saves: g('Saves') || 0, shots: g('Shots') || 0,
      bot: !!g('bBot'), epicId,
    };
  });

  // rebound: shot shortly after a previous shot by the same team → keeper pulled out of position
  for (let i = 0; i < shots.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (shots[i].t - shots[j].t > 1.6) break;
      if (shots[j].team === shots[i].team) {
        shots[i].xg = Math.min(0.96, r2(shots[i].xg * 1.3));
        break;
      }
    }
  }

  // ---------- xG: link shots to goals ----------
  for (const g of goals) {
    // last shot by the scorer's team within 4 s before the goal
    let matched = null;
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      if (s.goal || s.team !== g.team) continue;
      if (s.t <= g.time + 0.3 && s.t >= g.time - 4) { matched = s; break; }
    }
    if (matched) { matched.goal = true; }
    else {
      // goal without a detected shot (tap-in, owngoal deflection...) — synthesize from the scorer's last touch
      const scorer = [...players.values()].find((p2) => p2.name === g.player);
      const lastT = [...touchLog].reverse().find((tc) => tc.time < g.time + 0.3 && scorer && tc.playerKey === scorer.key);
      // xG from the geometry of the last touch (tap-in from 1 m ≈ 0.85, not a fixed 0.35)
      const sx = lastT ? lastT.pos.x : 0;
      const sy = lastT ? lastT.pos.y : (g.team === 0 ? 4000 : -4000);
      shots.push({
        t: g.time, key: scorer ? scorer.key : null, team: g.team,
        x: Math.round(sx), y: Math.round(sy),
        z: lastT ? Math.round(lastT.pos.z) : 93, speed: 0,
        xg: r2(synthGoalXg(sx, sy, g.team)), goal: true, synth: true,
      });
    }
  }

  // player finalization
  const outPlayers = [];
  for (const pl of players.values()) {
    if (!pl.name || pl.team == null) continue;
    const s = pl.stats;
    if (s.timePlayed < 10) continue; // spectators / ghosts
    delete s._lastTouchTime;
    const hs = headerStats.find((h) => h.name === pl.name) || {};
    const t = Math.max(s.timePlayed, 1);
    const shotsN = hs.shots || 0;
    const goalsN = hs.goals || 0;
    s.possession.kickoffs = kickoffCount;
    const myShots = shots.filter((sh) => sh.key === pl.key);
    const xgTotal = r2(myShots.reduce((acc, sh) => acc + sh.xg, 0));
    outPlayers.push({
      key: pl.key, name: pl.name, team: pl.team,
      bot: !!hs.bot,
      mvp: pl.mvp,
      tier: pl.tier || null, // real rank from the replay (ranked only)
      epicId: hs.epicId || null,
      xg: {
        total: xgTotal,
        onTarget: myShots.filter((sh) => !sh.synth).length,
        perShot: myShots.length ? r2(xgTotal / myShots.length) : 0,
        finishing: r2(goalsN - xgTotal), // goals - xG = finishing quality
        bigChances: myShots.filter((sh) => sh.xg >= 0.4).length,
        bigChancesScored: myShots.filter((sh) => sh.xg >= 0.4 && sh.goal).length,
        zicers: myShots.filter((sh) => sh.xg >= 0.6).length,
        zicersScored: myShots.filter((sh) => sh.xg >= 0.6 && sh.goal).length,
        shots: myShots.map((sh) => ({ t: r1(sh.t), x: sh.x, y: sh.y, z: sh.z, xg: r2(sh.xg), goal: sh.goal, speed: Math.round(sh.speed) })),
      },
      core: {
        score: hs.score || 0, goals: goalsN, assists: hs.assists || 0,
        saves: hs.saves || 0, shots: shotsN, shootingPct: shotsN > 0 ? Math.round((goalsN / shotsN) * 1000) / 10 : 0,
        demosInflicted: s.demos.inflicted, demosTaken: s.demos.taken,
      },
      boost: {
        avgAmount: s.boost.avgAmountDen > 0 ? r1(s.boost.avgAmountNum / s.boost.avgAmountDen) : 0,
        used: Math.round(s.boost.used), collected: Math.round(s.boost.collected),
        usedPerMin: r1((s.boost.used / t) * 60), collectedPerMin: r1((s.boost.collected / t) * 60),
        overfill: Math.round(s.boost.overfill), stolenAmount: Math.round(s.boost.stolenAmount),
        bigPads: s.boost.bigPads, smallPads: s.boost.smallPads, bigPadsStolen: s.boost.bigPadsStolen,
        timeZero: r1(s.boost.timeZero), timeFull: r1(s.boost.timeFull),
        pctZero: pct(s.boost.timeZero, t), pctFull: pct(s.boost.timeFull, t),
        pct0to25: pct(s.boost.time0to25, t), pct25to50: pct(s.boost.time25to50, t),
        pct50to75: pct(s.boost.time50to75, t), pct75to100: pct(s.boost.time75to100, t),
      },
      movement: {
        distanceM: Math.round(s.movement.distance / 100), // meters
        avgSpeed: Math.round(s.movement.avgSpeedNum / t),
        maxSpeed: Math.round(s.movement.maxSpeed),
        pctSlow: pct(s.movement.timeSlow, t), pctBoostSpeed: pct(s.movement.timeBoostSpeed, t),
        pctSupersonic: pct(s.movement.timeSupersonic, t),
        timeSupersonic: r1(s.movement.timeSupersonic),
        pctGround: pct(s.movement.timeGround, t), pctLowAir: pct(s.movement.timeLowAir, t),
        pctHighAir: pct(s.movement.timeHighAir, t),
        powerslides: s.movement.powerslides,
        powerslidesPerMin: r1((s.movement.powerslides / t) * 60),
        powerslideTimeS: r1(s.movement.powerslideTime),
        flipResets: s.movement.flipResets,
      },
      positioning: {
        pctDefHalf: pct(s.positioning.timeDefHalf, t), pctOffHalf: pct(s.positioning.timeOffHalf, t),
        pctDefThird: pct(s.positioning.timeDefThird, t), pctNeutThird: pct(s.positioning.timeNeutThird, t),
        pctOffThird: pct(s.positioning.timeOffThird, t),
        pctBehindBall: pct(s.positioning.timeBehindBall, t), pctAheadOfBall: pct(s.positioning.timeAheadOfBall, t),
        avgDistToBallM: Math.round(s.positioning.avgDistToBallNum / t / 100),
        pctMostBack: pct(s.positioning.timeMostBack, t), pctMostForward: pct(s.positioning.timeMostForward, t),
        pctClosestToBall: pct(s.positioning.timeClosestToBall, t), pctFurthestFromBall: pct(s.positioning.timeFurthestFromBall, t),
        avgTeammateDistM: s.positioning.avgTeammateDistDen > 0
          ? Math.round(s.positioning.avgTeammateDistNum / s.positioning.avgTeammateDistDen / 100) : null,
        doubleCommits: s.positioning.doubleCommits,
        abandoned2v1: s.positioning.abandoned2v1,
        concededWhileAhead: s.positioning.concededWhileAhead,
        aheadStreakAvg: s.positioning.aheadStreakCount > 0 ? r1(s.positioning.aheadStreakSum / s.positioning.aheadStreakCount) : 0,
        // average position per role, normalized to "own goal at the bottom" (y<0 = defense)
        rolePos: (() => {
          const sign = pl.team === 0 ? 1 : -1;
          const out = {};
          for (const [k, rp] of Object.entries(s.positioning._rp)) {
            if (rp.t > 5) out[k] = { x: Math.round((rp.x / rp.t) * sign), y: Math.round((rp.y / rp.t) * sign), pct: pct(rp.t, t) };
          }
          return Object.keys(out).length ? out : null;
        })(),
        aheadStreakMax: r1(s.positioning.aheadStreakMax),
        pctLostForward: pct(s.positioning.timeLostForward, t),
      },
      possession: {
        touches: s.possession.touches, aerialTouches: s.possession.aerialTouches,
        touchesPerMin: r1((s.possession.touches / t) * 60),
        possessionTime: r1(s.possession.possessionTime),
        possessionPct: pct(s.possession.possessionTime, activeTime || t),
        passes: s.possession.passes, passesReceived: s.possession.passesReceived,
        dribbles: s.possession.dribbles, turnovers: s.possession.turnovers, steals: s.possession.steals,
        firstTouches: s.possession.firstTouches, kickoffs: kickoffCount,
        kickoffFirstTouchPct: kickoffCount > 0 ? Math.round((s.possession.firstTouches / kickoffCount) * 100) : 0,
        clears: s.possession.clears,
        pressureClears: s.possession.pressureClears,
        fiftiesWon: s.possession.fiftiesWon, fiftiesLost: s.possession.fiftiesLost,
        fiftyWinPct: (s.possession.fiftiesWon + s.possession.fiftiesLost) > 0
          ? Math.round((s.possession.fiftiesWon / (s.possession.fiftiesWon + s.possession.fiftiesLost)) * 100) : null,
        kickoffsWon: s.possession.kickoffsWon, kickoffsLost: s.possession.kickoffsLost,
        kickoffsNeutral: s.possession.kickoffsNeutral,
        kickoffWinPct: (s.possession.kickoffsWon + s.possession.kickoffsLost) > 0
          ? Math.round((s.possession.kickoffsWon / (s.possession.kickoffsWon + s.possession.kickoffsLost)) * 100) : null,
        concededAsLastMan: s.possession.concededAsLastMan,
      },
      timePlayed: r1(s.timePlayed),
      heatmap: s.heatmap,
      touchPoints: s.touchPoints,
    });
  }

  // share of touches within the team ("ball hog" index in team modes)
  for (const team of [0, 1]) {
    const teamPl = outPlayers.filter((p2) => p2.team === team);
    const total = teamPl.reduce((acc, p2) => acc + p2.possession.touches, 0);
    for (const p2 of teamPl) {
      p2.possession.touchSharePct = teamPl.length > 1 && total > 0 ? pct(p2.possession.touches, total) : null;
    }
  }

  // ---------- playstyle profile (axes + tags) ----------
  for (const o of outPlayers) {
    o.style = computeStyle(o, P('TeamSize') || 1);
  }

  // ---------- rank estimate from performance ----------
  // 1) absolute estimate from the benchmark (speed, boost, touches, air...)
  // 2) correction by relative performance within the match (z-score composite)
  const ts = P('TeamSize') || 1;
  const ratings = outPlayers.map((p2) => ({
    p: p2,
    comp: [p2.core.score, p2.core.goals + 0.5 * p2.core.assists, p2.core.saves, p2.xg.total, p2.possession.possessionPct],
  }));
  const zOf = (idx) => {
    const vals = ratings.map((r) => r.comp[idx]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    return (v) => (v - mean) / sd;
  };
  const zs = [zOf(0), zOf(1), zOf(2), zOf(3), zOf(4)];
  const W = [0.4, 0.2, 0.15, 0.15, 0.1];
  for (const r of ratings) {
    const rating = r.comp.reduce((acc, v, i) => acc + W[i] * zs[i](v), 0);
    r.p.perfRating = r2(rating);
    const abs = estimateTierAbs(r.p, ts);
    r.p.estTier = abs != null ? r2(Math.max(0, Math.min(22, abs + 1.2 * rating))) : null;
    // match score 0-100 (performance relative to the lobby + production - penalties)
    r.p.gameScore = Math.max(1, Math.min(99, Math.round(
      58 + rating * 18
      + (r.p.core.goals + r.p.core.assists) * 2
      + (r.p.xg ? r.p.xg.finishing : 0) * 1.5
      - r.p.possession.concededAsLastMan * 2.5
      - r.p.positioning.doubleCommits * 1
    )));
  }

  // MVP fallback: highest score on the winning team
  if (!outPlayers.some((p2) => p2.mvp) && outPlayers.length) {
    const winTeam = (P('Team0Score') || 0) >= (P('Team1Score') || 0) ? 0 : 1;
    const cand = outPlayers.filter((p2) => p2.team === winTeam).sort((a, b) => b.core.score - a.core.score)[0];
    if (cand) cand.mvp = true;
  }

  // possession per team
  const teamPossession = { 0: 0, 1: 0 };
  for (const p2 of outPlayers) teamPossession[p2.team] += p2.possession.possessionTime;

  const dateRaw = P('Date') || ''; // "2026-07-17 17-16-10"
  const dateIso = dateRaw.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4');

  const t0 = P('Team0Score') || 0, t1 = P('Team1Score') || 0;
  const lastGoalTime = goals.length ? Math.max(...goals.map((g) => g.time)) : 0;

  return {
    id: P('MatchGUID') || P('Id') || fileName,
    file: fileName,
    name: P('ReplayName') || null,
    map: prettyMap(P('MapName')),
    mapRaw: P('MapName') || null,
    matchType: P('MatchType') || 'Unknown',
    teamSize: P('TeamSize') || Math.max(1, outPlayers.filter((x) => x.team === 0).length),
    date: dateIso,
    duration: r1(activeTime),
    totalSeconds: P('TotalSecondsPlayed') || 0,
    overtime: lastGoalTime > 302 || (P('TotalSecondsPlayed') || 0) > 315,
    team0Score: t0, team1Score: t1,
    goals,
    demoEvents,
    fieldTilt,
    ballHeatmap,
    teamPossession: {
      0: r1(teamPossession[0]), 1: r1(teamPossession[1]),
      pct0: pct(teamPossession[0], teamPossession[0] + teamPossession[1] || 1),
      pct1: pct(teamPossession[1], teamPossession[0] + teamPossession[1] || 1),
    },
    teamXg: {
      0: r2(outPlayers.filter((p2) => p2.team === 0).reduce((a, p2) => a + p2.xg.total, 0)),
      1: r2(outPlayers.filter((p2) => p2.team === 1).reduce((a, p2) => a + p2.xg.total, 0)),
    },
    players: outPlayers,
    timeline: finalizeTimeline(tlSamples, outPlayers),
  };
}

/**
 * Shot detection: after a touch the ball flies toward the opponent's goal (with gravity).
 * xG = geometry (opening angle, distance) + speed + DEFENSE (where the opponents are):
 * an empty net pushes xG toward ~0.9, a blocker on the shot line drags it down.
 */
function detectShot(pl, pos, vel, t, opps = []) {
  if (pl.team == null) return null;
  const goalY = pl.team === 0 ? GOAL.Y : -GOAL.Y;
  const dy = goalY - pos.y;
  if (Math.sign(vel.y) !== Math.sign(dy) || Math.abs(vel.y) < 100) return null;
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  const dist = Math.hypot(pos.x, dy, pos.z - 93);
  // near the goal even slow rollers/tap-ins are shots (before: fixed 500 → we missed them)
  if (speed < (dist < 3000 ? 300 : 500)) return null;
  const tGoal = dy / vel.y;
  if (tGoal <= 0 || tGoal > (dist < 3000 ? 6 : 4.5)) return null;
  const xAtGoal = pos.x + vel.x * tGoal;
  const zAtGoal = pos.z + vel.z * tGoal - 0.5 * GOAL.GRAVITY * tGoal * tGoal;
  if (Math.abs(xAtGoal) > GOAL.HALF_W + 90 || zAtGoal > GOAL.HEIGHT + 90 || zAtGoal < -60) return null;

  // base xG: goal opening angle + speed + distance
  const theta = Math.abs(Math.atan2(2 * GOAL.HALF_W * Math.abs(dy), dy * dy + pos.x * pos.x - GOAL.HALF_W * GOAL.HALF_W));
  const thetaN = theta / Math.PI;
  let xg = sigmoid(-2.9 + 4.5 * thetaN + 1.4 * (speed / 4600) - 2.2 * (dist / 11000));

  // defense: blockers on the shot line + defender nearest to the goal
  let blockers = 0;
  let nearestDefToGoal = Infinity;
  const vx = 0 - pos.x, vy = goalY - pos.y;
  const L2 = vx * vx + vy * vy || 1;
  for (const o of opps) {
    const dGoal = Math.hypot(o.x, o.y - goalY);
    if (dGoal < nearestDefToGoal) nearestDefToGoal = dGoal;
    const tt = ((o.x - pos.x) * vx + (o.y - pos.y) * vy) / L2;
    if (tt > 0.08 && tt < 0.98) {
      const lat = Math.hypot(o.x - (pos.x + vx * tt), o.y - (pos.y + vy * tt));
      if (lat < 320 && o.z < 900) blockers++;
    }
  }
  if (blockers === 0) {
    if (nearestDefToGoal > 2400) {
      // empty net — probability is driven by distance, not speed
      xg = Math.max(xg, dist < 2500 ? 0.92 : dist < 5000 ? 0.78 : dist < 8000 ? 0.55 : 0.35);
    } else if (nearestDefToGoal > 1200) {
      xg = Math.min(0.95, xg * 1.35 + 0.04); // a defender exists, but is out of position
    }
  } else if (blockers >= 2) {
    xg *= 0.45;
  } else {
    xg *= 0.62;
  }

  // Platt recalibration — coefficients fitted on real shot outcomes from the database
  // (562 shots; after it the predicted probability ≈ actual conversion per bucket)
  const cl = Math.min(0.95, Math.max(0.03, xg));
  xg = 1 / (1 + Math.exp(-(0.422 * Math.log(cl / (1 - cl)) + 0.367)));

  xg = Math.max(0.03, Math.min(0.96, xg));
  return { t, key: pl.key, team: pl.team, x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z), speed, xg, goal: false };
}

/** xG for a synthetic goal (no detected shot): geometry of the scorer's last touch. */
function synthGoalXg(x, y, team) {
  const goalY = team === 0 ? GOAL.Y : -GOAL.Y;
  const dy = goalY - y;
  const dist = Math.hypot(x, dy);
  const theta = Math.abs(Math.atan2(2 * GOAL.HALF_W * Math.abs(dy), dy * dy + x * x - GOAL.HALF_W * GOAL.HALF_W));
  return Math.max(0.25, Math.min(0.9, sigmoid(-1.1 + 4.4 * (theta / Math.PI) - 1.8 * (dist / 11000))));
}

/**
 * Absolute rank estimate from benchmark metrics (calibrated to public per-rank averages).
 * Returns tier 0-22 (Bronze 1 = 1 ... SSL = 22) or null if there is not enough data.
 */
function estimateTierAbs(p, teamSize) {
  if (!p.timePlayed || p.timePlayed < 60) return null;
  const scale = teamSize === 1 ? 1 : teamSize === 2 ? 0.78 : 0.62; // fewer touches per player in team modes
  const interp = (v, pts) => {
    if (v <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (v <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return pts[pts.length - 1][1];
  };
  const metrics = [
    [p.movement.pctSupersonic, [[3, 2], [7, 6], [10, 9], [13, 12], [16, 15], [20, 18], [25, 21]], 0.2],
    [p.boost.usedPerMin, [[240, 2], [300, 6], [350, 9], [390, 12], [430, 15], [470, 18], [510, 21]], 0.2],
    [p.movement.avgSpeed, [[1280, 2], [1360, 6], [1420, 9], [1470, 12], [1520, 15], [1570, 18], [1620, 21]], 0.15],
    [p.possession.touchesPerMin / scale, [[5, 2], [7, 6], [8.5, 9], [10, 12], [11.5, 15], [13, 18], [15, 21]], 0.15],
    [p.possession.aerialTouches / scale, [[0.5, 2], [2, 6], [4, 9], [6, 12], [9, 15], [13, 18], [18, 21]], 0.15],
    [p.movement.pctHighAir, [[0.3, 2], [1, 6], [1.8, 9], [2.8, 12], [4.2, 15], [6, 18], [9, 21]], 0.15],
  ];
  let acc = 0, wsum = 0;
  for (const [v, pts, w] of metrics) { acc += interp(v, pts) * w; wsum += w; }
  return acc / wsum;
}

/** Flat-encode timeline: samples → [t, bx,by,bz, pa_x,pa_y,pa_z,pa_yaw,pa_boost, pb_x, ...] */
function finalizeTimeline(samples, outPlayers) {
  const order = outPlayers.map((p) => p.key);
  const flat = samples.map((s) => {
    const row = [s.t, s.b[0], s.b[1], s.b[2]];
    for (const key of order) {
      const c = s.c[key];
      if (c) row.push(c[0], c[1], c[2], c[3], c[4] == null ? null : Math.round(c[4]));
      else row.push(null, null, null, null, null); // demolished / not spawned yet
    }
    return row;
  });
  return {
    players: outPlayers.map((p) => ({ key: p.key, name: p.name, team: p.team })),
    samples: flat,
  };
}

/**
 * Playstyle profile: 6 axes (0-100) + in-match behavior tags.
 * Inspired by calculated.gg playstyle analysis.
 */
function computeStyle(o, teamSize) {
  const cl = (v) => Math.max(0, Math.min(100, Math.round(v)));
  const ps = o.possession, po = o.positioning, mv = o.movement, c = o.core;
  const turnoverRate = ps.touches > 0 ? ps.turnovers / ps.touches : 0;
  const m = teamSize === 1 ? 0.62 : 1; // in 1v1 one player does everything — scale the counters
  const axes = {
    attack: cl(po.pctOffThird * 1.6 + m * (c.shots * 5 + c.goals * 7 + (o.xg ? o.xg.total * 10 : 0))),
    defense: cl(po.pctDefThird * 1.3 + m * (c.saves * 10 + ps.clears * 3.5) + (po.pctBehindBall - 55)),
    control: cl(62 + ps.dribbles * 2 + ps.passes * 3 - turnoverRate * 110),
    speed: cl(mv.pctSupersonic * 3.4 + (mv.avgSpeed - 1150) / 6),
    aerial: cl(ps.aerialTouches * 6 + mv.pctHighAir * 7 + mv.pctLowAir * 1.4),
    duels: cl(50 + (ps.fiftiesWon - ps.fiftiesLost) * 7 + (ps.kickoffsWon - ps.kickoffsLost) * 6 + c.demosInflicted * 4),
  };
  const tags = [];
  if (c.goals >= 3 || (c.shots >= 5 && c.shootingPct >= 40)) tags.push('Efficient attacker');
  if (c.saves >= 3) tags.push('Reliable defense');
  if (c.assists >= 2 || ps.passes >= 4) tags.push('Playmaker');
  if (teamSize > 1 && po.pctMostForward > 48 && po.pctBehindBall < 55) tags.push('Ball-chasing tendency');
  if (po.pctBehindBall > 75 && po.pctDefHalf > 62) tags.push('Disciplined rotation');
  if (ps.turnovers >= 8 && ps.turnovers > ps.steals * 1.5) tags.push('Frequent turnovers');
  if (o.boost.pctZero > 30) tags.push('Poor boost economy');
  if (o.boost.bigPadsStolen >= 5) tags.push('Boost stealing');
  if (c.demosInflicted >= 3) tags.push('Aggressive demos');
  if (ps.kickoffsWon >= 3 && ps.kickoffsWon > ps.kickoffsLost * 2) tags.push('Dominant kickoffs');
  if (ps.fiftiesWon >= 5 && ps.fiftyWinPct >= 60) tags.push('Strong in 50/50s');
  if (ps.aerialTouches >= 8) tags.push('Aerial presence');
  if (mv.pctSupersonic >= 18) tags.push('High tempo');
  if (c.shots >= 4 && c.shootingPct <= 12 && ps.turnovers >= 8) tags.push('Inefficient finishing');
  if (ps.concededAsLastMan >= 2) tags.push('Vulnerable last line');
  return { axes, tags };
}

// benchmark curves of metrics per tier (used both for the estimate and for the "you vs your rank" comparison)
const BENCHMARKS = [
  { key: 'pctSupersonic', label: 'Supersonic %', get: (p) => p.movement.pctSupersonic, pts: [[3, 2], [7, 6], [10, 9], [13, 12], [16, 15], [20, 18], [25, 21]] },
  { key: 'boostPerMin', label: 'Boost / min', get: (p) => p.boost.usedPerMin, pts: [[240, 2], [300, 6], [350, 9], [390, 12], [430, 15], [470, 18], [510, 21]] },
  { key: 'avgSpeed', label: 'Avg speed (uu/s)', get: (p) => p.movement.avgSpeed, pts: [[1280, 2], [1360, 6], [1420, 9], [1470, 12], [1520, 15], [1570, 18], [1620, 21]] },
  { key: 'touchesPerMin', label: 'Touches / min', get: (p) => p.possession.touchesPerMin, scaled: true, pts: [[5, 2], [7, 6], [8.5, 9], [10, 12], [11.5, 15], [13, 18], [15, 21]] },
  { key: 'aerialTouches', label: 'Aerial touches / game', get: (p) => p.possession.aerialTouches, scaled: true, pts: [[0.5, 2], [2, 6], [4, 9], [6, 12], [9, 15], [13, 18], [18, 21]] },
  { key: 'pctHighAir', label: 'High air %', get: (p) => p.movement.pctHighAir, pts: [[0.3, 2], [1, 6], [1.8, 9], [2.8, 12], [4.2, 15], [6, 18], [9, 21]] },
];

/** Expected metric value for a given tier (inverse interpolation of the benchmark curve). */
function expectedForTier(tier, teamSize) {
  const scale = teamSize === 1 ? 1 : teamSize === 2 ? 0.78 : 0.62;
  return BENCHMARKS.map((b) => {
    const pts = b.pts;
    let v;
    if (tier <= pts[0][1]) v = pts[0][0];
    else if (tier >= pts[pts.length - 1][1]) v = pts[pts.length - 1][0];
    else {
      for (let i = 1; i < pts.length; i++) {
        if (tier <= pts[i][1]) {
          const [v0, t0] = pts[i - 1], [v1, t1] = pts[i];
          v = v0 + ((tier - t0) / (t1 - t0)) * (v1 - v0);
          break;
        }
      }
    }
    if (b.scaled) v *= scale;
    return { key: b.key, label: b.label, expected: Math.round(v * 10) / 10 };
  });
}

function quatYaw(q) {
  // yaw from a quaternion (x,y,z,w)
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}
function quatUp(q) {
  // world-space direction of the car roof (local Z axis) from a quaternion
  return {
    x: 2 * (q.x * q.z + q.w * q.y),
    y: 2 * (q.y * q.z - q.w * q.x),
    z: 1 - 2 * (q.x * q.x + q.y * q.y),
  };
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function r2(x) { return Math.round(x * 100) / 100; }

// helpers — boost lookup via the carId cached on the entry
function getCarId(entry, carActors) {
  if (entry.carId != null) return entry.carId;
  for (const [cid, car] of carActors) if (car === entry.car) { entry.carId = cid; return cid; }
  return null;
}
function findBoost(entry, carActors, boostAmount) {
  const cid = getCarId(entry, carActors);
  return cid != null && boostAmount.has(cid) ? boostAmount.get(cid) : null;
}
function findBoostByCarId(cid, boostAmount) {
  return boostAmount.has(cid) ? boostAmount.get(cid) : null;
}
function pct(part, total) { return total > 0 ? Math.round((part / total) * 1000) / 10 : 0; }
function r1(x) { return Math.round(x * 10) / 10; }

module.exports = { analyze, ANALYZER_VERSION, expectedForTier, BENCHMARKS };
