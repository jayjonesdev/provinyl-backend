import { defineConfig } from 'vitest/config';

// Provide a valid env so modules that import config/env.ts (which validates with
// zod at load time) can be imported under test without a real .env.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://localhost:27017/provinyl-test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-0123456789',
      DISCOGS_CONSUMER_KEY: 'test-key',
      DISCOGS_CONSUMER_SECRET: 'test-secret',
      DISCOGS_CALLBACK_URL: 'http://localhost:8080/api/v1/auth/callback',
      CLIENT_ORIGIN: 'http://localhost:5173',
      TOKEN_ENC_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    },
  },
});
