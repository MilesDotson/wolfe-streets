const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const mini = document.querySelector("#map");
const mctx = mini.getContext("2d");

const ui = {
  mode: document.querySelector("#mode"),
  cash: document.querySelector("#cash"),
  heat: document.querySelector("#heat"),
  rep: document.querySelector("#rep"),
  health: document.querySelector("#healthBar"),
  missionTitle: document.querySelector("#missionTitle"),
  missionText: document.querySelector("#missionText"),
  start: document.querySelector("#start"),
  toast: document.querySelector("#toast"),
};

const BLOCK = 420;
const ROAD = 172;
const LANE_WIDTH = 30;
const LANE_OFFSETS = [22, 52];
const STREAM_RADIUS = 1900;
const MINIMAP_RANGE = 1500;
const HOME = { x: 324, y: 324, name: "Wolfe House" };
const keys = new Set();
const rand = mulberry32(8142026);
const colors = ["#c84c3a", "#2d9cdb", "#f2c94c", "#8fd694", "#f7f4e8", "#9b5de5"];
const busColors = ["#f2c94c", "#4cc9f0", "#8fd694", "#f7f4e8"];

const state = {
  running: false,
  time: 0,
  cash: Number(localStorage.getItem("wolfe.cash") || 0),
  rep: Number(localStorage.getItem("wolfe.rep") || 0),
  heat: 0,
  wantedTimer: 0,
  messageTimer: 0,
  currentMission: 0,
  camera: { x: 0, y: 0 },
};

const player = {
  x: HOME.x,
  y: HOME.y,
  r: 13,
  angle: 0,
  vx: 0,
  vy: 0,
  health: 100,
  inCar: null,
  invuln: 0,
};

const missions = [
  {
    title: "Courier Run",
    text: "Pick up the satchel and drop it near the river docks before the timer runs out.",
    pickup: { x: 930, y: 760 },
    drop: { x: 3260, y: 3250 },
    reward: 320,
    rep: 1,
    limit: 58,
  },
  {
    title: "Neon Sweep",
    text: "Collect three glowing caches across Midtown. Keep moving if the heat rises.",
    pickups: [
      { x: 1600, y: 1120 },
      { x: 2520, y: 920 },
      { x: 2820, y: 1940 },
    ],
    reward: 540,
    rep: 2,
    limit: 75,
  },
  {
    title: "Docks Dash",
    text: "Grab a ride, hit the docks checkpoint, then lose your wanted level.",
    pickup: { x: 3460, y: 3140 },
    drop: { x: 680, y: 620 },
    reward: 740,
    rep: 3,
    limit: 92,
    heat: 2,
  },
];

let activeJob = makeJob(0);
const vehicles = [];
const peds = [];
const cops = [];
const particles = [];

spawnTraffic();
spawnPeds();
spawnCops();
resize();
updateDebugTelemetry();
updateHud();
draw();
queueSelfTest();

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
  keys.add(event.key.toLowerCase());
  if (event.key.toLowerCase() === "e") interact();
  if (event.key.toLowerCase() === "m") cycleMission();
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
canvas.addEventListener("pointerdown", () => canvas.focus());
ui.start.addEventListener("click", startGame);

function startGame() {
  if (state.running) return;
  state.running = true;
  ui.start.classList.add("hidden");
  canvas.focus();
  toast(`Leaving ${HOME.name}. Find the yellow marker.`);
  requestAnimationFrame(tick);
}

function tick(now) {
  if (!state.last) state.last = now;
  const dt = Math.min((now - state.last) / 1000, 0.04);
  state.last = now;
  state.time += dt;
  update(dt);
  draw();
  requestAnimationFrame(tick);
}

function update(dt) {
  player.invuln = Math.max(0, player.invuln - dt);
  updatePlayer(dt);
  updateTraffic(dt);
  updatePeds(dt);
  updatePolice(dt);
  resolveVehicleOverlaps();
  updateParticles(dt);
  updateMission(dt);
  updateCamera(dt);
  updateDebugTelemetry();
  updateHud();
}

