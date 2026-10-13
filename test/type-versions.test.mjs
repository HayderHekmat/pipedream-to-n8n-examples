import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadNodeDefinition,
  validateWorkflow,
} from '../scripts/validate-workflows.mjs';

function minimalWorkflow(nodes) {
  return {
    name: 'Type version fixture',
    nodes,
    connections: {},
    settings: { executionOrder: 'v1' },
  };
}

function node(name, type, typeVersion) {
  return {
    id: name,
    name,
    type,
    typeVersion,
    position: [0, 0],
    parameters: {},
  };
}

describe('n8n-nodes-base typeVersions', () => {
  it('scheduleTrigger max is 1.3 (1.4 is not in the real version list)', () => {
    const def = loadNodeDefinition('n8n-nodes-base.scheduleTrigger');
    assert.ok(def, 'scheduleTrigger should load from n8n-nodes-base');
    assert.ok(def.supportedVersions.includes(1.3));
    assert.equal(def.supportedVersions.includes(1.4), false);
    assert.equal(Math.max(...def.supportedVersions), 1.3);
  });

  it('webhook max is 2.1 (2.2 is not in the real version list)', () => {
    const def = loadNodeDefinition('n8n-nodes-base.webhook');
    assert.ok(def, 'webhook should load from n8n-nodes-base');
    assert.ok(def.supportedVersions.includes(2.1));
    assert.equal(def.supportedVersions.includes(2.2), false);
    assert.equal(Math.max(...def.supportedVersions), 2.1);
  });

  it('rejects typeVersions that are not in the real node version list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'n8n-typeversion-'));
    const filePath = join(dir, 'workflow.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify(
          minimalWorkflow([
            node('Schedule', 'n8n-nodes-base.scheduleTrigger', 1.4),
            node('Hook', 'n8n-nodes-base.webhook', 2.2),
          ]),
        ),
      );

      const { errors } = await validateWorkflow(filePath);
      const scheduleError = errors.find((e) => e.includes('Schedule') && e.includes('1.4'));
      const webhookError = errors.find((e) => e.includes('Hook') && e.includes('2.2'));

      assert.ok(scheduleError, `expected scheduleTrigger 1.4 error, got: ${errors.join('; ')}`);
      assert.ok(webhookError, `expected webhook 2.2 error, got: ${errors.join('; ')}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts the published max versions for scheduleTrigger and webhook', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'n8n-typeversion-ok-'));
    const filePath = join(dir, 'workflow.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify(
          minimalWorkflow([
            node('Schedule', 'n8n-nodes-base.scheduleTrigger', 1.3),
            node('Hook', 'n8n-nodes-base.webhook', 2.1),
          ]),
        ),
      );

      const { errors } = await validateWorkflow(filePath);
      const versionErrors = errors.filter((e) => e.includes('unsupported typeVersion'));
      assert.deepEqual(versionErrors, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
