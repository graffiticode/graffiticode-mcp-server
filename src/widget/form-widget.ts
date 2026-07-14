/**
 * Skybridge widget HTML generator for Graffiticode forms
 *
 * Generates HTML that ChatGPT renders as an interactive Skybridge widget.
 * Embeds an iframe pointing to the server-built `_meta.form_url`.
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
    .card {
      padding: 28px 24px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      text-align: center;
      background: #f9fafb;
    }
    .card-title { font-size: 16px; font-weight: 600; color: #111827; }
    .card-text { margin-top: 6px; font-size: 14px; color: #6b7280; }
    .card-actions { margin-top: 18px; }
    .btn {
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      color: #fff;
      background: #2563eb;
    }
    .btn:hover { background: #1d4ed8; }
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

        // Get _meta (widget-only data) — carries the server-built form_url
        var meta = window.openai.toolResponseMetadata || toolOutput._meta || {};
        var formUrl = meta.form_url;
        var sc = toolOutput.structuredContent || toolOutput;

        // Web-chat hosts block the embedded form iframe with a hardcoded frame-src
        // that ignores our declared frameDomains (ChatGPT: frame-src 'none'). So we
        // render an "open in browser" CTA instead of a doomed iframe. Prefer the app
        // view_url (claim_url for free-plan), fall back to the embed form_url so
        // there's always a way to open the item. See OUTSTANDING.md.
        var claimUrl = sc.claim_url;
        var viewUrl = sc.view_url;
        var link = claimUrl || viewUrl || formUrl;
        var btnLabel = claimUrl ? 'Sign in to view & save' : 'Open in Graffiticode';
        var msg = claimUrl
          ? 'Sign in to view it and save it to your account.'
          : 'Open it in Graffiticode to view.';
        var html = '<div class="card"><div class="card-title">Your item is ready</div>'
          + '<div class="card-text">' + msg + '</div>';
        if (link) {
          html += '<div class="card-actions"><button class="btn" id="gc-open">' + btnLabel + '</button></div>';
        }
        html += '</div>';
        contentEl.innerHTML = html;
        contentEl.className = '';

        if (window.openai.theme === 'dark') {
          document.body.style.background = '#1f2937';
        }

        var openBtn = document.getElementById('gc-open');
        if (openBtn && link) {
          openBtn.addEventListener('click', function() {
            if (window.openai.openExternal) {
              window.openai.openExternal({ href: link });
            } else {
              window.open(link, '_blank', 'noopener');
            }
          });
        }
        return;
      }

      // Start trying to render
      tryRender();
    })();
  </script>
</body>
</html>`;
}
