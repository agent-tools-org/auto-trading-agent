<!-- aid:start -->
## aid orchestration

This project uses [aid](https://github.com/agent-tools-org/ai-dispatch) as the primary development method.
Use `aid run` to dispatch coding tasks to AI agents instead of writing code directly.

- **Project**: auto-trading-agent
- **Profile**: standard
- **Budget**: $20/day
- **Verify**: npm test

### Rules
- All new functions must have at least one test

### Usage
- Dispatch work: `aid run <agent> "<prompt>" --dir .`
- Review output: `aid show <id> --diff`
- Batch dispatch: `aid batch <file> --parallel`
- Project config: `.aid/project.toml`

<!-- aid:end -->
