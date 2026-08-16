module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Only .ts needs compiling. @ledgerlens/shared resolves through the npm
  // workspace symlink to its already-built packages/shared/dist/*.js —
  // matching .js here made ts-jest try to recompile that prebuilt output
  // without allowJs set, which just warns today but is one stricter
  // ts-jest option away from failing the build.
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
