# Pipedream to n8n Migration Checklist

Use this comprehensive checklist to plan and execute your migration from Pipedream to n8n before the **March 31, 2027 shutdown**.

---

## Phase 1: Inventory & Discovery

- [ ] Run pre-migration inventory on exports: `rg "process\.env|\$\.respond|\{\{" ./export`

### Workflows
- [ ] Export a list of all active workflows from Pipedream
- [ ] Document workflow names, descriptions, and purposes
- [ ] Identify business-critical vs. non-critical workflows
- [ ] Note workflow creation/modification dates and owners
- [ ] Review execution frequency and volume for each workflow

### Triggers
- [ ] Flag HTTP workflows that call `$.respond` (redirect or JSON body) — they need Respond to Webhook in n8n
- [ ] List all trigger types used (HTTP webhooks, schedules, app events, etc.)
- [ ] Document webhook URLs for each HTTP/webhook trigger
- [ ] Identify all third-party services with webhooks pointing to Pipedream
- [ ] Note trigger-specific configurations (filters, authentication, etc.)

### Schedules
- [ ] List all scheduled/cron-based workflows
- [ ] Document cron expressions or schedule frequencies
- [ ] Note timezone settings for each scheduled workflow
- [ ] Identify workflows with complex scheduling patterns

### Connected Accounts & Authentication
- [ ] List all connected accounts (Stripe, Slack, GitHub, etc.)
- [ ] Document authentication methods (OAuth, API keys, tokens)
- [ ] Note permission scopes for OAuth connections
- [ ] Identify which accounts are shared vs. user-specific
- [ ] Verify you have credentials/access to recreate connections

### Environment Variables
- [ ] Env vars are **not** included in the Pipedream export — grep code steps for `process.env`, list every name, and recreate each in n8n before the first test
- [ ] Watch for env vars that hold another workflow's URL; undefined values fail silently — migrate workflows in dependency order
- [ ] Export all environment variables from Pipedream
- [ ] Categorize variables by scope (global, workflow-specific)
- [ ] Identify secrets vs. non-sensitive configuration
- [ ] Document variable usage across workflows
- [ ] Verify you have access to all secret values

### Data Stores
- [ ] List all Pipedream Data Stores in use
- [ ] Document data structure and keys for each store
- [ ] Export current data from each store (API or UI)
- [ ] Estimate data volume and access patterns
- [ ] Identify workflows that depend on shared state

### Code Steps & Dependencies
- [ ] Find inline `{{ }}` JS in step **action fields** (not code steps): `Date.now()`, `.replace()` for HTML, etc. — easy to miss in export review
- [ ] List all workflows using Node.js code steps
- [ ] Document npm packages used in code steps
- [ ] Note specific package versions (if critical)
- [ ] Identify custom API calls or complex logic
- [ ] Check for Pipedream-specific syntax (`$.export`, `this.prop`)

### Error Handling & Retries
- [ ] Document error handling strategies per workflow
- [ ] Note retry configurations (count, delay)
- [ ] Identify workflows with custom error notifications
- [ ] Review error logs for patterns or known issues

### Concurrency & Throttling
- [ ] Identify workflows with concurrency controls
- [ ] Document rate limiting or throttling settings
- [ ] Note any workflows that must run sequentially
- [ ] Check for workflows with execution queues

---

## Phase 2: Planning & Mapping

### Pipedream → n8n Concept Mapping
- [ ] **Triggers**: Map to n8n Trigger nodes (Webhook, Schedule, etc.)
- [ ] **Steps**: Map to n8n nodes (HTTP Request, Function, Set, etc.)
- [ ] **Code Steps**: Plan conversion to n8n Code node (JavaScript)
- [ ] **`$.export` / Step Exports**: Plan to use n8n expressions like `{{ $json.fieldName }}`
- [ ] **Data Stores**: Choose alternative (n8n Data Tables, Redis, PostgreSQL, or HTTP Request to external DB)
- [ ] **Environment Variables**: Plan to use n8n credentials or global variables
- [ ] **`this.prop`**: Plan to use n8n's Static Data for workflow-level persistence
- [ ] **HTTP responses**: Webhook + `$.respond` → n8n Webhook trigger set to **Using Respond to Webhook Node**, plus a Respond to Webhook node (status, headers, body)

### n8n Environment Setup
- [ ] Choose n8n deployment (self-hosted, n8n Cloud, Docker, npm, etc.)
- [ ] Provision infrastructure (server, database, etc.)
- [ ] Install n8n and verify version
- [ ] Configure base URL and webhook URL settings
- [ ] Set up authentication (users, credentials encryption key)
- [ ] Configure email/notification settings for workflow errors

