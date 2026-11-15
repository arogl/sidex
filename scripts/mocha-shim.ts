// Maps mocha's TDD interface onto bun:test so upstream VS Code unit tests run unchanged.
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'bun:test';

type Hook = (this: unknown) => unknown;
// bun:test does not expose the running test's outcome, so hooks that inspect
// `this.currentTest?.state` (VS Code's leak checker) always see a passing test.
const context = { currentTest: { state: 'passed' } };
const bind = (fn: Hook) => () => fn.call(context);

const g = globalThis as Record<string, unknown>;
g.suite = describe;
g.test = it;
g.setup = (fn: Hook) => beforeEach(bind(fn));
g.teardown = (fn: Hook) => afterEach(bind(fn));
g.suiteSetup = (fn: Hook) => beforeAll(bind(fn));
g.suiteTeardown = (fn: Hook) => afterAll(bind(fn));
