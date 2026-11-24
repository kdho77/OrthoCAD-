export class TRPCError extends Error {
    constructor(opts = {}) {
        super(opts.message ?? "TRPCError");
        this.name = "TRPCError";
        this.code = opts.code;
    }
}
