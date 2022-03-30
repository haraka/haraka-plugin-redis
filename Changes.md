

### 2.0.0 - 2022-03-29

- bump redis major version 3 -> 4
- API change, callbacks replaced by promises


### 1.0.13 - 2021-10-14

- switch CI from Travis to GitHub Actions
- README: update formatting with GFM


### 1.0.12 - 2020-03-16

- replace nodeunit with mocha
- update redis lib to v3
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

