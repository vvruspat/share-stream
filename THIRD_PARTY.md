# Third-party software

- JUCE 8.0.4, https://github.com/juce-framework/JUCE/tree/8.0.4.
  JUCE is available under its commercial licence or AGPLv3. See
  https://github.com/juce-framework/JUCE/blob/8.0.4/LICENSE.md.
  Use and redistribution of builds must comply with the applicable JUCE licence.
- Monocypher 4.0.2, https://github.com/LoupVaillant/Monocypher/tree/4.0.2.
  `vendor/monocypher/monocypher.c` and `.h` are unmodified upstream source.
  Dual licensed BSD-2-Clause / CC0; the complete licence is included alongside them.
- VST is a trademark of Steinberg Media Technologies GmbH. The JUCE distribution
  includes the VST3 SDK and its licence notices.
- Browser signaling service: ws 8.22.0 (MIT), https://github.com/websockets/ws.
  Node.js 24 image, https://github.com/nodejs/node/blob/main/LICENSE.
- Browser UI: React / React DOM 19.3.1 (MIT), https://github.com/facebook/react;
  Radix UI 1.8.1 (MIT), https://github.com/radix-ui/primitives;
  Heroicons 2.2.0 (MIT), https://github.com/tailwindlabs/heroicons.
  Build tooling: Vite+ 1.3.0 (MIT), https://github.com/voidzero-dev/vite-plus;
  TypeScript 7.0.2 (Apache-2.0), https://github.com/microsoft/TypeScript.
  These web dependencies are not bundled into the native macOS binaries.
- TURN service: coturn 4.18.0, Docker image `coturn/coturn:4.18.0-r0-alpine`,
  BSD-3-Clause, https://github.com/coturn/coturn/blob/master/LICENSE.
- Browser QA: Playwright 1.64.1, Apache-2.0, https://github.com/microsoft/playwright.
  These server/test dependencies are not bundled into the native macOS binaries.

The source is included in this workspace. Distribution archives require a Developer
ID Application signature; packaging refuses ad-hoc signing. Apple notarization is
a separate release step. No third-party binary codec or Homebrew library is required at runtime.
