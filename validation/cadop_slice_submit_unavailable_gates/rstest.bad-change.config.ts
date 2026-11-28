import { resolve } from "node:path";
import base from "../../rstest.config.ts";

export default {
    ...base,
    include: ["validation/cadop_slice_submit_unavailable_gates/bad-change-proof.test.ts"],
};
