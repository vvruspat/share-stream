/// <reference types="vite/client" />
declare const __APP_VERSION__: string;

// Optional browser extension: Safari and newer Chromium builds expose this
// before it is included in TypeScript's DOM declarations. Always feature-detect.
interface MediaTrackSupportedConstraints {
  voiceIsolation?: boolean;
}
interface MediaTrackConstraints {
  voiceIsolation?: ConstrainBoolean;
}
interface MediaTrackSettings {
  voiceIsolation?: boolean;
}
