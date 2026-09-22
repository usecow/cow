// Ambient declarations for the `cow:` runtime modules, the canonical page
// spelling of Cow's bundled helpers. This file has no top-level imports or
// exports so TypeScript treats it as a global script: any program that
// includes a Cow declaration entry resolves these specifiers.
declare module 'cow:web' { export * from '@cowlang/cow/web' }
declare module 'cow:sqlite' { export * from '@cowlang/cow/sqlite' }
declare module 'cow:csv' { export * from '@cowlang/cow/csv' }
declare module 'cow:resource' { export * from '@cowlang/cow/resource' }
declare module 'cow:runtime' { export * from '@cowlang/cow/runtime' }
