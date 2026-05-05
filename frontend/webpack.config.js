// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// eslint-disable-next-line no-undef
module.exports = {

    devtool: 'source-map',

    mode: 'production',

    entry: {
        index: './src/index.ts'
    },

    output: {
        // eslint-disable-next-line no-undef
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js'
    },

    resolve: {
        extensions: ['.ts', '.js', '.mjs'],
        extensionAlias: {
            '.js': ['.js', '.ts']
        }
    },

    module: {
        rules: [
            {
                test: /\.mjs$/u,
                type: 'javascript/auto'
            },
            {
                // eslint-disable-next-line require-unicode-regexp
                test: /\.tsx?/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        transpileOnly: true
                    }
                },
                exclude: '/node_modules/'
            }
        ]
    },

    plugins: [
        new ForkTsCheckerWebpackPlugin()
    ],

    watch: false
};