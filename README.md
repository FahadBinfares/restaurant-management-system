# React + Vite

The independent development API and loopback-only PostgreSQL setup are documented
in [server/README.md](server/README.md). Run frontend commands from the repository
root and backend commands from `server/`. This backend is a development foundation,
not a production-ready service.

## Incremental TypeScript migration

Run `npm run typecheck` to check frontend types without emitting files. Existing
JavaScript and JSX remain supported (`allowJs: true`, `checkJs: false`); they are
not fully type-checked until migrated. New or migrated `.ts` and `.tsx` files in
`src` use strict checking and are included automatically. Vite client declarations
provide types for asset imports and `import.meta.env`.

Migrate individual modules as needed while preserving the current routes and RTL
UI. ESLint supports both JavaScript and TypeScript. Vite continues to handle
transpilation and bundling; the separate typecheck command runs in PR CI alongside
lint, tests, and build. Root JavaScript tool configuration files remain outside
the frontend TypeScript project.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
