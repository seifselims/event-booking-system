import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "./db/index";
import * as schema from "./db/schema";

export const auth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    user: {
        additionalFields: {
            role: {
                type: ["organizer", "admin"],
                required: false,
                defaultValue: "organizer",
                input: false,
            },
        },
    },
});
