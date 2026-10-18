# Security policy

AI Reliability Copilot can process incident context, logs, runbooks, and credentials. Please treat anything submitted to a deployment as sensitive operational data.

## Reporting a vulnerability

Please do not disclose vulnerabilities in a public issue or pull request. Use GitHub's **Report a vulnerability** flow in the repository's Security tab when it is available. If private vulnerability reporting is not enabled, contact the repository maintainer privately through GitHub before sharing technical details.

When reporting, include the affected component, the impact, and concise reproduction steps using synthetic data. Do not include real customer information, incident details, credentials, or private runbooks.

We will review reports and coordinate a fix and disclosure with the reporter. There is no guaranteed response time; please avoid sharing an exploit publicly while a report is under review.

## Deployment guidance

- Keep API keys and Supabase service-role credentials on the server. Never commit them or expose them in browser code.
- Protect production and preview MCP and webhook endpoints with their configured bearer secrets. Public access requires an explicit opt-in.
- Use the production privacy controls to keep saved incident data private, and only enable public sample data for deployments that contain no sensitive records.
- Redact incident content before sharing logs, screenshots, exports, or support requests. Built-in redaction covers known patterns and cannot identify every sensitive value.

See the [deployment and security guidance](./USAGE.md#6a-mcp-server-安全设置公网部署必看) and [contribution safety notes](./CONTRIBUTING.md#keep-operational-data-safe) for more detail.
