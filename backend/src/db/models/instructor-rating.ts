import { collections } from "../collections";
import type * as APIv4 from "hyperschedule-shared/api/v4";

import { createLogger } from "../../logger";

const logger = createLogger("db.instructorRating");

/**
 * Replaces all existing instructor ratings with the new ratings. An empty list
 * is much more likely to mean that something is wrong with the data source than
 * that nobody has a rating anymore, so we refuse to wipe the existing ratings.
 */
export async function updateInstructorRatings(
    ratings: APIv4.InstructorRating[],
): Promise<void> {
    if (ratings.length === 0)
        throw Error("Refusing to replace instructor ratings with nothing");

    logger.info(`Writing ${ratings.length} instructor ratings`);
    const bulk = collections.instructorRatings.initializeUnorderedBulkOp();
    for (const { name, ...rating } of ratings) {
        bulk.find({ _id: name })
            .upsert()
            .replaceOne({ _id: name, ...rating });
    }
    bulk.find({ _id: { $nin: ratings.map((r) => r.name) } }).delete();
    const result = await bulk.execute();
    if (!result.isOk()) {
        logger.error(result);
        throw Error("Database operation failed");
    }
}

export async function getAllInstructorRatings(): Promise<
    APIv4.InstructorRating[]
> {
    const ratings = await collections.instructorRatings.find().toArray();
    return ratings.map(({ _id, ...rating }) => ({ name: _id, ...rating }));
}

/**
 * The name of every instructor who has ever taught a section we know about
 */
export function getAllInstructorNames(): Promise<string[]> {
    return collections.sections.distinct("instructors.name");
}
