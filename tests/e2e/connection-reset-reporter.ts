import {createHash, randomUUID} from 'node:crypto';
import {writeSync} from 'node:fs';
import {basename} from 'node:path';
import {threadId} from 'node:worker_threads';
import type {FullConfig, Reporter, Suite, TestCase, TestResult} from '@playwright/test/reporter';

type Identity = {file: string; line: number; titlePathSha256: string};
const enabled = process.env.CI === 'true' && process.env.NEXUS_E2E_CONNECTION_RESET_OBSERVE === '1';
const mainIdentity = 'e8cf337398d6df54a2b01ca88d809536e6a9a1bcf2a4855ffd8bcde293b1b56a';
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export default class ConnectionResetReporter implements Reporter {
  private identities = new WeakMap<TestCase, Identity>();
  private readonly reporterInstanceId = enabled ? randomUUID() : null;
  private readonly startedAt = enabled ? new Date().toISOString() : null;
  private written = 0;
  private dropped = 0;

  private record(row: object, summary = false) {
    if (!enabled || this.written >= (summary ? 510 : 509)) { if (enabled) this.dropped++; return; }
    this.written++;
    try {
      const line = 'NEXUS_E2E_TEST ' + JSON.stringify({at: new Date().toISOString(), pid: process.pid, threadId, reporterInstanceId: this.reporterInstanceId, startedAt: this.startedAt, ...row}) + '\n';
      if (Buffer.byteLength(line) > 1024 || writeSync(2, line) !== Buffer.byteLength(line)) this.dropped++;
    } catch { this.dropped++; }
  }

  onBegin(_config: FullConfig, suite: Suite) {
    if (!enabled) return;
    const tests = suite.allTests();
    const identitySha256 = sha(tests.map(test => [basename(test.location.file), test.title, test.parent.project()?.name ?? '']).sort());
    const knownCollection = tests.length === 253 && identitySha256 === mainIdentity;
    this.record({kind: 'collection', count: tests.length, identitySha256, knownCollection});
    if (!knownCollection) return; // Record a coverage limit; never alter test execution.
    for (const test of tests) this.identities.set(test, {file: basename(test.location.file), line: test.location.line, titlePathSha256: sha(test.titlePath())});
  }

  onTestBegin(test: TestCase, result: TestResult) {
    const identity = this.identities.get(test);
    if (identity) this.record({kind: 'test_begin', ...identity, workerIndex: result.workerIndex});
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const identity = this.identities.get(test);
    if (identity) this.record({kind: 'test_end', ...identity, workerIndex: result.workerIndex,
      status: ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(result.status) ? result.status : 'other'});
  }

  onEnd() { this.record({kind: 'reporter_summary', written: this.written, dropped: this.dropped}, true); }
  printsToStdio() { return false; }
}
