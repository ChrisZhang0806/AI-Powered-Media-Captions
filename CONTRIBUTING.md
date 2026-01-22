# Contributing to AI Powered Media Captions

First off, thank you for considering contributing to AI Powered Media Captions! It's people like you that make this tool better for everyone.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Pull Requests](#pull-requests)
- [Development Setup](#development-setup)
- [Style Guidelines](#style-guidelines)
- [Commit Messages](#commit-messages)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (e.g., file types, languages used)
- **Describe the behavior you observed and what you expected**
- **Include screenshots or screen recordings** if applicable
- **Include your environment details** (OS, browser, Node.js version)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a detailed description of the proposed feature**
- **Explain why this enhancement would be useful**
- **List any alternatives you've considered**

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow the [Development Setup](#development-setup)** to get your environment ready
3. **Make your changes** following our [Style Guidelines](#style-guidelines)
4. **Test your changes** thoroughly
5. **Write clear commit messages** following our [Commit Message Guidelines](#commit-messages)
6. **Submit a pull request** with a clear description of your changes

## Development Setup

1. Fork and clone the repository
   ```bash
   git clone https://github.com/ChrisZhang0806/AI-Powered-Media-Captions.git
   cd ai-powered-media-captions
   ```

2. Install dependencies
   ```bash
   npm install
   cd server && npm install && cd ..
   ```

3. Copy environment variables
   ```bash
   cp .env.example .env.local
   ```

4. Start the development servers
   ```bash
   # Terminal 1: Backend
   cd server && npm run start
   
   # Terminal 2: Frontend
   npm run dev
   ```

## Style Guidelines

### TypeScript/JavaScript

- Use TypeScript for all new code
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

### CSS

- Use CSS custom properties for theming
- Follow BEM naming convention where applicable
- Keep selectors simple and avoid deep nesting

### React

- Use functional components with hooks
- Keep components focused and reusable
- Use proper TypeScript types for props

## Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(translation): add support for Korean language
fix(player): resolve audio sync issue with long videos
docs(readme): update installation instructions
```

---

Thank you for contributing! 🎉
