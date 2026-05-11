const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: './src/cli/main.ts',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist/cli/cli'),
    filename: 'main.js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    mainFields: ['main'],
    conditionNames: ['require', 'node', 'default'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: { loader: 'ts-loader', options: { transpileOnly: true } },
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    // yargs-parser (ESM build) references createRequire as a variable;
    // expose it from Node's 'module' built-in before the IIFE runs.
    new webpack.BannerPlugin({
      banner: "const { createRequire } = require('module');",
      raw: true,
    }),
  ],
};
