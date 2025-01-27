# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/).

### Unreleased

### [2.0.9] - 2025-01-26

- dep(eslint): upgrade to v9

### [2.0.8] - 2024-11-08

- fix missing error handlers on pi-watch and pi-karma redis clients [#45](https://github.com/haraka/haraka-plugin-redis/issues/45)
- fix no client QUIT on shutdown when it is not connected [#47]https://github.com/haraka/haraka-plugin-redis/pull/47

### [2.0.7] - 2024-04-21

- populate [files] in package.json. Delete .npmignore.
- lint: remove duplicate / stale rules from .eslintrc
- ci: update to shared GHA workflows
- doc(CONTRIBUTORS): added
- doc: Changes -> CHANGELOG
- prettier

### [2.0.6] - 2023-12-12

- doc(README): '[socket]' is now '[server]' (#39)
- chore(ci): add .release, updated dot files

### 2.0.5 - 2022-05-26

- fix: backwards compatibility with legacy plugin config files
- fix: rename p\* methods -> \* (required in redis v4)
- fix: add `await client.connect()` as is now required, fixes #32
- fix: make redis_ping async
- dep(redis): bump 4.0 -> 4.1
- chore(ci): updated syntax
- chore(ci): added codeql config
- test: added tests for init_redis_plugin

### 2.0.0 - 2022-03-29

- dep(redis): bump major version 3 -> 4
- breaking API change: replaced callbacks with promises
- config.ini
  - opts.db -> opts.database (to match upstream)

### 1.0.13 - 2021-10-14

- chore(ci): switch CI from Travis to GitHub Actions
- doc(README): update formatting with GFM

### 1.0.12 - 2020-03-16

- chore(ci): replace nodeunit with mocha
- dep(redis): update lib to v3
- appveyor: test on node 10

### 1.0.11 - 2019-04-11

- create custom connection only after: all 3 conditions match

### 1.0.10 - 2019-04-09

- merge ALL of [opts] into [server] config (fixes #18)
- merge all of [opts] into [pubsub] config
- include an empty config/redis.ini
- add defaultOpts once, vs defaults in two places

### 1.0.9 - 2019-02-19

- bump redis version to 2.8.0
- emit error message if redis connection fails
- add 3s timeout for subscribe connects: minimize connections stalls
- add es6 template literals

### 1.0.8 - 2018-01-03

- upon punsubscribe, `quit()` (disconnect) redis client

### 1.0.7 - 2017-07-31

- apply config [opts] to pubsub settings #7

### 1.0.6 - 2017-06-16

- eslint 4 compat

### 1.0.5 - 2017-06-09

- disconnect per-connection redis client upon punsubscribe

### 1.0.4 - 2017-02-06

- remove retry_strategy, redis client now does The Right Thing w/o it

### 1.0.3 - 2017-02-06

- don't break when no [redis] config exists

[1.0.13]: https://github.com/haraka/haraka-plugin-redis/releases/tag/1.0.13
[2.0.0]: https://github.com/haraka/haraka-plugin-redis/releases/tag/2.0.0
[2.0.1]: https://github.com/haraka/haraka-plugin-redis/releases/tag/2.0.1
[2.0.2]: https://github.com/haraka/haraka-plugin-redis/releases/tag/2.0.2
[2.0.3]: https://github.com/haraka/haraka-plugin-redis/releases/tag/2.0.3
[2.0.4]: https://github.com/haraka/haraka-plugin-redis/releases/tag/2.0.4
[2.0.5]: https://github.com/haraka/haraka-plugin-redis/releases/tag/2.0.5
[2.0.6]: https://github.com/haraka/haraka-plugin-redis/releases/tag/v2.0.6
[2.0.7]: https://github.com/haraka/haraka-plugin-redis/releases/tag/v2.0.7
[2.0.8]: https://github.com/haraka/haraka-plugin-redis/releases/tag/v2.0.8
