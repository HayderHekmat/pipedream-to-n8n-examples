#!/usr/bin/env node

/**
 * n8n Workflow Validation Script
 * 
 * Validates n8n workflow JSON files against real n8n node definitions
 * Checks:
 * - Valid JSON syntax
 * - Required top-level keys (name, nodes, connections, settings)
 * - Node structure (id, name, type, typeVersion, position, parameters)
 * - Node types and versions exist in actual n8n-nodes-base package
 * - Connection references (must reference existing node names)
 * - No duplicate node names
 * - No credentials or secrets in workflow files
 */

import { readFile } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { glob } from 'glob';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const NODES_BASE_PKG = require('n8n-nodes-base/package.json');
const EXPECTED_NODES_BASE_VERSION = '2.15.1';
if (NODES_BASE_PKG.version !== EXPECTED_NODES_BASE_VERSION) {
  throw new Error(
    `scripts/validate-workflows.mjs must load n8n-nodes-base@${EXPECTED_NODES_BASE_VERSION}, ` +
      `but require() resolved ${NODES_BASE_PKG.version} at ${require.resolve('n8n-nodes-base/package.json')}. ` +
      `Pin n8n-nodes-base to ${EXPECTED_NODES_BASE_VERSION} and do not let a newer nested copy hoist over it.`,
  );
}

const REQUIRED_TOP_LEVEL_KEYS = ['name', 'nodes', 'connections', 'settings'];
const REQUIRED_NODE_KEYS = ['id', 'name', 'type', 'typeVersion', 'position', 'parameters'];

let totalErrors = 0;
let totalWarnings = 0;
let nodeDefinitionsCache = {};

// Map of node types to their paths in n8n-nodes-base
const NODE_PATH_MAP = {
  'n8n-nodes-base.slack': 'Slack/Slack.node.js',
  'n8n-nodes-base.stripeTrigger': 'Stripe/StripeTrigger.node.js',
  'n8n-nodes-base.code': 'Code/Code.node.js',
  'n8n-nodes-base.set': 'Set/Set.node.js',
  'n8n-nodes-base.httpRequest': 'HttpRequest/V3/HttpRequestV3.node.js',
  'n8n-nodes-base.manualTrigger': 'ManualTrigger/ManualTrigger.node.js',
  'n8n-nodes-base.scheduleTrigger': 'Schedule/ScheduleTrigger.node.js',
  'n8n-nodes-base.rssFeedRead': 'RssFeedRead/RssFeedRead.node.js',
  'n8n-nodes-base.rssFeedReadTrigger': 'RssFeedRead/RssFeedReadTrigger.node.js',
  'n8n-nodes-base.removeDuplicates': 'Transform/RemoveDuplicates/RemoveDuplicates.node.js',
  'n8n-nodes-base.webhook': 'Webhook/Webhook.node.js',
  'n8n-nodes-base.if': 'If/If.node.js',
  'n8n-nodes-base.googleSheets': 'Google/Sheet/GoogleSheets.node.js',
  'n8n-nodes-base.respondToWebhook': 'RespondToWebhook/RespondToWebhook.node.js',
  'n8n-nodes-base.crypto': 'Crypto/Crypto.node.js',
};

/**
 * Collect typeVersions from the real node class.
 *
 * n8n import uses each versioned node's `description.version` (number or
 * array), not Object.keys(nodeVersions). Keys on the wrapper can include
 * versions the published node does not actually advertise.
 */
export function collectSupportedVersions(nodeInstance) {
  const versions = new Set();

  const add = (value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
      versions.add(value);
    }
  };

  if (nodeInstance.nodeVersions) {
    for (const versionNode of Object.values(nodeInstance.nodeVersions)) {
      add(versionNode?.description?.version);
    }
  }

  add(nodeInstance.description?.version);

  return [...versions];
}

/**
 * Load actual node definition from n8n-nodes-base
 */
export function loadNodeDefinition(nodeType) {
  if (nodeDefinitionsCache[nodeType]) {
    return nodeDefinitionsCache[nodeType];
  }

  if (!nodeType.startsWith('n8n-nodes-base.')) {
    return null;
  }

  const nodePath = NODE_PATH_MAP[nodeType];
  if (!nodePath) {
    // Try to guess the path
    return null;
  }

  try {
    const fullPath = `n8n-nodes-base/dist/nodes/${nodePath}`;
    const nodeModule = require(fullPath);
    
    // Get the class name from the path
    const className = nodePath.split('/').pop().replace('.node.js', '').split('.')[0];
    const NodeClass = nodeModule[className];
    
    if (!NodeClass) {
      return null;
    }

    const nodeInstance = new NodeClass();
    const description = nodeInstance.description;
    const supportedVersions = collectSupportedVersions(nodeInstance);

    nodeDefinitionsCache[nodeType] = {
      supportedVersions,
      defaultVersion: description.defaultVersion ?? supportedVersions[supportedVersions.length - 1],
      isVersioned: Boolean(nodeInstance.nodeVersions),
    };
    
    return nodeDefinitionsCache[nodeType];
  } catch (err) {
    console.error(`Error loading ${nodeType}:`, err.message);
    return null;
  }
}