function updatePlayer(dt) {
  if (player.inCar) {
    const car = player.inCar;
    const steer = key("a", "arrowleft") ? -1 : key("d", "arrowright") ? 1 : 0;
    const gas = key("w", "arrowup") ? 1 : key("s", "arrowdown") ? -0.65 : 0;
    const boost = key("shift") ? 1.35 : 1;
    car.speed += gas * car.accel * boost * dt;
    car.speed *= key(" ") ? 0.9 : 0.985;
    car.speed = clamp(car.speed, -car.max * 0.45, car.max * boost);
    car.angle += steer * (1.7 + Math.abs(car.speed) / 210) * Math.sign(car.speed || 1) * dt;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    if (hitsBuilding(car.x, car.y, car.w * 0.42)) {
      car.x -= Math.cos(car.angle) * car.speed * dt * 1.4;
      car.y -= Math.sin(car.angle) * car.speed * dt * 1.4;
      car.speed *= -0.25;
      hurt(Math.abs(car.speed) * 0.025);
      spark(car.x, car.y, 8, "#f2c94c");
    }
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    policeNoise(Math.abs(car.speed) > car.max * 1.18 ? 0.07 * dt : 0);
    return;
  }

  const dx = (key("d", "arrowright") ? 1 : 0) - (key("a", "arrowleft") ? 1 : 0);
  const dy = (key("s", "arrowdown") ? 1 : 0) - (key("w", "arrowup") ? 1 : 0);
  const mag = Math.hypot(dx, dy) || 1;
  const speed = key("shift") ? 230 : 148;
  const nx = player.x + (dx / mag) * speed * dt;
  const ny = player.y + (dy / mag) * speed * dt;
  if (!hitsBuilding(nx, player.y, player.r)) player.x = nx;
  if (!hitsBuilding(player.x, ny, player.r)) player.y = ny;
  if (dx || dy) player.angle = Math.atan2(dy, dx);
}

