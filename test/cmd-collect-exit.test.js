'use strict'

const test = require('tap').test
const path = require('path')
const async = require('async')
const { spawn } = require('child_process')
const endpoint = require('endpoint')
const CollectAndRead = require('./collect-and-read.js')

test('cmd - collect - external SIGINT is relayed', function (t) {
  const child = spawn(
    process.execPath, [
      path.resolve(__dirname, 'cmd-collect-exit-sigint.script.js')
    ], {
      detached: process.platform !== 'win32',
      cwd: __dirname
    }
  )
  child.stdout.once('data', () => {
    child.kill('SIGINT')
  })

  child.once('exit', function (code, signal) {
    t.strictEqual(signal, 'SIGINT')
    t.end()
  })

  async.parallel({
    stdout (done) { child.stdout.pipe(endpoint(done)) },
    stderr (done) { child.stderr.pipe(endpoint(done)) }
  }, function (err, output) {
    if (err) return t.ifError(err)

    // Expect the WARNING output to be shown
    t.ok(output.stderr.toString().split('\n').length, 1)
    t.strictEqual(output.stdout.toString(),
      'listening for SIGINT\n')
  })
})

test('cmd - collect - non-success exit code causes error', function (t) {
  const cmd = new CollectAndRead({}, '--expose-gc', '-e', 'process.exit(1)')

  cmd.once('error', function (err) {
    cmd.cleanup()

    t.strictDeepEqual(err, new Error('process exited with exit code 1'))
    t.end()
  })
})

test('cmd - collect - non-success exit code causes error', function (t) {
  const cmd = new CollectAndRead(
    {},
    '--expose-gc', '-e', 'process.kill(process.pid, "SIGKILL")'
  )

  cmd.once('error', function (err) {
    cmd.cleanup()

    t.strictDeepEqual(err, new Error('process exited with exit signal SIGKILL'))
    t.end()
  })
})
