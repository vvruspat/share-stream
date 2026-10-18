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

The source is included in this workspace. Distribution archives require a Developer
ID Application signature; packaging refuses ad-hoc signing. Apple notarization is
a separate release step. No third-party binary codec or Homebrew library is required at runtime.
