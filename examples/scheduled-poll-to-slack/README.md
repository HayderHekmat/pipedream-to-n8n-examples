# Scheduled Poll to Slack

Poll the NASA Breaking News RSS feed every 15 minutes and post new items to a Slack channel. Demonstrates scheduled execution, RSS parsing, deduplication with Remove Duplicates node, and timezone handling.

## What This Workflow Does

1. **Schedule Trigger**: Runs every 15 minutes in the `America/New_York` timezone
2. **RSS Feed Read**: Fetches and parses NASA Breaking News RSS feed
3. **Remove Duplicates**: Filters out items seen in previous executions using GUID field
4. **Format for Slack**: Transforms RSS items into Slack-formatted messages
5. **Post to Slack**: Sends formatted messages to `#nasa-news` channel

## Pipedream → n8n Mapping

| Pipedream | n8n | Notes |
|-----------|-----|-------|
| Schedule trigger (`*/15 * * * *`) | Schedule Trigger node (every 15 minutes) | Use `rule.interval` with `minutesInterval: 15` |
| HTTP Request + XML parsing | RSS Read node (`rssFeedRead` v1.2) | Regular node, not a trigger — a Schedule Trigger cannot feed another trigger |
| `$.service.db` for seen GUIDs | Remove Duplicates v2 `removeItemsSeenInPreviousExecutions` | Dedupes on `={{ $json.guid }}`; history lives in n8n processed-data, not workflow `staticData` |
| Code step for formatting | Code node (`runOnceForAllItems` mode) | Process all items together |
| Slack `postMessage` | Slack node v2.4 (`message.post`) | Use `resource: "message"`, `operation: "post"` |
| Timezone in trigger config | Workflow settings `timezone` field | Set at workflow level, not per-node |

## Setup Instructions

### 1. Import Workflow

1. Copy the entire contents of `n8n/workflow.json`
2. Open n8n editor
3. Press **Ctrl/Cmd+V** on the canvas to paste
4. All nodes and connections will appear

### 2. Configure Credentials

#### Slack OAuth2 API

The Slack node requires OAuth2 credentials:

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Add OAuth scopes:
   - `chat:write` (post messages)
   - `chat:write.public` (post to public channels without joining)
3. Install app to workspace
4. In n8n, create **Slack OAuth2 API** credential with your Client ID, Client Secret, and OAuth Token
5. Assign credential to the **Post to Slack** node

#### Channel Configuration

Update the channel name in the **Post to Slack** node:
- Default: `#nasa-news`
- Change `channelId.value` to your target channel

### 3. Configure Timezone (Optional)

The workflow is set to `America/New_York`. To change:

1. Open workflow settings (gear icon)
2. Set **Timezone** to your preferred zone
3. Save workflow

The Schedule Trigger will execute at consistent local times in this timezone.

### 4. Test with Pinned Data

The workflow includes sample NASA RSS items in `pinData`:

1. Click **Post to Slack** node
2. Enable **Use pinned data** (pin icon)
3. Click **Execute node** to test Slack posting
4. Disable pinned data before activating workflow

### 5. Seed Deduplication from Pipedream State (Do This Before Cutover)

Remove Duplicates v2 does **not** read workflow `staticData`. It records seen keys in n8n's processed-data store the first time the node runs. Seed that store from Pipedream **before** you activate the schedule, or the first poll will treat historical GUIDs as new and double-post.

**1. Export seen GUIDs from Pipedream** (temporary step):

```javascript
export default defineComponent({
  async run({ $ }) {
    const seenGuids = (await $.service.db.get("seen_guids")) || [];
    console.log(JSON.stringify(seenGuids));
    return seenGuids;
  }
});
```

**2. One-shot seed in n8n (same Remove Duplicates node):**

1. Keep the Slack node unconfigured or disconnected so the seed run cannot post.
2. Temporarily pin **Fetch NASA RSS** (or add a Manual Trigger → Code node) with one item per historical GUID:
   ```json
   { "json": { "guid": "https://www.nasa.gov/..." } }
   ```
3. Execute **only through Remove Duplicates**. Use the same parameters as production:
   - Operation: `removeItemsSeenInPreviousExecutions`
   - Keep Items Where: `removeItemsWithAlreadySeenKeyValues`
   - Value to Dedupe On: `={{ $json.guid }}`
4. Items with those GUIDs are now stored as already seen.
5. Unpin / remove the seed input. Reconnect Slack. Then activate the schedule.

Do **not** paste GUIDs into `workflow.staticData`. v2 ignores that field.

If you skip seeding, run both systems in parallel and expect duplicates until n8n has observed each GUID once.

## Cutover Strategy

### Phase 0: Seed (required to avoid double posts)

1. Export `seen_guids` from Pipedream
2. Run the one-shot seed through Remove Duplicates (Slack disconnected)
3. Confirm a second execute of the same GUIDs yields an empty Kept output

### Phase 1: Parallel Run (1 hour)

1. **Start n8n schedule** alongside running Pipedream workflow
2. If you seeded, n8n should not re-post historical items
3. **Monitor Slack** for anything still double-posted (new items published during the overlap)