function updateTraffic(dt) {
  for (const car of vehicles) {
    if (car === player.inCar) continue;
    car.pathT += dt * car.aiSpeed;
    car.aiSpeed = lerp(car.aiSpeed, car.targetSpeed, 0.6 * dt);
    const blocker = trafficBlocker(car);
    if (blocker) {
      car.aiSpeed = Math.max(20, Math.min(car.aiSpeed, blocker.aiSpeed || 40) * 0.74);
      if (blocker.gap < 42) car.sign *= -1;
    }
    const lane = car.lane;
    if (car.dir === "h") {
      car.x += car.sign * car.aiSpeed * dt;
      car.y = lane;
      car.angle = car.sign > 0 ? 0 : Math.PI;
    } else {
      car.y += car.sign * car.aiSpeed * dt;
      car.x = lane;
      car.angle = car.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    if (dist(car, player) > STREAM_RADIUS) resetTrafficCar(car, vehicles.indexOf(car));
    if (dist(car, player) < (player.inCar ? 44 : 26)) {
      if (player.inCar) {
        car.sign *= -1;
        player.inCar.speed *= 0.72;
        hurt(7);
        policeNoise(0.45);
        spark(player.x, player.y, 12, "#ffef9f");
      } else {
        hurt(16);
        player.x -= Math.cos(car.angle) * 26;
        player.y -= Math.sin(car.angle) * 26;
      }
    }
  }
}

function trafficBlocker(car) {
  let closest = null;
  for (const other of vehicles) {
    if (other === car || other === player.inCar || other.dir !== car.dir || other.sign !== car.sign) continue;
    if (Math.abs(other.lane - car.lane) > LANE_WIDTH * 0.55) continue;
    const gap = car.dir === "h" ? (other.x - car.x) * car.sign : (other.y - car.y) * car.sign;
    const followDistance = car.bus || other.bus ? 150 : 110;
    if (gap > 0 && gap < followDistance && (!closest || gap < closest.gap)) closest = { ...other, gap };
  }
  return closest;
}

function resolveVehicleOverlaps() {
  const allVehicles = [...vehicles, ...cops];
  for (let i = 0; i < allVehicles.length; i++) {
    for (let j = i + 1; j < allVehicles.length; j++) {
      const a = allVehicles[i];
      const b = allVehicles[j];
      const minDistance = vehicleRadius(a) + vehicleRadius(b) + 4;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      if (distance >= minDistance) continue;

      const overlap = minDistance - distance;
      const nx = dx / distance;
      const ny = dy / distance;
      const aLocked = a === player.inCar;
      const bLocked = b === player.inCar;
      const aPush = bLocked ? 1 : aLocked ? 0 : 0.5;
      const bPush = aLocked ? 1 : bLocked ? 0 : 0.5;

      a.x -= nx * overlap * aPush;
      a.y -= ny * overlap * aPush;
      b.x += nx * overlap * bPush;
      b.y += ny * overlap * bPush;

      if (!aLocked) {
        if (typeof a.sign === "number") a.sign *= -1;
        if (a.police) a.unstuckTimer = 0.25;
        a.aiSpeed = Math.max(18, (a.aiSpeed || 80) * 0.58);
        if (a.police) a.speed = Math.max(35, (a.speed || 80) * 0.65);
      }
      if (!bLocked) {
        if (typeof b.sign === "number") b.sign *= -1;
        if (b.police) b.unstuckTimer = 0.25;
        b.aiSpeed = Math.max(18, (b.aiSpeed || 80) * 0.58);
        if (b.police) b.speed = Math.max(35, (b.speed || 80) * 0.65);
      }
      if (aLocked || bLocked) {
        const playerCar = aLocked ? a : b;
        playerCar.speed *= 0.48;
        player.x = playerCar.x;
        player.y = playerCar.y;
      }
    }
  }
}

function vehicleRadius(vehicle) {
  return Math.max(vehicle.w || 54, vehicle.h || 28) * 0.52;
}

function updatePeds(dt) {
  for (const ped of peds) {
    ped.wait -= dt;
    if (ped.wait <= 0) {
      ped.angle += randRange(-1.4, 1.4);
      ped.wait = randRange(0.7, 2.4);
    }
    const speed = ped.scared ? 110 : 38;
    const nx = ped.x + Math.cos(ped.angle) * speed * dt;
    const ny = ped.y + Math.sin(ped.angle) * speed * dt;
    if (!hitsBuilding(nx, ny, 9) && isRoadish(nx, ny)) {
      ped.x = nx;
      ped.y = ny;
    } else {
      ped.angle += Math.PI * 0.6;
    }
    if (dist(ped, player) > STREAM_RADIUS * 0.82) resetPed(ped);
    ped.scared = dist(ped, player) < (player.inCar ? 120 : 58);
    if (ped.scared && player.inCar && dist(ped, player) < 24) {
      hurt(3);
      policeNoise(0.65);
      ped.x += Math.cos(player.angle) * 46;
      ped.y += Math.sin(player.angle) * 46;
      spark(ped.x, ped.y, 7, "#ef476f");
    }
  }
}

function updatePolice(dt) {
  state.wantedTimer = Math.max(0, state.wantedTimer - dt);
  if (state.wantedTimer <= 0) state.heat = Math.max(0, state.heat - dt * 0.12);

  for (const cop of cops) {
    cop.unstuckTimer = Math.max(0, (cop.unstuckTimer || 0) - dt);
    const pursuit = state.heat >= 1 && dist(cop, player) < 850;
    const targetAngle = pursuit && !cop.unstuckTimer ? Math.atan2(player.y - cop.y, player.x - cop.x) : cop.angle;
    cop.angle = lerpAngle(cop.angle, targetAngle, pursuit ? 3.2 * dt : 0.8 * dt);
    cop.speed = lerp(cop.speed, pursuit ? 210 + state.heat * 25 : 86, 1.8 * dt);
    const prevX = cop.x;
    const prevY = cop.y;
    cop.x += Math.cos(cop.angle) * cop.speed * dt;
    cop.y += Math.sin(cop.angle) * cop.speed * dt;
    if (hitsBuilding(cop.x, cop.y, 22)) {
      cop.x = prevX;
      cop.y = prevY;
      cop.angle = escapeHeading(cop);
      cop.speed = 48;
      cop.unstuckTimer = 0.65;
    }
    if (dist(cop, player) > STREAM_RADIUS * 1.2) resetCop(cop);
    if (pursuit && dist(cop, player) < (player.inCar ? 42 : 28)) {
      hurt(player.inCar ? 10 : 18);
      state.heat = Math.max(state.heat, 2.2);
      state.wantedTimer = 8;
      spark(player.x, player.y, 10, "#4cc9f0");
    }
  }
}

function updateMission(dt) {
  if (!activeJob.started && near(activeJob.pickup || activeJob.pickups[activeJob.collected], 40)) {
    activeJob.started = true;
    activeJob.timer = activeJob.limit;
    if (activeJob.heat) {
      state.heat = Math.max(state.heat, activeJob.heat);
      state.wantedTimer = 10;
    }
    toast(`${activeJob.title} started`);
  }

  if (!activeJob.started) return;
  activeJob.timer -= dt;
  if (activeJob.timer <= 0) {
    failMission("Job failed. The city does not wait.");
    return;
  }

  if (activeJob.pickups) {
    const target = activeJob.pickups[activeJob.collected];
    if (target && near(target, 42)) {
      activeJob.collected += 1;
      toast(`Cache ${activeJob.collected}/${activeJob.pickups.length}`);
    }
    if (activeJob.collected >= activeJob.pickups.length) completeMission();
    return;
  }

  if (!activeJob.hasPickup && near(activeJob.pickup, 42)) {
    activeJob.hasPickup = true;
    toast("Package secured");
  }
  if (activeJob.hasPickup && near(activeJob.drop, 50)) completeMission();
}

function completeMission() {
  state.cash += activeJob.reward;
  state.rep += activeJob.rep;
  state.heat = Math.max(0, state.heat - 0.75);
  localStorage.setItem("wolfe.cash", state.cash);
  localStorage.setItem("wolfe.rep", state.rep);
  toast(`Job complete: +$${activeJob.reward}`);
  state.currentMission = (state.currentMission + 1) % missions.length;
  activeJob = makeJob(state.currentMission);
}

function failMission(text) {
  toast(text);
  activeJob = makeJob(state.currentMission);
}

function interact() {
  if (!state.running) return startGame();
  if (player.inCar) {
    const car = player.inCar;
    player.inCar = null;
    player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 38;
    player.y = car.y + Math.sin(car.angle + Math.PI / 2) * 38;
    car.speed = 0;
    toast("Exited vehicle");
    return;
  }
  const car = vehicles.filter((v) => !v.police).sort((a, b) => dist(a, player) - dist(b, player))[0];
  if (car && dist(car, player) < 58) {
    player.inCar = car;
    car.speed = 0;
    policeNoise(0.35);
    toast("Vehicle acquired");
  }
}

function cycleMission() {
  state.currentMission = (state.currentMission + 1) % missions.length;
  activeJob = makeJob(state.currentMission);
  toast(`Selected: ${activeJob.title}`);
}

function updateCamera(dt) {
  const targetX = player.x - canvas.width / 2;
  const targetY = player.y - canvas.height / 2;
  state.camera.x = lerp(state.camera.x, targetX, 7 * dt);
  state.camera.y = lerp(state.camera.y, targetY, 7 * dt);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-state.camera.x, -state.camera.y);
  drawWorld();
  drawMarkers();
  for (const ped of peds) drawPed(ped);
  for (const car of vehicles) drawCar(car);
  for (const cop of cops) drawCar(cop);
  if (!player.inCar) drawPlayer();
  for (const p of particles) drawParticle(p);
  ctx.restore();
  drawVignette();
  drawMiniMap();
}

