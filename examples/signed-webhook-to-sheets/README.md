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
| HTTP trigger with `event.bodyRaw` | Webhook node with `rawBody: true` option | Must enable raw body in Webhook node options |
| `crypto.createHmac().update().digest()` | Same in Code node | Node.js `crypto` module available |
| `crypto.timingSafeEqual()` | Same in Code node | Prevents timing attacks |
| Secret prop (`this.github_secret`) | `$env.GITHUB_WEBHOOK_SECRET` or credential | Use environment variable or n8n credential |
| Conditional logic (if/else) | If node v2.3 | `verified === true` condition |
| Google Sheets `appendOrUpdate` | Google Sheets v4.7 `appendOrUpdate` operation | Set `columnToMatchOn` and `valueToMatchOn` |
| `$.respond({ status, body })` | Respond to Webhook node v1.5 | Set `responseCode` and `responseBody` |

## Setup Instructions

### 1. Import Workflow

1. Copy the entire contents of `n8n/workflow.json`
2. Open n8n editor
3. Press **Ctrl/Cmd+V** on the canvas to paste
4. All 7 nodes and 7 connections will appear

### 2. Configure Webhook Secret

The signature verification requires a shared secret. Choose one method:

#### Option A: Environment Variable (Recommended)

1. In n8n instance, set environment variable:
   ```bash
   export GITHUB_WEBHOOK_SECRET="your-secret-here"
   ```
2. Restart n8n
3. The Code node accesses it via `$env.GITHUB_WEBHOOK_SECRET`

#### Option B: n8n Credential

1. Create a generic credential in n8n
2. Store the secret
3. Update Code node to reference credential instead of `$env`

### 3. Configure Google Sheets

#### Create the Spreadsheet

1. Create a new Google Sheet
2. In **Sheet1**, add header row:
   ```
   event_id | repository | pusher | ref | commits_count | timestamp | url
   ```

3. Copy the Spreadsheet ID from URL:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit
   ```

4. Set environment variable:
   ```bash
   export GOOGLE_SHEET_ID="YOUR_SHEET_ID"
   ```

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

The workflow includes a sample GitHub push event in `pinData`:

**Important**: The pinned signature is invalid (placeholder). To test signature verification:

1. Generate a valid signature:
   ```bash
   echo -n '{"ref":"refs/heads/main",...}' | \
   openssl dgst -sha256 -hmac "your-secret" | \
   awk '{print "sha256="$2}'
   ```

2. Update `pinData` in workflow JSON with the computed signature

3. Or use the `/diagnosing-bugs` skill to test live webhook delivery

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

- ✅ **Webhook secret** (via `$env.GITHUB_WEBHOOK_SECRET` or credential)
- ✅ **Google Sheet ID** (via `$env.GOOGLE_SHEET_ID`)
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

// Sender (GitHub) computes:
const signature = crypto
  .createHmac('sha256', secret)
  .update(requestBody, 'utf8')  // RAW body, not parsed
  .digest('hex');

// Sends as: x-hub-signature-256: sha256=<signature>

// Receiver (n8n) verifies:
const computed = crypto
  .createHmac('sha256', secret)
  .update(rawBody, 'utf8')
  .digest('hex');

const isValid = crypto.timingSafeEqual(
  Buffer.from(receivedSignature),
  Buffer.from(`sha256=${computed}`)
);
```

### Critical: Use Raw Body

The signature is computed over the **raw, unparsed body**. If you verify against the parsed JSON, signatures will always fail because:
- Whitespace differences
- Key ordering changes
- Unicode encoding variations

In n8n Webhook node, **must enable `rawBody: true`** option.

### Constant-Time Comparison

`crypto.timingSafeEqual()` prevents timing attacks:
- String comparison (`===`) can leak information about where strings differ
- Attackers measure response time to guess valid signatures byte-by-byte
- `timingSafeEqual()` always takes same time regardless of where mismatch occurs

## Google Sheets Idempotency

The `appendOrUpdate` operation ensures each event is written exactly once:

1. **Match Column**: `event_id` (GitHub commit SHA)
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
- [ ] Webhook secret configured (`$env.GITHUB_WEBHOOK_SECRET` set)
- [ ] Google Sheet created with header row
- [ ] Google Sheet ID configured (`$env.GOOGLE_SHEET_ID` set)
- [ ] Google Sheets credential configured and authorized
- [ ] Test execution with pinned data succeeds (signature validation skipped in test)
- [ ] Generate real signature and verify it validates correctly
- [ ] Webhook URL is publicly accessible (not localhost)
- [ ] GitHub webhook configured with correct secret
- [ ] Send test webhook from GitHub and verify it writes to sheet
- [ ] Verify idempotency: send same event twice, only one row in sheet

## Workflow Features

### Webhook Raw Body

Enable in Webhook node options:
```json
{
  "options": {
    "rawBody": true
  }
}
```

Without this, `$json.body` contains parsed JSON, not raw string needed for signature verification.

### Code Node Crypto Access

Node.js `crypto` module is available:
```javascript
const crypto = require('crypto');
// Full crypto API available
```

No additional npm packages needed. `crypto` is built-in.

### If Node Conditional Routing

The If node v2.3 routes execution based on conditions:
- **True output** (left): Signature valid, continue processing
- **False output** (right): Signature invalid, return 401

Prevents invalid webhooks from writing to sheet.

### Environment Variables in Code

Access n8n environment variables:
```javascript
const secret = $env.GITHUB_WEBHOOK_SECRET;
const sheetId = $env.GOOGLE_SHEET_ID;
```

Set in n8n with:
```bash
export GITHUB_WEBHOOK_SECRET="secret"
export GOOGLE_SHEET_ID="sheet-id"
```

## Troubleshooting

### All Signatures Failing

**Symptom**: Every webhook returns 401, none write to sheet.

**Causes**:
1. Secret mismatch between GitHub and n8n
2. Using parsed body instead of raw body for verification
3. Signature header name incorrect

**Fix**:
- Verify secret matches exactly in GitHub webhook settings and n8n env var
- Check Webhook node has `rawBody: true` enabled
- Confirm Code node reads `$json.body` (raw string) not `$json` (parsed)

### Writes Not Idempotent

**Symptom**: Same event creates multiple rows in sheet.

**Causes**:
1. `event_id` field missing or null
2. `columnToMatchOn` incorrectly configured
3. Event has different ID each time (timestamp-based ID)

**Fix**:
- Verify GitHub push events include `after` commit SHA as stable ID
- Check Transform Payload extracts `event_id` correctly
- Confirm Google Sheets node `columnToMatchOn: "event_id"`

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
1. n8n version too old (unlikely, crypto is built-in)
2. Custom n8n Docker image missing Node.js

**Fix**:
- Verify `crypto` is Node.js built-in (no install needed)
- Check n8n version supports Code node v2
- If self-hosted, ensure n8n Docker image includes Node.js

## Related Documentation

- [n8n Webhook Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [n8n Code Node](https://docs.n8n.io/code/builtin/overview/)
- [n8n If Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/)
- [n8n Respond to Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/)
- [n8n Google Sheets](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/)
- [GitHub Webhook Signature Verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Node.js crypto.createHmac()](https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options)
