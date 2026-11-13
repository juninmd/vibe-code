# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0),
and this project adheres to [Semantic Versioning](https://semver.org/lang/en/).

## [Unreleased]

### Fixed
- **`packages/web/src/native/server-url.ts`**: Fixed TypeScript error `TS2339: Property 'preconnect' does not exist on type '...'` by augmenting the `init` parameter type from `RequestInit` to `RequestInit & { preconnect?: unknown }` in the `installNativeFetch` function. This allows the `Object.assign` to preserve the `preconnect` property from `window.fetch` without type errors.