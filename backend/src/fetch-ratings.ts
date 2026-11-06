/**
 * This file is used to refresh instructor ratings from Rate My Professors. This
 * is not part of the fetcher on purpose, and it should only be run by hand. See
 * the comment in rmp-api/fetcher.ts before running it.
 *
 * It sends one request per instructor we have a match for, a second apart, so a
 * full run takes a while (around 20 to 30 minutes).
 */

import { setTimeout } from "node:timers/promises";
import { createLogger } from "./logger";
import { DB_URL } from "./db/credentials";
import { connectToDb, closeDb } from "./db/connector";
import {
    getAllInstructorNames,
    getCoursesByInstructor,
    updateCourseRatings,
    updateInstructorRatings,
} from "./db/models/instructor-rating";
import {
    fetchAllTeachers,
    fetchTeacherReviews,
    schoolOfRmpId,
    type RmpReview,
} from "./rmp-api/fetcher";
import { matchInstructors } from "./rmp-api/matcher";
import { computeClassRatings } from "./rmp-api/classes";

const logger = createLogger("fetch-ratings");

await connectToDb(DB_URL);

// checked first so that we don't bother their server if there's nothing to match
const names = await getAllInstructorNames();
if (names.length === 0)
    throw Error("No instructors in the database, load some sections first");

const teachers = await fetchAllTeachers();
const matched = matchInstructors(names, teachers);
logger.info(
    "Matched %d of %d instructors using %d Rate My Professors entries",
    matched.length,
    names.length,
    teachers.length,
);

// the reviews are only needed to tell which class each one is for, so we only
// get them for instructors that we matched, and only once for each of them
const schools = new Map(teachers.map((t) => [t.legacyId, t.school.legacyId]));
const rmpIds = [...new Set(matched.map((r) => r.rmpId))];
const reviews = new Map<number, readonly RmpReview[]>();
for (const [i, rmpId] of rmpIds.entries()) {
    let result: RmpReview[] | null;
    try {
        result = await fetchTeacherReviews(rmpId);
    } catch (e) {
        // one retry for anything temporary, then we give up without writing
        // anything, so the ratings we already have stay as they are
        logger.warn("Retrying reviews of %d after an error: %s", rmpId, e);
        await setTimeout(60_000);
        result = await fetchTeacherReviews(rmpId);
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

await closeDb();
