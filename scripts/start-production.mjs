// Cross-platform production entry point; invoke after the web build.
process.env.NODE_ENV = 'production';
await import('../server.ts');
