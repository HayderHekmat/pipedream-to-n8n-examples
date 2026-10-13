# Scheduled Poll to Slack - Pipedream Workflow

## Overview

This Pipedream workflow polls the NASA Breaking News RSS feed every 15 minutes and posts new items to a Slack channel. It demonstrates Pipedream's built-in deduplication using `$.service.db` to track seen items.

## Workflow Steps

### 1. Schedule Trigger
```javascript
// Runs every 15 minutes
export default defineComponent({
  name: "schedule",
  version: "0.0.1",
  type: "trigger",
  props: {
    cron: {
      type: "string",
      default: "*/15 * * * *", // Every 15 minutes
    },
    timezone: {
      type: "string",
      default: "America/New_York",
    },
  },
  async run() {
    return {
      timestamp: new Date().toISOString(),
    };
  },
});
```

### 2. HTTP Request - Fetch RSS Feed
```javascript
export default defineComponent({
  async run({ steps, $ }) {
    const response = await axios({
      url: "https://www.nasa.gov/rss/dyn/breaking_news.rss",
      method: "GET",
    });
    
    // Parse RSS XML to JSON
    const parser = new XMLParser();
    const feed = parser.parse(response.data);
    
    return feed.rss.channel.item || [];
  },
});
```

### 3. Deduplicate - Track Seen Items
```javascript
export default defineComponent({
  async run({ steps, $ }) {
    const items = steps.http_request.$return_value;
    
    // Load seen GUIDs from Pipedream's built-in data store
    const seenGuids = (await $.service.db.get("seen_guids")) || [];
    
    // Filter out items we've already processed
    const newItems = items.filter(item => !seenGuids.includes(item.guid));
    
    // Update seen GUIDs (keep last 1000)
    const updatedGuids = [...seenGuids, ...newItems.map(i => i.guid)].slice(-1000);
    await $.service.db.set("seen_guids", updatedGuids);
    
    return newItems;
  },
});
```

### 4. Format Message
```javascript
export default defineComponent({
  async run({ steps, $ }) {
    const items = steps.deduplicate.$return_value;
    
    if (items.length === 0) {
      $.flow.exit("No new items to post");
    }
    
    return items.map(item => ({
      title: item.title,
      link: item.link,
      description: item.description?.substring(0, 200) + "...",
      pubDate: item.pubDate,
    }));
  },
});
```

### 5. Post to Slack
```javascript
export default defineComponent({
  props: {
    slack: {
      type: "app",
      app: "slack",
    },
  },
  async run({ steps, $ }) {
    const messages = steps.format_message.$return_value;
    
    for (const msg of messages) {
      await this.slack.postMessage({
        channel: "#nasa-news",
        text: `*${msg.title}*\n${msg.description}\n<${msg.link}|Read more>`,
      });
    }
  },
});
```

## Key Pipedream Features Used

### Service DB (`$.service.db`)
Pipedream automatically provides persistent key-value storage per workflow:
- `$.service.db.get(key)` - Retrieve stored data
- `$.service.db.set(key, value)` - Store data
- Data persists across workflow executions
- No additional setup required

### Timezone Configuration
- Schedule trigger respects the configured timezone
- `America/New_York` in this example
- Ensures consistent execution times regardless of server location

### Flow Control
- `$.flow.exit()` stops workflow execution early when no new items exist
- Prevents unnecessary Slack API calls

## Migration Considerations

When migrating to n8n, you need to:

1. **Seed the deduplication cursor** from `$.service.db.get("seen_guids")` before switching
   - Export the seen GUIDs before cutover
   - Load them into n8n's static data or use Remove Duplicates node history

2. **Replace Pipedream's data store** with n8n's workflow static data or Remove Duplicates node

3. **Configure timezone explicitly** in n8n workflow settings

4. **Handle concurrent execution** during cutover - both workflows may see the same items initially
