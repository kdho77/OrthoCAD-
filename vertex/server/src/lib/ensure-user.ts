// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PrismaClient, Role } from "@prisma/client";

const VALID_ROLES: readonly string[] = ["super_admin", "admin", "clinician"];

/**
 * Mirror a Supabase-authenticated user into the app `users` table so foreign keys
 * (token grants, audit logs, exports, etc.) resolve on first authenticated request.
 */
export async function ensureAppUser(
    prisma: PrismaClient,
    user: { id: string; email: string; role: string },
): Promise<void> {
    const role = (VALID_ROLES.includes(user.role) ? user.role : "clinician") as Role;
    const email = user.email.trim() || `${user.id}@placeholder.invalid`;
    await prisma.user.upsert({
        where: { id: user.id },
        update: {},
        create: { id: user.id, email, role },
    });
}
