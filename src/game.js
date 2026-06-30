import { applyLifeLoss, isLaneChangeSafe, nextTrafficSpeed, shouldAttemptLaneChange } from "./trafficModel.js";

const urlParams = new URLSearchParams(window.location.search);
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const mini = document.querySelector("#map");
const mctx = mini.getContext("2d");

const ui = {
  mode: document.querySelector("#mode"),
  cash: document.querySelector("#cash"),
  heat: document.querySelector("#heat"),
  policeActivity: document.querySelector("#policeActivity"),
  rep: document.querySelector("#rep"),
  health: document.querySelector("#healthBar"),
  lives: document.querySelector("#lives"),
  missionTitle: document.querySelector("#missionTitle"),
  missionText: document.querySelector("#missionText"),
  testPanel: document.querySelector("#testPanel"),
  start: document.querySelector("#start"),
  toast: document.querySelector("#toast"),
  joystick: document.querySelector("#joystick"),
  joystickKnob: document.querySelector("#joystickKnob"),
  mobileButtons: document.querySelectorAll(".touch-button"),
};

const BLOCK = 420;
const ROAD = 172;
const LANE_WIDTH = 30;
const LANE_OFFSETS = [22, 52];
const SIGNAL_CYCLE = 18;
const SIGNAL_YELLOW = 2.2;
const STREAM_RADIUS = 1900;
const MINIMAP_RANGE = 1500;
const HOME = { x: 630, y: 630, name: "Wolfe House" };
const HOME_SAFE_RADIUS = 82;
const WATER_WIDTH = 550;
const HOSPITAL_BILL = 120;
const BUST_BASE_FINE = 250;
const BUST_THRESHOLD = 3.4;
const BUST_DECAY = 0.55;
const WALK_SPEED = 112;
const SPRINT_SPEED = 168;
const SWIM_SPEED = 58;
const FAST_SWIM_SPEED = 92;
const keys = new Set();
const touchInput = { active: false, x: 0, y: 0, boost: false, brake: false };
const rand = mulberry32(8142026);
const colors = ["#c84c3a", "#2d9cdb", "#f2c94c", "#8fd694", "#f7f4e8", "#9b5de5"];
const busColors = ["#f2c94c", "#4cc9f0", "#8fd694", "#f7f4e8"];
const motorcycleColors = ["#ef476f", "#f2c94c", "#4cc9f0", "#f7f4e8"];

const state = {
  running: false,
  time: 0,
  cash: Number(localStorage.getItem("wolfe.cash") || 0),
  rep: Number(localStorage.getItem("wolfe.rep") || 0),
  heat: 0,
  wantedTimer: 0,
  messageTimer: 0,
  currentMission: 0,
  lives: 5,
  gameOver: false,
  testMode: urlParams.get("testMode") === "1",
  testScenario: urlParams.get("scenario") || "observe",
  inputX: 0,
  inputY: 0,
  playerSpeed: 0,
  playerDriveSpeed: 0,
  policeContacts: 0,
  policeBoosts: 0,
  busts: 0,
  bustPressure: 0,
  lawEvents: 0,
  lawCooldown: 0,
  wrongSideTimer: 0,
  lastLaw: "clear",
  homeSafeTimer: 0,
  waterTimer: 0,
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
window.addEventListener("blur", () => {
  keys.clear();
  resetTouchInput();
});
canvas.addEventListener("pointerdown", () => canvas.focus());
ui.start.addEventListener("click", startGame);
setupMobileControls();

function startGame() {
  if (state.gameOver) resetGame();
  if (state.running) return;
  state.running = true;
  ui.start.classList.add("hidden");
  canvas.focus();
  toast(`Leaving ${HOME.name}. Find the yellow marker.`);
  requestAnimationFrame(tick);
}

function setupMobileControls() {
  if (!ui.joystick || !ui.joystickKnob) return;
  const moveJoystick = (event) => {
    event.preventDefault();
    if (!state.running) startGame();
    const rect = ui.joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width * 0.34;
    const rawX = event.clientX - cx;
    const rawY = event.clientY - cy;
    const length = Math.hypot(rawX, rawY);
    const scale = length > max ? max / length : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    touchInput.active = true;
    touchInput.x = clamp(x / max, -1, 1);
    touchInput.y = clamp(y / max, -1, 1);
    ui.joystickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  };
  const releaseJoystick = (event) => {
    event.preventDefault();
    touchInput.active = false;
    touchInput.x = 0;
    touchInput.y = 0;
    ui.joystickKnob.style.transform = "translate(-50%, -50%)";
  };

  ui.joystick.addEventListener("pointerdown", (event) => {
    ui.joystick.setPointerCapture(event.pointerId);
    moveJoystick(event);
  });
  ui.joystick.addEventListener("pointermove", (event) => {
    if (touchInput.active) moveJoystick(event);
  });
  ui.joystick.addEventListener("pointerup", releaseJoystick);
  ui.joystick.addEventListener("pointercancel", releaseJoystick);

  for (const button of ui.mobileButtons) {
    const action = button.dataset.touch;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (!state.running) startGame();
      button.setPointerCapture(event.pointerId);
      button.classList.add("active");
      if (action === "boost") touchInput.boost = true;
      else if (action === "brake") touchInput.brake = true;
      else if (action === "interact") interact();
      else if (action === "mission") cycleMission();
    });
    const releaseButton = (event) => {
      event.preventDefault();
      button.classList.remove("active");
      if (action === "boost") touchInput.boost = false;
      if (action === "brake") touchInput.brake = false;
    };
    button.addEventListener("pointerup", releaseButton);
    button.addEventListener("pointercancel", releaseButton);
    button.addEventListener("lostpointercapture", releaseButton);
  }
}

function resetTouchInput() {
  touchInput.active = false;
  touchInput.x = 0;
  touchInput.y = 0;
  touchInput.boost = false;
  touchInput.brake = false;
  if (ui.joystickKnob) ui.joystickKnob.style.transform = "translate(-50%, -50%)";
  for (const button of ui.mobileButtons) button.classList.remove("active");
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
  if (state.gameOver) {
    updateDebugTelemetry();
    updateHud();
    return;
  }
  if (state.testMode && state.testScenario === "police") {
    state.heat = Math.max(state.heat, 4.5);
    state.wantedTimer = Math.max(state.wantedTimer, 20);
  }
  state.lawCooldown = Math.max(0, state.lawCooldown - dt);
  state.bustPressure = Math.max(0, state.bustPressure - dt * BUST_DECAY);
  player.invuln = Math.max(0, player.invuln - dt);
  updatePlayer(dt);
  updateHomeSafeZone(dt);
  updateTraffic(dt);
  updatePeds(dt);
  updatePolice(dt);
  resolveVehicleOverlaps();
  resolveTrafficGaps();
  updateParticles(dt);
  updateMission(dt);
  updateCamera(dt);
  updateDebugTelemetry();
  updateHud();
}

function updatePlayer(dt) {
  const prevX = player.x;
  const prevY = player.y;
  if (player.inCar) {
    const car = player.inCar;
    const steer = touchInput.active ? touchInput.x : key("a", "arrowleft") ? -1 : key("d", "arrowright") ? 1 : 0;
    const testCruise = state.testMode && state.testScenario === "drive" && !key("w", "arrowup", "s", "arrowdown");
    const gas = touchInput.active ? clamp(-touchInput.y, -0.65, 1) : key("w", "arrowup") ? 1 : key("s", "arrowdown") ? -0.65 : testCruise ? 0.55 : 0;
    const boost = key("shift") ? 1.35 : 1;
    car.speed += gas * car.accel * boost * dt;
    car.speed *= key(" ") ? 0.9 : 0.985;
    car.impactCooldown = Math.max(0, (car.impactCooldown || 0) - dt);
    car.speed = clamp(car.speed, -car.max * 0.45, car.max * boost);
    const steerGrip = car.motorcycle ? 1.45 : 1;
    car.angle += steer * (1.7 + Math.abs(car.speed) / 210) * steerGrip * Math.sign(car.speed || 1) * dt;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    if (hitsBuilding(car.x, car.y, car.w * 0.42)) {
      const impact = Math.abs(car.speed);
      car.x -= Math.cos(car.angle) * Math.min(18, impact * dt * 0.5);
      car.y -= Math.sin(car.angle) * Math.min(18, impact * dt * 0.5);
      car.speed *= 0.72;
      hurt(impact * 0.01);
      reportLawBreak("property damage", 0.85, 1.4);
      spark(car.x, car.y, 14, "#f2c94c");
    }
    if (isWater(car.x, car.y)) handleVehicleWater(car, dt);
    else state.waterTimer = 0;
    updateDrivingLawState(car, dt);
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    state.inputX = steer;
    state.inputY = gas;
    state.playerDriveSpeed = Math.abs(car.speed);
    state.playerSpeed = dist({ x: prevX, y: prevY }, player) / Math.max(dt, 0.001);
    policeNoise(Math.abs(car.speed) > car.max * 1.18 ? 0.07 * dt : 0);
    return;
  }

  const dx = touchInput.active ? touchInput.x : (key("d", "arrowright") ? 1 : 0) - (key("a", "arrowleft") ? 1 : 0);
  const dy = touchInput.active ? touchInput.y : (key("s", "arrowdown") ? 1 : 0) - (key("w", "arrowup") ? 1 : 0);
  state.inputX = dx;
  state.inputY = dy;
  const mag = Math.hypot(dx, dy) || 1;
  const swimming = isWater(player.x, player.y);
  const speed = swimming ? (key("shift") ? FAST_SWIM_SPEED : SWIM_SPEED) : key("shift") ? SPRINT_SPEED : WALK_SPEED;
  const nx = player.x + (dx / mag) * speed * dt;
  const ny = player.y + (dy / mag) * speed * dt;
  if (!hitsBuilding(nx, player.y, player.r)) player.x = nx;
  if (!hitsBuilding(player.x, ny, player.r)) player.y = ny;
  if (dx || dy) player.angle = Math.atan2(dy, dx);
  state.playerSpeed = dist({ x: prevX, y: prevY }, player) / Math.max(dt, 0.001);
  state.playerDriveSpeed = 0;
}

