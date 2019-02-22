
# 1.0.9 - 2019-02-19

- bump redis version to 2.8.0
- emit error message if redis connection fails
- add 3s timeout for subscribe connects: minimize connections stalls
- add es6 template literals

# 1.0.8 - 2018-01-03

- upon punsubscribe, `quit()` (disconnect) redis client

# 1.0.7 - 2017-07-31

- apply config [opts] to pubsub settings #7

# 1.0.6 - 2017-06-16

- eslint 4 compat

# 1.0.5 - 2017-06-09

- disconnect per-connection redis client upon punsubscribe

# 1.0.4 - 2017-02-06

- remove retry_strategy, redis client now does The Right Thing w/o it

# 1.0.3 - 2017-02-06

- don't break when no [redis] config exists

