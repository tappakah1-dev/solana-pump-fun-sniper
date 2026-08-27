import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { PRESETS, MCAP_SLIDER_MAX, MCAP_SLIDER_MIN } from "@/engine/replay.ts";
import { useBotStore } from "@/store/bot-store.ts";
import { fmtMcap } from "@/lib/utils.ts";

export function ReplayPanel() {
  const tick = useBotStore((s) => s.tick);
  const mcapSlider = useBotStore((s) => s.mcapSlider);
  const replayT = useBotStore((s) => s.replayT);
  const replayPlaying = useBotStore((s) => s.replayPlaying);
  const activePresetId = useBotStore((s) => s.activePresetId);
  const setMcapSlider = useBotStore((s) => s.setMcapSlider);
  const simulateAllowCreate = useBotStore((s) => s.simulateAllowCreate);
  const simulateSkipCreate = useBotStore((s) => s.simulateSkipCreate);
  const runNamedPreset = useBotStore((s) => s.runNamedPreset);
  const playReplay = useBotStore((s) => s.playReplay);
  const pauseReplay = useBotStore((s) => s.pauseReplay);
  const setReplayT = useBotStore((s) => s.setReplayT);
  void tick;

  const preset = PRESETS.find((p) => p.id === activePresetId);
  const maxT = preset ? (preset.frames[preset.frames.length - 1]?.t ?? 600) : 600;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Lab</h2>
          <p className="mt-1 text-sm text-muted text-pretty">
            Practice the phase machine. Start watches live Pump.fun — this slider is not the book.
          </p>
        </div>
        <div className="font-mono text-lg tabular-nums text-fg">{fmtMcap(mcapSlider)}</div>
      </div>

      <label className="block">
        <span className="sr-only">Market cap</span>
        <input
          type="range"
          min={MCAP_SLIDER_MIN}
          max={MCAP_SLIDER_MAX}
          step={100}
          value={mcapSlider}
          onChange={(e) => setMcapSlider(Number(e.target.value))}
          className="mcap-slider w-full"
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-subtle">
          <span>2,000</span>
          <span>300,000</span>
        </div>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={simulateAllowCreate}>
          Simulate allow-listed create
        </Button>
        <Button size="sm" variant="secondary" onClick={simulateSkipCreate}>
          Simulate non-allow create
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => runNamedPreset(p.id)}
            className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
              activePresetId === p.id
                ? "border-accent/50 bg-surface-2"
                : "border-border bg-bg hover:bg-surface-2"
            }`}
          >
            <div className="text-xs font-medium text-fg">{p.name}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted">{p.blurb}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => (replayPlaying ? pauseReplay() : playReplay())}
          disabled={!preset}
        >
          {replayPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {replayPlaying ? "Pause time" : "Play time"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!preset}
          onClick={() => {
            if (activePresetId) runNamedPreset(activePresetId);
          }}
        >
          <RotateCcw className="size-3.5" />
          Re-run
        </Button>
        <div className="min-w-32 flex-1">
          <input
            type="range"
            min={0}
            max={maxT}
            step={1}
            value={Math.min(replayT, maxT)}
            disabled={!preset}
            onChange={(e) => setReplayT(Number(e.target.value))}
            className="mcap-slider w-full"
          />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-muted">t={Math.round(replayT)}s</span>
      </div>
    </section>
  );
}