function updateHomeSafeZone(dt) {
  const safe = isHomeSafeZone(player);
  state.homeSafeTimer = safe ? state.homeSafeTimer + dt : 0;
  if (!safe) return;
  state.heat = 0;
  state.wantedTimer = 0;
  state.lawCooldown = 0;
  state.wrongSideTimer = 0;
  state.lastLaw = "safe at hideout";
  player.health = Math.min(100, player.health + 18 * dt);
  if (state.homeSafeTimer > 0.25 && state.homeSafeTimer - dt <= 0.25) toast("Safe at Wolfe House");
}

function isHomeSafeZone(point) {
  return dist(point, HOME) <= HOME_SAFE_RADIUS;
}

function handleVehicleWater(car, dt) {
  state.waterTimer += dt;
  car.speed *= 0.82;
  car.aiSpeed = 0;
  spark(car.x, car.y, 3, "#4cc9f0");
  if (state.waterTimer > 0.55) {
    hurt(40);
    car.x -= Math.cos(car.angle) * 46;
    car.y -= Math.sin(car.angle) * 46;
    car.speed = 0;
    player.x = car.x;
    player.y = car.y;
    if (state.waterTimer > 1.4) {
      toast("Vehicle flooded");
      sendHomeFromHospital();
      state.waterTimer = 0;
    }
  }
}

function updateTraffic(dt) {
  for (const car of vehicles) {
    if (car === player.inCar) continue;
    car.pathT += dt * car.aiSpeed;
    car.mergeCooldown = Math.max(0, (car.mergeCooldown || 0) - dt);
    const blocker = nearestTrafficBlocker(car);
    if (shouldPass(car, blocker)) startLaneChange(car);
    car.aiSpeed = nextTrafficSpeed({
      speed: car.aiSpeed,
      targetSpeed: car.targetSpeed,
      blocker,
      dt,
      options: trafficModelOptions(car),
    });
    recoverStuckTraffic(car, blocker, dt);

    maybeTurnAtIntersection(car);
    car.lane = lerp(car.lane, car.targetLane ?? car.lane, 4.5 * dt);
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
    if (isWater(car.x, car.y)) resetTrafficCar(car, vehicles.indexOf(car));
    if (dist(car, player) > STREAM_RADIUS) resetTrafficCar(car, vehicles.indexOf(car));
    if (dist(car, player) < (player.inCar ? 44 : 26)) {
      if (player.inCar) {
        handlePlayerVehicleImpact(player.inCar, car, 1);
      } else {
        hurt(16);
        player.x -= Math.cos(car.angle) * 26;
        player.y -= Math.sin(car.angle) * 26;
      }
    }
  }
}

function updateDrivingLawState(car, dt) {
  const wrongSide = isWrongSideDriving(car);
  state.wrongSideTimer = wrongSide ? state.wrongSideTimer + dt : Math.max(0, state.wrongSideTimer - dt * 2);
  if (Math.abs(car.speed) > car.max * 1.12) reportLawBreak("reckless speeding", 0.08 * dt, 0.7, false);
}

function isWrongSideDriving(car) {
  if (!isRoadish(car.x, car.y) || Math.abs(car.speed) < 55) return false;
  const roadX = Math.round(car.x / BLOCK) * BLOCK;
  const roadY = Math.round(car.y / BLOCK) * BLOCK;
  const dx = Math.abs(car.x - roadX);
  const dy = Math.abs(car.y - roadY);
  const inVertical = dx < ROAD / 2 - 14;
  const inHorizontal = dy < ROAD / 2 - 14;
  if (inVertical && inHorizontal) return false;

  if (inHorizontal && !inVertical) {
    const legalSign = car.y >= roadY ? 1 : -1;
    const travelSign = Math.cos(car.angle) >= 0 ? 1 : -1;
    return legalSign !== travelSign;
  }
  if (inVertical && !inHorizontal) {
    const legalSign = car.x <= roadX ? 1 : -1;
    const travelSign = Math.sin(car.angle) >= 0 ? 1 : -1;
    return legalSign !== travelSign;
  }
  return false;
}

function reportLawBreak(reason, heatAmount, minimumHeat = 1, announce = true) {
  state.lastLaw = reason;
  state.lawEvents = (state.lawEvents || 0) + 1;
  state.heat = Math.max(minimumHeat, clamp(state.heat + heatAmount, 0, 5));
  state.wantedTimer = Math.max(state.wantedTimer, 14);
  if (state.lawCooldown <= 0 && announce) {
    state.lawCooldown = 2.2;
    toast(`Police dispatched: ${reason}`);
  }
}

function shouldPass(car, blocker) {
  const nextLaneIndex = car.laneIndex === 0 ? 1 : 0;
  return shouldAttemptLaneChange({
    car,
    blocker,
    nearIntersection: nearIntersection(car),
    targetLaneClear: isLaneClear(car, nextLaneIndex),
  });
}

function startLaneChange(car) {
  car.laneIndex = car.laneIndex === 0 ? 1 : 0;
  const roadCenter = Math.round(car.lane / BLOCK) * BLOCK;
  car.targetLane = trafficLanePosition(car.dir, roadCenter, car.sign, car.laneIndex);
  car.mergeCooldown = 2.2;
  state.trafficPasses = (state.trafficPasses || 0) + 1;
}

function isLaneClear(car, laneIndex) {
  const roadCenter = Math.round(car.lane / BLOCK) * BLOCK;
  const lane = trafficLanePosition(car.dir, roadCenter, car.sign, laneIndex);
  let frontGap = Infinity;
  let rearGap = Infinity;
  let rearSpeed = 0;
  for (const other of vehicles) {
    if (other === car || other.dir !== car.dir || other.sign !== car.sign) continue;
    if (Math.abs((other.targetLane ?? other.lane) - lane) > LANE_WIDTH * 0.55) continue;
    const delta = car.dir === "h" ? (other.x - car.x) * car.sign : (other.y - car.y) * car.sign;
    const edgeGap = Math.abs(delta) - (car.w + other.w) / 2;
    if (delta >= 0) frontGap = Math.min(frontGap, edgeGap);
    else if (edgeGap < rearGap) {
      rearGap = edgeGap;
      rearSpeed = other.aiSpeed || 0;
    }
  }
  return isLaneChangeSafe({
    frontGap,
    rearGap,
    rearSpeed,
    carSpeed: car.aiSpeed,
    carLength: car.w,
  });
}

function recoverStuckTraffic(car, blocker, dt) {
  if (blocker?.signal || blocker?.intersection || isQueuedLeadVehicle(blocker?.vehicle)) {
    car.stuckTimer = 0;
    return;
  }
  const stoppedByTraffic = blocker && car.aiSpeed < 9 && car.targetSpeed > 40;
  car.stuckTimer = stoppedByTraffic ? (car.stuckTimer || 0) + dt : 0;
  if (car.stuckTimer < 1.35) return;

  if (shouldPass(car, blocker)) {
    startLaneChange(car);
    car.aiSpeed = Math.max(car.aiSpeed, Math.min(car.targetSpeed, 42));
    car.stuckTimer = 0;
    return;
  }

  if (car.stuckTimer < 3.2 || nearIntersection(car)) return;
  pullForwardToClearGap(car);
  car.aiSpeed = Math.max(car.aiSpeed, Math.min(car.targetSpeed, 34));
  car.mergeCooldown = 0.8;
  car.stuckTimer = 0;
  state.trafficRecoveries = (state.trafficRecoveries || 0) + 1;
}

function nearIntersection(car, margin = ROAD * 0.62) {
  const along = car.dir === "h" ? car.x : car.y;
  return Math.abs(along - Math.round(along / BLOCK) * BLOCK) < margin;
}

function pullForwardToClearGap(car) {
  const blocker = trafficBlocker(car);
  if (!blocker) return;
  const clearGap = blocker.minGap + (car.bus || blocker.bus ? 44 : 30);
  const target = car.dir === "h" ? blocker.x - car.sign * clearGap : blocker.y - car.sign * clearGap;
  if (car.dir === "h") car.x = target;
  else car.y = target;
}

function maybeTurnAtIntersection(car) {
  const cross = car.dir === "h" ? car.x : car.y;
  const roadCenter = Math.round(cross / BLOCK) * BLOCK;
  if (Math.abs(cross - roadCenter) > Math.max(10, car.aiSpeed * 0.05)) return;

  const otherAxis = car.dir === "h" ? car.y : car.x;
  const otherRoad = Math.round(otherAxis / BLOCK) * BLOCK;
  const nodeX = car.dir === "h" ? roadCenter : otherRoad;
  const nodeY = car.dir === "h" ? otherRoad : roadCenter;
  const node = `${nodeX},${nodeY}`;
  if (car.lastNode === node) return;
  car.lastNode = node;

  const roll = rand();
  const turn = car.bus
    ? (roll < 0.82 ? "straight" : roll < 0.91 ? "right" : "left")
    : car.motorcycle
      ? (roll < 0.5 ? "straight" : roll < 0.78 ? "right" : "left")
      : roll < 0.58 ? "straight" : roll < 0.8 ? "right" : "left";
  if (turn === "straight") return;

  const next = turnDirection(car.dir, car.sign, turn);
  if (!exitLaneClearFor(next.dir, next.sign, car.laneIndex, nodeX, nodeY, car, car.bus)) return;
  state.trafficTurns = (state.trafficTurns || 0) + 1;
  car.dir = next.dir;
  car.sign = next.sign;
  car.lane = trafficLanePosition(car.dir, car.dir === "h" ? nodeY : nodeX, car.sign, car.laneIndex);
  car.targetLane = car.lane;
  car.mergeCooldown = 1.2;
  if (car.dir === "h") {
    car.x = nodeX;
    car.y = car.lane;
  } else {
    car.x = car.lane;
    car.y = nodeY;
  }
  car.angle = car.dir === "h" ? (car.sign > 0 ? 0 : Math.PI) : car.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
}