function drawWorld() {
  const left = state.camera.x - 120;
  const top = state.camera.y - 120;
  const right = state.camera.x + canvas.width + 120;
  const bottom = state.camera.y + canvas.height + 120;

  ctx.fillStyle = "#25352f";
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.fillStyle = "#1b2424";
  for (let x = snapDown(left, BLOCK); x <= right; x += BLOCK) ctx.fillRect(x - ROAD / 2, top, ROAD, bottom - top);
  for (let y = snapDown(top, BLOCK); y <= bottom; y += BLOCK) ctx.fillRect(left, y - ROAD / 2, right - left, ROAD);
  ctx.strokeStyle = "rgba(247,244,232,.16)";
  ctx.lineWidth = 3;
  drawLaneMarkings(left, top, right, bottom);

  for (const b of visibleBuildings(left, top, right, bottom)) {
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    for (let wx = b.x + 18; wx < b.x + b.w - 14; wx += 38) {
      for (let wy = b.y + 18; wy < b.y + b.h - 14; wy += 34) ctx.fillRect(wx, wy, 10, 8);
    }
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }

  drawDistrictWater(left, top, right, bottom);
}

function drawLaneMarkings(left, top, right, bottom) {
  ctx.lineWidth = 2;
  for (let x = snapDown(left, BLOCK); x <= right; x += BLOCK) {
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(242,201,76,.68)";
    line(x - 3, top, x - 3, bottom);
    line(x + 3, top, x + 3, bottom);
    ctx.setLineDash([24, 26]);
    ctx.strokeStyle = "rgba(247,244,232,.2)";
    line(x - LANE_WIDTH, top, x - LANE_WIDTH, bottom);
    line(x + LANE_WIDTH, top, x + LANE_WIDTH, bottom);
  }
  for (let y = snapDown(top, BLOCK); y <= bottom; y += BLOCK) {
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(242,201,76,.68)";
    line(left, y - 3, right, y - 3);
    line(left, y + 3, right, y + 3);
    ctx.setLineDash([24, 26]);
    ctx.strokeStyle = "rgba(247,244,232,.2)";
    line(left, y - LANE_WIDTH, right, y - LANE_WIDTH);
    line(left, y + LANE_WIDTH, right, y + LANE_WIDTH);
  }
  ctx.setLineDash([]);
}

