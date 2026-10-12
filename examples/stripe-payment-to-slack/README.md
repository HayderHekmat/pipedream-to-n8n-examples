# Stripe Payment to Slack Notification

## What This Example Does

This workflow monitors Stripe payments and automatically sends a notification to a Slack channel when a payment succeeds. It demonstrates how to migrate a common webhook-based workflow from Pipedream to n8n.

## Pipedream Workflow Overview

The original Pipedream workflow consists of:
1. **Stripe Trigger**: Listens for `payment_intent.succeeded` webhook events
2. **Code Step**: Extracts and formats payment details (amount, currency, customer email, payment ID)
3. **Slack Action**: Posts a formatted message to a Slack channel

Pipedream automatically handles webhook registration and signature verification.

## n8n Workflow Overview

The n8n equivalent uses:
1. **Stripe Trigger Node**: Listens for `payment_intent.succeeded` events
2. **Code Node**: JavaScript to extract and format payment data
3. **Slack Node**: Sends message to channel using `chat.postMessage`

n8n also handles webhook registration automatically when you activate the workflow.

## Setup Instructions

### Prerequisites

- n8n instance (self-hosted or n8n Cloud)
- Stripe account with API access
- Slack workspace with permission to create apps

### n8n Setup

#### 1. Import the Workflow

1. Download or copy the contents of `n8n/workflow.json`
2. In your n8n editor, click the menu (⋮) in the top-right
3. Select **"Import from File"** or **"Import from URL"**
4. Paste the JSON or upload the file
5. Click **"Import"**

#### 2. Configure Stripe Credentials

1. Click on the **"Stripe Trigger"** node
2. Under **Credentials**, click **"Create New"**
3. Enter a name (e.g., "Stripe API - Production")
4. Add your Stripe **Secret Key**:
   - For test mode: Use your test secret key (starts with `sk_test_`)
   - For live mode: Use your live secret key (starts with `sk_live_`)
   - Find it in Stripe Dashboard → Developers → API keys