### Tool Selection for n8n Features
- [ ] Decide on shared data storage solution (if Data Stores were used)
- [ ] Choose database for n8n if self-hosting (PostgreSQL recommended)
- [ ] Plan monitoring/logging strategy (n8n logs, external tools)
- [ ] Set up backup strategy for n8n workflows and data

---

## Phase 3: Credential Recreation

### API Keys & Tokens
- [ ] Recreate API key credentials in n8n for each service
- [ ] Test each credential connection in n8n
- [ ] Store credentials securely (use n8n's credential encryption)
- [ ] Document credential names for reference

### OAuth Applications
- [ ] Re-authenticate OAuth apps in n8n (Slack, Google, etc.)
- [ ] Verify OAuth scopes match Pipedream requirements
- [ ] Test OAuth connections with sample API calls
- [ ] Note OAuth refresh token behavior if applicable

### Webhook Signing Secrets
- [ ] Identify services that use webhook signing (Stripe, GitHub, etc.)
- [ ] Prepare to update signing secrets after webhook registration
- [ ] Document where to find signing secrets in each service's dashboard

---

## Phase 4: Workflow Recreation

### Build Workflows in n8n
- [ ] Start with simplest/lowest-risk workflows first
- [ ] For each workflow:
  - [ ] Create a new workflow in n8n
  - [ ] Add trigger node and configure (HTTP + `$.respond`: Webhook **Using Respond to Webhook Node**)
  - [ ] Add Respond to Webhook node when the workflow answers the caller
  - [ ] Recreate every `process.env` variable from the inventory before the first test run
  - [ ] Add subsequent nodes for each step
  - [ ] Convert code steps to n8n Code nodes
  - [ ] Map Pipedream step exports to n8n node outputs using expressions
  - [ ] Configure error handling on nodes (Continue on Fail, Retry options)
  - [ ] Add notes to nodes for documentation
  - [ ] Set workflow name and tags

### Data Store Alternatives
- [ ] If using n8n's Database nodes, create tables/schemas
- [ ] If using external database, set up tables and credentials
- [ ] If using HTTP Request for external APIs, configure endpoints
- [ ] Migrate existing data from Pipedream Data Stores
- [ ] Test read/write operations

### Code Step Conversion
- [ ] Rewrite each inline `{{ }}` in step fields as an n8n expression (scan every field, not just Code nodes)
- [ ] Convert `$.export('key', value)` to `return [{ json: { key: value } }]`
- [ ] Replace `steps.previous_step.data` with `$json.fieldName` or `{{ $node["Node Name"].json.fieldName }}`
- [ ] Update `this.prop` to use n8n's Static Data
- [ ] Update npm package imports (ensure they're available in n8n environment)
- [ ] Test code with sample data in n8n's Code node

---

## Phase 5: Webhook Re-registration

### Update Webhook URLs
- [ ] For each webhook trigger in n8n:
  - [ ] Activate the workflow to generate n8n webhook URL
  - [ ] Copy the n8n production webhook URL
  - [ ] Update the webhook URL in the external service (Stripe, GitHub, etc.)
  - [ ] Verify webhook URL format and path are correct

### Update Signing Secrets
- [ ] For services with webhook verification:
  - [ ] Activate the workflow in n8n (creates webhook in service)
  - [ ] Find the webhook endpoint in the service's dashboard
  - [ ] Copy the signing secret (e.g., Stripe's `whsec_...`)
  - [ ] Update the n8n credential with the signing secret
  - [ ] Save and re-test the connection

### Test Webhook Delivery
- [ ] Trigger test events from each external service
- [ ] Verify n8n receives the webhook payload
- [ ] Check workflow execution logs for successful processing
- [ ] Confirm webhook signatures are validated (if applicable)

---

## Phase 6: Testing

### Individual Workflow Testing
- [ ] For each workflow:
  - [ ] Test with sample/test data first
  - [ ] For caller-facing HTTP workflows: verify status code, headers, and body the client receives (not only that nodes ran)
  - [ ] Verify all nodes execute successfully
  - [ ] Check output data at each step
  - [ ] Test error handling (intentionally trigger errors)
  - [ ] Verify retry behavior works as expected
  - [ ] Test with edge cases and unusual inputs

### Integration Testing
- [ ] Test workflows that depend on shared data stores
- [ ] Verify data is written and read correctly
- [ ] Test workflows that trigger other workflows (if applicable)
- [ ] Confirm external API calls return expected results

### Credential Testing
- [ ] Verify all credentials work in production environment
- [ ] Test OAuth token refresh (if applicable)
- [ ] Confirm API rate limits are respected
- [ ] Test credential fallback/rotation if configured

---

## Phase 7: Parallel Run / Shadow Mode

### Run Pipedream and n8n in Parallel
- [ ] Keep Pipedream workflows active during testing
- [ ] Activate corresponding n8n workflows
- [ ] Configure webhooks to send events to BOTH platforms (if possible)
- [ ] Alternatively, test n8n with test credentials/sandbox environments

### Monitor Execution Differences
- [ ] Compare execution results between Pipedream and n8n
- [ ] Log discrepancies or unexpected behavior
- [ ] Investigate and fix any differences in n8n
- [ ] Verify n8n produces same outcomes as Pipedream

### Performance Monitoring
- [ ] Monitor n8n workflow execution times
- [ ] Check resource usage (CPU, memory, database)
- [ ] Identify any performance bottlenecks
- [ ] Optimize workflows if needed (combine nodes, reduce API calls, etc.)

---

## Phase 8: Cutover

### Cutover Planning
- [ ] Choose cutover date (well before March 31, 2027)
- [ ] Create a cutover runbook with step-by-step instructions
- [ ] Identify rollback triggers (when to revert to Pipedream)
- [ ] Assign team members to monitor cutover
- [ ] Schedule cutover during low-traffic period if possible

### Cutover Execution
- [ ] Announce maintenance window to users (if applicable)
- [ ] Update all webhook URLs to point to n8n
- [ ] Update DNS/load balancers if custom domains are used
- [ ] Deactivate workflows in Pipedream (DO NOT DELETE YET)
- [ ] Verify n8n workflows are active and receiving traffic
- [ ] Monitor execution logs in real-time

### Post-Cutover Validation
- [ ] Confirm all workflows are executing successfully in n8n
- [ ] Check for error spikes or failed executions
- [ ] Verify external integrations are receiving expected data
- [ ] Monitor for 24-48 hours before considering cutover complete

---

## Phase 9: Monitoring & Maintenance

### Set Up Monitoring
- [ ] Configure n8n error notifications (email, Slack, etc.)
- [ ] Set up workflow execution tracking/logging
- [ ] Create alerts for failed workflows or high error rates
- [ ] Set up uptime monitoring for n8n instance (if self-hosted)

### Error Workflow
- [ ] Create a dedicated error handling workflow in n8n
- [ ] Configure workflows to trigger error workflow on failure
- [ ] Centralize error logging and notifications
- [ ] Include workflow name, error message, and timestamp in alerts

### Documentation
- [ ] Document all migrated workflows in a central location
- [ ] Update runbooks for workflow maintenance
- [ ] Document troubleshooting steps for common issues
- [ ] Train team members on n8n workflow management

---

## Phase 10: Rollback Plan

### Rollback Triggers
- [ ] Define criteria for rollback (e.g., >10% error rate, critical workflow failure)
- [ ] Assign rollback decision-maker

### Rollback Steps
- [ ] Revert webhook URLs to Pipedream
- [ ] Reactivate Pipedream workflows
- [ ] Deactivate n8n workflows temporarily
- [ ] Investigate and fix issues in n8n
- [ ] Retry cutover when ready

### Post-Rollback
- [ ] Document root cause of rollback
- [ ] Fix issues in n8n workflows
- [ ] Increase testing rigor
- [ ] Plan next cutover attempt

---

## Phase 11: Decommissioning Pipedream

### Before March 31, 2027
- [ ] Verify all workflows are stable on n8n for at least 30 days
- [ ] Confirm no workflows are still active on Pipedream
- [ ] Export final copies of all Pipedream workflows for archive
- [ ] Export any remaining data from Data Stores
- [ ] Cancel Pipedream subscription (if applicable)
- [ ] Remove Pipedream webhook URLs from external services
- [ ] Delete connected accounts from Pipedream (optional, for security)

### Archive
- [ ] Store exported Pipedream workflows in version control
- [ ] Document migration date and final cutover details
- [ ] Archive any migration notes or troubleshooting logs

---

## Additional Notes

- **Start early**: Don't wait until the March 2027 deadline approaches
- **Prioritize**: Migrate business-critical workflows first
- **Test thoroughly**: Use test/sandbox environments before production
- **Communicate**: Keep stakeholders informed of migration progress
- **Backup**: Always have a backup plan and rollback strategy
- **Learn n8n**: Invest time in learning n8n's features and best practices

---

**Good luck with your migration! 🚀**