function drawMarkers() {
  drawHomeMarker();
  const points = missionTargets();
  for (const point of points) {
    const pulse = 1 + Math.sin(state.time * 5) * 0.08;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 34 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = point.drop ? "rgba(76,201,240,.24)" : "rgba(242,201,76,.26)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = point.drop ? "#4cc9f0" : "#f2c94c";
    ctx.stroke();
  }
}

function drawHomeMarker() {
  ctx.save();
  ctx.translate(HOME.x, HOME.y);
  ctx.fillStyle = "rgba(6,214,160,.18)";
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#06d6a0";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#06d6a0";
  ctx.beginPath();
  ctx.moveTo(-14, -2);
  ctx.lineTo(0, -16);
  ctx.lineTo(14, -2);
  ctx.lineTo(10, -2);
  ctx.lineTo(10, 13);
  ctx.lineTo(-10, 13);
  ctx.lineTo(-10, -2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);
  ctx.fillStyle = player.invuln > 0 && Math.floor(state.time * 12) % 2 ? "#ef476f" : "#f7f4e8";
  ctx.beginPath();
  ctx.arc(0, 0, player.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#101817";
  ctx.fillRect(3, -4, 14, 8);
  ctx.restore();
}

function drawPed(ped) {
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.fillStyle = ped.scared ? "#ef476f" : ped.color;
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCar(car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = car.police ? "#f7f4e8" : car.color;
  roundRect(-car.w / 2, -car.h / 2, car.w, car.h, 6);
  ctx.fill();
  if (car.bus) {
    ctx.fillStyle = "rgba(10,14,16,.58)";
    for (let x = -car.w * 0.36; x < car.w * 0.28; x += 18) ctx.fillRect(x, -car.h * 0.34, 10, car.h * 0.68);
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.fillRect(car.w * 0.37, -car.h * 0.3, 9, 7);
    ctx.fillRect(car.w * 0.37, car.h * 0.12, 9, 7);
  } else {
    ctx.fillStyle = car.police ? "#1d3557" : "rgba(10,14,16,.62)";
    ctx.fillRect(-car.w * 0.17, -car.h * 0.42, car.w * 0.34, car.h * 0.84);
    ctx.fillStyle = car.police ? "#ef476f" : "rgba(255,255,255,.6)";
    ctx.fillRect(car.w * 0.3, -car.h * 0.33, 8, 7);
    ctx.fillStyle = car.police ? "#4cc9f0" : "rgba(255,255,255,.28)";
    ctx.fillRect(car.w * 0.3, car.h * 0.17, 8, 7);
  }
  ctx.restore();
}

function drawParticle(p) {
  ctx.globalAlpha = Math.max(0, p.life / p.max);
  ctx.fillStyle = p.color;
  ctx.fillRect(p.x, p.y, p.size, p.size);
  ctx.globalAlpha = 1;
}

function drawVignette() {
  const gradient = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.width * 0.25, canvas.width / 2, canvas.height / 2, canvas.width * 0.75);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,.38)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawMiniMap() {
  const s = mini.width / (MINIMAP_RANGE * 2);
  const center = mini.width / 2;
  mctx.clearRect(0, 0, mini.width, mini.height);
  mctx.fillStyle = "#182121";
  mctx.fillRect(0, 0, mini.width, mini.height);
  mctx.fillStyle = "#2e3b39";
  for (let x = snapDown(player.x - MINIMAP_RANGE, BLOCK); x <= player.x + MINIMAP_RANGE; x += BLOCK) {
    mctx.fillRect(center + (x - player.x) * s - 2, 0, 4, mini.height);
  }
  for (let y = snapDown(player.y - MINIMAP_RANGE, BLOCK); y <= player.y + MINIMAP_RANGE; y += BLOCK) {
    mctx.fillRect(0, center + (y - player.y) * s - 2, mini.width, 4);
  }
  for (const point of missionTargets()) {
    if (dist(point, player) > MINIMAP_RANGE) continue;
    mctx.fillStyle = point.drop ? "#4cc9f0" : "#f2c94c";
    mctx.beginPath();
    mctx.arc(center + (point.x - player.x) * s, center + (point.y - player.y) * s, 4, 0, Math.PI * 2);
    mctx.fill();
  }
  if (dist(HOME, player) <= MINIMAP_RANGE) {
    mctx.fillStyle = "#06d6a0";
    mctx.fillRect(center + (HOME.x - player.x) * s - 3, center + (HOME.y - player.y) * s - 3, 6, 6);
  }
  mctx.fillStyle = "#f7f4e8";
  mctx.beginPath();
  mctx.arc(center, center, 4.5, 0, Math.PI * 2);
  mctx.fill();
  if (state.heat >= 1) {
    mctx.fillStyle = "#ef476f";
    for (const cop of cops) mctx.fillRect(center + (cop.x - player.x) * s - 2, center + (cop.y - player.y) * s - 2, 4, 4);
  }
}

function updateHud() {
  ui.mode.textContent = player.inCar ? `Driving ${Math.round(Math.abs(player.inCar.speed))} mph` : "On foot";
  ui.cash.textContent = `$${state.cash}`;
  ui.heat.textContent = Math.floor(state.heat).toString();
  ui.rep.textContent = state.rep.toString();
  ui.health.style.width = `${clamp(player.health, 0, 100)}%`;
  ui.missionTitle.textContent = activeJob.started
    ? `${activeJob.title} - ${Math.max(0, Math.ceil(activeJob.timer))}s`
    : activeJob.title;
  ui.missionText.textContent = missionText();
}

function updateDebugTelemetry() {
  document.body.dataset.playerX = player.x.toFixed(2);
  document.body.dataset.playerY = player.y.toFixed(2);
  document.body.dataset.playerBlocked = String(hitsBuilding(player.x, player.y, player.r));
  document.body.dataset.playerOnRoad = String(isRoadish(player.x, player.y));
  document.body.dataset.playerAtHome = String(dist(player, HOME) < 8);
  document.body.dataset.homeName = HOME.name;
  document.body.dataset.running = String(state.running);
  document.body.dataset.vehicleOverlaps = String(countVehicleOverlaps());
  document.body.dataset.cityChunk = `${Math.floor(player.x / BLOCK)},${Math.floor(player.y / BLOCK)}`;
  document.body.dataset.policeMaxSpin = maxPoliceSpin().toFixed(3);
  document.body.dataset.busCount = String(vehicles.filter((vehicle) => vehicle.bus).length);
  document.body.dataset.laneCount = String(LANE_OFFSETS.length * 2);
}

function countVehicleOverlaps() {
  const allVehicles = [...vehicles, ...cops];
  let overlaps = 0;
  for (let i = 0; i < allVehicles.length; i++) {
    for (let j = i + 1; j < allVehicles.length; j++) {
      if (dist(allVehicles[i], allVehicles[j]) < vehicleRadius(allVehicles[i]) + vehicleRadius(allVehicles[j])) overlaps += 1;
    }
  }
  return overlaps;
}

function maxPoliceSpin() {
  let maxSpin = 0;
  for (const cop of cops) {
    const spin = Math.abs(Math.atan2(Math.sin(cop.angle - (cop.lastTelemetryAngle ?? cop.angle)), Math.cos(cop.angle - (cop.lastTelemetryAngle ?? cop.angle))));
    maxSpin = Math.max(maxSpin, spin);
    cop.lastTelemetryAngle = cop.angle;
  }
  return maxSpin;
}

function queueSelfTest() {
  const params = new URLSearchParams(window.location.search);
  const heat = Number(params.get("testHeat") || 0);
  if (heat > 0) {
    state.heat = heat;
    state.wantedTimer = 12;
  }
  if (params.get("testHospital") === "1") {
    window.setTimeout(() => {
      startGame();
      sendHomeFromHospital();
    }, 160);
  }
  const direction = params.get("testMove");
  if (!direction) return;
  const duration = clamp(Number(params.get("testMs") || 700), 100, 8000);
  window.setTimeout(() => {
    startGame();
    keys.add(direction.toLowerCase());
    window.setTimeout(() => keys.delete(direction.toLowerCase()), duration);
  }, 120);
}

function spawnTraffic() {
  for (let i = 0; i < 54; i++) {
    const bus = i % 8 === 0;
    const car = {
      bus,
      w: bus ? 96 : 54,
      h: bus ? 32 : 28,
      angle: 0,
      speed: 0,
      max: bus ? randRange(190, 240) : randRange(280, 360),
      accel: bus ? randRange(210, 280) : randRange(380, 460),
      aiSpeed: bus ? randRange(54, 96) : randRange(70, 150),
      targetSpeed: bus ? randRange(58, 102) : randRange(78, 150),
      sign: rand() > 0.5 ? 1 : -1,
      color: bus ? busColors[Math.floor(rand() * busColors.length)] : colors[Math.floor(rand() * colors.length)],
      pathT: randRange(0, 100),
    };
    resetTrafficCar(car, i);
    vehicles.push(car);
  }
}

function spawnPeds() {
  for (let i = 0; i < 86; i++) {
    const ped = { x: 0, y: 0, angle: randRange(0, Math.PI * 2), wait: randRange(0, 2), color: colors[Math.floor(rand() * colors.length)] };
    resetPed(ped);
    peds.push(ped);
  }
}

function spawnCops() {
  const starts = [
    { x: 780, y: 360 },
    { x: 2080, y: 400 },
    { x: 3340, y: 1260 },
    { x: 1220, y: 3340 },
  ];
  for (const p of starts) cops.push({ ...p, w: 58, h: 30, angle: randRange(0, 6), speed: 80, police: true, unstuckTimer: 0 });
}

function resetTrafficCar(car, index = 0) {
  const horizontal = rand() > 0.5;
  const offset = STREAM_RADIUS * 0.35 + randRange(0, STREAM_RADIUS * 0.65);
  const side = index % 2 === 0 ? 1 : -1;
  const laneBase = horizontal ? player.y + randRange(-STREAM_RADIUS, STREAM_RADIUS) : player.x + randRange(-STREAM_RADIUS, STREAM_RADIUS);
  car.dir = horizontal ? "h" : "v";
  car.sign = rand() > 0.5 ? 1 : -1;
  car.laneIndex = Math.floor(randRange(0, 2));
  car.lane = trafficLanePosition(snapDown(laneBase, BLOCK), car.sign, car.laneIndex);
  car.x = horizontal ? player.x + side * offset : car.lane;
  car.y = horizontal ? car.lane : player.y + side * offset;
  car.angle = horizontal ? (car.sign > 0 ? 0 : Math.PI) : car.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
  car.aiSpeed = car.bus ? randRange(54, 96) : randRange(70, 150);
  car.targetSpeed = car.bus ? randRange(58, 102) : randRange(78, 150);
}

function trafficLanePosition(roadCenter, sign, laneIndex) {
  const offset = LANE_OFFSETS[clamp(laneIndex, 0, LANE_OFFSETS.length - 1)];
  return roadCenter + offset * sign;
}

function resetPed(ped) {
  let tries = 0;
  do {
    const angle = randRange(0, Math.PI * 2);
    const radius = randRange(STREAM_RADIUS * 0.3, STREAM_RADIUS * 0.78);
    ped.x = player.x + Math.cos(angle) * radius;
    ped.y = player.y + Math.sin(angle) * radius;
    tries += 1;
  } while (tries < 30 && (!isRoadish(ped.x, ped.y) || hitsBuilding(ped.x, ped.y, 10)));
  ped.angle = randRange(0, Math.PI * 2);
  ped.wait = randRange(0.2, 2);
}

function resetCop(cop) {
  const angle = randRange(0, Math.PI * 2);
  const radius = STREAM_RADIUS * 0.75;
  cop.x = player.x + Math.cos(angle) * radius;
  cop.y = player.y + Math.sin(angle) * radius;
  cop.angle = angle + Math.PI;
  cop.speed = 80;
  cop.unstuckTimer = 0.3;
  if (hitsBuilding(cop.x, cop.y, 26)) {
    cop.x = snapDown(cop.x, BLOCK);
    cop.y = snapDown(cop.y, BLOCK);
  }
}

function escapeHeading(vehicle) {
  const headings = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let best = vehicle.angle + Math.PI;
  let bestScore = -Infinity;
  for (const heading of headings) {
    const testX = vehicle.x + Math.cos(heading) * 92;
    const testY = vehicle.y + Math.sin(heading) * 92;
    const score = (hitsBuilding(testX, testY, 24) ? -1000 : 0) + (isRoadish(testX, testY) ? 100 : 0) + dist({ x: testX, y: testY }, player) * 0.01;
    if (score > bestScore) {
      best = heading;
      bestScore = score;
    }
  }
  return best;
}

function missionTargets() {
  if (activeJob.pickups) {
    return activeJob.collected < activeJob.pickups.length ? [activeJob.pickups[activeJob.collected]] : [];
  }
  if (!activeJob.started || !activeJob.hasPickup) return [activeJob.pickup];
  return [{ ...activeJob.drop, drop: true }];
}

function missionText() {
  if (activeJob.pickups) {
    return activeJob.started
      ? `Cache ${activeJob.collected + 1}/${activeJob.pickups.length}. Reach the next yellow marker.`
      : activeJob.text;
  }
  if (!activeJob.started) return activeJob.text;
  return activeJob.hasPickup ? "Deliver the package to the blue marker." : "Reach the yellow pickup marker.";
}

function makeJob(index) {
  return { ...missions[index], started: false, timer: missions[index].limit, hasPickup: false, collected: 0 };
}

function hitsBuilding(x, y, r) {
  const minCx = Math.floor((x - r) / BLOCK) - 1;
  const maxCx = Math.floor((x + r) / BLOCK) + 1;
  const minCy = Math.floor((y - r) / BLOCK) - 1;
  const maxCy = Math.floor((y + r) / BLOCK) + 1;
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const b = buildingForCell(cx, cy);
      if (b && x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
    }
  }
  return false;
}