function turnDirection(dir, sign, turn) {
  if (dir === "h") {
    if (sign > 0) return { dir: "v", sign: turn === "right" ? 1 : -1 };
    return { dir: "v", sign: turn === "right" ? -1 : 1 };
  }
  if (sign > 0) return { dir: "h", sign: turn === "right" ? -1 : 1 };
  return { dir: "h", sign: turn === "right" ? 1 : -1 };
}

function trafficBlocker(car) {
  let closest = null;
  for (const other of roadVehicles()) {
    if (other === car || other === player.inCar || other.dir !== car.dir || other.sign !== car.sign) continue;
    if (other.police && state.heat >= 1) continue;
    if (isMerging(other)) continue;
    if (Math.abs(other.lane - car.lane) > LANE_WIDTH * 0.55) continue;
    const gap = car.dir === "h" ? (other.x - car.x) * car.sign : (other.y - car.y) * car.sign;
    const minGap = (car.w + other.w) / 2;
    const followDistance = minGap + followBuffer(car, other) + car.aiSpeed * (car.motorcycle ? 0.85 : 1.25);
    if (gap > 0 && gap < followDistance && (!closest || gap < closest.gap)) closest = { ...other, vehicle: other, gap, minGap };
  }
  return closest;
}

function trafficModelOptions(car) {
  if (car.bus) return { minGap: 26, timeHeadway: 1.55, maxAccel: 58, comfortableBrake: 125 };
  if (car.motorcycle) return { minGap: 12, timeHeadway: 0.82, maxAccel: 130, comfortableBrake: 190 };
  return undefined;
}

function followBuffer(car, other) {
  if (car.bus || other.bus) return 150;
  if (car.motorcycle && other.motorcycle) return 42;
  if (car.motorcycle || other.motorcycle) return 64;
  return 96;
}

function isQueuedLeadVehicle(vehicle) {
  return vehicle && vehicle.aiSpeed < 12 && (trafficSignalBlocker(vehicle) || intersectionBoxBlocker(vehicle));
}

function nearestTrafficBlocker(car) {
  const carBlocker = trafficBlocker(car);
  const signalBlocker = trafficSignalBlocker(car);
  const intersectionBlocker = intersectionBoxBlocker(car);
  return [carBlocker, signalBlocker, intersectionBlocker]
    .filter(Boolean)
    .sort((a, b) => a.gap - b.gap)[0] || null;
}

function trafficSignalBlocker(car) {
  if (isMerging(car)) return null;
  const along = car.dir === "h" ? car.x : car.y;
  const nodeAlong = nextSignalNode(along, car.sign);
  const roadCenter = Math.round((car.dir === "h" ? car.y : car.x) / BLOCK) * BLOCK;
  const signal = car.dir === "h" ? trafficSignalAt(nodeAlong, roadCenter) : trafficSignalAt(roadCenter, nodeAlong);
  if (signal.openDir === car.dir && signal.color !== "yellow") return null;

  const distToNode = (nodeAlong - along) * car.sign;
  if (distToNode < 0 || distToNode > ROAD * 1.15) return null;
  const vehicleHalf = car.dir === "h" ? car.w / 2 : car.h / 2;
  const stopLineGap = distToNode - ROAD / 2 + 12 - vehicleHalf;
  if (stopLineGap < -vehicleHalf * 0.8) return null;
  return { gap: Math.max(0, stopLineGap), minGap: 10, signal: true, bus: false };
}

function intersectionBoxBlocker(car) {
  if (isMerging(car)) return null;
  const along = car.dir === "h" ? car.x : car.y;
  const nodeAlong = nextSignalNode(along, car.sign);
  const crossRoad = Math.round((car.dir === "h" ? car.y : car.x) / BLOCK) * BLOCK;
  const nodeX = car.dir === "h" ? nodeAlong : crossRoad;
  const nodeY = car.dir === "h" ? crossRoad : nodeAlong;
  const distToNode = (nodeAlong - along) * car.sign;
  if (distToNode < ROAD / 2 || distToNode > ROAD * 1.4) return null;

  const vehicleHalf = car.dir === "h" ? car.w / 2 : car.h / 2;
  const stopLineGap = distToNode - ROAD / 2 + 16 - vehicleHalf;
  if (stopLineGap < -vehicleHalf * 0.6) return null;
  if (!intersectionOccupied(car, nodeX, nodeY) && exitLaneClear(car, nodeX, nodeY)) return null;
  return { gap: Math.max(0, stopLineGap), minGap: 12, intersection: true, bus: false };
}

function intersectionOccupied(car, nodeX, nodeY) {
  const half = ROAD / 2 - 10;
  for (const other of roadVehicles()) {
    if (other === car || other === player.inCar) continue;
    if (Math.abs(other.x - nodeX) < half && Math.abs(other.y - nodeY) < half) return true;
  }
  return false;
}

function exitLaneClear(car, nodeX, nodeY) {
  return exitLaneClearFor(car.dir, car.sign, car.laneIndex, nodeX, nodeY, car, car.bus);
}

function exitLaneClearFor(dir, sign, laneIndex, nodeX, nodeY, ignore, bus = false) {
  const exitDistance = bus ? 190 : ignore?.motorcycle ? 96 : 150;
  const lane = trafficLanePosition(dir, dir === "h" ? nodeY : nodeX, sign, laneIndex);
  for (const other of roadVehicles()) {
    if (other === ignore || other === player.inCar || other.dir !== dir || other.sign !== sign) continue;
    if (Math.abs((other.targetLane ?? other.lane) - lane) > LANE_WIDTH * 0.65) continue;
    const alongDelta = dir === "h" ? (other.x - nodeX) * sign : (other.y - nodeY) * sign;
    if (alongDelta > ROAD / 2 - 8 && alongDelta < ROAD / 2 + exitDistance) return false;
  }
  return true;
}

function roadVehicles() {
  return [...vehicles, ...cops];
}

function nextSignalNode(value, sign) {
  return sign > 0 ? Math.floor(value / BLOCK) * BLOCK + BLOCK : Math.ceil(value / BLOCK) * BLOCK - BLOCK;
}

function trafficSignalAt(nodeX, nodeY) {
  const offset = hashCell(Math.round(nodeX / BLOCK), Math.round(nodeY / BLOCK)) % 8;
  const t = mod(state.time + offset, SIGNAL_CYCLE);
  const half = SIGNAL_CYCLE / 2;
  const horizontalHalf = t < half;
  const phaseTime = horizontalHalf ? t : t - half;
  const yellow = phaseTime > half - SIGNAL_YELLOW;
  return {
    openDir: horizontalHalf ? "h" : "v",
    color: yellow ? "yellow" : "green",
  };
}

function isMerging(car) {
  return Math.abs((car.targetLane ?? car.lane) - car.lane) > 2;
}

function resolveVehicleOverlaps() {
  const allVehicles = [...vehicles, ...cops];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < allVehicles.length; i++) {
      for (let j = i + 1; j < allVehicles.length; j++) {
        const a = allVehicles[i];
        const b = allVehicles[j];
        const playerInvolved = a === player.inCar || b === player.inCar;
        const minDistance = vehicleRadius(a) + vehicleRadius(b) + (playerInvolved ? -8 : 2);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        if (distance >= minDistance) continue;

        if (separateLaneTraffic(a, b, minDistance, distance)) continue;

        const overlap = minDistance - distance;
        const nx = dx / distance;
        const ny = dy / distance;
        const aLocked = false;
        const bLocked = false;
        const aPush = bLocked ? 1 : aLocked ? 0 : 0.5;
        const bPush = aLocked ? 1 : bLocked ? 0 : 0.5;

        a.x -= nx * overlap * aPush;
        a.y -= ny * overlap * aPush;
        b.x += nx * overlap * bPush;
        b.y += ny * overlap * bPush;

        if (!aLocked) {
          if (a.police) a.unstuckTimer = 0.25;
          a.aiSpeed = Math.max(18, (a.aiSpeed || 80) * 0.58);
          if (a.police) a.speed = Math.max(35, (a.speed || 80) * 0.65);
        }
        if (!bLocked) {
          if (b.police) b.unstuckTimer = 0.25;
          b.aiSpeed = Math.max(18, (b.aiSpeed || 80) * 0.58);
          if (b.police) b.speed = Math.max(35, (b.speed || 80) * 0.65);
        }
        if (playerInvolved) handlePlayerVehicleImpact(a === player.inCar ? a : b, a === player.inCar ? b : a, overlap);
      }
    }
  }
}

function handlePlayerVehicleImpact(playerCar, other, overlap) {
  const impact = Math.max(Math.abs(playerCar.speed || 0), other.aiSpeed || other.speed || 0);
  const otherHeavy = other.bus ? 1.25 : 1;
  if ((playerCar.impactCooldown || 0) <= 0) {
    playerCar.impactCooldown = 0.45;
    hurt(clamp(impact * 0.035 * otherHeavy, 4, 18));
    reportLawBreak("vehicle collision", other.police ? 1.25 : 0.75, other.police ? 2.4 : 1.2);
    spark((playerCar.x + other.x) / 2, (playerCar.y + other.y) / 2, 16, other.police ? "#4cc9f0" : "#ffef9f");
  }
  playerCar.speed *= 0.84;
  if (other.aiSpeed != null) other.aiSpeed = Math.max(8, other.aiSpeed * 0.42);
  if (other.speed != null) other.speed = Math.max(18, other.speed * 0.55);
  if (other.police) other.unstuckTimer = 0.18;
  player.x = playerCar.x;
  player.y = playerCar.y;
  state.lastImpact = overlap;
}

