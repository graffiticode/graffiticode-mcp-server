/**
 * Skybridge widget HTML generator for Graffiticode forms
 *
 * Generates HTML that ChatGPT renders as an interactive Skybridge widget.
 * Embeds an iframe pointing to api.graffiticode.org/form endpoint.
 */

export function generateFormWidgetHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #fff; }
    .container { width: 100%; height: 100%; }
    iframe { width: 100%; height: 600px; border: none; border-radius: 8px; }
    .error {
      padding: 20px;
      color: #dc2626;
      background: #fef2f2;
      border-radius: 8px;
      text-align: center;
    }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="content" class="loading">Loading form...</div>
  </div>

  <script>
    (function() {
      var contentEl = document.getElementById('content');
      var retryCount = 0;
      var maxRetries = 60;  // Wait up to 60 seconds
      var retryInterval = 1000; // 1 second between retries

      function tryRender() {
        retryCount++;

        if (!window.openai) {
          if (retryCount < maxRetries) {
            setTimeout(tryRender, retryInterval);
          } else {
            contentEl.innerHTML = '<div class="error">Widget API not available</div>';
            contentEl.className = '';
          }
          return;
        }

        // Get tool output from Skybridge runtime
        var toolOutput = window.openai.toolOutput || window.openai.props;

        // If no data yet, check if we're in input mode
        if (!toolOutput || Object.keys(toolOutput).length === 0) {
          // If we have toolInput but no toolOutput, we're in the input phase (tool is running)
          var toolInput = window.openai.toolInput;
          if (toolInput && Object.keys(toolInput).length > 0) {
            // Show progress message while tool is running
            var description = toolInput.description || 'your request';
            contentEl.innerHTML = '<div class="loading">Creating: ' + description.substring(0, 50) + '...</div>';
            // Keep retrying silently
            if (retryCount < maxRetries) {
              setTimeout(tryRender, retryInterval);
            }
            return;
          }

          if (retryCount < maxRetries) {
            setTimeout(tryRender, retryInterval);
          } else {
            contentEl.innerHTML = '<div class="error">Waiting for data...</div>';
            contentEl.className = '';
          }
          return;
        }

        // Get _meta (widget-only data)
        var meta = window.openai.toolResponseMetadata || toolOutput._meta || {};

        // Extract data
        var data = toolOutput.structuredContent || toolOutput;
        var language = data.language;
        var taskId = data.task_id;
        var accessToken = meta.access_token || data.access_token;

        // Extract language ID (remove "L" prefix if present)
        var langId = language ? language.replace(/^L/i, '') : '';

        if (!langId || !taskId || !accessToken) {
          contentEl.innerHTML = '<div class="error">Unable to load form. Missing required data.</div>';
          contentEl.className = '';
          return;
        }

        // Build form URL with access token
        var formUrl = 'https://api.graffiticode.org/form?lang=' + langId + '&id=' + encodeURIComponent(taskId) + '&access_token=' + encodeURIComponent(accessToken);

        // Create and insert iframe
        var iframe = document.createElement('iframe');
        iframe.src = formUrl;
        iframe.allow = 'clipboard-read; clipboard-write';

        contentEl.innerHTML = '';
        contentEl.className = '';
        contentEl.appendChild(iframe);

        // Report height for ChatGPT auto-sizing
        if (window.openai.notifyIntrinsicHeight) {
          window.openai.notifyIntrinsicHeight(650);
        }

        // Listen for messages from the form iframe
        window.addEventListener('message', function(event) {
          if (event.origin === 'https://api.graffiticode.org') {
            if (event.data && event.data.type === 'data-updated') {
              if (window.openai.setWidgetState) {
                window.openai.setWidgetState({ formData: event.data.data });
              }
            }
          }
        });

        // Handle theme changes from ChatGPT
        if (window.openai.theme === 'dark') {
          document.body.style.background = '#1f2937';
        }
      }

      // Start trying to render
      tryRender();
    })();
  </script>
</body>
</html>`;
}
