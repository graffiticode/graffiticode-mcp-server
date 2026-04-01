# Privacy Policy

**Graffiticode MCP Server**
**Effective Date: April 1, 2026**

## Overview

The Graffiticode MCP Server ("the Service") is operated by Graffiticode. This policy describes how the Service collects, uses, and protects information when you connect to the Graffiticode MCP server through an MCP-compatible client such as Claude, ChatGPT, or other AI assistants.

## Information We Collect

### Authentication Credentials

When you connect to the Service, you provide authentication credentials in one of two ways:

- **OAuth 2.1 access tokens** — issued during the OAuth authorization flow. These tokens are used to authenticate requests and are not stored persistently by the MCP server.
- **API keys** — passed as Bearer tokens. API keys are exchanged for short-lived session tokens and are not logged or stored beyond the authentication step.

### Content You Create

When you use the Service's tools (`create_item`, `update_item`, `get_item`), the natural language descriptions you provide and the items you create are stored in the Graffiticode platform. This includes:

- Natural language descriptions and modification requests
- Generated code and compiled output data
- Conversation history for iterative editing (stored per item)
- Item metadata (creation and update timestamps, language, name)

### Automatically Collected Information

The Service may collect standard server logs including:

- IP addresses
- Request timestamps
- HTTP headers (excluding authorization tokens, which are redacted)
- Error messages for debugging

## How We Use Your Information

We use the information described above to:

- Authenticate your requests and authorize access to your items
- Generate, store, and retrieve content you create through the Service
- Maintain conversation history to support iterative editing of items
- Debug errors and maintain service reliability
- Improve the Service

## Data Sharing

We do not sell your personal information. We may share data only in the following circumstances:

- **Service providers** — We use Google Cloud Platform to host the Service. Data is processed in accordance with Google Cloud's data processing terms.
- **Firebase Authentication** — Authentication tokens are processed through Firebase. See Google's privacy policy for details.
- **Legal requirements** — We may disclose information if required by law or legal process.

## Data Retention

- **Items and content** — Retained as long as your Graffiticode account is active, or until you delete them.
- **Authentication tokens** — Cached in memory for up to 55 minutes and discarded when the server session ends.
- **Server logs** — Retained for up to 90 days for debugging purposes.

## Security

We protect your data using:

- HTTPS/TLS encryption for all data in transit
- OAuth 2.1 with PKCE for secure authentication flows
- Short-lived authentication tokens with automatic refresh
- Deployment on Google Cloud Run with managed infrastructure security

## Your Rights

You may:

- Request access to or deletion of your data by contacting us
- Delete items you've created through the Graffiticode console at [console.graffiticode.org](https://console.graffiticode.org)
- Revoke API keys at any time through your Graffiticode account settings

## Changes to This Policy

We may update this policy from time to time. Changes will be posted to this document with an updated effective date.

## Contact

For questions about this privacy policy or your data, contact:

- Email: jeff@artcompiler.com
- GitHub: [github.com/graffiticode/graffiticode-mcp-server](https://github.com/graffiticode/graffiticode-mcp-server)
