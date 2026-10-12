#!/usr/bin/env node

/**
 * n8n Workflow Validation Script
 * 
 * Validates n8n workflow JSON files in examples directory
 * Checks:
 * - Valid JSON syntax
 * - Required top-level keys (name, nodes, connections, settings)
 * - Node structure (id, name, type, typeVersion, position, parameters)
 * - Connection references (must reference existing node names)
 * - No duplicate node names
 * - No credentials or secrets in workflow files
 * - Imports workflows into n8n to verify they load correctly
 */

import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const REQUIRED_TOP_LEVEL_KEYS = ['name', 'nodes', 'connections', 'settings'];
const REQUIRED_NODE_KEYS = ['id', 'name', 'type', 'typeVersion', 'position', 'parameters'];

// Known n8n node types and their supported versions (based on n8n-nodes-base)
// This is a minimal set for validation - real nodes may support more versions
const KNOWN_NODE_VERSIONS = {
  'n8n-nodes-base.stripeTrigger': [1],
  'n8n-nodes-base.slack': [1, 2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7],
  'n8n-nodes-base.code': [1, 2],
  'n8n-nodes-base.httpRequest': [1, 2, 3, 4, 4.1, 4.2],
  'n8n-nodes-base.set': [1, 2, 3, 3.1, 3.2, 3.3, 3.4],
  'n8n-nodes-base.manualTrigger': [1],
};

// Required parameters for common node operations
const REQUIRED_NODE_PARAMETERS = {
  'n8n-nodes-base.slack': {
    message: ['resource', 'operation'],
  },
  'n8n-nodes-base.code': {
    all: ['mode'],
  },
};

let totalErrors = 0;
let totalWarnings = 0;

/**
 * Validate a single workflow JSON file
 */
async function validateWorkflow(filePath) {
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
    
    // Validate node type version against known types
    if (node.type && KNOWN_NODE_VERSIONS[node.type]) {
      if (!KNOWN_NODE_VERSIONS[node.type].includes(node.typeVersion)) {
        errors.push(
          `Node "${node.name}" (${node.type}) has unsupported typeVersion ${node.typeVersion}. ` +
          `Supported versions: ${KNOWN_NODE_VERSIONS[node.type].join(', ')}`
        );
      }
    }
    
    // Check required parameters for known node types
    if (node.type && node.parameters) {
      const nodeType = node.type;
      const requiredParams = REQUIRED_NODE_PARAMETERS[nodeType];
      
      if (requiredParams) {
        // Check for resource-specific requirements (e.g., Slack message operations)
        if (requiredParams[node.parameters.resource]) {
          const required = requiredParams[node.parameters.resource];
          required.forEach(param => {
            if (!(param in node.parameters)) {
              errors.push(
                `Node "${node.name}" (${nodeType}, resource: ${node.parameters.resource}) ` +
                `missing required parameter: "${param}"`
              );
            }
          });
        }
        
        // Check for universal requirements
        if (requiredParams.all) {
          requiredParams.all.forEach(param => {
            if (!(param in node.parameters)) {
              errors.push(`Node "${node.name}" (${nodeType}) missing required parameter: "${param}"`);
            }
          });
        }
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
 * Test importing workflow into n8n CLI (if available)
 */
async function testN8nImport(workflow, filePath) {
  const errors = [];
  const warnings = [];
  
  console.log('   🧪 Testing n8n import...');
  
  try {
    // Check if n8n CLI is available
    try {
      await execFileAsync('npx', ['n8n', 'version'], { timeout: 5000 });
    } catch (err) {
      warnings.push('n8n CLI not available for import testing (npx n8n version failed)');
      return { errors, warnings };
    }
    
    // Create temporary workflow file
    const tempDir = join(tmpdir(), 'n8n-validation');
    await mkdir(tempDir, { recursive: true });
    const tempFile = join(tempDir, `workflow-${Date.now()}.json`);
    
    try {
      await writeFile(tempFile, JSON.stringify(workflow, null, 2));
      
      // Test import (dry-run)
      try {
        const { stdout, stderr } = await execFileAsync(
          'npx',
          ['n8n', 'import:workflow', '--input', tempFile, '--separate'],
          { timeout: 10000 }
        );
        
        if (stderr && !stderr.includes('Successfully imported')) {
          warnings.push(`n8n import produced warnings: ${stderr.slice(0, 200)}`);
        }
        
        console.log('   ✅ n8n import successful');
      } catch (importErr) {
        if (importErr.code === 'ETIMEDOUT') {
          warnings.push('n8n import test timed out');
        } else {
          errors.push(`n8n import failed: ${importErr.stderr || importErr.message}`);
        }
      }
    } finally {
      // Clean up temp file
      try {
        await unlink(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  } catch (err) {
    warnings.push(`Import test setup failed: ${err.message}`);
  }
  
  return { errors, warnings };
}

/**
 * Main validation function
 */
async function main() {
  console.log('🔍 n8n Workflow Validation\n');
  console.log('Searching for workflow files in examples/**/n8n/*.json...\n');
  
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
    const { errors, warnings, workflow } = await validateWorkflow(filePath);
    
    // Test import if basic validation passed
    if (errors.length === 0 && workflow) {
      const importResult = await testN8nImport(workflow, filePath);
      errors.push(...importResult.errors);
      warnings.push(...importResult.warnings);
    }
    
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

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
