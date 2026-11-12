import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_MUTEX_CHANNEL = "workflow:mutex:v1";
export const AGENT_WORKFLOW_GROUP = "agent-workflow";
export type WorkflowMutexOwner = symbol;

interface Claim {
    version: 1;
    session: object;
    group: string;
    owner: WorkflowMutexOwner;
    denied: boolean;
}

export class WorkflowMutex {
    private session: object | undefined;
    private readonly heldGroups = new Map<
        string,
        { owner: WorkflowMutexOwner; generation: number }
    >();
    private generation = 0;

    constructor(private readonly pi: Pick<ExtensionAPI, "events">) {
        pi.events.on(WORKFLOW_MUTEX_CHANNEL, (event) => this.answer(event));
    }

    bindSession(session: object): void {
        this.heldGroups.clear();
        this.generation++;
        this.session = session;
    }

    unbindSession(session: object): void {
        if (this.session !== session) return;
        this.heldGroups.clear();
        this.generation++;
        this.session = undefined;
    }

    acquire(group = AGENT_WORKFLOW_GROUP): WorkflowMutexOwner | undefined {
        if (!this.session || !group || this.heldGroups.has(group)) return undefined;
        const owner = Symbol(group);
        const generation = this.generation;
        const claim: Claim = { version: 1, session: this.session, group, owner, denied: false };
        // Publish locally before probing peers so a reentrant claim cannot pass unnoticed.
        this.heldGroups.set(group, { owner, generation });
        try {
            this.pi.events.emit(WORKFLOW_MUTEX_CHANNEL, claim);
        } catch (error) {
            this.release(owner, group);
            throw error;
        }
        if (claim.denied || generation !== this.generation || !this.isOwner(owner, group)) {
            this.release(owner, group);
            return undefined;
        }
        return owner;
    }

    isOwner(owner: WorkflowMutexOwner | undefined, group = AGENT_WORKFLOW_GROUP): boolean {
        const held = this.heldGroups.get(group);
        return owner !== undefined && this.session !== undefined && held?.owner === owner
            && held.generation === this.generation;
    }

    release(owner: WorkflowMutexOwner | undefined, group = AGENT_WORKFLOW_GROUP): void {
        if (this.isOwner(owner, group)) this.heldGroups.delete(group);
    }

    private answer(event: unknown): void {
        if (!event || typeof event !== "object") return;
        const claim = event as Partial<Claim>;
        if (
            claim.version !== 1 || claim.session !== this.session || typeof claim.group !== "string"
        ) return;
        const held = this.heldGroups.get(claim.group);
        if (held && held.owner !== claim.owner) claim.denied = true;
    }
}
