import type { PlanExportDestination } from "./plan-export.ts";

export type PlanExportDestinationProvider = () => PlanExportDestination;

export function planExportInputScreen(getDestination: PlanExportDestinationProvider) {
    const destination = getDestination();
    return {
        kind: "input" as const,
        title: "Export plan",
        lines: [
            "Create a Markdown file without overwriting existing files.",
            `Default: ${destination.resolvedPath}`,
        ],
        placeholder: destination.configuredPath,
        action: "export" as const,
        hint: "back" as const,
    };
}
