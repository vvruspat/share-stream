export {};
declare global {
  interface Window {
    mediaRequests: { audio: number; display: number };
    testPCs: RTCPeerConnection[];
    captureTracks: MediaStreamTrack[];
    iceErrors: { code: number; text: string; url: string }[];
    micConstraints: MediaTrackConstraints[];
    forcePressure?: boolean;
    testSocket: WebSocket;
  }
  interface RTCRtpEncodingParameters {
    networkPriority?: "very-low" | "low" | "medium" | "high";
  }
}
