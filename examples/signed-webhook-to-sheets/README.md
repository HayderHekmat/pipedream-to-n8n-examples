# Signed Webhook to Google Sheets

Receive signed webhooks (GitHub push events as example), verify HMAC-SHA256 signatures, transform payloads, and write idempotently to Google Sheets. Demonstrates raw body access, cryptographic verification, conditional logic, and append-or-update patterns.

## What This Workflow Does

1. **Webhook**: Receives POST requests at `/github-push` endpoint with raw body access
2. **Verify Signature**: Computes HMAC-SHA256 of raw body and compares to `x-hub-signature-256` header
3. **Check Signature**: Routes to success or failure path based on verification result
4. **Transform Payload**: Extracts relevant fields from GitHub push event
5. **Write to Google Sheets**: Idempotently writes to Sheet1, keyed on `event_id` (updates if exists, appends if new)
6. **Respond Success**: Returns 200 OK with event details
7. **Respond Invalid Signature**: Returns 401 Unauthorized if signature check fails

## Pipedream → n8n Mapping

| Pipedream | n8n | Notes |
|-----------|-----|-------|
| HTTP trigger with `event.bodyRaw` | Webhook v2.1 with `rawBody: true` | Raw bytes land in `binary.data`, not parsed `json.body` |
| `crypto.createHmac().update().digest()` | Same in Code node | Requires `NODE_FUNCTION_ALLOW_BUILTIN=crypto` |
| `crypto.timingSafeEqual()` | Same in Code node | Prevents timing attacks |
| Secret prop (`this.github_secret`) | `$env.GITHUB_WEBHOOK_SECRET` only (fail closed) | Default n8n **blocks** `$env` — see env setup below |
| Conditional logic (if/else) | If node v2.3 | `verified === true` condition |
| Google Sheets `appendOrUpdate` | Google Sheets v4.7 `appendOrUpdate` | Sheet ID via resource locator (`documentId` mode `id` or `list`), not `$env` |
| Delivery ID for idempotency | `x-github-delivery` header → `event_id` | Do not use `Date.now()` |
| `$.respond({ status, body })` | Respond to Webhook node v1.5 | `respondWith: json` plus `options.responseCode` |

## Setup Instructions

### 1. Import Workflow

1. Copy the entire contents of `n8n/workflow.json`
2. Open n8n editor
3. Press **Ctrl/Cmd+V** on the canvas to paste
4. All 7 nodes and 7 connections will appear

### 2. Configure Webhook Secret and Code-Node Runtime Flags

The Verify Signature node **fails closed**: if `GITHUB_WEBHOOK_SECRET` is missing, the webhook returns 401. There is no `'your-secret-here'` fallback.

n8n Code nodes do **not** allow `require('crypto')` or `$env` unless you opt in.

#### Required environment flags (self-hosted)

```bash
# Allow the Node.js crypto builtin inside Code nodes (otherwise require('crypto') throws)
export NODE_FUNCTION_ALLOW_BUILTIN=crypto

# n8n 2.x blocks $env / process.env in Code nodes by default.
# Set this to false so $env.GITHUB_WEBHOOK_SECRET is readable.
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false

export GITHUB_WEBHOOK_SECRET="replace-with-the-github-webhook-secret"
```

Restart n8n after changing these.

On n8n Cloud, set `GITHUB_WEBHOOK_SECRET` in the instance variables UI. If `$env` stays blocked, the Code node returns `verified: false` with an error telling you to unset the block.

`NODE_FUNCTION_ALLOW_BUILTIN` is a comma-separated allowlist. Use `crypto` (or `*` only if you accept the broader risk). An empty/unset value means **no** builtins.

### 3. Configure Google Sheets

#### Create the Spreadsheet

1. Create a new Google Sheet
2. In **Sheet1**, add header row:
   ```
   event_id | repository | pusher | ref | commits_count | timestamp | url
   ```

3. Copy the Spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit
   ```

4. In the **Write to Google Sheets** node, use the document **resource locator** (do not use `$env.GOOGLE_SHEET_ID`):
   - **By ID**: paste `YOUR_SHEET_ID` into `documentId` (mode `id`)
   - **From List**: after credentials are connected, pick the spreadsheet from the dropdown (mode `list`)
   - Sheet tab: resource locator mode `name` = `Sheet1`

#### Configure Credentials

1. In n8n, create **Google Sheets OAuth2 API** credential
2. Follow OAuth flow to authorize
3. Assign credential to **Write to Google Sheets** node

### 4. Update Webhook Path (Optional)

The workflow uses path `/github-push`. To change:

1. Click **Webhook** node
2. Update `path` parameter
3. Note the full webhook URL shown in node (e.g., `https://your-n8n.com/webhook/github-push`)

