# CI/CD Architecture

This document describes the proper CI/CD pipeline for the Apple On-Device AI library.

## 🏗️ Architecture Overview

### 1. **CI Workflow** (`.github/workflows/ci.yml`)

- **Triggers**: Push to `main`/`develop`, Pull Requests
- **Purpose**: Validation and testing only
- **Actions**:
  - ✅ Validate native binaries exist
  - ✅ Build TypeScript
  - ✅ Validate package contents
  - ⚠️ Note about local testing requirements
- **Does NOT publish**

### 2. **Release Workflow** (`.github/workflows/release.yml`)

- **Triggers**:
  - Manual dispatch (workflow_dispatch)
  - Version tags (`v*.*.*`)
- **Purpose**: The ONLY place that publishes to npm
- **Actions**:
  - 📦 Build and validate package
  - 🔢 Version bumping (manual dispatch only)
  - 📝 Intelligent changelog generation
  - 🚀 Publish to npm
  - 🏷️ Create GitHub release

### 3. **Test Reminder Workflow** (`.github/workflows/test-reminder.yml`)

- **Triggers**: Pull Requests, Push to main/develop
- **Purpose**: Remind developers about local testing requirements
- **Actions**:
  - 💬 Comments on PRs with testing checklist
  - 📝 Logs reminders about Apple Silicon requirements

## 🚀 Release Process

### Option A: Manual Release (Recommended)

1. **Local Development**:

   ```bash
   # Run tests locally (required - CI can't run them)
   bun test
   ```

2. **Push changes**:

   ```bash
   git push origin main
   ```

3. **Trigger release**:
   - Go to GitHub Actions → "Release" workflow
   - Click "Run workflow"
   - Choose release type: `patch`, `minor`, `major`, or `prerelease`

### Option B: Tag-based Release

1. **Create and push tag**:

   ```bash
   git tag v1.4.3
   git push origin v1.4.3
   ```

2. **Release workflow triggers automatically**

## 📋 Testing Requirements

**Important**: Tests require Apple Intelligence and Apple Silicon hardware.

### Local Testing Checklist:

- [ ] All tests pass: `bun test`
- [ ] Streaming works without hanging
- [ ] Basic examples run successfully
- [ ] No race conditions observed

### Why CI Can't Run Tests:

- Apple Intelligence APIs require Apple Silicon (M1/M2/M3) chips
- GitHub Actions runners don't have Apple Intelligence enabled
- On-device models are not available in CI environments

## 🔧 Troubleshooting

### If Release Fails:

1. Check that native binaries exist: `bun run validate-binaries`
2. Verify TypeScript builds: `bun run build:ts`
3. Test package creation: `npm pack --dry-run`

### If CI Validation Fails:

- Usually means missing native binaries or TypeScript compilation errors
- Run `bun run build:local` to rebuild everything locally

## 🚫 What Was Fixed

### Previous Issues:

- ❌ Two workflows both publishing to npm
- ❌ Publishing on every push to main
- ❌ Useless changelogs
- ❌ CI trying to run Apple Intelligence tests
- ❌ Failed builds but successful publishes

### Current Solution:

- ✅ Single source of truth for publishing (release.yml)
- ✅ Manual or tag-triggered releases only
- ✅ Intelligent changelog generation
- ✅ Proper validation without requiring Apple hardware
- ✅ Clear separation of concerns

## 📦 Package Contents

The published package includes:

- `dist/` - Compiled TypeScript
- `build/*.node` - Native NAPI binaries
- `build/*.dylib` - Swift dynamic libraries
- `build/*.swiftmodule` - Swift module files

## 🔐 Required Secrets

- `NPM_TOKEN` - npm publish access token
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions
