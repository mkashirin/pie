import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH = 512;

export interface ImplementationModelOverride {
    provider: string;
    modelId: string;
}

export interface AvailableImplementationModel {
    provider: string;
    id: string;
    name?: string;
}

export function isPendingImplementationModelIdentifier(value: unknown): value is string {
    return typeof value === "string" && value.length > 0
        && value.length <= MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH
        && value === value.trim() && !/[\x00-\x1f\x7f]/u.test(value);
}

export function snapshotAvailableImplementationModels(
    ctx: ExtensionContext,
): AvailableImplementationModel[] {
    const available = ctx.modelRegistry.getAvailable();
    const scoped = ctx.scopedModels;
    return available.filter((model) =>
        !scoped?.length
        || scoped.some(({ model: entry }) =>
            entry.provider === model.provider && entry.id === model.id
        )
    ).map(({ provider, id, name }) => ({ provider, id, name }));
}

export function findAvailableImplementationModel(
    models: readonly AvailableImplementationModel[],
    configured: ImplementationModelOverride | undefined,
): AvailableImplementationModel | undefined {
    return configured
        ? models.find((model) =>
            model.provider === configured.provider && model.id === configured.modelId
        )
        : undefined;
}