function separateLaneTraffic(a, b, minDistance, distance) {
  if (a === player.inCar || b === player.inCar) return false;
  if (a.police || b.police || a.dir !== b.dir || a.sign !== b.sign) return false;
  if (Math.abs(a.lane - b.lane) > LANE_WIDTH * 0.75) return false;

  const axisDelta = a.dir === "h" ? b.x - a.x : b.y - a.y;
  const aheadSign = Math.sign(axisDelta) || a.sign;
  const overlap = minDistance - distance;
  const push = overlap * 0.5 + 1;
  if (a.dir === "h") {
    a.x -= aheadSign * push;
    b.x += aheadSign * push;
    a.y = a.lane;
    b.y = b.lane;
  } else {
    a.y -= aheadSign * push;
    b.y += aheadSign * push;
    a.x = a.lane;
    b.x = b.lane;
  }
  a.angle = a.dir === "h" ? (a.sign > 0 ? 0 : Math.PI) : a.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
  b.angle = b.dir === "h" ? (b.sign > 0 ? 0 : Math.PI) : b.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
  a.aiSpeed = Math.max(22, a.aiSpeed || 0);
  b.aiSpeed = Math.max(22, b.aiSpeed || 0);
  return true;
}

function resolveTrafficGaps() {
  const groups = new Map();
  for (const car of vehicles) {
    if (car === player.inCar || isMerging(car)) continue;
    const laneKey = `${car.dir}:${car.sign}:${Math.round(car.lane / 4)}`;
    if (!groups.has(laneKey)) groups.set(laneKey, []);
    groups.get(laneKey).push(car);
  }

  let corrections = 0;
  for (const laneCars of groups.values()) {
    laneCars.sort((a, b) => trafficProgress(a) - trafficProgress(b));
    for (let i = 1; i < laneCars.length; i++) {
      const rear = laneCars[i - 1];
      const front = laneCars[i];
      const minCenterGap = (rear.w + front.w) / 2 + gapCorrectionBuffer(rear, front);
      const centerGap = trafficProgress(front) - trafficProgress(rear);
      if (centerGap >= minCenterGap) continue;

      const pushBack = minCenterGap - centerGap;
      moveAlongTraffic(rear, -pushBack);
      rear.aiSpeed = Math.min(rear.aiSpeed, Math.max(0, front.aiSpeed - 8));
      rear.stuckTimer = 0;
      corrections += 1;
    }
  }
  state.trafficGapCorrections = (state.trafficGapCorrections || 0) + corrections;
}

function trafficProgress(car) {
  return (car.dir === "h" ? car.x : car.y) * car.sign;
}

function moveAlongTraffic(car, amount) {
  if (car.dir === "h") car.x += amount * car.sign;
  else car.y += amount * car.sign;
}

function vehicleRadius(vehicle) {
  return Math.max(vehicle.w || 54, vehicle.h || 28) * 0.52;
}

function gapCorrectionBuffer(a, b) {
  if (a.bus || b.bus) return 76;
  if (a.motorcycle && b.motorcycle) return 24;
  if (a.motorcycle || b.motorcycle) return 32;
  return 44;
}

function updatePeds(dt) {
  for (const ped of peds) {
    const playerDistance = dist(ped, player);
    const dangerRange = player.inCar ? 140 : 42;
    const danger = playerDistance < dangerRange;
    if (danger && player.inCar) {
      ped.panicTimer = Math.max(ped.panicTimer || 0, 1.6);
      ped.program = "panic";
    }
    ped.panicTimer = Math.max(0, (ped.panicTimer || 0) - dt);
    if (ped.panicTimer <= 0 && ped.program === "panic") {
      ped.program = "sidewalk";
      ped.wait = 0;
    }

    ped.wait -= dt;
    if (ped.wait <= 0) {
      choosePedDirection(ped);
    }
    const speed = pedSpeed(ped);
    const nx = ped.x + Math.cos(ped.angle) * speed * dt;
    const ny = ped.y + Math.sin(ped.angle) * speed * dt;
    if (canPedMoveTo(ped, nx, ny)) {
      ped.x = nx;
      ped.y = ny;
      ped.crossing = isStreetInterior(ped.x, ped.y);
    } else {
      ped.crossing = false;
      ped.program = "sidewalk";
      ped.angle = sidewalkHeading(ped) + randRange(-0.35, 0.35);
      ped.wait = randRange(0.35, 1.1);
    }
    if (dist(ped, player) > STREAM_RADIUS * 0.82) resetPed(ped);
    ped.scared = ped.program === "panic" || danger;
    if (ped.scared && player.inCar && playerDistance < 24) {
      const hitForce = clamp(Math.abs(player.inCar.speed) / 180, 0.45, 1.35);
      reportLawBreak("pedestrian hit", 1.15 * hitForce, 1.9);
      player.inCar.speed *= 0.9;
      ped.panicTimer = 2.8;
      ped.program = "panic";
      ped.x += Math.cos(player.angle) * (48 + hitForce * 24);
      ped.y += Math.sin(player.angle) * (48 + hitForce * 24);
      spark(ped.x, ped.y, 12, "#ef476f");
    }
  }
}

function choosePedDirection(ped) {
  if (ped.program === "panic" || ped.panicTimer > 0) {
    ped.program = "panic";
    ped.angle = Math.atan2(ped.y - player.y, ped.x - player.x) + randRange(-0.28, 0.28);
    ped.wait = randRange(0.18, 0.42);
    return;
  }

  const crossHeading = crossingHeading(ped);
  if (nearCrosswalk(ped) && (ped.jaywalker || (rand() < 0.28 && pedestrianSignalAllows(ped, crossHeading)))) {
    ped.program = ped.jaywalker ? "jaywalk" : "crossing";
    ped.angle = crossHeading;
    ped.crossing = true;
    ped.wait = randRange(0.8, 1.5);
    return;
  }

  if (ped.jaywalker && rand() < 0.18) {
    ped.program = "jaywalk";
    ped.angle = crossHeading + randRange(-0.18, 0.18);
    ped.crossing = true;
    ped.wait = randRange(0.8, 1.5);
    return;
  }

  ped.program = "sidewalk";
  if (rand() < 0.08) ped.walkSign *= -1;
  ped.angle = sidewalkHeading(ped) + randRange(-0.3, 0.3);
  ped.wait = randRange(1.1, 3.4);
}

function canPedMoveTo(ped, x, y) {
  if (hitsBuilding(x, y, 9) || !isPedWalkable(x, y)) return false;
  if (ped.program === "panic" || ped.jaywalker || ped.crossing) return true;
  if (!isStreetInterior(x, y)) return true;
  return ped.crossing && nearCrosswalk({ x, y }) && pedestrianSignalAllows({ ...ped, x, y });
}

function pedSpeed(ped) {
  if (ped.program === "panic") return 132;
  if (ped.program === "crossing" || ped.program === "jaywalk") return 48;
  return 34;
}

function pedestrianSignalAllows(ped, heading = ped.angle) {
  const nodeX = Math.round(ped.x / BLOCK) * BLOCK;
  const nodeY = Math.round(ped.y / BLOCK) * BLOCK;
  const signal = trafficSignalAt(nodeX, nodeY);
  const crossingDir = pedestrianCrossingDir(heading);
  return signal.openDir !== crossingDir && signal.color === "green";
}

function pedestrianCrossingDir(heading) {
  return Math.abs(Math.cos(heading)) > Math.abs(Math.sin(heading)) ? "h" : "v";
}

function crossingHeading(ped) {
  const mx = Math.abs(mod(ped.x + BLOCK / 2, BLOCK) - BLOCK / 2);
  const my = Math.abs(mod(ped.y + BLOCK / 2, BLOCK) - BLOCK / 2);
  if (mx < my) return ped.x < Math.round(ped.x / BLOCK) * BLOCK ? 0 : Math.PI;
  return ped.y < Math.round(ped.y / BLOCK) * BLOCK ? Math.PI / 2 : -Math.PI / 2;
}

function sidewalkHeading(ped) {
  const base = ped.walkAxis === "v" ? Math.PI / 2 : 0;
  return base + (ped.walkSign < 0 ? Math.PI : 0);
}

function updatePolice(dt) {
  state.wantedTimer = Math.max(0, state.wantedTimer - dt);
  if (state.wantedTimer <= 0) state.heat = Math.max(0, state.heat - dt * 0.12);

  for (const cop of cops) {
    cop.unstuckTimer = Math.max(0, (cop.unstuckTimer || 0) - dt);
    cop.contactCooldown = Math.max(0, (cop.contactCooldown || 0) - dt);
    cop.boostCooldown = Math.max(0, (cop.boostCooldown || 0) - dt);
    const distanceToPlayer = dist(cop, player);
    const pursuit = state.heat >= 1 && distanceToPlayer < 1450 && !isHomeSafeZone(player);
    if (!pursuit) {
      updatePolicePatrol(cop, dt);
      continue;
    }
    const leadTime = player.inCar ? clamp(distanceToPlayer / 620, 0.18, 0.85) : 0.12;
    const targetX = player.x + Math.cos(player.angle) * (player.inCar ? player.inCar.speed * leadTime : state.playerSpeed * leadTime);
    const targetY = player.y + Math.sin(player.angle) * (player.inCar ? player.inCar.speed * leadTime : state.playerSpeed * leadTime);
    const targetAngle = pursuit && !cop.unstuckTimer ? Math.atan2(targetY - cop.y, targetX - cop.x) : cop.angle;
    cop.angle = lerpAngle(cop.angle, targetAngle, pursuit ? (4.2 + state.heat * 0.28) * dt : 0.8 * dt);
    const chaseSpeed = 250 + state.heat * 44 + (player.inCar ? Math.min(120, Math.abs(player.inCar.speed) * 0.28) : 0);
    cop.speed = lerp(cop.speed, pursuit ? chaseSpeed : 96, (pursuit ? 2.7 : 1.4) * dt);
    const prevX = cop.x;
    const prevY = cop.y;
    cop.x += Math.cos(cop.angle) * cop.speed * dt;
    cop.y += Math.sin(cop.angle) * cop.speed * dt;
    if (hitsBuilding(cop.x, cop.y, 22)) {
      cop.x = prevX;
      cop.y = prevY;
      cop.angle = escapeHeading(cop);
      cop.speed = pursuit ? 120 : 48;
      cop.unstuckTimer = 0.38;
      if (pursuit && cop.boostCooldown <= 0) {
        cop.boostCooldown = 0.45;
        state.policeBoosts = (state.policeBoosts || 0) + 1;
      }
    }
    if (distanceToPlayer > STREAM_RADIUS * 1.2) resetCop(cop);
    if (pursuit && cop.contactCooldown <= 0 && distanceToPlayer < (player.inCar ? 52 : 30)) {
      cop.contactCooldown = 1.1;
      state.heat = Math.max(state.heat, 2.2);
      state.wantedTimer = 12;
      state.policeContacts = (state.policeContacts || 0) + 1;
      const playerCarSpeed = player.inCar ? Math.abs(player.inCar.speed) : 0;
      state.bustPressure += player.inCar ? (playerCarSpeed < 70 ? 0.7 : 0.25) : 0.9;
      if (player.inCar) player.inCar.speed *= 0.58;
      spark(player.x, player.y, 18, "#4cc9f0");
      if (state.bustPressure >= BUST_THRESHOLD) {
        sendHomeFromBust();
        return;
      }
      hurt(player.inCar ? 6 : 10);
    }
    if (pursuit && state.heat >= 3.5 && rand() < 0.022) spark(cop.x, cop.y, 3, "#ef476f");
  }
}

