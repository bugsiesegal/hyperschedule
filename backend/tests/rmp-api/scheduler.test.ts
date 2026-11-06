import { describe, expect, jest, test } from "@jest/globals";
import {
    REFRESH_INTERVAL_MS,
    RETRY_DELAY_MS,
    runRatingsSchedulerOnce,
    type RatingsSchedulerDeps,
} from "../../src/rmp-api/scheduler";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-05T12:00:00Z");

function fakeDeps(
    refreshedAt: Date | null,
    overrides: Partial<RatingsSchedulerDeps> = {},
) {
    const refresh = jest.fn<RatingsSchedulerDeps["refresh"]>(() =>
        Promise.resolve(),
    );
    const setRefreshedAt = jest.fn<RatingsSchedulerDeps["setRefreshedAt"]>(() =>
        Promise.resolve(),
    );
    return {
        refresh,
        setRefreshedAt,
        getRefreshedAt: () => Promise.resolve(refreshedAt),
        now: () => NOW,
        ...overrides,
    };
}

describe("runRatingsSchedulerOnce", () => {
    test("refreshes right away if ratings were never refreshed", async () => {
        const deps = fakeDeps(null);
        expect(await runRatingsSchedulerOnce(deps)).toBe(REFRESH_INTERVAL_MS);
        expect(deps.refresh).toHaveBeenCalledTimes(1);
        expect(deps.setRefreshedAt).toHaveBeenCalledWith(NOW);
    });

    test("waits until a week after the last refresh", async () => {
        const deps = fakeDeps(new Date(NOW.getTime() - 2 * DAY));
        expect(await runRatingsSchedulerOnce(deps)).toBe(5 * DAY);
        expect(deps.refresh).not.toHaveBeenCalled();
        expect(deps.setRefreshedAt).not.toHaveBeenCalled();
    });

    test("refreshes once the last refresh is a week old", async () => {
        const deps = fakeDeps(new Date(NOW.getTime() - 7 * DAY));
        expect(await runRatingsSchedulerOnce(deps)).toBe(REFRESH_INTERVAL_MS);
        expect(deps.refresh).toHaveBeenCalledTimes(1);
    });

    test("tries again later without recording a failed refresh", async () => {
        const deps = fakeDeps(null, {
            refresh: () => Promise.reject(Error("down")),
        });
        expect(await runRatingsSchedulerOnce(deps)).toBe(RETRY_DELAY_MS);
        expect(deps.setRefreshedAt).not.toHaveBeenCalled();
    });

    test("never throws, even if the database fails", async () => {
        const deps = fakeDeps(null, {
            getRefreshedAt: () => Promise.reject(Error("no database")),
        });
        expect(await runRatingsSchedulerOnce(deps)).toBe(RETRY_DELAY_MS);
        expect(deps.refresh).not.toHaveBeenCalled();
    });
});
