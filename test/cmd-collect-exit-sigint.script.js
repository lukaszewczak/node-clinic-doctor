'use strict'

const path = require('path')
const CollectAndRead = require(path.resolve('collect-and-read.js'))
const cmd = new CollectAndRead({}, '-e', `
  setInterval(() => {}, 100)
  console.log('listening for SIGINT')
`)
cmd.on('ready', function () {
  cmd.cleanup()
})
process.on('exit', function () {
  cmd.cleanup()
})