5. Leave **Signature Secret** blank for now (we'll add it after activation)
6. Click **"Save"**

#### 3. Configure Slack Credentials

1. Click on the **"Send to Slack"** node
2. Under **Authentication**, select **OAuth2**
3. Click **"Create New"** credential
4. You have two options:

   **Option A: Use n8n's OAuth flow (recommended)**
   - Follow n8n's prompts to connect to Slack
   - Authorize the required scopes (`chat:write`, `channels:read`)
   
   **Option B: Create a Slack App manually**
   - Go to https://api.slack.com/apps
   - Click **"Create New App"** → **"From scratch"**
   - Name it (e.g., "n8n Notifications") and choose your workspace
   - Go to **OAuth & Permissions**
   - Add Bot Token Scopes: `chat:write`, `channels:read`
   - Install the app to your workspace
   - Copy the **Bot User OAuth Token** (starts with `xoxb-`)
   - Paste it in n8n's credential field

5. Click **"Save"**

#### 4. Select Slack Channel

1. In the **"Send to Slack"** node, under **Channel**, click the dropdown
2. Select your desired channel (e.g., `#payments`, `#notifications`)
3. If the channel doesn't appear, make sure:
   - The Slack bot is invited to the channel (type `/invite @your-bot-name` in the channel)
   - Your OAuth scopes include `channels:read`

#### 5. Activate the Workflow

1. Click the toggle switch in the top-right to activate the workflow
2. n8n will automatically:
   - Generate a webhook URL
   - Register the webhook with Stripe
   - Create a webhook endpoint in your Stripe account

#### 6. Add Stripe Signing Secret (Important!)

After activation, you must configure the signing secret for webhook verification.

**Why is this necessary?** When n8n creates the Stripe webhook endpoint, Stripe returns a signing secret which n8n stores in workflow static data. However, n8n's signature verification (which prevents forged webhook requests) reads the secret from your Stripe API credential, not from workflow static data. This separation means you must manually copy the secret from Stripe Dashboard to your credential. (Source: [`StripeTrigger.node.ts`](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Stripe/StripeTrigger.node.ts) - webhook creation stores `webhookSecret`, while [`StripeTriggerHelpers.ts`](https://github.com/n8n-io/n8n/commit/e5051286c9e6203258fbe1a878fa824f2e428aea) - verification reads `credential.signatureSecret`)

**Setup steps**:
1. Go to your Stripe Dashboard → **Developers** → **Webhooks**
2. Find the webhook endpoint created by n8n:
   - Look for description: "Created by n8n for workflow ID: [your-workflow-id]"
   - Or match the webhook URL to your n8n URL
3. Click on the endpoint
4. Under **Signing secret**, click **"Click to reveal"**
5. Copy the secret (starts with `whsec_`)
6. Go back to n8n and open your **Stripe API** credential
7. Paste the signing secret into the **Signature Secret** field
8. Click **"Save"**

**Note**: If using both test and live modes, you'll need separate credentials and signing secrets for each.

### Testing

#### Test with Stripe's Webhook Testing Tool

1. In Stripe Dashboard, go to **Developers** → **Webhooks**
2. Click on your n8n webhook endpoint
3. Click **"Send test webhook"**
4. Select event type: **`payment_intent.succeeded`**
5. Click **"Send test webhook"**
6. Check n8n's execution log (click "Executions" in n8n sidebar)
7. Verify the Slack message was sent to your channel

#### Test with a Real Payment (Test Mode)

1. Make sure you're using Stripe test mode credentials
2. Create a test payment:
   - Use Stripe's test card: `4242 4242 4242 4242`
   - Any future expiry date
   - Any CVC
3. Complete the payment
4. Check your Slack channel for the notification
5. Verify the payment details are correct

#### What to Look For

In the n8n execution log:
- ✅ **Stripe Trigger** receives the webhook payload
- ✅ **Format Payment Data** node outputs formatted data
- ✅ **Send to Slack** node shows successful message post

In Slack:
- ✅ Message appears with payment details
- ✅ Amount is correctly formatted (in dollars, not cents)
- ✅ Stripe dashboard link is clickable

## Migration Notes

### Key Differences Between Pipedream and n8n

#### 1. Webhook URL Changes
- **Pipedream**: `https://[unique-id].m.pipedream.net`
- **n8n**: `https://[your-n8n-domain]/webhook/[workflow-id]` (or similar, depending on setup)
- **Action Required**: You must update webhook URLs in external services if migrating an existing workflow. In this case, n8n registers the webhook automatically, but if you're switching from Pipedream, you may need to remove the old Pipedream webhook from Stripe first.

#### 2. Stripe Signing Secret
- **Pipedream**: Automatically managed; you don't need to configure it
- **n8n**: Must be manually copied from Stripe and added to the n8n credential after activation
- **Why**: This ensures n8n can verify that webhook requests genuinely come from Stripe

#### 3. Data Access Patterns
- **Pipedream**:
  ```javascript
  $.export('amount', formattedAmount);
  // Access in next step:
  steps.parse_payment.$return_value.amount
  ```
- **n8n**:
  ```javascript
  return { json: { amount: formattedAmount } };
  // Access in next node:
  {{ $json.amount }}
  ```

#### 4. Code Node Differences
- **Pipedream**: Use `$.export()` to pass data to next step
- **n8n**: Use `return { json: { ... } }` to output data
- **Pipedream**: Access previous steps via `steps.step_name.$return_value`
- **n8n**: Access previous nodes via `$json.field` or `{{ $node["Node Name"].json.field }}`

#### 5. Amount Formatting
- Both Stripe and n8n receive amounts in **cents**
- The Code node divides by 100 to display in dollars/euros
- Make sure to format consistently with your currency

#### 6. Test vs. Live Mode
- **Pipedream**: Can connect one Stripe account per workflow
- **n8n**: Use separate credentials for test and live mode
- **Tip**: Create two workflows (one for test, one for live) or use environment-based credential selection

#### 7. Retries and Idempotency
- **Pipedream**: Automatic retries with exponential backoff
- **n8n**: Configure retries per node (click node → Settings → Continue on Fail, Retry on Fail)
- **Recommendation**: Enable "Retry on Fail" on the Slack node with 3-5 retries

#### 8. Error Handling
- **Pipedream**: Errors are logged in Pipedream dashboard; optional error notifications
- **n8n**: Configure error workflows or use n8n's error notification settings (Settings → Community Nodes → Error Trigger)

### Gotchas

1. **Slack Channel Selection**: Make sure to invite the Slack bot to the channel before sending messages. The bot can only post to channels it's a member of.

2. **Stripe Webhook Signature Verification**: If you forget to add the signing secret, n8n will reject webhook requests with a `401 Unauthorized` error. Always add the signing secret after activation.

3. **Activation Required**: Unlike Pipedream, n8n workflows must be explicitly **activated** (toggled on) to receive webhooks. Inactive workflows will not register webhooks.

4. **Multiple Workflow Versions**: If you import a workflow multiple times or duplicate it, each will create a separate webhook endpoint in Stripe. Clean up old endpoints to avoid duplicate notifications.

5. **Credential Scope**: Make sure your Slack OAuth token has the `chat:write` scope. If you created the Slack app manually, you must add this scope and reinstall the app.

6. **Amount in Cents**: Stripe always sends amounts in cents (or smallest currency unit). The Code node converts this to dollars by dividing by 100. If you use a different currency with different subunits (e.g., Japanese Yen has no subunits), adjust the logic accordingly.

### Additional Considerations

- **Performance**: n8n workflows generally perform similarly to Pipedream for webhook-based workflows. Monitor execution times if you have high-volume webhooks.

- **Cost**: Self-hosted n8n has no per-execution costs, unlike Pipedream's credit-based system. n8n Cloud pricing is based on workflow executions.

- **Scalability**: For high-volume webhooks (thousands per minute), consider:
  - n8n Cloud with higher execution limits
  - Self-hosted n8n with queue mode and Redis
  - Rate limiting on the Stripe side if needed

- **Logging**: n8n logs are available in the Executions panel. For self-hosted instances, you can also access server logs for debugging.

- **Custom Domains**: If using a custom domain for n8n webhooks, make sure SSL/TLS is properly configured. Stripe requires HTTPS for webhook endpoints.

## Resources

- [n8n Stripe Trigger Docs](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.stripetrigger)
- [n8n Slack Node Docs](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.slack)
- [Stripe Webhooks Documentation](https://stripe.com/docs/webhooks)
- [Stripe Test Cards](https://stripe.com/docs/testing)

---

**Questions or issues?** Open an issue in this repository or check the [n8n community forum](https://community.n8n.io).
