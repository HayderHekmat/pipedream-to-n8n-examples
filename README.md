# Pipedream to n8n Migration Examples

This repository provides real-world examples and guidance to help you migrate your workflows from Pipedream to n8n ahead of **Pipedream's shutdown on March 31, 2027**.

## Why This Repository?

With Pipedream shutting down on **2027-03-31**, many developers need to migrate their automation workflows to alternative platforms. n8n is a powerful open-source workflow automation tool that offers similar capabilities with the added benefits of self-hosting and extensive customization.

## Repository Organization

This repository is organized as follows:

```
├── README.md              # This file
├── CHECKLIST.md           # Comprehensive migration checklist
├── CONTRIBUTING.md        # Guide for contributing new examples
└── examples/
    └── stripe-payment-to-slack/
        ├── README.md           # Example-specific documentation
        ├── pipedream/          # Original Pipedream workflow representation
        └── n8n/                # n8n workflow JSON (ready to import)
```

## Available Examples

| Example | Description | Pipedream Features | n8n Features |
|---------|-------------|-------------------|--------------|
| [Stripe Payment → Slack](./examples/stripe-payment-to-slack/) | Sends a Slack notification when a Stripe payment succeeds | Stripe webhook trigger, Code step | Stripe Trigger node, Slack node |

More examples coming soon! Contributions welcome.

## How to Use These Examples

### 1. Importing n8n Workflows

Each example includes an `n8n/workflow.json` file that you can import directly into your n8n instance:

**Method 1: Import from File**
1. Open your n8n editor
2. Click on the **Workflow** menu (three dots) in the top-right corner
3. Select **"Import from File"**
4. Choose the `workflow.json` file from the example folder
5. The workflow will appear in your n8n canvas

**Method 2: Paste JSON directly**
1. Open the workflow JSON file
2. Copy the entire contents (Ctrl/Cmd+C)
3. In n8n, click on an empty area of the canvas
4. Paste with **Ctrl+V** (Windows/Linux) or **Cmd+V** (Mac)
5. The workflow will appear on the canvas

**Method 3: Import from URL**
1. Click on the **Workflow** menu (three dots) in the top-right corner
2. Select **"Import from URL"**
3. Enter the URL to a workflow JSON file (e.g., from GitHub)
4. Click **"Import"**

### 2. Setting Up Credentials

After importing a workflow, you'll need to configure credentials for each service:

1. Click on a node that requires credentials (marked with a red warning icon)
2. Click **"Create New"** under the credential field
3. Follow the service-specific instructions to authenticate:
   - **Stripe**: Enter your Stripe API key (test or live mode) and webhook signing secret
   - **Slack**: Use OAuth2 or create a Slack App with the required scopes (`chat:write`, `channels:read`)
4. Test the credential connection
5. Save the credential

**Important**: Never commit credentials or API keys to version control. The workflow JSON files use credential placeholders.

### 3. Testing Your Workflow

Before activating a workflow for production:

1. **Test mode**: Use test mode credentials (e.g., Stripe test mode) when available
2. **Manual trigger**: If the workflow has a manual trigger node, execute it to verify each step
3. **Sample data**: Use the "Execute node" feature to test individual nodes with sample data
4. **Webhook testing**: For webhook-based triggers:
   - Activate the workflow (this registers the webhook with the external service)
   - Trigger a test event from the external service (e.g., use Stripe's "Send test webhook" feature)
   - Check the workflow execution log in n8n

### 4. Activating Your Workflow

Once testing is complete:

1. Switch to **production credentials** (e.g., Stripe live mode)
2. Toggle the workflow to **Active** using the switch in the top-right corner
3. n8n will register webhooks with external services automatically
4. Monitor the first few executions to ensure everything works as expected

**For webhook-based workflows**: When you activate a workflow with a webhook trigger (like Stripe), n8n automatically creates and registers the webhook endpoint with that service. For services that use webhook signature verification (like Stripe), you must manually copy the signing secret from the service's dashboard to your n8n credential after activation - this is because n8n's verification reads from the credential, not from the automatically-stored webhook data. See the [Stripe example README](./examples/stripe-payment-to-slack/README.md) for detailed steps.

## Migration Checklist

Before starting your migration, review the comprehensive [CHECKLIST.md](./CHECKLIST.md) which covers:

- ✅ Inventorying your existing Pipedream workflows
- ✅ Mapping Pipedream concepts to n8n equivalents
- ✅ Credential and environment variable migration
- ✅ Webhook URL updates and re-registration
- ✅ Testing strategies and parallel run approaches
- ✅ Monitoring and rollback plans
- ✅ Final cutover steps before the 2027-03-31 deadline

## Contributing

We welcome contributions! If you've successfully migrated a workflow pattern from Pipedream to n8n, consider sharing it here to help others.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on:
- Example folder structure
- Documentation requirements
- What makes a good example

## Resources

- **n8n Documentation**: https://docs.n8n.io
- **n8n Community Forum**: https://community.n8n.io
- **n8n GitHub**: https://github.com/n8n-io/n8n
- **Pipedream Documentation Archive**: https://pipedream.com/docs

---

**Need help migrating? Free check: https://pipedream-to-n8n.vercel.app/**

---

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Pipedream or n8n. All trademarks, service marks, trade names, product names, and logos are the property of their respective owners.