### 5. Test with Sample Event

The workflow includes a sample GitHub push event in `pinData`. The pinned `x-hub-signature-256` is a **placeholder** and will fail verification (fail closed). HMAC is computed over **raw body bytes** in `binary.data`, not over parsed `json.body`.

To pin a real signature:

1. Put the exact request bytes in `pinData.Webhook[0].binary.data.data` (base64).
2. Sign those bytes (not `JSON.stringify` of the parsed body):
   ```bash
   echo -n '{"ref":"refs/heads/main"}' | \
   openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" | \
   awk '{print "sha256="$2}'
   ```
3. Set `headers.x-hub-signature-256` to that value and `headers.x-github-delivery` to a stable UUID (this becomes `event_id`).

`npm run test:unit` includes a test (dummy secret only) that a valid signature over those bytes passes and a tampered body fails.

### 6. Configure GitHub Webhook (For Production)

1. Go to your GitHub repository → Settings → Webhooks → Add webhook
2. **Payload URL**: Your n8n webhook URL (e.g., `https://your-n8n.com/webhook/github-push`)
3. **Content type**: `application/json`
4. **Secret**: Same secret configured in n8n
5. **Events**: Select "Just the push event"
6. **Active**: ✓ Enabled
7. Save webhook

GitHub will send a test ping event immediately.

## Cutover Strategy

### Phase 1: Prepare n8n (1-2 days before)

1. **Import workflow** to n8n and configure credentials
2. **Test with sample events** using pinned data
3. **Verify signature verification** with real secret
4. **Test Google Sheets writes** (use test sheet first)
5. **Monitor n8n webhook endpoint** is accessible from internet

### Phase 2: Parallel Run (3-7 days)

1. **Add n8n webhook to GitHub** without removing Pipedream
2. **Both receive events** - both write to sheets (expect duplicates)
3. **Monitor n8n execution logs** for failures
4. **Compare sheet writes** between Pipedream and n8n
5. **Pipedream remains primary** - alerts and monitoring active

### Phase 3: Log-and-Alert Mode (Pipedream)

Modify Pipedream workflow to **not write to sheets**, only log and alert:

```javascript
// In Pipedream's Google Sheets step
export default defineComponent({
  async run({ steps, $ }) {
    // DON'T write to sheets
    // Instead, log for comparison
    console.log("Would write:", steps.transform_payload.$return_value);
    
    // Alert if n8n failed (check sheet for event_id)
    const eventId = steps.transform_payload.event_id;
    const exists = await this.googleSheets.getValue({
      spreadsheetId: this.spreadsheetId,
      range: `Sheet1!A:A`,
    });
    
    const found = exists.values?.some(row => row[0] === eventId);
    
    if (!found) {
      // n8n missed this event!
      await $.send.email({
        subject: `n8n webhook failure: ${eventId}`,
        text: `Event ${eventId} not found in sheet. Check n8n logs.`,
      });
    }
  },
});
```

Run this for 2-3 days to verify n8n catches all events.

### Phase 4: Deactivate Pipedream

1. **Remove Pipedream webhook from GitHub** (n8n is now sole receiver)
2. **Keep Pipedream workflow paused** for 7 days (rollback safety)
3. **Monitor n8n for 48 hours** with no issues
4. **Delete Pipedream workflow** after successful cutover

### Rollback Plan

If n8n fails during Phase 2-3:

1. **GitHub webhooks stay configured** for both (no change needed)
2. **Re-enable Pipedream sheet writes** (remove log-only mode)
3. **Investigate n8n failure** in execution logs
4. **Fix and re-test** before trying Phase 3 again

If n8n fails after Phase 4 (Pipedream deleted):

1. **Recreate Pipedream workflow from backup**
2. **Add Pipedream webhook back to GitHub**
3. **Disable n8n webhook in GitHub settings**
4. No data loss - events are idempotent by `event_id`

