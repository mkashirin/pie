export interface CommandArgumentCompletion {
    value: string;
    label: string;
    description?: string;
}

const commands = [
    ["start", "Enable Plan Mode without sending a request"],
    ["tools", "Choose tools before starting"],
    ["show", "Show the stored plan"],
    ["finalize", "Ask the agent to complete the plan"],
    ["implement", "Implement the plan in this session"],
    ["save", "Save the completed plan for later"],
    ["export", "Export Markdown without overwriting a file"],
    ["settings", "Configure Plan Mode"],
    ["exit", "Leave planning or clear the stored plan"],
    ["off", "Leave Plan Mode"],
] as const;

export function completePlanArguments(argumentPrefix: string): CommandArgumentCompletion[] | null {
    const prefix = argumentPrefix.trimStart();
    const matches = commands.filter(([name]) => name.startsWith(prefix)).map(
        ([value, description]) => ({ value, label: value, description }),
    );
    return matches.length ? matches : null;
}
