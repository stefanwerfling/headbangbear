// eslint-disable-next-line @typescript-eslint/no-var-requires
const gulp = require('gulp');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpack = require('webpack');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpackConfig = require('./webpack.config.js');
const fs = require('fs');

const currentPath = './';
const collectionPath = './../';
const assetsPath = `${currentPath}assets/`;

function funcFindNodeModules(nodesModuleName, subdir) {
    const pathIn = `${currentPath}node_modules/${nodesModuleName}`;
    try {
        const stats = fs.lstatSync(pathIn);
        if (stats.isDirectory()) {
            return `${pathIn}/${subdir}`;
        }
    } catch (e) {
        // ...
    }

    const pathOut = `${collectionPath}node_modules/${nodesModuleName}`;
    try {
        const stats = fs.lstatSync(pathOut);
        if (stats.isDirectory()) {
            return `${pathOut}/${subdir}`;
        }
    } catch (e) {
        // ...
    }

    throw new Error(`Path not found for module: ${nodesModuleName}`);
}

/**
 * copy-data — copy static runtime assets into ./assets/. Each subtask is its own gulp task
 * so the parallel-safe `gulp.parallel` can run them concurrently and each individually
 * resolves its stream.
 */
gulp.task('copy-adminlte-css', () =>
    gulp.src(funcFindNodeModules('admin-lte', 'dist/css/**/*'))
        .pipe(gulp.dest(`${assetsPath}css`))
);

gulp.task('copy-adminlte-js', () =>
    gulp.src(funcFindNodeModules('admin-lte', 'dist/js/adminlte.js'))
        .pipe(gulp.dest(assetsPath))
);

gulp.task('copy-ionicons', () =>
    gulp.src(funcFindNodeModules('ionicons-css', 'dist/**/*'))
        .pipe(gulp.dest(`${assetsPath}ionicons-css`))
);

gulp.task('copy-bambooo-css', () =>
    gulp.src(funcFindNodeModules('bambooo', 'bambooo.css'))
        .pipe(gulp.dest(`${assetsPath}css`))
);

gulp.task('copy-jquery', () =>
    gulp.src(funcFindNodeModules('jquery', 'dist/jquery.min.js'))
        .pipe(gulp.dest(`${assetsPath}plugins/jquery`))
);

gulp.task('copy-bootstrap-js', () =>
    gulp.src(funcFindNodeModules('bootstrap', 'dist/js/bootstrap.bundle.min.js'))
        .pipe(gulp.dest(`${assetsPath}plugins/bootstrap/js`))
);

gulp.task('copy-bootstrap-css', () =>
    gulp.src(funcFindNodeModules('bootstrap', 'dist/css/bootstrap.min.css'))
        .pipe(gulp.dest(`${assetsPath}plugins/bootstrap/css`))
);

gulp.task('copy-fontawesome', () =>
    gulp.src(funcFindNodeModules('@fortawesome/fontawesome-free', '**/*'))
        .pipe(gulp.dest(`${assetsPath}plugins/fontawesome-free`))
);

// Static project assets (logo, favicon, etc.) — kept under doc/images/ so they're
// versioned in git, copied into the gitignored assets/ tree at build time.
gulp.task('copy-static', () =>
    gulp.src('./../doc/images/logo.png')
        .pipe(gulp.dest(`${assetsPath}img`))
);

// Audio assets (intro jingle on the Home page). Stored under doc/audio/ for the same
// reason as the images: versioned, copied at build time.
gulp.task('copy-audio', () =>
    gulp.src('./../doc/audio/logo.mp3')
        .pipe(gulp.dest(`${assetsPath}audio`))
);

gulp.task('copy-data', gulp.parallel(
    'copy-adminlte-css',
    'copy-adminlte-js',
    'copy-ionicons',
    'copy-bambooo-css',
    'copy-jquery',
    'copy-bootstrap-js',
    'copy-bootstrap-css',
    'copy-fontawesome',
    'copy-static',
    'copy-audio'
));

gulp.task('build-webpack', () => {
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line consistent-return
        webpack(webpackConfig, (err, stats) => {
            if (err) {
                return reject(err);
            }
            if (stats.hasErrors()) {
                return reject(new Error(stats.compilation.errors.join('\n')));
            }
            resolve();
        });
    });
});

/**
 * watch-webpack — run webpack in incremental rebuild mode. Switches to `development` mode
 * so rebuilds are fast (no minification) and crashes carry useful stack traces. The task
 * deliberately never resolves: gulp keeps it "running" until the user kills the process,
 * and the webpack watcher fires `compiler.watch`'s callback on every save.
 */
gulp.task('watch-webpack', () => {
    // `watch: true` in the config conflicts with `compiler.watch(callback)` — webpack warns
    // about a duplicate watcher. Set the flag here so `compiler.watch` owns the lifecycle.
    const devConfig = Object.assign({}, webpackConfig, {
        mode: 'development',
        watch: false
    });
    const compiler = webpack(devConfig);
    compiler.watch({}, (err, stats) => {
        const ts = new Date().toLocaleTimeString();
        if (err) {
            console.error(`[${ts}] webpack failed:`, err);
            return;
        }
        if (stats.hasErrors()) {
            console.error(`[${ts}] webpack errors:\n${stats.compilation.errors.join('\n')}`);
            return;
        }
        console.log(`[${ts}] webpack rebuilt — refresh the browser`);
    });
    // Returning a never-resolving promise keeps the gulp process alive without sprinkling
    // `process.stdin.resume()` everywhere. Ctrl+C exits the whole process.
    return new Promise(() => {});
});

gulp.task('watch', gulp.series('copy-data', 'watch-webpack'));

gulp.task('default', gulp.series('copy-data', 'build-webpack'));