## Manual Configuration Required

### Must Configure Before Activation

- ✅ **`NODE_FUNCTION_ALLOW_BUILTIN=crypto`** (Code node `require('crypto')`)
- ✅ **`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`** (otherwise `$env` is blocked by default)
- ✅ **Webhook secret** via `$env.GITHUB_WEBHOOK_SECRET` (no placeholder fallback)
- ✅ **Google Sheet ID** via the Sheets resource locator on the node (not `$env`)
- ✅ **Google Sheets OAuth2 credential** (with Sheets read/write scope)
- ✅ **GitHub webhook** (configure in repository settings with n8n URL)

### Optional Tuning

- **Webhook path**: Change from `/github-push` to custom path
- **Sheet name**: Change from `Sheet1` to different tab
- **Column mappings**: Adjust fields extracted in Transform Payload node
- **Response format**: Customize success/failure response bodies

## Cutover Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Invalid signature from n8n** | All webhooks rejected, no data written | Test with sample events before cutover; verify secret matches |
| **Duplicate writes during parallel run** | Same event written twice (once by Pipedream, once by n8n) | Idempotent writes keyed on `event_id` - updates don't create duplicates |
| **n8n webhook unreachable** | GitHub events lost, no retries | Verify n8n URL is publicly accessible; check firewall rules |
| **Secret mismatch** | All signatures fail | Double-check secret matches in GitHub webhook and n8n environment |
| **Sheet quota exceeded** | Writes fail if too many events | Monitor Google Sheets API quota; GitHub push events are typically low-volume |
| **Webhook URL change breaks GitHub** | Events sent to old Pipedream URL | During cutover, keep both webhooks active until verified |

## Signature Verification Details

### How HMAC-SHA256 Works

```javascript
const crypto = require('crypto');

// Sender (GitHub) computes over the raw request bytes:
const signature = crypto
  .createHmac('sha256', secret)
  .update(rawBodyBuffer)  // Buffer of the HTTP body, not parsed JSON
  .digest('hex');

// Sends as: x-hub-signature-256: sha256=<signature>

// Receiver (n8n) reads those bytes from webhook binary data:
const rawBody = Buffer.from($input.first().binary.data.data, 'base64');
const computed = crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');

const isValid = crypto.timingSafeEqual(
  Buffer.from(receivedSignature),
  Buffer.from(`sha256=${computed}`)
);
```

### Critical: Use Raw Body Bytes (`binary.data`)

Webhook `rawBody: true` puts the unparsed request in **binary data** (`item.binary.data`, base64-encoded). `$json.body` is the **parsed** JSON object and must not be hashed.

Hashing parsed JSON fails because of:
- Whitespace differences
- Key ordering changes
- Unicode encoding variations

### Constant-Time Comparison

`crypto.timingSafeEqual()` prevents timing attacks:
- String comparison (`===`) can leak information about where strings differ
- Attackers measure response time to guess valid signatures byte-by-byte
- `timingSafeEqual()` always takes same time regardless of where mismatch occurs

## Google Sheets Idempotency

The `appendOrUpdate` operation ensures each event is written exactly once:

1. **Match Column**: `event_id` (GitHub `x-github-delivery` header — unique per delivery)
2. **Match Value**: `$json.event_id` from Transform Payload
3. **Behavior**:
   - If `event_id` exists in sheet → **Update** that row
   - If `event_id` not found → **Append** new row

### Why This Matters

During parallel run (Phase 2), both Pipedream and n8n receive the same event:
- First to write (Pipedream) **appends** row with `event_id: abc123`
- Second to write (n8n) **updates** same row (finds `event_id: abc123`)
- Result: One row in sheet, not two

## Testing Checklist

Before cutover:

