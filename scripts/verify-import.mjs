#!/usr/bin/env node

/**
 * n8n Workflow Import Verification Script
 *
 * Loads example workflow JSON files and verifies:
 * - Stripe example still has the expected nodes and connections
 * - Every example workflow's node types/typeVersions exist in n8n-nodes-base
 * - Connections reference existing nodes
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import { loadNodeDefinition } from './validate-workflows.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const STRIPE_WORKFLOW_PATH = './examples/stripe-payment-to-slack/n8n/workflow.json';

const EXPECTED_NODES = {
  'Stripe Trigger': { type: 'n8n-nodes-base.stripeTrigger', typeVersion: 1 },
  'Format Payment Data': { type: 'n8n-nodes-base.code', typeVersion: 2 },
  'Send to Slack': { type: 'n8n-nodes-base.slack', typeVersion: 2.4 },
};

const EXPECTED_CONNECTIONS = [
  { from: 'Stripe Trigger', to: 'Format Payment Data' },
  { from: 'Format Payment Data', to: 'Send to Slack' },
];

function hasConnection(workflow, from, to) {
  const connections = workflow.connections[from];
  if (!connections) return false;

  for (const buckets of Object.values(connections)) {
    for (const bucket of buckets) {
      if (!bucket || !Array.isArray(bucket)) continue;
      if (bucket.some((conn) => conn.node === to)) return true;
    }
  }
  return false;
}

async function verifyStripeStructure(workflow) {
  let errors = 0;
  const actualNodes = new Map(workflow.nodes.map((n) => [n.name, n]));

  console.log(`\n📦 Verifying ${Object.keys(EXPECTED_NODES).length} expected Stripe nodes...`);
  for (const [name, expected] of Object.entries(EXPECTED_NODES)) {
    const node = actualNodes.get(name);
    if (!node) {
      console.error(`❌ Missing node: "${name}"`);
      errors++;
      continue;
    }

    if (node.type !== expected.type) {
      console.error(`❌ Node "${name}" has wrong type: ${node.type} (expected ${expected.type})`);
      errors++;
    } else if (node.typeVersion !== expected.typeVersion) {
      console.error(
        `❌ Node "${name}" has wrong typeVersion: ${node.typeVersion} (expected ${expected.typeVersion})`,
      );
      errors++;
    } else {
      console.log(`✅ Node "${name}": ${expected.type} v${expected.typeVersion}`);
    }
  }

  console.log(`\n🔗 Verifying ${EXPECTED_CONNECTIONS.length} expected Stripe connections...`);
  for (const { from, to } of EXPECTED_CONNECTIONS) {
    if (hasConnection(workflow, from, to)) {
      console.log(`✅ Connection: "${from}" → "${to}"`);
    } else {
      console.error(`❌ Missing connection: "${from}" → "${to}"`);
      errors++;
    }
  }

  return errors;
}

function verifyAgainstNodePackage(workflow) {
  let errors = 0;
  const nodeNames = new Set(workflow.nodes.map((n) => n.name));

  for (const node of workflow.nodes) {
    const definition = loadNodeDefinition(node.type);
    if (!definition) {
      console.error(
        `❌ Node "${node.name}" has unknown type "${node.type}" in n8n-nodes-base@2.15.1`,
      );
      errors++;
      continue;
    }

    if (!definition.supportedVersions.includes(node.typeVersion)) {
      console.error(
        `❌ Node "${node.name}" typeVersion ${node.typeVersion} is not in the real version list ` +
          `[${definition.supportedVersions.join(', ')}] (default: ${definition.defaultVersion})`,
      );
      errors++;
    } else {
      console.log(`✅ Node "${node.name}" typeVersion ${node.typeVersion} is supported`);
    }
  }

  for (const [source, connectionTypes] of Object.entries(workflow.connections || {})) {
    if (!nodeNames.has(source)) {
      console.error(`❌ Connection source does not exist: "${source}"`);
      errors++;
    }
    for (const buckets of Object.values(connectionTypes || {})) {
      for (const bucket of buckets || []) {
        if (!bucket) continue;
        for (const conn of bucket) {
          if (conn.node && !nodeNames.has(conn.node)) {
            console.error(`❌ Connection target does not exist: "${conn.node}"`);
            errors++;
          }
        }
      }
    }
  }

  return errors;
}

async function main() {
  console.log('🧪 n8n Workflow Import Verification\n');

  const workflowFiles = await glob('examples/**/n8n/*.json', {
    cwd: rootDir,
    absolute: false,
  });

  if (workflowFiles.length === 0) {
    console.error('❌ No workflow files found');
    process.exit(1);
  }

  let totalErrors = 0;

  for (const file of workflowFiles) {
    const filePath = join(rootDir, file);
    console.log(`\n📄 ${file}`);

    let workflow;
    try {
      workflow = JSON.parse(await readFile(filePath, 'utf8'));
      console.log(`✅ Loaded workflow: "${workflow.name}"`);
    } catch (err) {
      console.error(`❌ Failed to load workflow: ${err.message}`);
      totalErrors++;
      continue;
    }

    if (file.replace(/\\/g, '/') === STRIPE_WORKFLOW_PATH.slice(2)) {
      totalErrors += await verifyStripeStructure(workflow);
    }

    console.log('\n🔍 Verifying against n8n-nodes-base@2.15.1...');
    totalErrors += verifyAgainstNodePackage(workflow);
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Verification Summary');
  console.log('='.repeat(60));
  console.log(`Workflows: ${workflowFiles.length}`);
  console.log(`Errors: ${totalErrors}`);

  if (totalErrors > 0) {
    console.log(`\n❌ Verification failed with ${totalErrors} error(s)`);
    process.exit(1);
  }

  console.log('\n✅ Workflows verified against n8n-nodes-base@2.15.1.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