/**
 * Validate a single workflow JSON file
 */
export async function validateWorkflow(filePath) {
  const errors = [];
  const warnings = [];
  
  console.log(`\n📄 Validating: ${filePath}`);
  
  let content;
  let workflow;
  
  // Step 1: Check if file can be read and parsed as JSON
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    errors.push(`Failed to read file: ${err.message}`);
    return { errors, warnings };
  }
  
  try {
    workflow = JSON.parse(content);
  } catch (err) {
    errors.push(`Invalid JSON: ${err.message}`);
    return { errors, warnings };
  }
  
  // Step 2: Check top-level structure
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in workflow)) {
      errors.push(`Missing required top-level key: "${key}"`);
    }
  }
  
  if (errors.length > 0) {
    return { errors, warnings };
  }
  
  // Step 3: Validate nodes array
  if (!Array.isArray(workflow.nodes)) {
    errors.push('"nodes" must be an array');
    return { errors, warnings };
  }
  
  if (workflow.nodes.length === 0) {
    warnings.push('Workflow has no nodes');
  }
  
  const nodeNames = new Set();
  const nodeNamesArray = [];
  
  workflow.nodes.forEach((node, index) => {
    // Check required node keys
    for (const key of REQUIRED_NODE_KEYS) {
      if (!(key in node)) {
        errors.push(`Node at index ${index} missing required key: "${key}"`);
      }
    }
    
    // Check node name uniqueness
    if (node.name) {
      if (nodeNames.has(node.name)) {
        errors.push(`Duplicate node name: "${node.name}"`);
      }
      nodeNames.add(node.name);
      nodeNamesArray.push(node.name);
    }
    
    // Check node type is a string
    if (node.type && typeof node.type !== 'string') {
      errors.push(`Node "${node.name}" has invalid type (must be string)`);
    }
    
    // Check typeVersion is a number
    if (node.typeVersion && typeof node.typeVersion !== 'number') {
      errors.push(`Node "${node.name}" has invalid typeVersion (must be number)`);
    }
    
    // Check position is an array of two numbers
    if (node.position) {
      if (!Array.isArray(node.position) || node.position.length !== 2) {
        errors.push(`Node "${node.name}" has invalid position (must be [x, y])`);
      } else if (typeof node.position[0] !== 'number' || typeof node.position[1] !== 'number') {
        errors.push(`Node "${node.name}" position coordinates must be numbers`);
      }
    }
    
    // Check parameters is an object
    if (node.parameters && typeof node.parameters !== 'object') {
      errors.push(`Node "${node.name}" has invalid parameters (must be object)`);
    }
    
    // Validate node type and version against actual n8n-nodes-base definitions
    if (node.type && node.typeVersion !== undefined) {
      const definition = loadNodeDefinition(node.type);
      
      if (!definition) {
        errors.push(
          `Node "${node.name}" has unknown type "${node.type}". ` +
          `This node type is not found in n8n-nodes-base@${EXPECTED_NODES_BASE_VERSION}.`
        );
      } else if (!definition.supportedVersions.includes(node.typeVersion)) {
        errors.push(
          `Node "${node.name}" (${node.type}) has unsupported typeVersion ${node.typeVersion}. ` +
          `Supported versions in n8n-nodes-base@${EXPECTED_NODES_BASE_VERSION}: ${definition.supportedVersions.join(', ')} ` +
          `(default: ${definition.defaultVersion})`
        );
      }
    }
    
    // Check for credentials with actual IDs or secrets
    if (node.credentials) {
      Object.entries(node.credentials).forEach(([credType, credData]) => {
        if (credData.id && credData.id !== null) {
          warnings.push(`Node "${node.name}" contains credential ID for "${credType}". Consider removing it.`);
        }
        
        // Check for common secret field names
        const secretFields = ['apiKey', 'token', 'password', 'secret', 'key'];
        Object.keys(credData).forEach(field => {
          if (secretFields.some(s => field.toLowerCase().includes(s))) {
            warnings.push(`Node "${node.name}" may contain secret in credential field: "${field}"`);
          }
        });
      });
    }
  });
  
  // Step 4: Validate connections
  if (typeof workflow.connections !== 'object' || workflow.connections === null) {
    errors.push('"connections" must be an object');
    return { errors, warnings };
  }
  
  Object.entries(workflow.connections).forEach(([sourceNodeName, connectionTypes]) => {
    // Check if source node exists
    if (!nodeNames.has(sourceNodeName)) {
      errors.push(`Connection references non-existent source node: "${sourceNodeName}"`);
    }
    
    // Check connection structure
    if (typeof connectionTypes !== 'object') {
      errors.push(`Connections for "${sourceNodeName}" must be an object`);
      return;
    }
    
    Object.entries(connectionTypes).forEach(([connectionType, outputBuckets]) => {
      if (!Array.isArray(outputBuckets)) {
        errors.push(`Connection type "${connectionType}" for "${sourceNodeName}" must be an array`);
        return;
      }
      
      outputBuckets.forEach((bucket, bucketIndex) => {
        if (bucket === null || bucket === undefined) {
          // Null buckets are allowed for unused outputs
          return;
        }
        
        if (!Array.isArray(bucket)) {
          errors.push(`Output bucket ${bucketIndex} for "${sourceNodeName}.${connectionType}" must be an array`);
          return;
        }
        
        bucket.forEach((connection, connIndex) => {
          if (!connection.node) {
            errors.push(`Connection ${connIndex} in "${sourceNodeName}.${connectionType}[${bucketIndex}]" missing "node" property`);
          } else if (!nodeNames.has(connection.node)) {
            errors.push(`Connection "${sourceNodeName}" → "${connection.node}" references non-existent target node`);
          }
          
          if (!connection.type) {
            errors.push(`Connection ${connIndex} in "${sourceNodeName}.${connectionType}[${bucketIndex}]" missing "type" property`);
          }
          
          if (connection.index === undefined) {
            errors.push(`Connection ${connIndex} in "${sourceNodeName}.${connectionType}[${bucketIndex}]" missing "index" property`);
          }
        });
      });
    });
  });
  
  // Step 5: Check for common n8n node types (basic verification)
  const knownNodePrefixes = [
    'n8n-nodes-base.',
    '@n8n/',
    'n8n-nodes-'
  ];
  
  workflow.nodes.forEach(node => {
    if (node.type && !knownNodePrefixes.some(prefix => node.type.startsWith(prefix))) {
      warnings.push(`Node "${node.name}" has unusual type: "${node.type}". Verify it's correct.`);
    }
  });
  
  return { errors, warnings, workflow };
}

