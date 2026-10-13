import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_PATH = join(rootDir, 'examples/signed-webhook-to-sheets/n8n/workflow.json');

// Test-only dummy. Never stored in the workflow JSON (secret lives in a Crypto credential).
const DUMMY_SECRET = 'test-only-dummy-webhook-secret';
const RAW_BODY = Buffer.from(
  '{"ref":"refs/heads/main","after":"7fd1a60b01f91b314f59955a4e4d4e80d8edf11d"}',
  'utf8',
);

function githubSignature(secret, rawBody) {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/**
 * Mirrors n8n-nodes-base Crypto v2 HMAC of webhook binary.data
 * (createHmac(type, hmacSecret).update(Buffer.from(binary.data, 'base64')).digest(encoding)).
 */
function cryptoNodeHmacHex(rawBody, secret) {
  return createHmac('SHA256', secret).update(rawBody).digest('hex');
}

/** Mirrors the Check Signature If node: 'sha256=' + $json.hmac === header */
function ifNodeAccepts(hmacHex, header) {
  return `sha256=${hmacHex}` === header;
}

async function loadWorkflow() {
  return JSON.parse(await readFile(WORKFLOW_PATH, 'utf8'));
}

describe('GitHub webhook HMAC (Crypto node over raw body bytes)', () => {
  it('configures Crypto v2 to HMAC binary.data, not parsed json.body', async () => {
    const workflow = await loadWorkflow();
    const cryptoNode = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.crypto');
    assert.ok(cryptoNode, 'HMAC SHA256 Crypto node must exist');
    assert.equal(cryptoNode.typeVersion, 2);
    assert.equal(cryptoNode.parameters.action, 'hmac');
    assert.equal(cryptoNode.parameters.binaryData, true);
    assert.equal(cryptoNode.parameters.binaryPropertyName, 'data');
    assert.equal(cryptoNode.parameters.type, 'SHA256');
    assert.equal(cryptoNode.parameters.encoding, 'hex');
    assert.equal(cryptoNode.parameters.dataPropertyName, 'hmac');
    assert.equal(cryptoNode.parameters.value, undefined);
  });

  it('keeps the HMAC secret out of the workflow JSON (enter it on the Crypto credential)', async () => {
    const raw = await readFile(WORKFLOW_PATH, 'utf8');
    assert.equal(raw.includes('your-secret-here'), false);
    assert.equal(raw.includes(DUMMY_SECRET), false);
    assert.equal(raw.includes('hmacSecret'), false);
    assert.equal(raw.includes('GITHUB_WEBHOOK_SECRET'), false);

    const workflow = JSON.parse(raw);
    const cryptoNode = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.crypto');
    assert.equal(cryptoNode.credentials?.crypto?.id, null);
    assert.equal(cryptoNode.credentials?.crypto?.name, 'GitHub Webhook HMAC');
  });

  it('does not require() crypto in any Code node (task runners disallow the builtin)', async () => {
    const workflow = await loadWorkflow();
    for (const node of workflow.nodes) {
      const jsCode = node.parameters?.jsCode;
      if (typeof jsCode !== 'string') continue;
      assert.equal(
        /require\s*\(\s*['"]crypto['"]\s*\)/.test(jsCode),
        false,
        `${node.name} must not require('crypto')`,
      );
    }
  });

  it('accepts a valid signature computed over the raw body bytes', () => {
    const signature = githubSignature(DUMMY_SECRET, RAW_BODY);
    const hmacHex = cryptoNodeHmacHex(RAW_BODY, DUMMY_SECRET);
    // Crypto node type "SHA256" must match GitHub's sha256 digest.
    assert.equal(hmacHex, createHmac('sha256', DUMMY_SECRET).update(RAW_BODY).digest('hex'));
    assert.equal(ifNodeAccepts(hmacHex, signature), true);
  });

  it('rejects a tampered body that keeps the original signature', () => {
    const signature = githubSignature(DUMMY_SECRET, RAW_BODY);
    const tampered = Buffer.concat([RAW_BODY, Buffer.from('x')]);
    const hmacHex = cryptoNodeHmacHex(tampered, DUMMY_SECRET);
    assert.equal(ifNodeAccepts(hmacHex, signature), false);
  });

  it('does not treat parsed json.body as the HMAC input', () => {
    const signature = githubSignature(DUMMY_SECRET, RAW_BODY);
    const parsedAsString = JSON.stringify({ tampered: true, thisMustNotBeHashed: true });
    const wrongHex = cryptoNodeHmacHex(Buffer.from(parsedAsString, 'utf8'), DUMMY_SECRET);
    const rightHex = cryptoNodeHmacHex(RAW_BODY, DUMMY_SECRET);
    assert.equal(ifNodeAccepts(wrongHex, signature), false);
    assert.equal(ifNodeAccepts(rightHex, signature), true);
  });
});
