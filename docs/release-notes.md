Music, voice and screen in one private session.

- **macOS universal**: VST3 and Audio Unit plugins for Send/Listen, plus a standalone receiver. macOS 12+, Apple Silicon and Intel.
- Native stereo float32 streaming at 48 kHz, encrypted direct UDP with relay fallback.
- One invitation for the native music stream and browser voice/screen room.
- React + TypeScript + Vite+ browser client with styled Radix UI and Heroicons.
- Independent screen and voice transports; unprocessed headphone capture by default.
- Listen handles silent/disabled input, DAW audio restarts and sample-rate changes.

### Downloads

| Archive | Contents |
| --- | --- |
| **ShareStream-macOS.zip** | VST3, AU, standalone receiver and `Install.command` |
| **ShareStream-Receiver-macOS.zip** | Standalone receiver for the listening partner |

Both archives use the owner's Apple Developer ID signature and Apple notarization. Verification is included in `NOTARIZATION.json` and `SHA256SUMS.txt`.

Quit the DAW before installing updated plugins, then reopen it. In Logic: **Audio FX → Audio Units → Share Stream → Share Stream**. Click **Voice & screen…** to open the same room in the browser.
