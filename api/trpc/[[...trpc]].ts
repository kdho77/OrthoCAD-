// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Repo-root entry for Vercel when the project Root Directory is the monorepo root
// (not vertex/). vertex/api/trpc covers the vertex/ root-directory deployment.
export { default, config } from "../../vertex/api/trpc/vercel-entry";