- [ ] Import workflow successfully (7 nodes, 7 connections)
- [ ] `NODE_FUNCTION_ALLOW_BUILTIN=crypto` set and n8n restarted
- [ ] `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (or `$env` access otherwise enabled)
- [ ] Webhook secret configured (`$env.GITHUB_WEBHOOK_SECRET` set, no fallback)
- [ ] Google Sheet created with header row
- [ ] Google Sheet selected via the document resource locator (ID or list)
- [ ] Google Sheets credential configured and authorized
- [ ] Test execution with pinned data succeeds (signature validation skipped in test)
- [ ] Generate real signature and verify it validates correctly
- [ ] Webhook URL is publicly accessible (not localhost)
- [ ] GitHub webhook configured with correct secret
- [ ] Send test webhook from GitHub and verify it writes to sheet
- [ ] Verify idempotency: send same event twice, only one row in sheet

## Workflow Features

### Webhook Raw Body

Enable in Webhook node options (this example uses Webhook **v2.1**; v2.2 is not in n8n-nodes-base@2.15.1):
```json
{
  "options": {
    "rawBody": true
  }
}
```

The Code node must HMAC `Buffer.from($input.first().binary.data.data, 'base64')`. Do not hash `$json.body`.

### Code Node Crypto Access

`require('crypto')` is a Node builtin. n8n's Code sandbox allowlist is empty unless you set:

```bash
export NODE_FUNCTION_ALLOW_BUILTIN=crypto
```

Without that flag the Verify Signature node throws `Cannot find module 'crypto'`.

### If Node Conditional Routing

The If node v2.3 routes execution based on conditions:
- **True output** (left): Signature valid, continue processing
- **False output** (right): Signature invalid, return 401

Prevents invalid webhooks from writing to sheet.

### Environment Variables in Code

n8n 2.x sets **`N8N_BLOCK_ENV_ACCESS_IN_NODE=true` by default**. `$env` and `process.env` throw (or are empty) until you set:

```bash
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false
export GITHUB_WEBHOOK_SECRET="the-github-webhook-secret"
```

The Code node reads **only** `$env.GITHUB_WEBHOOK_SECRET` and fails closed if it is unset. The Google Sheet ID is **not** an env var — pick it with the Sheets resource locator on the node.

### event_id

Transform Payload uses `headers['x-github-delivery']` as `event_id`. That header is unique per GitHub delivery. Do not fall back to `Date.now()` — a new id on every retry would break idempotent sheet writes.

## Troubleshooting

### All Signatures Failing

**Symptom**: Every webhook returns 401, none write to sheet.

**Causes**:
1. Secret mismatch between GitHub and n8n
2. Hashing parsed `json.body` instead of `binary.data` bytes
3. `$env` blocked (`N8N_BLOCK_ENV_ACCESS_IN_NODE` still true) so the node fail-closes
4. `require('crypto')` blocked (`NODE_FUNCTION_ALLOW_BUILTIN` unset)
5. Signature header name incorrect

**Fix**:
- Verify secret matches exactly in GitHub webhook settings and n8n env var
- Check Webhook node has `rawBody: true` and the Code node hashes `binary.data`
- Set `NODE_FUNCTION_ALLOW_BUILTIN=crypto` and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`

### Writes Not Idempotent

**Symptom**: Same event creates multiple rows in sheet.

**Causes**:
1. `event_id` field missing or null
2. `columnToMatchOn` incorrectly configured
3. Event has different ID each time (timestamp-based ID)

**Fix**:
- Confirm Transform Payload uses `x-github-delivery` (not `Date.now()` or commit SHA)
- Confirm Google Sheets `columns.matchingColumns` includes `event_id`

### Webhook Not Receiving Events

**Symptom**: GitHub shows webhook deliveries, but n8n has no executions.

**Causes**:
1. n8n URL not publicly accessible (firewall/NAT)
2. Webhook path incorrect
3. n8n workflow not activated

**Fix**:
- Test n8n webhook URL with `curl -X POST https://your-n8n.com/webhook/github-push`
- Check GitHub webhook Recent Deliveries tab for response codes
- Verify workflow is **Active** (toggle in top-right of n8n editor)

### Crypto Module Not Found

**Symptom**: Code node fails with "Cannot find module 'crypto'".

**Causes**:
1. `NODE_FUNCTION_ALLOW_BUILTIN` unset (Code sandbox allowlist defaults to empty)
2. Custom n8n image without Node builtins

**Fix**:
```bash
export NODE_FUNCTION_ALLOW_BUILTIN=crypto
```
Restart n8n. `crypto` is a Node builtin — do not npm-install it.

## Related Documentation

- [n8n Webhook Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [n8n Code Node](https://docs.n8n.io/code/builtin/overview/)
- [n8n If Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/)
- [n8n Respond to Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/)
- [n8n Google Sheets](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/)
- [GitHub Webhook Signature Verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Node.js crypto.createHmac()](https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options)
