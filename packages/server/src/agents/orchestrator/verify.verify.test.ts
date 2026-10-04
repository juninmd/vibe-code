import { describe, expect, test, mock, afterEach } from "bun:test";
import { verifyWorktree, verifyWorktreeParallel } from "./verify";
import * as VerifyModule from "./verify";

// Keep it simple without global mock side effects
// we will just use the normal mock inside the test block
