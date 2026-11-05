/**
 * This file is used to refresh instructor ratings from Rate My Professors. This
 * is not part of the fetcher on purpose, and it should only be run by hand. See
 * the comment in rmp-api/fetcher.ts before running it.
 */

import { createLogger } from "./logger";
import { DB_URL } from "./db/credentials";
import { connectToDb, closeDb } from "./db/connector";
import {
    getAllInstructorNames,
    updateInstructorRatings,
} from "./db/models/instructor-rating";
import { fetchAllTeachers } from "./rmp-api/fetcher";
import { matchInstructors } from "./rmp-api/matcher";

const logger = createLogger("fetch-ratings");

await connectToDb(DB_URL);

// checked first so that we don't bother their server if there's nothing to match
const names = await getAllInstructorNames();
if (names.length === 0)
    throw Error("No instructors in the database, load some sections first");

const teachers = await fetchAllTeachers();
const ratings = matchInstructors(names, teachers);
logger.info(
    "Matched %d of %d instructors using %d Rate My Professors entries",
    ratings.length,
    names.length,
    teachers.length,
);
await updateInstructorRatings(ratings);

await closeDb();
