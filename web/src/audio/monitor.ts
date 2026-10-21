export const monitorMinDb = -60;
export const monitorMaxDb = 6;
export const monitorStepDb = 0.1;
export type StereoPeaks = readonly [number, number];

export function monitorGain(db: number): number {
  if (!Number.isFinite(db) || Math.abs(db) < 0.0001) return 1;
  return db <= monitorMinDb ? 0 : 10 ** (Math.min(db, monitorMaxDb) / 20);
}

export function meterFraction(peak: number): number {
  return peak > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(peak) + 60) / 60)) : 0;
}

export function monitorLabel(db: number): string {
  return db <= monitorMinDb ? "Mute" : `${db.toFixed(1)} dB`;
}

export function peakLabel(peaks: StereoPeaks): string {
  const peak = Math.max(...peaks);
  return peak > 0
    ? `Peak ${Math.max(-100, 20 * Math.log10(peak)).toFixed(1)} dBFS`
    : "Peak -inf dBFS";
}
