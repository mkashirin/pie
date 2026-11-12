import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { clipText, type Component } from "@pi-extensions/tui";
import { compactText, freezePreview } from "./activity.ts";
import { safeCallback, warnCallbackFailure } from "./callbacks.ts";
import { compactRunLines, MAX_VISIBLE_RUNS } from "./presentation.ts";
import type { LiveBatch, LiveRunResult, RunStatus } from "./state.ts";

export { compactText } from "./activity.ts";

export const FLEET_WIDGET = "pi-openai-subagents-fleet";
const MAX_ROWS = MAX_VISIBLE_RUNS;

const active = (status: RunStatus) => status === "queued" || status === "running";

type Row = LiveRunResult;
interface Call {
    live: boolean;
    rows: Map<string, Row>;
    heartbeats: Set<() => void>;
}
export interface FleetClock {
    everySecond(tick: () => void): () => void;
}
const clock: FleetClock = {
    everySecond(tick) {
        const timer = setInterval(tick, 1000);
        timer.unref();
        return () => clearInterval(timer);
    },
};
export interface FleetLease {
    update(batch: LiveBatch): void;
    finish(status?: "failed" | "cancelled"): void;
    subscribeHeartbeat(refresh: () => void): () => void;
}
const silent: FleetLease = { update() {}, finish() {}, subscribeHeartbeat: () => () => {} };

/** Stateless render-time styling and width-aware clipping; factories have no Pi padding. */
export class FleetComponent implements Component {
    constructor(
        private calls: () => Call[],
        private theme: Theme,
        private onDispose: () => void,
    ) {}

    invalidate() {}

    dispose() {
        this.onDispose();
    }

    render(width: number) {
        width = Number.isFinite(width) ? Math.floor(width) : 0;
        if (width < 1) return [];
        const calls = this.calls();
        // Prefer active rows when the merged fleet exceeds the visible bound.
        const rows = calls.flatMap((call) => [...call.rows.values()]);
        rows.sort((a, b) => Number(active(b.status)) - Number(active(a.status)));
        const hidden = Math.max(0, rows.length - MAX_ROWS);
        const lines = [this.theme.fg(
            "accent",
            `Agents · ${calls.filter((call) => call.live).length} calls · ${rows.length} runs${
                hidden ? ` · +${hidden} more` : ""
            }`,
        )];
        rows.slice(0, MAX_ROWS).forEach((row) => {
            lines.push(compactRunLines(row, this.theme, true)[0]);
        });
        // Above-editor widgets use the full width without adding a left margin.
        return lines.map((line) => clipText(line, width));
    }
}

/** One ephemeral fleet per extension session. No resources are created by construction. */
export class FleetUI {
    private generation = 0;
    private calls = new Map<string, Call>();
    private ui: ExtensionContext["ui"] | undefined;
    private component: FleetComponent | undefined;
    private redraw: (() => void) | undefined;
    private stopTicker: (() => void) | undefined;

    constructor(private time: FleetClock = clock) {}

    reset() {
        this.generation++;
        for (const call of this.calls.values()) call.heartbeats.clear();
        this.calls.clear();
        const ui = this.ui;
        this.ui = undefined;
        this.component = undefined;
        this.redraw = undefined;
        const stopTicker = this.stopTicker;
        this.stopTicker = undefined;
        try {
            stopTicker?.();
        } finally {
            // Clear ownership before removal: Pi calls dispose synchronously during setWidget.
            ui?.setWidget(FLEET_WIDGET, undefined);
        }
    }

    begin(id: string, ctx: ExtensionContext): FleetLease {
        if (ctx.mode !== "tui" || !ctx.hasUI) return silent;
        const generation = this.generation;
        const call: Call = { live: true, rows: new Map(), heartbeats: new Set() };
        this.calls.set(id, call);

        const current = () => generation === this.generation && this.calls.get(id) === call;

        return {
            update: (batch) => {
                if (!current() || !call.live) return;
                for (const result of batch.results) {
                    call.rows.set(result.id, this.row(result));
                }
                if (!this.ui && call.rows.size) this.show(ctx, generation);
                this.component?.invalidate();
                this.redraw?.();
            },
            finish: (status = "failed") => {
                if (!current() || !call.live) return;
                try {
                    // Capture authoritative elapsed before freezing cancellation/error rows.
                    this.refresh(call);
                } finally {
                    call.heartbeats.clear();
                    for (const row of call.rows.values()) {
                        if (active(row.status)) row.status = status;
                    }
                    call.live = false;
                    if (current()) {
                        if (![...this.calls.values()].some((other) => other.live)) this.reset();
                        else this.redraw?.();
                    }
                }
            },
            subscribeHeartbeat: (refresh) => {
                if (!current() || !call.live) return () => {};
                call.heartbeats.add(refresh);
                return () => call.heartbeats.delete(refresh);
            },
        };
    }

    private refresh(call: Call) {
        for (const refresh of [...call.heartbeats]) {
            // A callback can unsubscribe/reset/finish while publishing.
            if (!call.live || !call.heartbeats.has(refresh)) continue;
            try {
                refresh();
            } catch (error) {
                call.heartbeats.delete(refresh);
                warnCallbackFailure("fleet heartbeat subscriber", error);
            }
        }
    }

    private row(result: LiveRunResult): Row {
        return {
            ...result,
            agent: compactText(result.agent),
            model: compactText(result.model),
            ...(result.activity ? { activity: freezePreview(result.activity) } : {}),
        };
    }

    private show(ctx: ExtensionContext, generation: number) {
        this.ui = ctx.ui;
        ctx.ui.setWidget(FLEET_WIDGET, (tui, theme) => {
            const component = new FleetComponent(
                () => [...this.calls.values()],
                theme,
                () => {
                    if (this.component === component && this.generation === generation) {
                        // Host disposal (e.g. /reload) must also invalidate outstanding leases.
                        this.ui = undefined;
                        this.reset();
                    }
                },
            );
            this.component = component;
            this.redraw = safeCallback("fleet redraw", () => {
                if (this.generation === generation) tui.requestRender();
            });
            return component;
        }, { placement: "aboveEditor" });
        // One lazy heartbeat shared by all calls and both UI surfaces, outside the factory.
        if (this.generation !== generation || this.stopTicker) return;
        this.stopTicker = this.time.everySecond(() => {
            if (this.generation !== generation) return;
            for (const call of this.calls.values()) {
                if (!call.live) continue;
                this.refresh(call);
                if (this.generation !== generation) return;
            }
            this.component?.invalidate();
            this.redraw?.();
        });
    }
}
