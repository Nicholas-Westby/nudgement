# PR Review Picker

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-63%20passing-brightgreen.svg)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Smarter, fairer code reviews for modern engineering teams.

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [How It Works](#how-it-works)
4. [Getting Started](#getting-started)
5. [Documentation](#documentation)
6. [Roadmap](#roadmap)
7. [Contributing](#contributing)
8. [License](#license)

## Overview

In today's fast-paced software development landscape, timely and evenly distributed code reviews are more important than ever. Yet many teams still struggle with uneven review workloads, forgotten pull requests and the awkward "who should review this?" conversation.

PR Review Picker changes that. By seamlessly bridging the gap between your issue tracker and your team's communication platform, it transforms the way your team approaches code review, making the process smarter, fairer and more transparent than ever before. Whether you're a small startup or a large enterprise, PR Review Picker adapts effortlessly to your team's unique workflow.

## Key Features

### Smart Reviewer Selection

A robust selection algorithm distributes review responsibilities fairly across your team, while staying unpredictable enough to prevent anyone from gaming the system.

### Seamless Jira Integration

Comprehensive support for real-world issue keys, including tricky ones like `SMRT1002-2153`, means PR Review Picker understands your workflow out of the box.

### Native Slack Experience

Reviewers are notified right where they already work, with organized threads and intuitive interactive buttons.

### Zero-Configuration Groups

Groups are created automatically the first time a project is seen, so there is nothing to set up before you start.

### Battle-Tested Reliability

A comprehensive suite of 63 tests covers everything from pure logic to full end-to-end integration, giving you complete peace of mind.

## How It Works

PR Review Picker leverages a modern, scalable architecture built on industry-standard technologies:

| Component  | Technology                     |
| ---------- | ------------------------------ |
| Language   | TypeScript                     |
| Framework  | Bolt 5                         |
| Testing    | Node.js test runner            |
| Deployment | Flexible (Socket Mode or HTTP) |

## Getting Started

### Prerequisites

- Node.js (LTS version recommended)
- npm
- Access to a workspace where you can install apps

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-org/pr-review-picker.git
   cd pr-review-picker/prototype
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Run the test suite to verify that everything is working correctly:

   ```bash
   npm test
   ```

## Documentation

For a deep dive into how everything works under the hood, check out the comprehensive documentation in the `docs/` folder.

## Roadmap

- [ ] Persistent storage
- [ ] Analytics dashboard
- [ ] Support for additional issue trackers
- [ ] Microsoft Teams integration

## Contributing

Contributions are welcome! Whether it's a bug report, a feature request or a pull request, every contribution helps make PR Review Picker better for everyone. Please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
