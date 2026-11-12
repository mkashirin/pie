/** Pi rejects captured session-bound APIs after replacing an extension runtime. */
export function isStaleExtensionContextError(error: unknown): boolean {
    return error instanceof Error
        && /(?:stale|no longer active|replaced|disposed|invalidated).*(?:context|session|runtime|extension)|(?:context|session|runtime|extension).*(?:stale|no longer active|replaced|disposed|invalidated)/iu
            .test(error.message);
}
