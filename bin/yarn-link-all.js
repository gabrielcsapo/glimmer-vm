#!/usr/bin/env node
"use strict";

/*
 * This script loops through the compiled packages in `dist` and links them
 * using yarn. This allows the packages to be used in other packages while being
 * developed. This script will also symlink cross-dependencies into each
 * package's `node_modules` directory, so e.g.
 * @glimmer/runtime can find @glimmer/util when it is imported.
 */
const fs = require('fs');
const globSync = require('glob').sync;
const execSync = require('child_process').execSync;
const chalk = require('chalk');
const cwd = process.cwd();

const LINK_COMMAND = 'yarn link';
const UNLINK_COMMAND = 'yarn unlink';

if (!fs.existsSync('dist')) {
  console.log(chalk.red('No dist directory found. Run `ember build` first before running this command.'))
  process.exit(1);
}

let command = process.argv[2] === '--unlink' ? UNLINK_COMMAND : LINK_COMMAND;
let packages = globSync('dist/@glimmer/*/', { cwd });

packages.forEach(link);

console.log('\nIn your project...\n')
packages.forEach(dir => {
  let name = dir.replace(/^dist\//, '').replace(/\/$/, '');
  console.log(`${chalk.blue('yarn link')} ${name}`);
});

function link(dir) {
  try {
    let stat = fs.statSync(dir);

    if (stat.isDirectory()) {
      console.log(chalk.blue(command), dir);
      process.chdir(dir);
      let result;

      try {
        result = execSync(command, {
          stdio: ['ignore', 'ignore', 'pipe']
        });
      } catch (err) {
        console.log(err.toString());
      }
    }
  } finally {
    process.chdir(cwd);
  }
}

function exec(cmd) {
  console.log(chalk.blue(cmd));
  return execSync(cmd, { cwd });
}
