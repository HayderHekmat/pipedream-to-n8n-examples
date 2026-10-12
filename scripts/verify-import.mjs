#!/usr/bin/env node

/**
 * n8n Workflow Import Verification Script
 * 
 * Loads and validates workflow JSON files can be deserialized correctly
 * Verifies:
 * - All 3 nodes are present (Stripe Trigger, Code, Send to Slack)
 * - All 2 connections exist (Trigger → Code, Code → Slack)
 * - Node types and versions match real n8n-nodes-base definitions
 * - Connections reference existing nodes
 */

import { readFile } from 'fs/promises';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const WORKFLOW_PATH = './examples/stripe-payment-to-slack/n8n/workflow.json';

// Expected workflow structure
const EXPECTED_NODES = {
  'Stripe Trigger': { type: 'n8n-nodes-base.stripeTrigger', typeVersion: 1 },
  'Format Payment Data': { type: 'n8n-nodes-base.code', typeVersion: 2 },
  'Send to Slack': { type: 'n8n-nodes-base.slack', typeVersion: 2.4 },
};

const EXPECTED_CONNECTIONS = [
  { from: 'Stripe Trigger', to: 'Format Payment Data' },
  { from: 'Format Payment Data', to: 'Send to Slack' },
];

async function main() {
  console.log('🧪 n8n Workflow Import Verification\n');
  
  // Load workflow
  let workflow;
  try {
    const content = await readFile(WORKFLOW_PATH, 'utf-8');
    workflow = JSON.parse(content);
    console.log(`✅ Loaded workflow: "${workflow.name}"`);
  } catch (err) {
    console.error(`❌ Failed to load workflow: ${err.message}`);
    process.exit(1);
  }
  
  // Verify nodes
  console.log(`\n📦 Verifying ${Object.keys(EXPECTED_NODES).length} expected nodes...`);
  const actualNodes = new Map(workflow.nodes.map(n => [n.name, n]));
  
  let nodeErrors = 0;
  for (const [name, expected] of Object.entries(EXPECTED_NODES)) {
    const node = actualNodes.get(name);
    if (!node) {
      console.error(`❌ Missing node: "${name}"`);
      nodeErrors++;
      continue;
    }
    
    if (node.type !== expected.type) {
      console.error(`❌ Node "${name}" has wrong type: ${node.type} (expected ${expected.type})`);
      nodeErrors++;
    } else if (node.typeVersion !== expected.typeVersion) {
      console.error(`❌ Node "${name}" has wrong typeVersion: ${node.typeVersion} (expected ${expected.typeVersion})`);
      nodeErrors++;
    } else {
      console.log(`✅ Node "${name}": ${expected.type} v${expected.typeVersion}`);
    }
  }
  
  if (workflow.nodes.length !== Object.keys(EXPECTED_NODES).length) {
    console.warn(`⚠️  Workflow has ${workflow.nodes.length} nodes, expected ${Object.keys(EXPECTED_NODES).length}`);
  }
  
  // Verify connections
  console.log(`\n🔗 Verifying ${EXPECTED_CONNECTIONS.length} expected connections...`);
  let connectionErrors = 0;
  
  for (const { from, to } of EXPECTED_CONNECTIONS) {
    const connections = workflow.connections[from];
    if (!connections) {
      console.error(`❌ No connections from "${from}"`);
      connectionErrors++;
      continue;
    }
    
    // Check if any connection type (main, ai, etc.) has a connection to the target
    let found = false;
    for (const [connType, buckets] of Object.entries(connections)) {
      for (const bucket of buckets) {
        if (bucket && Array.isArray(bucket)) {
          for (const conn of bucket) {
            if (conn.node === to) {
              found = true;
              console.log(`✅ Connection: "${from}" → "${to}" (${connType})`);
              break;
            }
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    
    if (!found) {
      console.error(`❌ Missing connection: "${from}" → "${to}"`);
      connectionErrors++;
    }
  }
  
  // Verify against real node definitions
  console.log('\n🔍 Verifying against n8n-nodes-base@2.15.1...');
  let versionErrors = 0;
  
  for (const node of workflow.nodes) {
    try {
      // Load real node definition
      let NodeClass, nodePath;
      
      switch (node.type) {
        case 'n8n-nodes-base.slack':
          nodePath = 'n8n-nodes-base/dist/nodes/Slack/Slack.node.js';
          NodeClass = require(nodePath).Slack;
          break;
        case 'n8n-nodes-base.stripeTrigger':
          nodePath = 'n8n-nodes-base/dist/nodes/Stripe/StripeTrigger.node.js';
          NodeClass = require(nodePath).StripeTrigger;
          break;
        case 'n8n-nodes-base.code':
          nodePath = 'n8n-nodes-base/dist/nodes/Code/Code.node.js';
          NodeClass = require(nodePath).Code;
          break;
        default:
          console.warn(`⚠️  Unknown node type: ${node.type} (not verifying version)`);
          continue;
      }
      
      const instance = new NodeClass();
      const desc = instance.description;
      
      // Get supported versions
      let supportedVersions;
      if (instance.nodeVersions) {
        supportedVersions = Object.keys(instance.nodeVersions).map(v =>
          v.includes('.') ? parseFloat(v) : parseInt(v)
        );
      } else {
        supportedVersions = Array.isArray(desc.version) ? desc.version : [desc.version];
      }
      
      if (!supportedVersions.includes(node.typeVersion)) {
        console.error(
          `❌ Node "${node.name}" typeVersion ${node.typeVersion} not supported. ` +
          `Supported: [${supportedVersions.join(', ')}]`
        );
        versionErrors++;
      } else {
        console.log(`✅ Node "${node.name}" typeVersion ${node.typeVersion} is supported`);
      }
    } catch (err) {
      console.error(`❌ Failed to verify "${node.name}": ${err.message}`);
      versionErrors++;
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Verification Summary');
  console.log('='.repeat(60));
  console.log(`Nodes: ${workflow.nodes.length} found, ${Object.keys(EXPECTED_NODES).length} expected`);
  console.log(`Node errors: ${nodeErrors}`);
  console.log(`Connections: ${EXPECTED_CONNECTIONS.length} verified`);
  console.log(`Connection errors: ${connectionErrors}`);
  console.log(`Version errors: ${versionErrors}`);
  
  const totalErrors = nodeErrors + connectionErrors + versionErrors;
  if (totalErrors > 0) {
    console.log(`\n❌ Verification failed with ${totalErrors} error(s)`);
    process.exit(1);
  } else {
    console.log('\n✅ Workflow verified! All nodes and connections are correct.');
    console.log('\nThis workflow can be imported into n8n successfully.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