### Phase 2: Deactivate Pipedream

1. **After 1 hour** (4 execution cycles), disable Pipedream workflow
2. n8n Remove Duplicates now also has any GUIDs first seen during the overlap
3. No more duplicates

### Why This Works

- RSS feed updates ~2-3 times per day
- Remove Duplicates retains the last 1000 GUIDs (`historySize`)
- Seeding copies Pipedream's cursor so cutover does not replay the feed
- 1 hour of overlap covers items published after the export and before Pipedream is paused

### Rollback Plan

If n8n fails:
1. Immediately reactivate Pipedream workflow
2. Deactivate n8n workflow
3. No data loss - RSS feed is stateless and re-fetchable

## Manual Configuration Required

### Must Configure Before Activation

- ✅ **Slack credentials** (OAuth2 token with `chat:write` scope)
- ✅ **Slack channel name** (update `#nasa-news` to your channel)
- ⚠️ **Timezone** (if different from `America/New_York`)

### Optional Tuning

- **Schedule interval**: Change `minutesInterval` in Schedule Trigger v1.3 (default: 15)
- **Max retained GUIDs**: Adjust `options.historySize` in Remove Duplicates (default: 1000)
- **RSS feed URL**: Change `url` on the RSS Read node to any valid RSS 2.0 feed

## Cutover Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Duplicate posts during parallel run** | Users see same news item twice in first hour | Communicate to team; duplicates stop after 1 hour |
| **Missing items during cutover** | News item posted in 15-min gap between runs | Run both workflows in parallel for 1 hour to eliminate gap |
| **Timezone mismatch** | Workflow runs at unexpected times | Verify workflow settings timezone matches your team's location |
| **Slack rate limits** | Failed posts if many new items | NASA RSS updates slowly (~2-3/day); unlikely to hit limits |
| **Feed URL change** | RSS fetch fails if NASA changes URL | Monitor n8n executions; update URL if needed |

## Testing Checklist

Before activating:

- [ ] Import workflow successfully (5 nodes, 4 connections)
- [ ] Slack credentials configured and tested
- [ ] Channel name updated to your target channel
- [ ] Timezone set correctly in workflow settings
- [ ] Test execution with pinned data succeeds
- [ ] Remove pinned data before activation
- [ ] Schedule trigger set to active

## Workflow Features

### Remove Duplicates Node (v2)

Use operation `removeItemsSeenInPreviousExecutions` with `dedupeValue: {{ $json.guid }}`:
- History is stored in n8n's processed-data helper (survives restarts)
- `options.historySize` caps how many GUIDs are retained (default 1000)
- First output is Kept (new items); discarded items go to the unused second output
- Seed from Pipedream `$.service.db` **before** activating the schedule (see setup above)

### Schedule Trigger Timezone

Unlike Pipedream's per-trigger timezone, n8n sets timezone at the **workflow level**:
- Go to **Workflow > Settings > Timezone**
- All time-based nodes respect this setting
- Defaults to `Europe/Berlin` if not set
- This example uses Schedule Trigger **v1.3** (v1.4 is not in n8n-nodes-base@2.15.1)

### RSS Read (regular node)

A trigger cannot feed `rssFeedReadTrigger`. This workflow is:

`Schedule Trigger → rssFeedRead → Remove Duplicates → Code → Slack 2.4`

- Fetches the feed on each schedule execution
- Parses RSS 2.0 and Atom feeds automatically
- Returns items with `title`, `link`, `description`, `guid`, `pubDate`

## Troubleshooting

### No Items Appearing

**Symptom**: Workflow executes but no Slack messages posted.

**Causes**:
1. All items deduplicated (already seen)
2. RSS feed empty or unchanged
3. Code node filters out all items

**Fix**:
- Check Remove Duplicates output (should have items)
- Clear dedup history: Edit workflow static data and empty `removeDuplicatesHistory`
- Test with pinned data to verify Slack posting works

### Duplicate Posts

**Symptom**: Same item posted multiple times.

**Causes**:
1. GUID field missing or null in RSS items
2. Remove Duplicates history cleared
3. Parallel Pipedream + n8n execution

**Fix**:
- Verify RSS feed includes `<guid>` tags
- Check Remove Duplicates `fieldsToCompare` uses correct field name
- Wait 1 hour for parallel run phase to complete

### Timezone Issues

**Symptom**: Workflow runs at wrong time.

**Causes**:
1. Workflow timezone not set (defaults to `Europe/Berlin`)
2. Local machine timezone vs. n8n server timezone confusion

**Fix**:
- Open **Workflow Settings** and explicitly set timezone
- Verify in execution history that timestamps match expected local time

## Related Documentation

- [n8n Schedule Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/)
- [n8n RSS Read](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.rssfeedread/)
- [n8n Remove Duplicates](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.removeduplicates/)
- [n8n Slack Node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.slack/)
- [NASA RSS Feeds](https://www.nasa.gov/rss/dyn/breaking_news.rss)
