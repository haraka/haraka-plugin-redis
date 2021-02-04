# haraka-plugin-redis

[![Build Status][ci-img]][ci-url]
[![Code Climate][clim-img]][clim-url]
[![Windows Build status][apv-img]][apv-url]

Connects to a redis instance. By default it stores a `redis`
connection handle at `server.notes.redis`. See below to get a custom DB handle
attached to another database.

## Config

The `redis.ini` file has the following sections (defaults shown):

### [server]

```ini
; host=127.0.0.1
; port=6379
```

### [pubsub]

```ini
; host=127.0.0.1
; port=6379
```

Publish & Subscribe are DB agnostic and thus have no db setting. If host and port and not defined, they default to the same as [server] settings.

### [opts]

```ini
; see https://www.npmjs.com/package/redis#options-object-properties
; db=0
; password=battery-horse-staple
```

Options specified in `redis.ini[opts]` are applied to the server config, the pubsub config, AND the configurations of any plugins that inherit this plugin. This is ideal if the redis server requires a password. Specify it once in [opts]. If other redis connections need a different value (such as a unique DB), they must specify it. For plugins, all options are stored in the plugins `[redis]` section of its config file.

## Usage (shared redis)

Use redis in your plugin like so:

```js
if (server.notes.redis) {
    server.notes.redis.hgetall(...);
        // or any other redis command
}
```

## Publish/Subscribe Usage

In your plugin:

```js
exports.results_init = function (next, connection) {
    this.redis_subscribe(connection, () => {
        connection.notes.redis.on('pmessage', (pattern, channel, message) => {
            this.do_something_with_message(message, ...)
        })
        next()
    })
}
// be nice to redis and disconnect
exports.hook_disconnect = function (next, connection) {
    this.redis_unsubscribe(connection)
}
```

## Custom Usage

This variation lets your plugin establish its own Redis connection,
optionally with a redis db ID. All redis config options must be listed in your plugins config file in the [redis] section.

```js
exports.register = function () {
    const plugin = this;
    plugin.inherits('redis');

    plugin.cfg = plugin.config.get('my-plugin.ini');

    // populate plugin.cfg.redis with defaults from redis.ini
    plugin.merge_redis_ini();

    // cluster aware redis connection(s)
    plugin.register_hook('init_master', 'init_redis_plugin');
    plugin.register_hook('init_child',  'init_redis_plugin');
}
```

When a db ID is specified in the [redis] section of a redis inheriting plugin, log messages like these will be emitted when Haraka starts:

````
[INFO] [-] [redis] connected to redis://172.16.15.16:6379 v3.2.6
[INFO] [-] [limit] connected to redis://172.16.15.16:6379/1 v3.2.6
[INFO] [-] [karma] connected to redis://172.16.15.16:6379/2 v3.2.6
[INFO] [-] [known-senders] connected to redis://172.16.15.16:6379/3 v3.2.6
````

Notice the database ID numbers appended to each plugins redis connection
message.



[ci-img]: https://github.com/haraka/haraka-plugin-redis/workflows/Tests/badge.svg
[ci-url]: https://github.com/haraka/haraka-plugin-redis/actions?query=workflow%3ATests
[clim-img]: https://codeclimate.com/github/haraka/haraka-plugin-redis/badges/gpa.svg
[clim-url]: https://codeclimate.com/github/haraka/haraka-plugin-redis
[apv-img]: https://ci.appveyor.com/api/projects/status/fxk78f25n61nq3lx?svg=true
[apv-url]: https://ci.appveyor.com/project/msimerson/haraka-plugin-redis
