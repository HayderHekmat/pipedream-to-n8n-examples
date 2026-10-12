# Pipedream Workflow: Stripe Payment to Slack Notification

## Overview
This workflow listens for successful Stripe payments and sends a formatted notification to a Slack channel.

## Trigger
**Type**: Stripe - New Payment Intent (Webhook)
**Event**: `payment_intent.succeeded`
**Configuration**:
- Stripe account connected via OAuth or API key
- Webhook automatically registered by Pipedream
- Webhook signing secret automatically managed

## Steps

### Step 1: Parse Payment Details
**Type**: Node.js Code Step
**Description**: Extracts and formats payment information from the Stripe webhook payload

**Code**:
```javascript
// Access the Stripe event data
const event = steps.trigger.event;
const paymentIntent = event.data.object;

// Extract key details
const amount = paymentIntent.amount; // Amount in cents
const currency = paymentIntent.currency.toUpperCase();
const customerEmail = paymentIntent.receipt_email || paymentIntent.charges?.data[0]?.billing_details?.email || 'N/A';
const paymentId = paymentIntent.id;
const status = paymentIntent.status;

// Format amount (convert cents to dollars/euros/etc)
const formattedAmount = (amount / 100).toFixed(2);

// Export data for next step
$.export('amount', formattedAmount);
$.export('currency', currency);
$.export('customerEmail', customerEmail);
$.export('paymentId', paymentId);
$.export('status', status);
```

### Step 2: Send Slack Message
**Type**: Slack - Send Message to Channel
**Description**: Posts a formatted message to a Slack channel

**Configuration**:
- **Slack Account**: Connected via OAuth
- **Channel**: `#payments` (or your chosen channel)
- **Message Text**:
```javascript
`✅ New Payment Received!

*Amount:* $${steps.parse_payment.$return_value.amount} ${steps.parse_payment.$return_value.currency}
*Customer Email:* ${steps.parse_payment.$return_value.customerEmail}
*Payment ID:* ${steps.parse_payment.$return_value.paymentId}
*Status:* ${steps.parse_payment.$return_value.status}

View in Stripe Dashboard: https://dashboard.stripe.com/payments/${steps.parse_payment.$return_value.paymentId}
```

**Alternative Implementation**: Instead of using the Slack action, you could use an HTTP Request step:

```javascript
// Alternative: HTTP Request to Slack API
await require("@pipedreamhq/platform").axios(this, {
  method: 'POST',
  url: 'https://slack.com/api/chat.postMessage',
  headers: {
    'Authorization': `Bearer ${auths.slack.oauth_access_token}`,
    'Content-Type': 'application/json',
  },
  data: {
    channel: '#payments',
    text: `✅ New Payment Received!\n\n*Amount:* $${steps.parse_payment.$return_value.amount} ${steps.parse_payment.$return_value.currency}\n*Customer Email:* ${steps.parse_payment.$return_value.customerEmail}\n*Payment ID:* ${steps.parse_payment.$return_value.paymentId}`,
  }
});
```

## Data Flow
1. **Trigger** receives Stripe webhook with `payment_intent.succeeded` event
2. **Step 1** exports: `amount`, `currency`, `customerEmail`, `paymentId`, `status`
3. **Step 2** accesses: `steps.parse_payment.$return_value.amount`, etc.
4. **Step 2** posts message to Slack channel

## Environment Variables (if used)
- `SLACK_CHANNEL_ID` (optional): Override default channel
- `STRIPE_MODE` (optional): 'test' or 'live' indicator for message formatting

## Error Handling
- Pipedream automatically retries failed steps (exponential backoff)
- Errors are logged in Pipedream dashboard
- Optional: Add a separate error notification step

## Notes
- Pipedream automatically verifies Stripe webhook signatures
- Webhook URL format: `https://[unique-id].m.pipedream.net`
- No need to manually register webhook; Pipedream handles it
- Step exports use `$.export()` function
- Step data is accessed via `steps.[step_name].$return_value.[key]`
