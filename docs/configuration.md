# Project configuration

nudgement reads `nudgement.json` at the root of the repository being reviewed.
Use `--config path/to/settings.json` for another location. Paths inside the
configuration are relative to the configuration file; `~/` is supported.

```json
{
  "context": "docs/product-spec.md",
  "readme": { "require": ["Installation", "A runnable example"] },
  "commit": { "forbidTrailers": true, "maxChangedLines": 600 },
  "copy": { "app": "A booking calendar for workshop attendees", "properNouns": ["Claybank"] },
  "ignore": ["fixtures/**"],
  "hygiene": { "forbiddenPaths": ["scratch/"], "maxFileKb": 500 }
}
```

All fields are optional. `context` can also be a list of files.
`readme.require` can be a file containing one requirement per line.
`hygiene.forbiddenWords` rejects project-specific words, and `hygiene.ignore`
excludes paths from hygiene checks alone. Top-level `ignore` excludes paths
from changed-file, comment and hygiene checks.

For a project in a linked Git worktree, ignored paths, forbidden words and
product names are combined with those in the project's main checkout.
Explicit `--context` and `--require` options override the corresponding settings.

Commit checks use Conventional Commits with a 72-character subject limit.
An optional body contains up to three `- ` bullets, each under 80 characters.
Trailers are ignored when judging prose unless `forbidTrailers` rejects them.
