import type * as APIv4 from "hyperschedule-shared/api/v4";
import { connector } from "./connector";
import type { Collection } from "mongodb";

export type DBSection = Omit<APIv4.Section, "identifier"> & {
    _id: APIv4.SectionIdentifier;
};

export type DBInstructorRating = Omit<APIv4.InstructorRating, "name"> & {
    _id: string;
};

export interface DBCollections {
    users: Collection<APIv4.ServerUser>;
    sections: Collection<DBSection>;
    instructorRatings: Collection<DBInstructorRating>;
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
});

export const collections = obj as DBCollections;
