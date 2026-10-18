# Contributing

Thanks for helping make incident response safer and more useful. Contributions can improve the app, CLI, MCP tools, scenario library, documentation, or evaluation process.

## Find a useful change

- Improve a confusing workflow or accessibility issue in the app.
- Add a realistic SRE scenario, parser, runbook example, or integration.
- Report a failure mode or propose an evaluation case that tests it.
- Clarify setup, deployment, security, or evaluation documentation.

For a substantial change, open an issue first so we can agree on the problem and scope. For a small fix or a well-scoped scenario, a pull request is welcome directly.

## Develop locally

1. Use Node.js 22 or later.
2. Fork the repository and create a branch for your change.
3. Run `npm ci` and copy `.env.local.example` to `.env.local`.
4. Add `DEEPSEEK_API_KEY` to use analysis features. Supabase is optional for local exploration; configure it for persistence and archive features.
5. Start the app with `npm run dev`.

Before opening a pull request, run the checks relevant to your change. `npm run lint` and `npm run build` cover broad application issues; the repository CI also runs type checks and its offline checks. Changes to prompts, scenarios, or evaluation behavior should include the corresponding evaluation artifacts or an explanation of what remains unverified.

## Scenario and evaluation contributions

Good scenarios describe observable symptoms, relevant baselines, timelines, and enough evidence to distinguish plausible causes. Include expected severity and explain which evidence supports it. Keep the scenario self-contained and synthetic unless you have explicit permission to share real incident material.

Evaluation results are evidence about the tested cases, not a general reliability guarantee. Document the case set, model and judge configuration, failures, and uncertainty. Do not present a score change from a small or selectively chosen sample as proof of improvement.

## Keep operational data safe

- Never commit credentials, customer data, private runbooks, or real incident details.
- Use synthetic examples and scrub secrets from logs and screenshots.
- Call out behavior that could lead to destructive production actions; mitigations should include risks and rollback steps.
- Avoid claiming that an analysis is verified when its evidence or assumptions have not been checked.

## Pull requests

- Keep each pull request focused and explain the user problem it solves.
- Include before-and-after screenshots for meaningful UI changes.
- Document changed configuration, security behavior, or evaluation assumptions.
- Link related issues and state what you checked locally.
- Be open to revising the approach based on review.

