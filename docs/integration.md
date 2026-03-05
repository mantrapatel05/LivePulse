# LivePulse V1 Integration

## 1) Add the SDK script

```html
<script src="https://your-cdn/livepulse.js" data-api-key="YOUR_PROJECT_API_KEY"></script>
```

Or initialize manually:

```html
<script src="https://your-cdn/livepulse.js"></script>
<script>
  window.LivePulse.init({
    apiKey: 'YOUR_PROJECT_API_KEY',
    endpoint: 'http://localhost:5000/api/events/ingest',
    projectId: 'optional-project-id',
    userId: 'anonymous'
  });
</script>
```

## 2) Event payload shape (V1)

```json
{
  "project_id": "string",
  "session_id": "string",
  "user_id": "string | anonymous",
  "event_type": "page_view | click | error | rage_click | custom",
  "url": "string",
  "element": "string | null",
  "timestamp": "ISO8601",
  "metadata": {}
}
```

## 3) Backend ingest endpoint

- `POST /api/events/ingest`
- Header: `x-api-key: <project-api-key>`
- Content type: `application/json`

The backend accepts both `snake_case` and `camelCase` keys for compatibility.
