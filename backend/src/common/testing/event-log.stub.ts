/** Test double for EventLogService: records every emitted event, runs guarded/tracked actions transparently. */
export function makeEventLogStub() {
  const emit = jest.fn().mockResolvedValue(undefined);
  return {
    emit,
    success: jest.fn().mockResolvedValue(undefined),
    warning: jest.fn().mockResolvedValue(undefined),
    partialSuccess: jest.fn().mockResolvedValue(undefined),
    failure: jest.fn().mockResolvedValue(undefined),
    guard: jest.fn(async (_spec: unknown, run: () => Promise<unknown>) => run()),
    track: jest.fn(
      async (_spec: unknown, run: () => Promise<unknown>, describe?: (r: unknown) => unknown) => {
        const result = await run();
        describe?.(result);
        return result;
      },
    ),
  };
}
