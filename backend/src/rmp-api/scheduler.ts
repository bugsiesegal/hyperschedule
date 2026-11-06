import { setTimeout } from "node:timers/promises";
import { createLogger } from "../logger";
import {
    getRatingsRefreshedAt,
    setRatingsRefreshedAt,
} from "../db/models/instructor-rating";
import { refreshRatings } from "./refresh";

const logger = createLogger("rmp.scheduler");

const HOUR = 60 * 60 * 1000;

// reviews come in slowly, so there's no point in asking for them more often
export const REFRESH_INTERVAL_MS = 7 * 24 * HOUR;
// after a failed refresh, e.g. if Rate My Professors is down
export const RETRY_DELAY_MS = 6 * HOUR;

export type RatingsSchedulerDeps = {
    refresh: () => Promise<void>;
    getRefreshedAt: () => Promise<Date | null>;
    setRefreshedAt: (date: Date) => Promise<void>;
    now: () => Date;
};

const defaultDeps: RatingsSchedulerDeps = {
    refresh: () => refreshRatings(),
    getRefreshedAt: getRatingsRefreshedAt,
    setRefreshedAt: setRatingsRefreshedAt,
    now: () => new Date(),
};

/**
 * Refreshes the ratings if the last refresh was long enough ago, and returns how
 * long to wait before calling this again. This never throws, since a problem
 * with ratings shouldn't stop the fetcher from updating course data.
 *
 * The time of the last refresh is kept in the database rather than in memory,
 * so restarting or redeploying the fetcher doesn't start a new one each time.
 */
export async function runRatingsSchedulerOnce(
    deps: RatingsSchedulerDeps = defaultDeps,
): Promise<number> {
    try {
        const refreshedAt = await deps.getRefreshedAt();
        if (refreshedAt !== null) {
            const wait =
                refreshedAt.getTime() +
                REFRESH_INTERVAL_MS -
                deps.now().getTime();
            if (wait > 0) return wait;
        }

        logger.info("Refreshing instructor ratings from Rate My Professors");
        await deps.refresh();
        await deps.setRefreshedAt(deps.now());
        logger.info("Instructor ratings refreshed");
        return REFRESH_INTERVAL_MS;
    } catch (e) {
        logger.error(
            "Failed to refresh instructor ratings, trying again later",
        );
        logger.error(e);
        return RETRY_DELAY_MS;
    }
}

/**
 * Keeps the instructor ratings up to date for as long as the process runs. This
 * runs as part of the fetcher rather than the server, so only one process ever
 * refreshes them, and running just the server, as in development, never
 * contacts Rate My Professors.
 */
export async function runRatingsScheduler(): Promise<void> {
    logger.info("Starting instructor ratings scheduler");
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
    while (true) {
        const wait = await runRatingsSchedulerOnce();
        logger.info(
            "Next instructor ratings check in %d hours",
            Math.round(wait / HOUR),
        );
        await setTimeout(wait);
    }
}
