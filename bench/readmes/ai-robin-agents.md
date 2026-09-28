# robin-agents

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Step 1: Clone the Repository](#step-1-clone-the-repository)
  - [Step 2: Run the Init Script](#step-2-run-the-init-script)
  - [Step 3: Reload Your Shell](#step-3-reload-your-shell)
- [How It Works](#how-it-works)
  - [Config Directories](#config-directories)
  - [Plugin Loading](#plugin-loading)
- [Reply Footer](#reply-footer)
- [Adding a Skill](#adding-a-skill)
- [Testing](#testing)
- [Formatting](#formatting)
- [Contributing](#contributing)
- [License](#license)

## Introduction

robin-agents is a comprehensive collection of personal Claude Code skills designed to streamline and enhance your AI-assisted development workflow. It seamlessly integrates with Claude Code across multiple profiles, ensuring a consistent and powerful experience wherever you work.

## Features

- **Personal skills**: A curated set of skills tailored to your workflow
- **Multi-profile support**: Works with both the `agent-home` and `agent-work` profiles
- **Live editing**: Changes take effect immediately thanks to symlinks
- **Reply footer**: Displays useful information after every reply
- **Idempotent setup**: The init script can be safely run multiple times

## Requirements

- **Node.js**: Version 22.18+ (or 23.6+)
- **Claude Code**: Latest version recommended
- **Shell**: zsh

## Installation

### Step 1: Clone the Repository

```sh
git clone <this-repo> ~/wherever/robin-agents
```

### Step 2: Run the Init Script

```sh
cd ~/wherever/robin-agents
node init.ts
```

### Step 3: Reload Your Shell

```sh
source ~/.zshrc
```

Then restart Claude Code. The first launch of each profile will prompt you to log in.

## How It Works

### Config Directories

Claude Code stores its user-level settings, plugins and skills in the directory specified by `CLAUDE_CONFIG_DIR`, which defaults to `~/.claude`. The launchers that `init.ts` adds to `~/.zshrc` start `agent-home` in `~/.claude` and `agent-work` in `~/.agent-work`.

### Plugin Loading

`init.ts` symlinks this repository into the `skills` folder of each config directory. Claude Code automatically detects any directory there that contains a `.claude-plugin/plugin.json` file and loads it as a plugin, providing a robust and flexible way to manage your skills.

## Reply Footer

After every reply, a Stop hook runs `hooks/reply-footer.ts` and displays the time the reply finished. This leverages Claude Code's `systemMessage` feature, which means the footer doesn't consume any tokens.

## Adding a Skill

To add a new skill, create a `SKILL.md` file in `skills/<skill-name>/` with the following frontmatter:

```markdown
---
name: skill-name
description: Use when <the situations that should trigger this skill>
---
```

## Testing

```sh
npm test
```

## Formatting

```sh
npm run format
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
