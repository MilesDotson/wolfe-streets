export const IDM_DEFAULTS = {
  minGap: 18,
  timeHeadway: 1.15,
  maxAccel: 92,
  comfortableBrake: 155,
  exponent: 4,
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function leadSpeed(blocker) {
  if (!blocker) return 0;
  if (blocker.signal || blocker.intersection) return 0;
  return Math.max(0, blocker.aiSpeed ?? blocker.speed ?? 0);
}

export function desiredGap(speed, blocker, options = {}) {
  const model = { ...IDM_DEFAULTS, ...options };
  const deltaV = Math.max(0, speed - leadSpeed(blocker));
  const brakingTerm = (speed * deltaV) / (2 * Math.sqrt(model.maxAccel * model.comfortableBrake));
  return model.minGap + speed * model.timeHeadway + brakingTerm;
}

export function idmAcceleration({ speed, targetSpeed, blocker, options = {} }) {
  const model = { ...IDM_DEFAULTS, ...options };
  const freeRoad = Math.pow(speed / Math.max(1, targetSpeed), model.exponent);
  if (!blocker) return model.maxAccel * (1 - freeRoad);

  const gap = Math.max(0.1, blocker.gap - (blocker.minGap || 0));
  const desired = desiredGap(speed, blocker, model);
  return model.maxAccel * (1 - freeRoad - Math.pow(desired / gap, 2));
}

export function nextTrafficSpeed({ speed, targetSpeed, blocker, dt, options = {} }) {
  const accel = idmAcceleration({ speed, targetSpeed, blocker, options });
  return clamp(speed + accel * dt, 0, targetSpeed * 1.08);
}

export function shouldAttemptLaneChange({ car, blocker, nearIntersection, targetLaneClear }) {
  if (!blocker || blocker.signal || blocker.intersection) return false;
  if (car.bus || car.mergeCooldown > 0 || nearIntersection) return false;
  if (Math.abs((car.targetLane ?? car.lane) - car.lane) > 2) return false;
  const lead = leadSpeed(blocker);
  const blockedHard = blocker.gap < blocker.minGap + Math.max(52, car.aiSpeed * 0.75);
  const speedGain = car.targetSpeed > lead + 20;
  return blockedHard && speedGain && targetLaneClear;
}

export function isLaneChangeSafe({ frontGap = Infinity, rearGap = Infinity, carLength = 54, rearSpeed = 0, carSpeed = 0 }) {
  const frontNeed = carLength + Math.max(48, carSpeed * 0.8);
  const rearNeed = carLength + Math.max(44, rearSpeed * 0.65);
  return frontGap > frontNeed && rearGap > rearNeed;
}

export function applyLifeLoss(lives, amount = 1) {
  const nextLives = Math.max(0, lives - amount);
  return {
    lives: nextLives,
    gameOver: nextLives <= 0,
  };
}
