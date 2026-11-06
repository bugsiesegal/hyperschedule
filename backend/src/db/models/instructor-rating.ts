import { collections } from "../collections";
import type { Collection, Document } from "mongodb";
import type * as APIv4 from "hyperschedule-shared/api/v4";

import { createLogger } from "../../logger";

const logger = createLogger("db.instructorRating");

/**
 * Replaces every document in the collection with these. An empty list is much
 * more likely to mean that something is wrong with the data source than that
 * nobody has a rating anymore, so we refuse to wipe the existing ratings.
 */
async function replaceAll<T extends Document & { _id: string }>(
    collection: Collection<T>,
    docs: T[],
    what: string,
): Promise<void> {
    if (docs.length === 0)
        throw Error(`Refusing to replace ${what} with nothing`);

    logger.info(`Writing ${docs.length} ${what}`);
    const bulk = collection.initializeUnorderedBulkOp();
    for (const doc of docs)
        bulk.find({ _id: doc._id }).upsert().replaceOne(doc);
    bulk.find({ _id: { $nin: docs.map((d) => d._id) } }).delete();
    const result = await bulk.execute();
    if (!result.isOk()) {
        logger.error(result);
        throw Error("Database operation failed");
    }
}

export function updateInstructorRatings(
    ratings: APIv4.InstructorRating[],
): Promise<void> {
    return replaceAll(
        collections.instructorRatings,
        ratings.map(({ name, ...rating }) => ({ _id: name, ...rating })),
        "instructor ratings",
    );
}

export function updateCourseRatings(
    ratings: APIv4.CourseRating[],
): Promise<void> {
    return replaceAll(
        collections.courseRatings,
        ratings.map(({ course, ...rating }) => ({ _id: course, ...rating })),
        "course ratings",
    );
}

export async function getAllInstructorRatings(): Promise<
    APIv4.InstructorRating[]
> {
    const ratings = await collections.instructorRatings.find().toArray();
    return ratings.map(({ _id, ...rating }) => ({
        name: _id,
        ...rating,
        classes: rating.classes ?? [],
    }));
}

/**
 * The name of every instructor who has ever taught a section we know about
 */
export function getAllInstructorNames(): Promise<string[]> {
    return collections.sections.distinct("instructors.name") as Promise<
        string[]
    >;
}

export async function getAllCourseRatings(): Promise<APIv4.CourseRating[]> {
    const ratings = await collections.courseRatings.find().toArray();
    return ratings.map(({ _id, ...rating }) => ({ course: _id, ...rating }));
}

/**
 * Every course each instructor has taught in any term we know about, keyed by
 * their name without leading or trailing whitespace
 */
export async function getCoursesByInstructor(): Promise<
    Map<string, APIv4.CourseCode[]>
> {
    const rows = await collections.sections
        .aggregate<{ _id: string; courses: APIv4.CourseCode[] }>([
            { $unwind: "$instructors" },
            {
                $group: {
                    _id: { $trim: { input: "$instructors.name" } },
                    courses: {
                        $addToSet: {
                            department: "$_id.department",
                            courseNumber: "$_id.courseNumber",
                            suffix: "$_id.suffix",
                            affiliation: "$_id.affiliation",
                        },
                    },
                },
            },
        ])
        .toArray();
    return new Map(rows.map((r) => [r._id, r.courses]));
}
