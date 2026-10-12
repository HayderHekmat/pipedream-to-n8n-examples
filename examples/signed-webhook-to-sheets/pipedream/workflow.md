# Signed Webhook to Sheets - Pipedream Workflow

## Overview

This Pipedream workflow receives signed webhooks (GitHub push events as an example), verifies the HMAC-SHA256 signature against the raw request body, transforms the payload, and writes it idempotently to a Google Sheet keyed by event ID.

## Workflow Steps

### 1. HTTP / Webhook Trigger
```javascript
export default defineComponent({
  name: "webhook",
  version: "0.0.1",
  type: "trigger",
  props: {
    http: {
      type: "$.interface.http",
      customResponse: true,
    },
  },
  async run(event) {
    // Pipedream automatically parses the body
    const signature = event.headers["x-hub-signature-256"];
    const payload = event.bodyRaw; // RAW body for signature verification
    const body = event.body; // Parsed JSON

    return {
      signature,
      payload,
      body,
    };
  },
});
```

### 2. Verify Signature
```javascript
import crypto from "crypto";

export default defineComponent({
  props: {
    github_secret: {
      type: "string",
      secret: true, // Stored securely in Pipedream
    },
  },
  async run({ steps, $ }) {
    const signature = steps.webhook.signature;
    const payload = steps.webhook.payload;
    
    if (!signature) {
      throw new Error("Missing x-hub-signature-256 header");
    }
    
    // Compute HMAC-SHA256 of raw body
    const hmac = crypto
      .createHmac("sha256", this.github_secret)
      .update(payload)
      .digest("hex");
    
    const expected = `sha256=${hmac}`;
    
    // Constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
    
    if (!isValid) {
      throw new Error("Invalid signature");
    }
    
    return { verified: true };
  },
});
```

### 3. Transform Payload
```javascript
export default defineComponent({
  async run({ steps, $ }) {
    const event = steps.webhook.body;
    
    // Extract relevant fields from GitHub push event
    const row = {
      event_id: event.after || event.head_commit?.id, // Unique ID for dedup
      repository: event.repository?.full_name,
      pusher: event.pusher?.name,
      ref: event.ref,
      commits_count: event.commits?.length || 0,
      timestamp: new Date().toISOString(),
      url: event.compare,
    };
    
    return row;
  },
});
```

### 4. Write to Google Sheets (Idempotent)
```javascript
export default defineComponent({
  props: {
    googleSheets: {
      type: "app",
      app: "google_sheets",
    },
    spreadsheetId: {
      type: "string",
    },
  },
  async run({ steps, $ }) {
    const row = steps.transform_payload.$return_value;
    
    // Read existing rows to check if event_id exists
    const existing = await this.googleSheets.getValues({
      spreadsheetId: this.spreadsheetId,
      range: "Sheet1!A:A", // event_id column
    });
    
    const eventIds = existing.values?.map(r => r[0]) || [];
    
    if (eventIds.includes(row.event_id)) {
      // Already exists, update the row
      const rowIndex = eventIds.indexOf(row.event_id) + 1;
      await this.googleSheets.updateValues({
        spreadsheetId: this.spreadsheetId,
        range: `Sheet1!A${rowIndex}:G${rowIndex}`,
        values: [[
          row.event_id,
          row.repository,
          row.pusher,
          row.ref,
          row.commits_count,
          row.timestamp,
          row.url,
        ]],
      });
      
      return { action: "updated", rowIndex };
    } else {
      // New event, append
      await this.googleSheets.appendValues({
        spreadsheetId: this.spreadsheetId,
        range: "Sheet1",
        values: [[
          row.event_id,
          row.repository,
          row.pusher,
          row.ref,
          row.commits_count,
          row.timestamp,
          row.url,
        ]],
      });
      
      return { action: "appended" };
    }
  },
});
```

### 5. Respond to Webhook
```javascript
export default defineComponent({
  async run({ steps, $ }) {
    // Send 200 OK response to webhook sender
    await $.respond({
      status: 200,
      body: {
        success: true,
        action: steps.write_to_sheets.action,
      },
    });
  },
});
```

## Key Pipedream Features Used

### HTTP Interface
- `event.bodyRaw` provides the raw, unparsed request body for signature verification
- `event.body` provides the parsed JSON payload
- `event.headers` contains all HTTP headers including signature

### Secret Management
- Secrets stored in Pipedream environment variables
- Accessed via `this.secret_name` in components
- Never logged or exposed in execution history

### Custom HTTP Response
- `$.respond()` sends custom HTTP responses to webhook sender
- Can set status code, headers, and body
- Useful for acknowledgment or error reporting

### Crypto Module
- Node.js `crypto` module available by default
- `crypto.timingSafeEqual()` prevents timing attacks during signature comparison
- `crypto.createHmac()` for HMAC-SHA256 computation

## Migration Considerations

When migrating to n8n:

1. **Raw body access**: Ensure n8n Webhook node is configured to provide raw body for signature verification

2. **Secret storage**: Replace Pipedream secrets with n8n credentials or environment variables

3. **Idempotent writes**: Use Google Sheets `appendOrUpdate` operation keyed on event_id

4. **Webhook URL change**: Update the sending service to point to n8n webhook URL

5. **Cutover strategy**: Run Pipedream in "log and alert" mode during transition
   - Keep Pipedream webhook active
   - Log incoming events but don't write to sheets
   - Alert on signature validation failures
   - Verify n8n is receiving and processing all events
