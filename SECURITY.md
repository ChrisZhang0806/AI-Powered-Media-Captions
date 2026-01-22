# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of AI Powered Media Captions seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please send an email to the maintainers with:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Potential impact** of the vulnerability
4. **Suggested fix** (if any)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Assessment**: We will investigate and assess the severity within 7 days
- **Resolution**: We aim to fix critical issues within 30 days
- **Disclosure**: We will coordinate public disclosure timing with you

### Security Best Practices for Users

1. **API Keys**: Never commit your OpenAI API keys to version control
2. **Environment Variables**: Use `.env.local` for sensitive configuration (already in `.gitignore`)
3. **Dependencies**: Keep dependencies updated with `npm audit` and `npm update`
4. **File Uploads**: Be cautious with files from untrusted sources

## Responsible Disclosure

We kindly ask that you:

- Allow us reasonable time to fix the issue before public disclosure
- Avoid exploiting the vulnerability beyond what is necessary for testing
- Not access or modify other users' data

Thank you for helping keep AI Powered Media Captions secure!
