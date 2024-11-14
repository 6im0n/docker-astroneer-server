const moment = require('moment');
const fs = require('fs-extra');
const { chain, get, first, last, orderBy, compact } = require('lodash');
const clc = require('cli-color');
const path = require('path');

function Backup() {
  let backups = [];
  let backupIntervalID;
  let cleanupIntervalID;

  /**
   * Load current backups from backup dir
   *
   * @return  {[type]}  [return description]
   */
  function load() {
    console.log(clc.blue('LOADING CURRENT BACKUPS FROM /backup AND /backup/daily'));

    const daily = fs
      .readdirSync('/backup/daily')
      .map((f) => {
        const parts = f.split('$');
        const name = first(parts);
        const timestamp = get(parts, 1, '').replace('.savegame');

        return {
          name,
          path: `/backup/daily/${f}`,
          timestamp,
          type: 'daily'
        };
      });

    const incremental = fs
      .readdirSync('/backup')
      .filter((file) => !fs.lstatSync(`/backup/${file}`).isDirectory())
      .map((f) => {
        const parts = f.split('$');
        const name = first(parts);
        const timestamp = get(parts, 1, '').replace('.savegame');

        return {
          name,
          path: `/backup/${f}`,
          timestamp,
          type: 'incremental'
        };
      });

    return orderBy([...daily, ...incremental], ['timestamp'], ['asc']);
  }

  /**
   * Init the backup.
   * Load current backups from volume and order them by date.
   * Then start the backup intervall (10 min)
   *
   * @return  void
   */
  function init() {
    console.log(clc.blue('Init backup...'));

    fs.ensureDirSync('/backup/daily');
    fs.ensureDirSync('/backup/restore');
    backups = load();

    // Run backup every 10 minutes
    backupIntervalID = setInterval(() => {
      const timestamp = moment().format();
      const files = fs.readdirSync('/astroneer/Astro/Saved/SaveGames');

      backups = chain(files)
        .filter((file) => path.extname(file) === '.savegame')
        .reduce((result, file) => {
          console.log(clc.blue(`Going to create incremental backup of file ${file}...`));

          fs.copySync(`/astroneer/Astro/Saved/SaveGames/${file}`, `/backup/${file}`);

          console.log(clc.green(`Incremental backup of file ${file} created!`));

          return [...result, {
            name: first(file.split('$')),
            path: `/backup/${file}`,
            timestamp,
            type: 'incremental'
          }];
        }, backups)
        .value();
    }, 600000);

    // Run cleanup every hour
    // eslint-disable-next-line no-use-before-define
    cleanupIntervalID = setInterval(cleanup, (60 * 60 * 1000));

    console.log(clc.green('Backup is now running'));
  }

  /**
   * Stop the backup
   *
   * @return  void
   */
  function stop() {
    clearInterval(backupIntervalID);
    clearInterval(cleanupIntervalID);
    console.log(clc.green('Backup stopped!'));
  }

  /**
   * Cleanup old backups
   * We are going to keep all the backups from current day and the latest one from prev days
   *
   * @return  void
   */
  function cleanup() {
    console.log(clc.blue('--------------Cleanup backups--------------'));
    console.log(clc.blue('Running periodic cleanup...'));

    const items = load();
    const files = chain(items)
      .filter((b) => b.type !== 'daily')
      .groupBy((b) => moment(b.timestamp).startOf('day').format())
      .omit([moment().startOf('day').format()])
      .reduce((result, b) => {
        const ordered = orderBy(b, ['timestamp'], ['asc']);
        const index = Math.floor(Math.abs(ordered.length - 1) / 2);

        const mid = get(ordered, index);
        const latest = last(ordered);

        const move = [
          ...get(result, 'move', []),
          ...compact([mid, latest])
        ];

        const remove = [
          ...get(result, 'remove', []),
          ...b
        ];

        return {
          move,
          remove
        };
      }, {})
      .value();

    console.log(clc.blue('The following backups will be copied to the daily folder:'));
    console.log(get(files, 'move', []));

    // Copy daily files
    get(files, 'move', []).forEach((b) => fs.copySync(b.path, `/backup/daily/${b.timestamp}`));

    console.log(clc.blue('The following backups will be removed:'));
    console.log(get(files, 'remove', []));

    // Remove unused files
    get(files, 'remove', []).forEach((b) => fs.removeSync(b.path));

    // Reload backups
    backups = load();

    console.log(clc.green('Cleanup successful!'));
  }

  /**
   * Get the latest backup from backups
   *
   * @param {String} name Base name of the save game
   *
   * @return  {String}  latest  Latest backup
   */
  function getLatest(name) {
    backups = load();

    chain(backups)
      .filter((backup) => backup.name === name)
      .last()
      .value();

    return last(backups);
  }

  return Object.freeze({
    init,
    stop,
    getLatest,
    cleanup
  });
}

module.exports = Backup;