function updatePolicePatrol(cop, dt) {
  ensurePolicePatrolRoute(cop);
  cop.mergeCooldown = Math.max(0, (cop.mergeCooldown || 0) - dt);
  const blocker = nearestTrafficBlocker(cop);
  cop.aiSpeed = nextTrafficSpeed({
    speed: cop.aiSpeed || 72,
    targetSpeed: cop.targetSpeed || 92,
    blocker,
    dt,
    options: { minGap: 20, timeHeadway: 1.25, maxAccel: 72, comfortableBrake: 145 },
  });
  recoverStuckTraffic(cop, blocker, dt);
  maybeTurnAtIntersection(cop);
  cop.lane = lerp(cop.lane, cop.targetLane ?? cop.lane, 4.2 * dt);
  if (cop.dir === "h") {
    cop.x += cop.sign * cop.aiSpeed * dt;
    cop.y = cop.lane;
    cop.angle = cop.sign > 0 ? 0 : Math.PI;
  } else {
    cop.y += cop.sign * cop.aiSpeed * dt;
    cop.x = cop.lane;
    cop.angle = cop.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  cop.speed = cop.aiSpeed;
  if (hitsBuilding(cop.x, cop.y, 24) || isWater(cop.x, cop.y) || dist(cop, player) > STREAM_RADIUS * 1.2) resetCop(cop);
}

function ensurePolicePatrolRoute(cop) {
  if (cop.dir && Number.isFinite(cop.lane)) return;
  const horizontal = rand() > 0.5;
  const roadBase = horizontal ? snapDown(cop.y, BLOCK) : snapDown(cop.x, BLOCK);
  cop.dir = horizontal ? "h" : "v";
  cop.sign = rand() > 0.5 ? 1 : -1;
  cop.laneIndex = Math.floor(randRange(0, 2));
  cop.lane = trafficLanePosition(cop.dir, roadBase, cop.sign, cop.laneIndex);
  cop.targetLane = cop.lane;
  if (cop.dir === "h") cop.y = cop.lane;
  else cop.x = cop.lane;
  cop.aiSpeed = cop.aiSpeed || randRange(58, 98);
  cop.targetSpeed = cop.targetSpeed || randRange(72, 108);
  cop.mergeCooldown = randRange(0.3, 1.2);
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
  if (state.testMode) drawSimulationOverlay();
  ctx.restore();
  drawVignette();
  drawMiniMap();
}

function drawSimulationOverlay() {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(76,201,240,.34)";
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.inCar ? 140 : 42, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(239,71,111,.18)";
  for (const cop of cops) {
    ctx.beginPath();
    ctx.arc(cop.x, cop.y, 1450, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const ped of peds) {
    if (dist(ped, player) > 520) continue;
    ctx.fillStyle = ped.program === "panic" ? "#ef476f" : ped.program === "crossing" ? "#4cc9f0" : ped.program === "jaywalk" ? "#f2c94c" : "rgba(247,244,232,.7)";
    ctx.fillRect(ped.x - 3, ped.y - 15, 6, 3);
  }
  ctx.restore();
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
  drawTrafficSignals(left, top, right, bottom);

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

function drawTrafficSignals(left, top, right, bottom) {
  const firstRoadX = snapDown(left, BLOCK) - BLOCK;
  const lastRoadX = right + BLOCK;
  const firstRoadY = snapDown(top, BLOCK) - BLOCK;
  const lastRoadY = bottom + BLOCK;
  for (let x = firstRoadX; x <= lastRoadX; x += BLOCK) {
    for (let y = firstRoadY; y <= lastRoadY; y += BLOCK) {
      if (x + ROAD < left || x - ROAD > right || y + ROAD < top || y - ROAD > bottom) continue;
      drawCrosswalks(x, y);
      drawSignalHead(x - ROAD / 2 + 18, y - ROAD / 2 + 18, "h", trafficSignalAt(x, y));
      drawSignalHead(x + ROAD / 2 - 18, y + ROAD / 2 - 18, "h", trafficSignalAt(x, y));
      drawSignalHead(x + ROAD / 2 - 18, y - ROAD / 2 + 18, "v", trafficSignalAt(x, y));
      drawSignalHead(x - ROAD / 2 + 18, y + ROAD / 2 - 18, "v", trafficSignalAt(x, y));
    }
  }
}

function drawCrosswalks(x, y) {
  ctx.save();
  ctx.strokeStyle = "rgba(247,244,232,.18)";
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 12]);
  line(x - ROAD / 2 + 14, y - ROAD / 2 + 20, x + ROAD / 2 - 14, y - ROAD / 2 + 20);
  line(x - ROAD / 2 + 14, y + ROAD / 2 - 20, x + ROAD / 2 - 14, y + ROAD / 2 - 20);
  line(x - ROAD / 2 + 20, y - ROAD / 2 + 14, x - ROAD / 2 + 20, y + ROAD / 2 - 14);
  line(x + ROAD / 2 - 20, y - ROAD / 2 + 14, x + ROAD / 2 - 20, y + ROAD / 2 - 14);
  ctx.restore();
}

function drawSignalHead(x, y, dir, signal) {
  const lit = signal.openDir === dir ? signal.color : "red";
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(8,12,13,.82)";
  roundRect(-8, -8, 16, 16, 4);
  ctx.fill();
  ctx.fillStyle = lit === "red" ? "#ef476f" : lit === "yellow" ? "#f2c94c" : "#06d6a0";
  ctx.beginPath();
  ctx.arc(0, 0, 4.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLaneMarkings(left, top, right, bottom) {
  ctx.lineWidth = 2;
  const firstRoadX = snapDown(left, BLOCK) - BLOCK;
  const lastRoadX = right + BLOCK;
  const firstRoadY = snapDown(top, BLOCK) - BLOCK;
  const lastRoadY = bottom + BLOCK;

  for (let x = firstRoadX; x <= lastRoadX; x += BLOCK) {
    for (let y = firstRoadY; y <= lastRoadY; y += BLOCK) {
      const segmentTop = y + ROAD / 2;
      const segmentBottom = y + BLOCK - ROAD / 2;
      if (segmentBottom < top || segmentTop > bottom) continue;
      drawVerticalRoadSegmentMarkings(x, segmentTop, segmentBottom);
    }
  }

  for (let y = firstRoadY; y <= lastRoadY; y += BLOCK) {
    for (let x = firstRoadX; x <= lastRoadX; x += BLOCK) {
      const segmentLeft = x + ROAD / 2;
      const segmentRight = x + BLOCK - ROAD / 2;
      if (segmentRight < left || segmentLeft > right) continue;
      drawHorizontalRoadSegmentMarkings(y, segmentLeft, segmentRight);
    }
  }
  ctx.setLineDash([]);
}

function drawVerticalRoadSegmentMarkings(x, top, bottom) {
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(242,201,76,.72)";
  line(x - 3, top, x - 3, bottom);
  line(x + 3, top, x + 3, bottom);
  ctx.setLineDash([22, 24]);
  ctx.strokeStyle = "rgba(247,244,232,.28)";
  line(x - LANE_WIDTH, top, x - LANE_WIDTH, bottom);
  line(x + LANE_WIDTH, top, x + LANE_WIDTH, bottom);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(247,244,232,.38)";
  line(x - ROAD / 2 + 12, top + 10, x + ROAD / 2 - 12, top + 10);
  line(x - ROAD / 2 + 12, bottom - 10, x + ROAD / 2 - 12, bottom - 10);
}

function drawHorizontalRoadSegmentMarkings(y, left, right) {
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(242,201,76,.72)";
  line(left, y - 3, right, y - 3);
  line(left, y + 3, right, y + 3);
  ctx.setLineDash([22, 24]);
  ctx.strokeStyle = "rgba(247,244,232,.28)";
  line(left, y - LANE_WIDTH, right, y - LANE_WIDTH);
  line(left, y + LANE_WIDTH, right, y + LANE_WIDTH);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(247,244,232,.38)";
  line(left + 10, y - ROAD / 2 + 12, left + 10, y + ROAD / 2 - 12);
  line(right - 10, y - ROAD / 2 + 12, right - 10, y + ROAD / 2 - 12);
}

function drawMarkers() {
  drawHomeMarker();
  const points = missionTargets();
  for (const point of points) {
    const pulse = 1 + Math.sin(state.time * 5) * 0.12;
    const radius = point.drop ? 44 : 34;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * pulse, 0, Math.PI * 2);
    ctx.fillStyle = point.drop ? "rgba(76,201,240,.24)" : "rgba(242,201,76,.26)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = point.drop ? "#4cc9f0" : "#f2c94c";
    ctx.stroke();
    if (point.drop) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(247,244,232,.86)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 18 + Math.sin(state.time * 7) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawHomeMarker() {
  ctx.save();
  ctx.translate(HOME.x, HOME.y);
  ctx.fillStyle = "rgba(6,214,160,.08)";
  ctx.beginPath();
  ctx.arc(0, 0, HOME_SAFE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(6,214,160,.34)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.stroke();
  ctx.setLineDash([]);
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
  ctx.fillStyle = player.invuln > 0 && Math.floor(state.time * 12) % 2 ? "#ef476f" : isWater(player.x, player.y) ? "#4cc9f0" : "#f7f4e8";
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
  if (ped.jaywalker) {
    ctx.strokeStyle = "rgba(242,201,76,.78)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCar(car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = car.police ? "#f7f4e8" : car.color;
  if (car.motorcycle) {
    drawMotorcycle(car);
    ctx.restore();
    return;
  }
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

function drawMotorcycle(car) {
  ctx.fillStyle = car.color;
  roundRect(-car.w / 2, -car.h / 2, car.w, car.h, 5);
  ctx.fill();
  ctx.fillStyle = "rgba(10,14,16,.68)";
  ctx.fillRect(-car.w * 0.08, -car.h * 0.44, car.w * 0.26, car.h * 0.88);
  ctx.fillStyle = "rgba(247,244,232,.78)";
  ctx.beginPath();
  ctx.arc(car.w * 0.42, -car.h * 0.42, 4, 0, Math.PI * 2);
  ctx.arc(car.w * 0.42, car.h * 0.42, 4, 0, Math.PI * 2);
  ctx.fill();
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
    drawMissionMiniMarker(point, s, center);
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

function drawMissionMiniMarker(point, scale, center) {
  const dx = point.x - player.x;
  const dy = point.y - player.y;
  const distance = Math.hypot(dx, dy);
  const visibleDistance = Math.min(distance, MINIMAP_RANGE * 0.92);
  const angle = Math.atan2(dy, dx);
  const markerX = center + Math.cos(angle) * visibleDistance * scale;
  const markerY = center + Math.sin(angle) * visibleDistance * scale;
  const radius = point.drop ? 7 : 5;
  mctx.save();
  mctx.fillStyle = point.drop ? "#4cc9f0" : "#f2c94c";
  mctx.strokeStyle = point.drop ? "#f7f4e8" : "rgba(16,24,23,.85)";
  mctx.lineWidth = point.drop ? 2.5 : 1.5;
  mctx.beginPath();
  mctx.arc(markerX, markerY, radius + Math.sin(state.time * 7) * 1.2, 0, Math.PI * 2);
  mctx.fill();
  mctx.stroke();
  if (distance > MINIMAP_RANGE) {
    mctx.translate(markerX, markerY);
    mctx.rotate(angle);
    mctx.fillStyle = point.drop ? "#4cc9f0" : "#f2c94c";
    mctx.beginPath();
    mctx.moveTo(10, 0);
    mctx.lineTo(1, -5);
    mctx.lineTo(1, 5);
    mctx.closePath();
    mctx.fill();
  }
  mctx.restore();
}

function updateHud() {
  ui.mode.textContent = state.gameOver ? "Game over" : player.inCar ? `Driving ${Math.round(Math.abs(player.inCar.speed))} mph` : isWater(player.x, player.y) ? "Swimming" : "On foot";
  ui.cash.textContent = `$${state.cash}`;
  ui.heat.textContent = Math.floor(state.heat).toString();
  updatePoliceActivityIcon();
  ui.rep.textContent = state.rep.toString();
  ui.lives.textContent = state.lives.toString();
  ui.health.style.width = `${clamp(player.health, 0, 100)}%`;
  if (state.gameOver) {
    ui.missionTitle.textContent = "Game Over";
    ui.missionText.textContent = "You used all 5 lives. Restart from Wolfe House.";
    updateTestPanel();
    return;
  }
  ui.missionTitle.textContent = activeJob.started
    ? `${activeJob.title} - ${Math.max(0, Math.ceil(activeJob.timer))}s`
    : activeJob.title;
  ui.missionText.textContent = missionText();
  updateTestPanel();
}

function updatePoliceActivityIcon() {
  if (!ui.policeActivity) return;
  const level = state.heat >= 2.5 ? "pursuit" : state.heat >= 0.8 || state.wantedTimer > 0 ? "dispatch" : "idle";
  ui.policeActivity.className = level === "pursuit" ? "police-pursuit" : level === "dispatch" ? "police-dispatch" : "police-idle";
  ui.policeActivity.textContent = level === "pursuit" ? "✹" : level === "dispatch" ? "!" : "★";
  ui.policeActivity.title = `Police: ${level}${state.lastLaw !== "clear" ? ` (${state.lastLaw})` : ""}`;
}

function updateTestPanel() {
  if (!ui.testPanel) return;
  ui.testPanel.classList.toggle("hidden", !state.testMode);
  if (!state.testMode) return;
  const pedPrograms = countPedPrograms();
  const nearestCop = cops.reduce((closest, cop) => Math.min(closest, dist(cop, player)), Infinity);
  ui.testPanel.innerHTML = `
    <strong>Simulation Lab: ${state.testScenario}</strong>
    <dl>
      <dt>mode</dt><dd>${player.inCar ? "driving" : "on-foot"}</dd>
      <dt>input</dt><dd>${state.inputX.toFixed(0)}, ${state.inputY.toFixed(0)}</dd>
      <dt>walk speed</dt><dd>${state.playerSpeed.toFixed(1)}</dd>
      <dt>drive speed</dt><dd>${state.playerDriveSpeed.toFixed(1)}</dd>
      <dt>heat</dt><dd>${state.heat.toFixed(1)}</dd>
      <dt>police state</dt><dd>${document.body.dataset.policeActivity || "idle"}</dd>
      <dt>last law</dt><dd>${state.lastLaw}</dd>
      <dt>wrong side</dt><dd>${player.inCar ? String(isWrongSideDriving(player.inCar)) : "false"}</dd>
      <dt>nearest police</dt><dd>${Number.isFinite(nearestCop) ? nearestCop.toFixed(0) : "-"}</dd>
      <dt>police hits</dt><dd>${state.policeContacts || 0}</dd>
      <dt>busts</dt><dd>${state.busts || 0}</dd>
      <dt>bust pressure</dt><dd>${state.bustPressure.toFixed(1)}</dd>
      <dt>peds sidewalk</dt><dd>${pedPrograms.sidewalk || 0}</dd>
      <dt>peds crossing</dt><dd>${(pedPrograms.crossing || 0) + (pedPrograms.jaywalk || 0)}</dd>
      <dt>peds panic</dt><dd>${pedPrograms.panic || 0}</dd>
      <dt>traffic stuck</dt><dd>${document.body.dataset.stoppedTraffic || "0"}</dd>
      <dt>overlaps</dt><dd>${document.body.dataset.vehicleOverlaps || "0"}</dd>
    </dl>
  `;
}

function countPedPrograms() {
  return peds.reduce((counts, ped) => {
    counts[ped.program] = (counts[ped.program] || 0) + 1;
    return counts;
  }, {});
}

function updateDebugTelemetry() {
  document.body.dataset.playerX = player.x.toFixed(2);
  document.body.dataset.playerY = player.y.toFixed(2);
  document.body.dataset.playerBlocked = String(hitsBuilding(player.x, player.y, player.r));
  document.body.dataset.playerOnRoad = String(isRoadish(player.x, player.y));
  document.body.dataset.playerAtHome = String(dist(player, HOME) < 8);
  document.body.dataset.playerInHideout = String(isHomeSafeZone(player));
  document.body.dataset.playerInWater = String(isWater(player.x, player.y));
  document.body.dataset.playerOnBridge = String(isBridge(player.x, player.y));
  document.body.dataset.swimming = String(!player.inCar && isWater(player.x, player.y));
  document.body.dataset.homeName = HOME.name;
  document.body.dataset.running = String(state.running);
  document.body.dataset.gameOver = String(state.gameOver);
  document.body.dataset.testMode = String(state.testMode);
  document.body.dataset.testScenario = state.testScenario;
  document.body.dataset.lives = String(state.lives);
  document.body.dataset.policeActivity = state.heat >= 2.5 ? "pursuit" : state.heat >= 0.8 || state.wantedTimer > 0 ? "dispatch" : "idle";
  document.body.dataset.heat = state.heat.toFixed(2);
  document.body.dataset.lastLaw = state.lastLaw;
  document.body.dataset.lawEvents = String(state.lawEvents || 0);
  document.body.dataset.wrongSideDriving = String(player.inCar ? isWrongSideDriving(player.inCar) : false);
  document.body.dataset.playerSpeed = state.playerSpeed.toFixed(2);
  document.body.dataset.playerDriveSpeed = state.playerDriveSpeed.toFixed(2);
  document.body.dataset.touchActive = String(touchInput.active);
  document.body.dataset.touchX = touchInput.x.toFixed(2);
  document.body.dataset.touchY = touchInput.y.toFixed(2);
  document.body.dataset.touchBoost = String(touchInput.boost);
  document.body.dataset.touchBrake = String(touchInput.brake);
  document.body.dataset.vehicleOverlaps = String(countVehicleOverlaps());
  document.body.dataset.cityChunk = `${Math.floor(player.x / BLOCK)},${Math.floor(player.y / BLOCK)}`;
  document.body.dataset.policeMaxSpin = maxPoliceSpin().toFixed(3);
  document.body.dataset.busCount = String(vehicles.filter((vehicle) => vehicle.bus).length);
  document.body.dataset.motorcycleCount = String(vehicles.filter((vehicle) => vehicle.motorcycle).length);
  document.body.dataset.laneCount = String(LANE_OFFSETS.length * 2);
  document.body.dataset.trafficTurns = String(state.trafficTurns || 0);
  document.body.dataset.trafficPasses = String(state.trafficPasses || 0);
  document.body.dataset.trafficRecoveries = String(state.trafficRecoveries || 0);
  document.body.dataset.trafficGapCorrections = String(state.trafficGapCorrections || 0);
  const redLightStops = vehicles.filter((vehicle) => trafficSignalBlocker(vehicle)).length;
  const intersectionWaits = vehicles.filter((vehicle) => intersectionBoxBlocker(vehicle)).length;
  document.body.dataset.redLightStops = String(redLightStops);
  document.body.dataset.intersectionWaits = String(intersectionWaits);
  document.body.dataset.stoppedTraffic = String(vehicles.filter((vehicle) => vehicle.aiSpeed < 8 && !trafficSignalBlocker(vehicle) && !intersectionBoxBlocker(vehicle)).length);
  document.body.dataset.queuedTraffic = String(redLightStops);
  document.body.dataset.pedsInStreet = String(peds.filter((ped) => isStreetInterior(ped.x, ped.y)).length);
  document.body.dataset.jaywalkers = String(peds.filter((ped) => ped.jaywalker).length);
  document.body.dataset.pedsPanic = String(peds.filter((ped) => ped.program === "panic").length);
  document.body.dataset.pedsCrossing = String(peds.filter((ped) => ped.program === "crossing" || ped.program === "jaywalk").length);
  document.body.dataset.policeContacts = String(state.policeContacts || 0);
  document.body.dataset.policeBoosts = String(state.policeBoosts || 0);
  document.body.dataset.busts = String(state.busts || 0);
  document.body.dataset.bustPressure = state.bustPressure.toFixed(2);
  document.body.dataset.closestTrafficBuffer = closestTrafficBuffer().toFixed(1);
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

function closestTrafficBuffer() {
  let closest = Infinity;
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      if (a.dir !== b.dir || a.sign !== b.sign || Math.abs(a.lane - b.lane) > LANE_WIDTH * 0.55) continue;
      const gap = Math.abs(a.dir === "h" ? b.x - a.x : b.y - a.y);
      const buffer = gap - (a.w + b.w) / 2;
      if (buffer >= 0) closest = Math.min(closest, buffer);
    }
  }
  return Number.isFinite(closest) ? closest : 0;
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
  const heat = Number(urlParams.get("testHeat") || 0);
  if (heat > 0) {
    state.heat = heat;
    state.wantedTimer = 12;
  }
  if (urlParams.get("testHospital") === "1") {
    window.setTimeout(() => {
      startGame();
      sendHomeFromHospital();
    }, 160);
  }
  if (urlParams.get("testLives") === "0") {
    window.setTimeout(() => {
      startGame();
      for (let i = 0; i < 5; i++) sendHomeFromHospital();
    }, 160);
  }
  const testWrongSide = urlParams.get("testWrongSide") === "1";
  if (testWrongSide) {
    window.setTimeout(() => {
      startGame();
      placePlayerInWrongSideCar();
    }, 180);
  }
  if (state.testMode && !testWrongSide) {
    window.setTimeout(() => activateTestScenario(), 180);
  }
  const direction = urlParams.get("testMove");
  if (!direction) return;
  const duration = clamp(Number(urlParams.get("testMs") || 700), 100, 8000);
  window.setTimeout(() => {
    startGame();
    keys.add(direction.toLowerCase());
    window.setTimeout(() => keys.delete(direction.toLowerCase()), duration);
  }, 120);
}

function placePlayerInWrongSideCar() {
  const car = vehicles.find((vehicle) => !vehicle.bus) || vehicles[0];
  if (!car) return;
  const roadY = snapDown(HOME.y, BLOCK);
  car.dir = "h";
  car.sign = 1;
  car.laneIndex = 0;
  car.lane = trafficLanePosition("h", roadY, -1, 0);
  car.targetLane = car.lane;
  car.x = HOME.x + 160;
  car.y = car.lane;
  car.angle = 0;
  car.speed = 150;
  player.inCar = car;
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  toast("Wrong-side driving test");
}

function activateTestScenario() {
  startGame();
  if (state.testScenario === "drive") {
    const car = vehicles.filter((vehicle) => !vehicle.bus).sort((a, b) => dist(a, HOME) - dist(b, HOME))[0];
    if (car) {
      car.x = HOME.x + 120;
      car.y = trafficLanePosition("h", snapDown(HOME.y, BLOCK), 1, 0);
      car.dir = "h";
      car.sign = 1;
      car.laneIndex = 0;
      car.lane = car.y;
      car.targetLane = car.y;
      car.angle = 0;
      car.speed = 80;
      player.inCar = car;
      player.x = car.x;
      player.y = car.y;
      player.angle = car.angle;
      toast("Simulation Lab: driving scenario");
    }
  } else if (state.testScenario === "police") {
    state.heat = 5;
    state.wantedTimer = 999;
    placePoliceRing(360);
    toast("Simulation Lab: extreme police scenario");
  } else {
    toast(`Simulation Lab: ${state.testScenario}`);
  }
}

function placePoliceRing(radius) {
  cops.forEach((cop, index) => {
    const angle = (Math.PI * 2 * index) / cops.length;
    cop.x = player.x + Math.cos(angle) * radius;
    cop.y = player.y + Math.sin(angle) * radius;
    cop.angle = angle + Math.PI;
    cop.speed = 140;
    cop.unstuckTimer = 0;
    cop.contactCooldown = 0.35;
    cop.boostCooldown = 0;
  });
}

function spawnTraffic() {
  for (let i = 0; i < 54; i++) {
    const bus = i % 8 === 0;
    const motorcycle = !bus && i % 5 === 2;
    const car = {
      bus,
      motorcycle,
      w: bus ? 96 : motorcycle ? 36 : 54,
      h: bus ? 32 : motorcycle ? 16 : 28,
      angle: 0,
      speed: 0,
      max: bus ? randRange(190, 240) : motorcycle ? randRange(330, 410) : randRange(280, 360),
      accel: bus ? randRange(210, 280) : motorcycle ? randRange(520, 620) : randRange(380, 460),
      aiSpeed: trafficCruiseSpeed({ bus, motorcycle }),
      targetSpeed: trafficTargetSpeed({ bus, motorcycle }),
      sign: rand() > 0.5 ? 1 : -1,
      color: bus ? busColors[Math.floor(rand() * busColors.length)] : motorcycle ? motorcycleColors[Math.floor(rand() * motorcycleColors.length)] : colors[Math.floor(rand() * colors.length)],
      pathT: randRange(0, 100),
      mergeCooldown: randRange(0, 1.5),
    };
    resetTrafficCar(car, i);
    vehicles.push(car);
  }
}

function spawnPeds() {
  for (let i = 0; i < 86; i++) {
    const ped = {
      x: 0,
      y: 0,
      angle: randRange(0, Math.PI * 2),
      wait: randRange(0, 2),
      jaywalker: rand() < 0.12,
      crossing: false,
      program: "sidewalk",
      panicTimer: 0,
      walkAxis: rand() > 0.5 ? "h" : "v",
      walkSign: rand() > 0.5 ? 1 : -1,
      color: colors[Math.floor(rand() * colors.length)],
    };
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
    { x: -420, y: 820 },
    { x: 420, y: -520 },
  ];
  for (const p of starts) {
    const cop = { ...p, w: 58, h: 30, angle: randRange(0, 6), speed: 80, aiSpeed: 80, targetSpeed: 92, police: true, unstuckTimer: 0, contactCooldown: 0, boostCooldown: 0 };
    ensurePolicePatrolRoute(cop);
    cops.push(cop);
  }
}

function resetTrafficCar(car, index = 0) {
  let tries = 0;
  do {
    const horizontal = rand() > 0.5;
    const offset = STREAM_RADIUS * 0.35 + randRange(0, STREAM_RADIUS * 0.65);
    const side = index % 2 === 0 ? 1 : -1;
    const laneBase = horizontal ? player.y + randRange(-STREAM_RADIUS, STREAM_RADIUS) : player.x + randRange(-STREAM_RADIUS, STREAM_RADIUS);
    car.dir = horizontal ? "h" : "v";
    car.sign = rand() > 0.5 ? 1 : -1;
    car.laneIndex = Math.floor(randRange(0, 2));
    car.lane = trafficLanePosition(car.dir, snapDown(laneBase, BLOCK), car.sign, car.laneIndex);
    car.targetLane = car.lane;
    car.x = horizontal ? player.x + side * offset : car.lane;
    car.y = horizontal ? car.lane : player.y + side * offset;
    car.angle = horizontal ? (car.sign > 0 ? 0 : Math.PI) : car.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    tries += 1;
  } while (tries < 20 && isWater(car.x, car.y));
  car.aiSpeed = trafficCruiseSpeed(car);
  car.targetSpeed = trafficTargetSpeed(car);
  car.lastNode = "";
  car.mergeCooldown = randRange(0.4, 1.6);
}

function trafficCruiseSpeed(vehicle) {
  if (vehicle.bus) return randRange(54, 96);
  if (vehicle.motorcycle) return randRange(92, 176);
  return randRange(70, 150);
}

function trafficTargetSpeed(vehicle) {
  if (vehicle.bus) return randRange(58, 102);
  if (vehicle.motorcycle) return randRange(104, 184);
  return randRange(78, 150);
}

function trafficLanePosition(dir, roadCenter, sign, laneIndex) {
  const offset = LANE_OFFSETS[clamp(laneIndex, 0, LANE_OFFSETS.length - 1)];
  return roadCenter + offset * (dir === "v" ? -sign : sign);
}

function resetPed(ped) {
  let tries = 0;
  do {
    const roadX = snapDown(player.x + randRange(-STREAM_RADIUS, STREAM_RADIUS), BLOCK);
    const roadY = snapDown(player.y + randRange(-STREAM_RADIUS, STREAM_RADIUS), BLOCK);
    const along = randRange(-BLOCK / 2 + ROAD / 2 + 28, BLOCK / 2 - ROAD / 2 - 28);
    const side = rand() > 0.5 ? 1 : -1;
    ped.walkAxis = rand() > 0.5 ? "h" : "v";
    ped.walkSign = rand() > 0.5 ? 1 : -1;
    if (ped.walkAxis === "h") {
      ped.x = roadX + BLOCK / 2 + along;
      ped.y = roadY + side * (ROAD / 2 + 20);
    } else {
      ped.x = roadX + side * (ROAD / 2 + 20);
      ped.y = roadY + BLOCK / 2 + along;
    }
    tries += 1;
  } while (tries < 30 && (hitsBuilding(ped.x, ped.y, 10) || !isPedWalkable(ped.x, ped.y)));
  ped.angle = sidewalkHeading(ped) + randRange(-0.25, 0.25);
  ped.wait = randRange(0.2, 2);
  ped.crossing = false;
  ped.program = "sidewalk";
  ped.panicTimer = 0;
}

function resetCop(cop) {
  let tries = 0;
  do {
    const horizontal = rand() > 0.5;
    const offset = STREAM_RADIUS * 0.45 + randRange(0, STREAM_RADIUS * 0.45);
    const side = rand() > 0.5 ? 1 : -1;
    const laneBase = horizontal ? player.y + randRange(-STREAM_RADIUS, STREAM_RADIUS) : player.x + randRange(-STREAM_RADIUS, STREAM_RADIUS);
    cop.dir = horizontal ? "h" : "v";
    cop.sign = rand() > 0.5 ? 1 : -1;
    cop.laneIndex = Math.floor(randRange(0, 2));
    cop.lane = trafficLanePosition(cop.dir, snapDown(laneBase, BLOCK), cop.sign, cop.laneIndex);
    cop.targetLane = cop.lane;
    cop.x = horizontal ? player.x + side * offset : cop.lane;
    cop.y = horizontal ? cop.lane : player.y + side * offset;
    cop.angle = horizontal ? (cop.sign > 0 ? 0 : Math.PI) : cop.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    tries += 1;
  } while (tries < 20 && isWater(cop.x, cop.y));
  cop.speed = 80;
  cop.aiSpeed = randRange(58, 98);
  cop.targetSpeed = randRange(72, 108);
  cop.unstuckTimer = 0.3;
  cop.contactCooldown = 0;
  cop.boostCooldown = 0;
  cop.mergeCooldown = randRange(0.3, 1.2);
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
    if (waterX + WATER_WIDTH < left || waterX > right) continue;
    ctx.fillRect(waterX, top, WATER_WIDTH, bottom - top);
    ctx.fillStyle = "rgba(255,255,255,.12)";
    for (let y = snapDown(top, 90); y < bottom; y += 90) ctx.fillRect(waterX - 10, y, 70, 20);
    ctx.fillStyle = "#174d54";
    drawWaterBridges(waterX, top, bottom);
  }
}

function drawWaterBridges(waterX, top, bottom) {
  const bridgeLeft = waterX - 34;
  const bridgeWidth = WATER_WIDTH + 68;
  for (let y = snapDown(top, BLOCK) - BLOCK; y <= bottom + BLOCK; y += BLOCK) {
    ctx.fillStyle = "#202928";
    ctx.fillRect(bridgeLeft, y - ROAD / 2, bridgeWidth, ROAD);
    ctx.fillStyle = "rgba(247,244,232,.12)";
    ctx.fillRect(bridgeLeft, y - ROAD / 2 + 9, bridgeWidth, 3);
    ctx.fillRect(bridgeLeft, y + ROAD / 2 - 12, bridgeWidth, 3);
    ctx.strokeStyle = "rgba(242,201,76,.72)";
    ctx.lineWidth = 2;
    line(bridgeLeft, y - 3, bridgeLeft + bridgeWidth, y - 3);
    line(bridgeLeft, y + 3, bridgeLeft + bridgeWidth, y + 3);
    ctx.setLineDash([20, 22]);
    ctx.strokeStyle = "rgba(247,244,232,.28)";
    line(bridgeLeft, y - LANE_WIDTH, bridgeLeft + bridgeWidth, y - LANE_WIDTH);
    line(bridgeLeft, y + LANE_WIDTH, bridgeLeft + bridgeWidth, y + LANE_WIDTH);
    ctx.setLineDash([]);
  }
}

function isRoadish(x, y) {
  const mx = Math.abs(mod(x + BLOCK / 2, BLOCK) - BLOCK / 2);
  const my = Math.abs(mod(y + BLOCK / 2, BLOCK) - BLOCK / 2);
  return isBridge(x, y) || (!isWater(x, y) && (mx < ROAD * 0.55 || my < ROAD * 0.55));
}

function isStreetInterior(x, y) {
  if (isWater(x, y) && !isBridge(x, y)) return false;
  const mx = Math.abs(mod(x + BLOCK / 2, BLOCK) - BLOCK / 2);
  const my = Math.abs(mod(y + BLOCK / 2, BLOCK) - BLOCK / 2);
  return mx < ROAD / 2 - 8 || my < ROAD / 2 - 8;
}

function isPedWalkable(x, y) {
  if (isWater(x, y) && !isBridge(x, y)) return false;
  const mx = Math.abs(mod(x + BLOCK / 2, BLOCK) - BLOCK / 2);
  const my = Math.abs(mod(y + BLOCK / 2, BLOCK) - BLOCK / 2);
  const sidewalkBand = ROAD / 2 + 34;
  return mx < sidewalkBand || my < sidewalkBand;
}

function nearCrosswalk(point) {
  const mx = Math.abs(mod(point.x + BLOCK / 2, BLOCK) - BLOCK / 2);
  const my = Math.abs(mod(point.y + BLOCK / 2, BLOCK) - BLOCK / 2);
  return mx < ROAD / 2 + 18 && my < ROAD / 2 + 18;
}

function isWaterDistrict(x) {
  return mod(x - BLOCK * 8.7, BLOCK * 12) < WATER_WIDTH;
}

function isWater(x, y) {
  return isWaterDistrict(x) && Number.isFinite(y) && !isBridge(x, y);
}

function isBridge(x, y) {
  if (!isWaterDistrict(x) || !Number.isFinite(y)) return false;
  const my = Math.abs(mod(y + BLOCK / 2, BLOCK) - BLOCK / 2);
  return my < ROAD / 2;
}

function policeNoise(amount) {
  if (amount <= 0) return;
  state.heat = clamp(state.heat + amount, 0, 5);
  state.wantedTimer = 9;
}

function hurt(amount) {
  if (state.gameOver || player.invuln > 0) return;
  player.health -= amount;
  player.invuln = 0.5;
  if (player.health <= 0) {
    sendHomeFromHospital();
  }
}

function failActiveJobForPenalty() {
  const jobFailed = activeJob.started;
  if (jobFailed) activeJob = makeJob(state.currentMission);
  return jobFailed;
}

function resetWantedState() {
  state.heat = 0;
  state.wantedTimer = 0;
  state.lawCooldown = 0;
  state.wrongSideTimer = 0;
  state.lastLaw = "clear";
  state.homeSafeTimer = 0;
  state.waterTimer = 0;
  state.bustPressure = 0;
}

function sendHomeFromHospital() {
  const jobFailed = failActiveJobForPenalty();
  const lifeState = applyLifeLoss(state.lives);
  state.lives = lifeState.lives;
  if (lifeState.gameOver) {
    triggerGameOver();
    return;
  }
  const bill = Math.min(state.cash, HOSPITAL_BILL);
  state.cash -= bill;
  localStorage.setItem("wolfe.cash", state.cash);
  player.health = 100;
  player.x = HOME.x;
  player.y = HOME.y;
  player.inCar = null;
  resetWantedState();
  toast(jobFailed ? `Job failed. Hospital bill: $${bill}. ${state.lives} lives left.` : `Hospital bill: $${bill}. ${state.lives} lives left.`);
}

function sendHomeFromBust() {
  const jobFailed = failActiveJobForPenalty();
  const fine = Math.min(state.cash, Math.max(BUST_BASE_FINE, Math.floor(state.cash * 0.3)));
  state.cash -= fine;
  state.busts = (state.busts || 0) + 1;
  localStorage.setItem("wolfe.cash", state.cash);
  player.health = 100;
  player.x = HOME.x;
  player.y = HOME.y;
  player.inCar = null;
  resetWantedState();
  toast(`${jobFailed ? "Job failed. " : ""}Busted by cops: -$${fine}.`);
}

function triggerGameOver() {
  state.gameOver = true;
  state.running = false;
  state.heat = 0;
  state.wantedTimer = 0;
  state.lawCooldown = 0;
  state.wrongSideTimer = 0;
  state.lastLaw = "clear";
  state.homeSafeTimer = 0;
  state.waterTimer = 0;
  state.bustPressure = 0;
  player.health = 0;
  player.inCar = null;
  ui.start.textContent = "Restart Game";
  ui.start.classList.remove("hidden");
  toast("Game over. Wolfe City took all 5 lives.");
}

function resetGame() {
  state.gameOver = false;
  state.lives = 5;
  state.heat = 0;
  state.wantedTimer = 0;
  state.lawCooldown = 0;
  state.wrongSideTimer = 0;
  state.lastLaw = "clear";
  state.homeSafeTimer = 0;
  state.waterTimer = 0;
  state.bustPressure = 0;
  state.cash = Number(localStorage.getItem("wolfe.cash") || 0);
  state.rep = Number(localStorage.getItem("wolfe.rep") || 0);
  state.currentMission = 0;
  activeJob = makeJob(0);
  player.health = 100;
  player.invuln = 0;
  player.inCar = null;
  player.x = HOME.x;
  player.y = HOME.y;
  ui.start.textContent = "Start Game";
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
  return names.some((name) => keys.has(name) || (name === "shift" && touchInput.boost) || (name === " " && touchInput.brake));
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
