import assert from "node:assert/strict";
import test from "node:test";
import { applyLifeLoss, isLaneChangeSafe, nextTrafficSpeed, shouldAttemptLaneChange } from "../src/trafficModel.js";

test("IDM accelerates on open road", () => {
  const next = nextTrafficSpeed({ speed: 35, targetSpeed: 100, blocker: null, dt: 0.5 });
  assert.ok(next > 35);
  assert.ok(next <= 108);
});

test("IDM brakes before a close lead vehicle", () => {
  const next = nextTrafficSpeed({
    speed: 88,
    targetSpeed: 120,
    blocker: { gap: 42, minGap: 27, aiSpeed: 18 },
    dt: 0.35,
  });
  assert.ok(next < 88);
  assert.ok(next >= 0);
});

test("IDM treats red lights as virtual stopped blockers", () => {
  const next = nextTrafficSpeed({
    speed: 70,
    targetSpeed: 110,
    blocker: { gap: 34, minGap: 10, signal: true },
    dt: 0.5,
  });
  assert.ok(next < 35);
});

test("lane changes require safe front and rear gaps", () => {
  assert.equal(isLaneChangeSafe({ frontGap: 160, rearGap: 150, carLength: 54, rearSpeed: 55, carSpeed: 70 }), true);
  assert.equal(isLaneChangeSafe({ frontGap: 40, rearGap: 150, carLength: 54, rearSpeed: 55, carSpeed: 70 }), false);
  assert.equal(isLaneChangeSafe({ frontGap: 160, rearGap: 35, carLength: 54, rearSpeed: 90, carSpeed: 70 }), false);
});

test("MOBIL-style decision blocks passing at signals and intersections", () => {
  const car = { bus: false, mergeCooldown: 0, lane: 10, targetLane: 10, aiSpeed: 80, targetSpeed: 120 };
  assert.equal(shouldAttemptLaneChange({ car, blocker: { signal: true, gap: 40 }, nearIntersection: false, targetLaneClear: true }), false);
  assert.equal(shouldAttemptLaneChange({ car, blocker: { gap: 45, minGap: 28, aiSpeed: 30 }, nearIntersection: true, targetLaneClear: true }), false);
  assert.equal(shouldAttemptLaneChange({ car, blocker: { gap: 45, minGap: 28, aiSpeed: 30 }, nearIntersection: false, targetLaneClear: true }), true);
});

test("five-life rule reaches game over at zero", () => {
  assert.deepEqual(applyLifeLoss(5), { lives: 4, gameOver: false });
  assert.deepEqual(applyLifeLoss(1), { lives: 0, gameOver: true });
  assert.deepEqual(applyLifeLoss(0), { lives: 0, gameOver: true });
});
