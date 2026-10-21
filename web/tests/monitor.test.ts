import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vite-plus/test";
import {
  meterFraction,
  monitorGain,
  monitorLabel,
  monitorMaxDb,
  monitorMinDb,
  monitorStepDb,
  peakLabel,
} from "../src/audio/monitor.js";

test("native and browser monitors share the dB range, mute and gain curve", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../../Tests/MonitorGains.json", import.meta.url), "utf8"),
  ) as {
    min: number;
    max: number;
    step: number;
    default: number;
    cases: { db: number; gain: number }[];
  };
  assert.deepEqual(
    [monitorMinDb, monitorMaxDb, monitorStepDb],
    [fixture.min, fixture.max, fixture.step],
  );
  for (const { db, gain } of fixture.cases) assert.ok(Math.abs(monitorGain(db) - gain) < 1e-10);
  assert.equal(monitorGain(fixture.default), 1);
  assert.equal(monitorLabel(-60), "Mute");
  assert.equal(monitorLabel(0), "0.0 dB");
});

test("signal meter uses the native -60..0 dBFS scale independently of gain", () => {
  assert.equal(meterFraction(0), 0);
  assert.equal(meterFraction(0.001), 0);
  assert.equal(meterFraction(0.01), 1 / 3);
  assert.equal(meterFraction(0.1), 2 / 3);
  assert.equal(meterFraction(1), 1);
  assert.equal(meterFraction(2), 1);
  assert.equal(peakLabel([0, 0]), "Peak -inf dBFS");
  assert.equal(peakLabel([0.25, 0.5]), "Peak -6.0 dBFS");
});
