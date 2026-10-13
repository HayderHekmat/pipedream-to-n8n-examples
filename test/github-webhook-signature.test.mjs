import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_PATH = join(rootDir, 'examples/signed-webhook-to-sheets/n8n/workflow.json');

// Test-only dummy. Never used in the workflow JSON (fail closed, no fallback).
const DUMMY_SECRET = 'test-only-dummy-webhook-secret';
const RAW_BODY = Buffer.from(
  '{"ref":"refs/heads/main","after":"7fd1a60b01f91b314f59955a4e4d4e80d8edf11d"}',
  'utf8',
);

function githubSignature(secret, rawBody) {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

async function getVerifyJsCode() {
  const workflow = JSON.parse(await readFile(WORKFLOW_PATH, 'utf8'));
  const node = workflow.nodes.find((n) => n.name === 'Verify Signature');
  assert.ok(node, 'Verify Signature node must exist');
  assert.equal(typeof node.parameters.jsCode, 'string');
  return node.parameters.jsCode;
}

function runVerifyCode(jsCode, item, env) {
  const $input = {
    first: () => item,
    all: () => [item],
  };
  const fn = new Function('require', '$input', '$env', jsCode);
  return fn(require, $input, env);
}

function webhookItem({ rawBody, signature, jsonBody }) {
  return {
    json: {
      headers: {
        'x-hub-signature-256': signature,
        'x-github-event': 'push',
        'x-github-delivery': '72d3162e-cc78-11e3-81ab-4c9367dc0958',
        'content-type': 'application/json',
      },
      body: jsonBody,
    },
    binary: {
      data: {
        data: rawBody.toString('base64'),
        mimeType: 'application/json',
      },
    },
  };
}

describe('GitHub webhook HMAC (raw body bytes)', () => {
  it('accepts a valid signature computed over the raw body bytes', async () => {
    const jsCode = await getVerifyJsCode();
    const signature = githubSignature(DUMMY_SECRET, RAW_BODY);
    const result = runVerifyCode(
      jsCode,
      webhookItem({
        rawBody: RAW_BODY,
        signature,
        // Deliberately different from the raw bytes so HMAC-over-json.body would fail.
        jsonBody: { tampered: true, thisMustNotBeHashed: true },
      }),
      { GITHUB_WEBHOOK_SECRET: DUMMY_SECRET },
    );

    assert.equal(result[0].json.verified, true);
  });

  it('rejects a tampered body that keeps the original signature', async () => {
    const jsCode = await getVerifyJsCode();
    const signature = githubSignature(DUMMY_SECRET, RAW_BODY);
    const tampered = Buffer.concat([RAW_BODY, Buffer.from('x')]);
    const result = runVerifyCode(
      jsCode,
      webhookItem({
        rawBody: tampered,
        signature,
        jsonBody: JSON.parse(RAW_BODY.toString('utf8')),
      }),
      { GITHUB_WEBHOOK_SECRET: DUMMY_SECRET },
    );

    assert.equal(result[0].json.verified, false);
  });

  it('fails closed when the secret is missing (no placeholder fallback)', async () => {
    const jsCode = await getVerifyJsCode();
    const signature = githubSignature(DUMMY_SECRET, RAW_BODY);
    const result = runVerifyCode(
      jsCode,
      webhookItem({
        rawBody: RAW_BODY,
        signature,
        jsonBody: JSON.parse(RAW_BODY.toString('utf8')),
      }),
      {},
    );

    assert.equal(result[0].json.verified, false);
    assert.match(result[0].json.error, /GITHUB_WEBHOOK_SECRET/);
    assert.equal(jsCode.includes('your-secret-here'), false);
  });
});
