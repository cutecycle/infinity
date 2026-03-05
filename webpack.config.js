const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    mode: argv.mode || 'development',
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    entry: {
      'service-worker': './src/service-worker.js',
      'content-script': './src/content-script.js',
      'popup': './src/popup/index.js',
      'options': './src/options/index.js',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
      alias: {
        '@utils': path.resolve(__dirname, 'src/utils/'),
        '@types': path.resolve(__dirname, 'src/types/'),
      },
    },
    plugins: [
      new CleanWebpackPlugin(),
      new CopyPlugin({
        patterns: [
          {
            from: 'public/manifest.json',
            to: 'manifest.json',
          },
          {
            from: 'public/icons',
            to: 'icons',
            noErrorOnMissing: true,
          },
        ],
      }),
      new HtmlWebpackPlugin({
        template: 'public/popup.html',
        filename: 'popup.html',
        chunks: ['popup'],
        cache: false,
      }),
      new HtmlWebpackPlugin({
        template: 'public/options.html',
        filename: 'options.html',
        chunks: ['options'],
        cache: false,
      }),
    ],
    optimization: {
      minimize: isProduction,
    },
    watch: argv.mode === 'development',
    watchOptions: {
      ignored: /node_modules/,
    },
    performance: {
      hints: isProduction ? 'warning' : false,
      maxEntrypointSize: 512000,
      maxAssetSize: 512000,
    },
  };
};

