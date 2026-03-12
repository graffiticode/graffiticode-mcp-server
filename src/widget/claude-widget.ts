/**
 * Claude MCP Apps widget HTML generator for Graffiticode forms
 *
 * Generates HTML that Claude renders as an interactive MCP App widget.
 * Uses postMessage protocol for communication with Claude host.
 * Embeds an iframe pointing to api.graffiticode.org/form endpoint.
 */

export function generateClaudeWidgetHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #fff; }
    body.dark { background: #1f2937; color: #f9fafb; }
    .container { width: 100%; height: 100%; }
    iframe { width: 100%; height: 600px; border: none; border-radius: 8px; }
    .error {
      padding: 20px;
      color: #dc2626;
      background: #fef2f2;
      border-radius: 8px;
      text-align: center;
    }
    body.dark .error {
      color: #fca5a5;
      background: #450a0a;
    }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: #6b7280;
    }
    body.dark .loading {
      color: #9ca3af;
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
      var initialized = false;

      function renderWidget(toolOutput) {
        if (initialized) return;
        initialized = true;

        // Get _meta (widget-only data)
        var meta = toolOutput._meta || {};

        // Extract data from structuredContent or directly from toolOutput
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

        // Send resize notification to Claude host
        window.parent.postMessage({
          jsonrpc: '2.0',
          method: 'ui/resize',
          params: { height: 650 }
        }, '*');

        // Listen for messages from the form iframe
        window.addEventListener('message', function(event) {
          if (event.origin === 'https://api.graffiticode.org') {
            if (event.data && event.data.type === 'data-updated') {
              // Could notify Claude of state changes if needed
            }
          }
        });
      }

      function updateTheme(theme) {
        if (theme === 'dark') {
          document.body.classList.add('dark');
        } else {
          document.body.classList.remove('dark');
        }
      }

      // Listen for MCP Apps messages from Claude host
      window.addEventListener('message', function(event) {
        var msg = event.data;

        // Only handle JSON-RPC 2.0 messages
        if (!msg || msg.jsonrpc !== '2.0') return;

        if (msg.method === 'ui/initialize') {
          // msg.params contains { toolOutput, toolInput }
          if (msg.params && msg.params.toolOutput) {
            renderWidget(msg.params.toolOutput);
          }
        }

        if (msg.method === 'ui/theme') {
          // msg.params contains { theme: 'light' | 'dark' }
          if (msg.params && msg.params.theme) {
            updateTheme(msg.params.theme);
          }
        }
      });
    })();
  </script>
</body>
</html>`;
}
