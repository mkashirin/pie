import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { canSelectToolInPlanMode, classifyPlanModeTool, isBuiltinTool } from "./tool-policy.ts";

export function toolNameFromLegacyKey(key: string, tools: ToolInfo[]): string | undefined {
    const direct = tools.find((tool) => tool.name === key);
    if (direct) return direct.name;
    // Historical selections qualified a name with provenance. Never resolve an ambiguous suffix.
    const matches = tools.filter((tool) => {
        const source = tool.sourceInfo;
        return [source?.source, source?.path].filter(Boolean).some((prefix) =>
            key === `${prefix}:${tool.name}` || key === `${prefix}::${tool.name}`
        );
    });
    return matches.length === 1 ? matches[0]!.name : undefined;
}
export function compareTools(left: ToolInfo, right: ToolInfo): number {
    return Number(isBuiltinTool(right)) - Number(isBuiltinTool(left))
        || left.name.localeCompare(right.name);
}
export function toolPolicyLabel(tool: ToolInfo): string {
    switch (classifyPlanModeTool(tool)) {
        case "read-only":
            return "Read-only";
        case "limited":
            return "Limited · read-only commands";
        case "user-opt-in":
            return "User opt-in · runs at your risk";
        case "blocked":
            return "Blocked in Plan Mode";
    }
}
export function unique(values: string[]): string[] {
    return [...new Set(values)];
}
export function defaultPlanModeToolNames(
    tools: ToolInfo[],
    configuredNames: string[] | undefined,
): string[] {
    const available = tools.filter(canSelectToolInPlanMode);
    if (configuredNames !== undefined) {
        const names = new Set(available.map((tool) => tool.name));
        return unique(configuredNames).filter((name) => names.has(name));
    }
    return unique(available.filter(isBuiltinTool).map((tool) => tool.name));
}
interface PlanModeToolSelectionSnapshot {
    selectedToolNames?: string[];
    selectedToolKeys?: string[];
    defaultPlanTools?: string[];
}
export function snapshotPlanModeSelectedNames(
    tools: ToolInfo[],
    selection: PlanModeToolSelectionSnapshot,
): Set<string> {
    if (selection.selectedToolNames !== undefined) {
        return new Set(defaultPlanModeToolNames(tools, selection.selectedToolNames));
    }
    if (selection.selectedToolKeys !== undefined) {
        return new Set(defaultPlanModeToolNames(
            tools,
            selection.selectedToolKeys.map((key) => toolNameFromLegacyKey(key, tools))
                .filter((name): name is string => name !== undefined),
        ));
    }
    return new Set(defaultPlanModeToolNames(tools, selection.defaultPlanTools));
}
