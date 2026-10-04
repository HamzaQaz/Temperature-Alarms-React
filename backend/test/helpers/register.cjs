// Compiles the tests with tsconfig.test.json. Kept here rather than as a TS_NODE_PROJECT=
// prefix on the npm script, which cmd.exe cannot parse, so `npm test` runs on Windows too.
require('ts-node').register({
  project: require('node:path').join(__dirname, '..', '..', 'tsconfig.test.json'),
  transpileOnly: true,
});
