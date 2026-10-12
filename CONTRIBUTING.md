# Contributing to Pipedream to n8n Examples

Thank you for considering contributing to this repository! Your real-world migration examples will help others successfully transition from Pipedream to n8n.

## What Makes a Good Example?

A good example should:
- ✅ Represent a common, real-world use case
- ✅ Include both the Pipedream workflow representation and working n8n workflow JSON
- ✅ Be well-documented with setup instructions and migration notes
- ✅ Use current n8n node versions and best practices
- ✅ Include clear explanations of differences between platforms

## Example Folder Structure

Each example should follow this structure:

```
examples/
└── your-example-name/
    ├── README.md                  # Example-specific documentation
    ├── pipedream/
    │   ├── workflow.md            # Description of Pipedream workflow
    │   └── code-step-1.js         # Any code steps (numbered)
    └── n8n/
        └── workflow.json          # Importable n8n workflow
```

### Folder Naming Convention
- Use lowercase with hyphens: `stripe-payment-to-slack`
- Be descriptive and concise
- Use format: `[source-service]-[action]-to-[destination-service]` when applicable

### Required Files

#### 1. `README.md` (Example-specific)

Your example README should include:

```markdown
# [Example Name]

## What This Example Does
[1-2 sentence description]

## Pipedream Workflow Overview
[Describe the trigger and key steps]

## n8n Workflow Overview
[Describe how it maps to n8n nodes]

## Setup Instructions

### Prerequisites
- [List required accounts, credentials, etc.]

### n8n Setup
1. Import the workflow from `n8n/workflow.json`
2. Configure credentials:
   - **Service 1**: [Instructions]
   - **Service 2**: [Instructions]
3. [Any additional setup steps]

### Testing
1. [How to test with sample data]
2. [How to trigger a test event]
3. [What to look for in the execution log]

## Migration Notes

### Key Differences
- **Webhook URL**: [Explain change]
- **Data Format**: [Explain any transformations]
- **Error Handling**: [Explain any changes]

### Gotchas
- [Common pitfalls or things to watch out for]

### Additional Considerations
- [Performance, cost, limitations, etc.]
```

#### 2. `pipedream/workflow.md`

Since Pipedream workflows aren't easily exported as a single file, create a clear representation:

```markdown
# Pipedream Workflow: [Name]

## Trigger
**Type**: [Webhook / Schedule / App Event]
**Configuration**:
- [Key settings]

## Steps

### Step 1: [Name]
**Type**: [Code / Action / HTTP Request]
**Description**: [What it does]

**Code** (if applicable):
\`\`\`javascript
// Code here
\`\`\`

**Configuration** (for actions/integrations):
- Setting 1: value
- Setting 2: value

### Step 2: [Name]
...

## Data Flow
- Step 1 exports: `$.export('key', value)`
- Step 2 accesses: `steps.step1.$return_value.key`
```

#### 3. `n8n/workflow.json`

- Export your workflow from n8n (Workflow menu → Download)
- **Remove** any credentials or sensitive data
- Use credential placeholders: `"id": null, "name": "Service Name Credential"`
- Validate the JSON structure before committing (run `npm run validate`)

## Submitting Your Example

### Before Submitting
1. ✅ Test the n8n workflow on a fresh n8n instance
2. ✅ Verify all credentials are removed from `workflow.json`
3. ✅ Run `npm run validate` to check workflow JSON structure
4. ✅ Write clear, beginner-friendly documentation
5. ✅ Add your example to the table in the main `README.md`

### Pull Request Process
1. Fork this repository
2. Create a new branch: `git checkout -b add-example-name`
3. Add your example folder under `examples/`
4. Update the examples table in the main `README.md`
5. Commit your changes with a clear message: `Add [example-name] migration example`
6. Push to your fork and submit a pull request
7. In the PR description:
   - Describe the use case
   - List any external services/credentials needed
   - Note any testing you performed

### PR Checklist
- [ ] Example follows the folder structure
- [ ] README includes all required sections
- [ ] n8n workflow JSON is valid and importable
- [ ] No credentials or sensitive data in files
- [ ] Validation script passes (`npm run validate`)
- [ ] Main README table updated with new example
- [ ] PR description explains the use case

## Style Guidelines

### Documentation
- Use clear, concise language
- Write for beginners (assume no prior n8n experience)
- Include screenshots if helpful (store in `examples/your-example/images/`)
- Use code blocks with syntax highlighting
- Link to official documentation when referencing features

### Code
- Format JSON with 2-space indentation
- Use meaningful node names in n8n workflows
- Add notes to complex nodes in the n8n editor
- Follow n8n best practices (error handling, retries, etc.)

### Naming
- **Node names**: Use descriptive names like "Get Customer from Stripe" instead of "HTTP Request"
- **Credential names**: Use service name + purpose, e.g., "Stripe Production API" or "Slack Bot"

## Node Verification

When creating n8n workflows:
1. Verify node type names against [n8n documentation](https://docs.n8n.io/integrations/builtin/)
2. Check node `typeVersion` (use current/recommended versions)
3. Validate parameter names by inspecting nodes in the n8n UI
4. Test with the latest stable n8n version

Common node types:
- `n8n-nodes-base.stripeTrigger` (Stripe Trigger)
- `n8n-nodes-base.slack` (Slack)
- `n8n-nodes-base.httpRequest` (HTTP Request)
- `n8n-nodes-base.code` (Code / Function)
- `n8n-nodes-base.set` (Edit Fields / Set)

## Questions or Need Help?

- Open an issue with the `question` label
- Check existing examples for reference
- Review the [n8n documentation](https://docs.n8n.io)
- Ask in the [n8n community forum](https://community.n8n.io)

## Code of Conduct

- Be respectful and constructive
- Focus on helping others migrate successfully
- Provide accurate, tested examples
- Credit original sources when applicable

---

Thank you for contributing! Your examples help the community migrate successfully before the Pipedream shutdown on **March 31, 2027**. 🙏
