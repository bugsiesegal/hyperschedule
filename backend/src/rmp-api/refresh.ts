import { setTimeout } from "node:timers/promises";
import { createLogger } from "../logger";
import {
    getAllInstructorNames,
    getCoursesByInstructor,
    updateCourseRatings,
    updateInstructorRatings,
} from "../db/models/instructor-rating";
import {
    fetchAllTeachers,
    fetchTeacherReviews,
    schoolOfRmpId,
    type RmpReview,
} from "./fetcher";
import { matchInstructors } from "./matcher";
import { computeClassRatings } from "./classes";

const logger = createLogger("rmp.refresh");

export type RefreshOptions = {
    // between requests to Rate My Professors
    delayMs?: number;
    // before trying an instructor's reviews again after an error
    retryDelayMs?: number;
};

/**
 * Replaces every instructor and course rating with fresh ones from Rate My
 * Professors. This sends one request a second, so it takes around 20 to 30
 * minutes. If anything goes wrong it throws without writing anything, so the
 * ratings we already have stay as they are.
 *
 * Per-course scores only work for courses we know an instructor has taught, so
 * this needs every past term in the database to get them all.
 */
export async function refreshRatings(
    options: RefreshOptions = {},
): Promise<void> {
    const { delayMs = 1000, retryDelayMs = 60_000 } = options;

    // checked first so that we don't bother their server if there's nothing to match
    const names = await getAllInstructorNames();
    if (names.length === 0)
        throw Error("No instructors in the database, load some sections first");

    const teachers = await fetchAllTeachers(delayMs);
    const matched = matchInstructors(names, teachers);
    logger.info(
        "Matched %d of %d instructors using %d Rate My Professors entries",
        matched.length,
        names.length,
        teachers.length,
    );

    // the reviews are only needed to tell which class each one is for, so we
    // only get them for instructors that we matched, and only once for each
    const schools = new Map(
        teachers.map((t) => [t.legacyId, t.school.legacyId]),
    );
    const rmpIds = [...new Set(matched.map((r) => r.rmpId))];
    const reviews = new Map<number, readonly RmpReview[]>();
    for (const [i, rmpId] of rmpIds.entries()) {
        let result: RmpReview[] | null;
        try {
            result = await fetchTeacherReviews(rmpId, delayMs);
        } catch (e) {
            // one retry for anything temporary, then we give up on this run
            logger.warn("Retrying reviews of %d after an error: %s", rmpId, e);
            await setTimeout(retryDelayMs);
            result = await fetchTeacherReviews(rmpId, delayMs);
        }
        if (result !== null) reviews.set(rmpId, result);
        if ((i + 1) % 50 === 0)
            logger.info("Fetched reviews of %d of %d", i + 1, rmpIds.length);
    }

    const { classes, courses } = computeClassRatings(
        matched.map((r) => ({
            name: r.name,
            school: schoolOfRmpId(schools.get(r.rmpId)!),
            reviews: reviews.get(r.rmpId) ?? [],
        })),
        await getCoursesByInstructor(),
    );
    logger.info(
        "Found class ratings for %d instructors and %d courses",
        [...classes.values()].filter((c) => c.length > 0).length,
        courses.length,
    );

    // checked before writing anything, so that both stay in step with each other
    if (courses.length === 0)
        throw Error("Couldn't tell which class any review is for, not saving");

    await updateInstructorRatings(
        matched.map((r) => ({ ...r, classes: classes.get(r.name) ?? [] })),
    );
    await updateCourseRatings(courses);
}
