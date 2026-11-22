# Installed skills

Copied unmodified from https://github.com/mattpocock/skills (MIT licence, see `LICENSE-mattpocock-skills`), commit `abeeaf95660ba9e8b7c753eb38f441ca707a8823`:

| Skill | Source path | Use |
|---|---|---|
| `grill-with-docs` | `skills/engineering/grill-with-docs` | Run `/grill-with-docs` to be interviewed about a plan or design; it also writes `GLOSSARY.md` and `docs/adr/` as decisions settle. It only calls the two skills below. |
| `grilling` | `skills/productivity/grilling` | The interview itself (rounds of numbered questions, each with a recommended answer). |
| `domain-modeling` | `skills/engineering/domain-modeling` | Builds the project glossary and records architecture decisions. |

`grill-with-docs` has `disable-model-invocation: true`, so it only runs when the user types `/grill-with-docs`.

The upstream `agents/openai.yaml` files (Codex settings) were left out. To update, re-copy from the upstream repo or run `npx skills@latest update`.
