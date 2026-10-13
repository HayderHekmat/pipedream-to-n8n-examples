import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadNodeDefinition,
  validateWorkflow,
  NODE_PACKAGES,
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

      const { errors } = await validateWorkflow(filePath, { quiet: true });
      const scheduleError = errors.find((e) => e.includes('Schedule') && e.includes('1.4'));
      const webhookError = errors.find((e) => e.includes('Hook') && e.includes('2.2'));

      assert.ok(scheduleError, `expected scheduleTrigger 1.4 error, got: ${errors.join('; ')}`);
      assert.ok(webhookError, `expected webhook 2.2 error, got: ${errors.join('; ')}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('crypto in 2.4.5 is version 1 only; 2.15.1 adds v2', () => {
    const v245 = loadNodeDefinition('n8n-nodes-base.crypto', '2.4.5');
    const v215 = loadNodeDefinition('n8n-nodes-base.crypto', '2.15.1');
    assert.ok(v245, 'crypto should load from n8n-nodes-base@2.4.5');
    assert.ok(v215, 'crypto should load from n8n-nodes-base@2.15.1');
    assert.deepEqual(v245.supportedVersions, [1]);
    assert.ok(v215.supportedVersions.includes(1));
    assert.ok(v215.supportedVersions.includes(2));
    assert.equal(v215.defaultVersion, 2);
  });

  it('rejects Crypto typeVersion 2 because 2.4.5 does not have it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'n8n-crypto-v2-'));
    const filePath = join(dir, 'workflow.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify(minimalWorkflow([node('HMAC SHA256', 'n8n-nodes-base.crypto', 2)])),
      );
      const { errors } = await validateWorkflow(filePath, { quiet: true });
      const against245 = errors.find(
        (e) => e.includes('HMAC SHA256') && e.includes('2.4.5') && e.includes('typeVersion 2'),
      );
      assert.ok(against245, `expected crypto v2 rejected on 2.4.5, got: ${errors.join('; ')}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts Crypto typeVersion 1 on both 2.4.5 and 2.15.1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'n8n-crypto-v1-'));
    const filePath = join(dir, 'workflow.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify(minimalWorkflow([node('HMAC SHA256', 'n8n-nodes-base.crypto', 1)])),
      );
      const { errors } = await validateWorkflow(filePath, { quiet: true });
      const versionErrors = errors.filter((e) => e.includes('unsupported typeVersion'));
      assert.deepEqual(versionErrors, []);
      for (const pkg of NODE_PACKAGES) {
        const def = loadNodeDefinition('n8n-nodes-base.crypto', pkg.version);
        assert.ok(def.supportedVersions.includes(1), `${pkg.version} must include crypto v1`);
      }
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

      const { errors } = await validateWorkflow(filePath, { quiet: true });
      const versionErrors = errors.filter((e) => e.includes('unsupported typeVersion'));
      assert.deepEqual(versionErrors, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
