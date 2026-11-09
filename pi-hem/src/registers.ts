export interface RegisterValue {
    fragments: string[];
    linewise: boolean;
}
export type RegisterOperation = "yank" | "delete";
const clone = (value: RegisterValue): RegisterValue => ({
    ...value,
    fragments: [...value.fragments],
});
/** Private editor registers; returned values never alias stored fragments. */
export class RegisterBank {
    private values = new Map<string, RegisterValue>();
    read(name = "\""): RegisterValue | undefined {
        const value = this.values.get(name.toLowerCase());
        return value && clone(value);
    }
    write(value: RegisterValue, operation: RegisterOperation, name = "\""): void {
        if (name === "_") return;
        if (/^[A-Z]$/.test(name)) {
            const previous = this.read(name);
            if (previous) {
                value = {
                    fragments: Array.from({
                        length: Math.max(previous.fragments.length, value.fragments.length),
                    }, (_, i) =>
                        previous.fragments[Math.min(i, previous.fragments.length - 1)]!
                        + value.fragments[Math.min(i, value.fragments.length - 1)]!),
                    linewise: previous.linewise && value.linewise,
                };
            }
        }
        this.values.set(name.toLowerCase(), clone(value));
        this.values.set("\"", clone(value));
        if (operation === "yank") this.values.set("0", clone(value));
        else if (value.linewise || value.fragments.some((text) => text.includes("\n"))) {
            for (let i = 9; i > 1; i--) {
                const previous = this.values.get(String(i - 1));
                if (previous) this.values.set(String(i), clone(previous));
                else this.values.delete(String(i));
            }
            this.values.set("1", clone(value));
        } else this.values.set("-", clone(value));
    }
}
