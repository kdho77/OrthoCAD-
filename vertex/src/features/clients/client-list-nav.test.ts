// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { CLIENT_LIST_PATH } from "./client-list-nav";

describe("client list navigation", () => {
    test("CLIENT_LIST_PATH is the post-login directory route", () => {
        expect(CLIENT_LIST_PATH).toBe("/clients");
    });
});