function visibleBuildings(left, top, right, bottom) {
  const result = [];
  const minCx = Math.floor(left / BLOCK) - 1;
  const maxCx = Math.floor(right / BLOCK) + 1;
  const minCy = Math.floor(top / BLOCK) - 1;
  const maxCy = Math.floor(bottom / BLOCK) + 1;
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const building = buildingForCell(cx, cy);
      if (building) result.push(building);
    }
  }
  return result;
}

function buildingForCell(cx, cy) {
  const r = cellRandom(cx, cy);
  if (r() < 0.08 || isWaterDistrict(cx * BLOCK + BLOCK / 2)) return null;
  const inset = 24 + Math.floor(r() * 16);
  const x = cx * BLOCK + ROAD / 2 + inset;
  const y = cy * BLOCK + ROAD / 2 + inset;
  const w = BLOCK - ROAD - inset * 2;
  const h = BLOCK - ROAD - inset * 2;
  const palette = ["#39443f", "#344052", "#473f38", "#2f4a4d", "#4a3c51"];
  return { x, y, w, h, color: palette[Math.floor(r() * palette.length)] };
}

function drawDistrictWater(left, top, right, bottom) {
  const start = snapDown(left, BLOCK * 12);
  ctx.fillStyle = "#174d54";
  for (let x = start; x <= right; x += BLOCK * 12) {
    const waterX = x + BLOCK * 8.7;
    if (waterX + 550 < left || waterX > right) continue;
    ctx.fillRect(waterX, top, 550, bottom - top);
    ctx.fillStyle = "rgba(255,255,255,.12)";
    for (let y = snapDown(top, 90); y < bottom; y += 90) ctx.fillRect(waterX - 10, y, 70, 20);
    ctx.fillStyle = "#174d54";
  }
}

