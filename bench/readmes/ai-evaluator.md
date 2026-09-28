# Commit Evaluator

A comprehensive, AI-powered tool for evaluating the quality of your commit messages, code comments, code files and READMEs.

## Overview

Commit Evaluator is a robust solution designed to help developers maintain high standards across their repositories. By leveraging TypeSafe's Jev model, it provides detailed, actionable feedback on commit messages, the code comments a commit adds, individual code files and README files, ensuring that your project history and documentation remain clean, consistent and easy to understand.

Whether you're working on a personal project or collaborating with a large team, Commit Evaluator seamlessly integrates into your existing Git workflow, making it easy to catch issues before they become part of your project's permanent record.

## Key Features

- **Commit message evaluation**: Checks your commit messages against Conventional Commits and house style rules
- **Human-sounding analysis**: Determines whether your text reads like it was written by a human
- **Code comment review**: Evaluates every code comment added in a commit
- **Code file analysis**: Identifies bloated or overengineered code
- **README review**: Checks whether a README is succinct and well structured
- **Detailed feedback**: Provides clear, actionable insights to help you improve
- **Comprehensive logging**: Keeps a detailed record of every evaluation for later analysis

## Why Commit Messages Matter

Commit messages are an important part of any software project. They explain why a change was made, help reviewers understand the context of a pull request, and make it easier to track down when and why a bug was introduced. Writing clear, consistent commit messages takes discipline, especially when you are focused on the code itself, and it is easy for standards to slip over time.

The same is true of code comments and documentation. Comments that restate what the code does add noise, and a README that is hard to read makes it harder for newcomers to get started.

## Getting Started

### Prerequisites

Before using Commit Evaluator, make sure you have [Bun](https://bun.sh) installed on your machine. Bun is a fast JavaScript runtime that the evaluator uses to run its TypeScript code directly. You can install it by following the instructions on the Bun website.

You will also need Git installed, since the evaluator reads commits and staged changes from your repository. Most developers will already have Git installed, but you can check by running `git --version` in your terminal.

### Usage

It is important to always use the live copy of the evaluator, which only changes when a tested version is promoted:

```sh
E=~/tools/evaluator/live/evaluate.ts
```

To evaluate your staged changes along with the commit message you plan to use:

```sh
bun $E /path/to/repo --staged -m "feat(api): add retry to token refresh"
```

To evaluate a commit that has already been made:

```sh
bun $E /path/to/repo --hash abc123
```

To evaluate every commit on a branch:

```sh
bun $E /path/to/repo --range main..HEAD
```

To evaluate a code file or a README:

```sh
bun $E /path/to/repo --file src/sync.ts
bun $E /path/to/repo --readme
```

### Understanding the Results

The evaluator uses three kinds of findings to help you understand the results:

- **Errors (✗)**: These are critical issues that must be fixed. Any error will cause the run to fail.
- **Warnings (!)**: These are issues that are worth fixing, but they will not cause the run to fail.
- **Notes (·)**: These are suggestions that may help you improve your commit message.

The evaluator also provides a score out of 100, which gives you a quick overview of the overall quality of what was evaluated.

## Summary

Commit Evaluator provides a comprehensive way to check commit messages, code comments, code files and READMEs against your project's standards. By combining exact checks in code with targeted questions to Jev, it gives you detailed and actionable feedback, helping to keep your project history and documentation clean, consistent and easy to understand.
