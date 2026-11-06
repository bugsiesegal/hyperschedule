import type * as APIv4 from "hyperschedule-shared/api/v4";
import { connector } from "./connector";
import type { Collection } from "mongodb";

export type DBSection = Omit<APIv4.Section, "identifier"> & {
    _id: APIv4.SectionIdentifier;
};

export type DBInstructorRating = Omit<
    APIv4.InstructorRating,
    "name" | "classes"
> & {
    _id: string;
    // missing from ratings saved before class scores existed
    classes?: APIv4.InstructorClassRating[];
};

export type DBCourseRating = Omit<APIv4.CourseRating, "course"> & {
    _id: string;
};

// when a scheduled job last finished successfully, keyed by the job's name
export type DBJob = {
    _id: string;
    lastSuccess: Date;
};

export interface DBCollections {
    users: Collection<APIv4.ServerUser>;
    sections: Collection<DBSection>;
    instructorRatings: Collection<DBInstructorRating>;
    courseRatings: Collection<DBCourseRating>;
    jobs: Collection<DBJob>;
}

/* we use getters to defer the collection initialization to the first
 * time we access the properies, which hopefully happens after a db
 * connection is already established at runtime.
 *
 * sorry kye i know you don't like oop
 */
let obj = {};
Object.defineProperties(obj, {
    users: {
        get(): Collection<APIv4.User> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<APIv4.User>("users");
        },
    },
    sections: {
        get(): Collection<APIv4.Section> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<APIv4.Section>("sections");
        },
    },
    instructorRatings: {
        get(): Collection<DBInstructorRating> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<DBInstructorRating>(
                "instructorRatings",
            );
        },
    },
    courseRatings: {
        get(): Collection<DBCourseRating> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<DBCourseRating>("courseRatings");
        },
    },
    jobs: {
        get(): Collection<DBJob> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<DBJob>("jobs");
        },
    },
});

export const collections = obj as DBCollections;