function isRoadish(x, y) {
  const mx = Math.abs(mod(x + BLOCK / 2, BLOCK) - BLOCK / 2);
  const my = Math.abs(mod(y + BLOCK / 2, BLOCK) - BLOCK / 2);
  return mx < ROAD * 0.55 || my < ROAD * 0.55 || isWaterDistrict(x);
}

function isWaterDistrict(x) {
  return mod(x - BLOCK * 8.7, BLOCK * 12) < 550;
}

function policeNoise(amount) {
  if (amount <= 0) return;
  state.heat = clamp(state.heat + amount, 0, 5);
  state.wantedTimer = 9;
}

function hurt(amount) {
  if (player.invuln > 0) return;
  player.health -= amount;
  player.invuln = 0.5;
  if (player.health <= 0) {
    state.cash = Math.max(0, state.cash - 120);
    sendHomeFromHospital();
  }
}

function sendHomeFromHospital() {
  player.health = 100;
  player.x = HOME.x;
  player.y = HOME.y;
  player.inCar = null;
  state.heat = 0;
  state.wantedTimer = 0;
  toast(`Discharged from hospital. Back home at ${HOME.name}.`);
}

function spark(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: randRange(-100, 100),
      vy: randRange(-100, 100),
      life: randRange(0.25, 0.55),
      max: 0.55,
      size: randRange(2, 5),
      color,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1900);
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function key(...names) {
  return names.some((name) => keys.has(name));
}

function near(point, radius) {
  return point && Math.hypot(player.x - point.x, player.y - point.y) < radius;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mod(value, size) {
  return ((value % size) + size) % size;
}

function snapDown(value, size) {
  return Math.floor(value / size) * size;
}

function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * clamp(t, 0, 1);
}

function randRange(min, max) {
  return min + rand() * (max - min);
}

function cellRandom(cx, cy) {
  return mulberry32(hashCell(cx, cy));
}

function hashCell(cx, cy) {
  let h = 2166136261;
  h ^= cx + 0x9e3779b9 + (h << 6) + (h >>> 2);
  h = Math.imul(h, 16777619);
  h ^= cy + 0x85ebca6b + (h << 6) + (h >>> 2);
  return h >>> 0;
}

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

window.__wolfeDebug = {
  player,
  keys,
  state,
  isBlocked: () => hitsBuilding(player.x, player.y, player.r),
};
