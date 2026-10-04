import { readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export async function canonical(path: string, depth = 0): Promise<string> {
    if (depth > 40) throw new Error("Too many symbolic links in ownership path");
    let current = resolve(path);
    const suffix: string[] = [];
    for (;;) {
        try {
            return resolve(await realpath(current), ...suffix.reverse());
        } catch (error) {
            if (
                !["ENOENT", "ENOTDIR", "ELOOP"].includes(
                    (error as NodeJS.ErrnoException).code ?? "",
                )
            ) {
                throw error;
            }
            // Resolve dangling links too: realpath alone would silently skip them while walking upward.
            let link: string | undefined;
            try {
                link = await readlink(current);
            } catch (linkError) {
                if (
                    !["ENOENT", "ENOTDIR", "EINVAL"].includes(
                        (linkError as NodeJS.ErrnoException).code ?? "",
                    )
                ) throw linkError;
            }
            if (link !== undefined) {
                return canonical(resolve(dirname(current), link, ...suffix.reverse()), depth + 1);
            }
            if ((error as NodeJS.ErrnoException).code === "ELOOP") throw error;
            const parent = dirname(current);
            if (parent === current) throw error;
            suffix.push(relative(parent, current));
            current = parent;
        }
    }
}

export function contains(root: string, path: string) {
    const rel = relative(root, path);
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function overlaps(a: string[], b: string[]) {
    return a.some((x) => b.some((y) => contains(x, y) || contains(y, x)));
}

export async function ownership(cwd: string, paths: string[]): Promise<string[]> {
    const root = await canonical(cwd);
    const result: string[] = [];
    for (const path of paths) {
        if (!path.trim() || isAbsolute(path) || /[*?\[\]{}]/.test(path)) {
            throw new Error(
                `writePaths must be explicit workspace-relative files/directories: ${path}`,
            );
        }
        const resolved = await canonical(resolve(cwd, path));
        if (!contains(root, resolved)) throw new Error(`writePaths escapes the workspace: ${path}`);
        result.push(resolved);
    }
    return [...new Set(result)];
}

export interface Job {
    id: string;
    writer: boolean;
    reviewer: boolean;
    paths: string[];
    signal?: AbortSignal;
}
interface Queued {
    job: Job;
    start: () => void;
    reject: (reason: Error) => void;
    cleanup: () => void;
}

export class Scheduler {
    private active = new Map<string, Job>();
    private reservations = new Map<string, Job>();
    private queue: Queued[] = [];

    constructor(public concurrency = 4) {}

    reserve(jobs: Job[]) {
        const writers = jobs.filter((j) => j.writer);
        if (writers.length > 1 && writers.some((j) => !j.paths.length)) {
            throw new Error(
                "Parallel writers require nonempty, disjoint writePaths for every writer",
            );
        }
        const candidates = [...this.reservations.values(), ...jobs];
        for (let i = 0; i < candidates.length; i++) {
            for (let k = i + 1; k < candidates.length; k++) {
                const a = candidates[i], b = candidates[k];
                if (
                    a.writer && b.writer && a.paths.length && b.paths.length
                    && overlaps(a.paths, b.paths)
                ) throw new Error(`Write ownership conflict: ${a.id} and ${b.id}`);
            }
        }
        for (const job of jobs) this.reservations.set(job.id, job);
    }

    private eligible(job: Job) {
        if (this.active.size >= this.concurrency) return false;
        const active = [...this.active.values()];
        if (job.reviewer && [...this.reservations.values()].some((j) => j.writer)) return false;
        if (job.writer && active.some((j) => j.reviewer)) return false;
        if (job.writer && active.some((j) => j.writer && (!j.paths.length || !job.paths.length))) {
            return false;
        }
        return true;
    }

    private pump() {
        for (let i = 0; i < this.queue.length;) {
            const q = this.queue[i];
            if (!this.eligible(q.job)) {
                i++;
                continue;
            }
            this.queue.splice(i, 1);
            q.cleanup();
            this.active.set(q.job.id, q.job);
            q.start();
        }
    }

    async run<T>(job: Job, fn: () => Promise<T>): Promise<T> {
        try {
            await new Promise<void>((start, reject) => {
                if (job.signal?.aborted) {
                    reject(new Error("Cancelled before execution"));
                    return;
                }

                const cancel = () => {
                    this.queue = this.queue.filter((q) => q.job.id !== job.id);
                    this.reservations.delete(job.id);
                    cleanup();
                    reject(new Error("Cancelled while queued"));
                    this.pump();
                };

                const cleanup = () => job.signal?.removeEventListener("abort", cancel);

                this.queue.push({ job, start, reject, cleanup });
                job.signal?.addEventListener("abort", cancel, { once: true });
                this.pump();
            });
            return await fn();
        } finally {
            this.active.delete(job.id);
            this.reservations.delete(job.id);
            this.pump();
        }
    }

    cancelQueued() {
        const queue = this.queue;
        this.queue = [];
        for (const q of queue) {
            q.cleanup();
            this.reservations.delete(q.job.id);
            q.reject(new Error("Agent runtime stopped"));
        }
    }

    get busy() {
        return this.active.size > 0 || this.queue.length > 0;
    }
}
