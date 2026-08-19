export const DEFAULT_TELEGRAM_MAX_RUNS_PER_DAY = 10;

export type DailyRunCounter = {
  /** Consume one run; false when today's budget is spent. */
  tryConsume: () => boolean;
  /** Runs consumed so far today. */
  used: () => number;
};

export function utcDayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * In-memory daily run budget, keyed by UTC calendar day. Resets when the
 * day rolls over (and, implicitly, when the gateway restarts).
 */
export function createDailyRunCounter(params: {
  maxRunsPerDay: number;
  now?: () => number;
}): DailyRunCounter {
  const now = params.now ?? (() => Date.now());
  let day = utcDayKey(now());
  let count = 0;

  const rollover = () => {
    const today = utcDayKey(now());
    if (today !== day) {
      day = today;
      count = 0;
    }
  };

  return {
    tryConsume: () => {
      rollover();
      if (count >= params.maxRunsPerDay) {
        return false;
      }
      count += 1;
      return true;
    },
    used: () => {
      rollover();
      return count;
    },
  };
}
