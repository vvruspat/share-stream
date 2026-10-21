import { Slider } from "radix-ui";
import {
  meterFraction,
  monitorLabel,
  monitorMaxDb,
  monitorMinDb,
  monitorStepDb,
  peakLabel,
  type StereoPeaks,
} from "../../audio/monitor.js";

export function MonitorSlider({
  id,
  value,
  peaks,
  onValueChange,
}: {
  id: string;
  value: number;
  peaks: StereoPeaks;
  onValueChange: (db: number) => void;
}) {
  return (
    <section className="monitor-field" aria-label="Voice playback">
      <div className="monitor-label">
        <label id={`${id}-label`} htmlFor={id}>
          Local monitor
        </label>
        <output id={`${id}-value`} aria-live="off">
          {monitorLabel(value)}
        </output>
      </div>
      <div className="monitor-fader">
        <span className="monitor-channels" aria-hidden="true">
          <span>L</span>
          <span>R</span>
        </span>
        <Slider.Root
          id={id}
          className="monitor-slider"
          value={[value]}
          min={monitorMinDb}
          max={monitorMaxDb}
          step={monitorStepDb}
          onValueChange={(values) => onValueChange(values[0])}
          onDoubleClick={(event) => {
            event.preventDefault();
            onValueChange(0);
          }}
          title="Only changes your local voice output. Double-click for 0 dB."
        >
          <Slider.Track className="monitor-track" aria-hidden="true">
            {peaks.map((peak, channel) => (
              <span className="monitor-channel" key={channel}>
                <span
                  className={`monitor-signal ${peak > 1 ? "is-clipping" : ""}`}
                  style={{ width: `${meterFraction(peak) * 100}%` }}
                />
              </span>
            ))}
          </Slider.Track>
          <Slider.Thumb
            className="monitor-thumb"
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-description`}
            aria-valuetext={monitorLabel(value)}
          />
        </Slider.Root>
      </div>
      <div className="monitor-readout">
        <span>Partner’s voice / Stereo</span>
        <output aria-live="off">{peakLabel(peaks)}</output>
      </div>
      <p id={`${id}-description`} className="monitor-hint">
        Only changes what you hear. L/R show local output in dBFS.
      </p>
    </section>
  );
}