/**
 * Main validation function
 */
async function main() {
  console.log('🔍 n8n Workflow Validation\n');
  console.log(`Loading node definitions from n8n-nodes-base@${EXPECTED_NODES_BASE_VERSION}...\n`);
  
  // Find all workflow JSON files
  const workflowFiles = await glob('examples/**/n8n/*.json', {
    cwd: rootDir,
    absolute: false
  });
  
  if (workflowFiles.length === 0) {
    console.log('⚠️  No workflow files found to validate.');
    return;
  }
  
  console.log(`Found ${workflowFiles.length} workflow file(s)\n`);
  
  // Validate each workflow
  for (const file of workflowFiles) {
    const filePath = join(rootDir, file);
    const { errors, warnings } = await validateWorkflow(filePath);
    
    if (errors.length > 0) {
      console.log(`❌ Errors (${errors.length}):`);
      errors.forEach(err => console.log(`   - ${err}`));
      totalErrors += errors.length;
    }
    
    if (warnings.length > 0) {
      console.log(`⚠️  Warnings (${warnings.length}):`);
      warnings.forEach(warn => console.log(`   - ${warn}`));
      totalWarnings += warnings.length;
    }
    
    if (errors.length === 0 && warnings.length === 0) {
      console.log('✅ Valid');
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Validation Summary');
  console.log('='.repeat(60));
  console.log(`Total workflows validated: ${workflowFiles.length}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Total warnings: ${totalWarnings}`);
  console.log(`\nValidated against: n8n-nodes-base@${EXPECTED_NODES_BASE_VERSION}`);
  
  if (totalErrors > 0) {
    console.log('\n❌ Validation failed. Please fix the errors above.');
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log('\n⚠️  Validation passed with warnings. Review warnings above.');
    process.exit(0);
  } else {
    console.log('\n✅ All workflows valid!');
    process.exit(0);
  }
}

const isDirectRun = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
);

if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
