'use strict'

const fs = require('fs')
const path = require('path')
const pump = require('pump')
const stream = require('stream')
const { spawn } = require('child_process')
const analysis = require('./analysis/index.js')
const Stringify = require('streaming-json-stringify')
const browserify = require('browserify')
const streamTemplate = require('stream-template')
const getLoggingPaths = require('./collect/get-logging-paths.js')
const SystemInfoDecoder = require('./format/system-info-decoder.js')
const TraceEventDecoder = require('./format/trace-event-decoder.js')
const ProcessStatDecoder = require('./format/process-stat-decoder.js')
const RenderRecommendations = require('./recommendations/index.js')

class ClinicDoctor {
  constructor (settings = {}) {
    // define default parameters
    const {
      sampleInterval = 10
    } = settings

    this.sampleInterval = sampleInterval
  }

  collect (args, callback) {
    const samplerPath = path.resolve(__dirname, 'sampler.js')

    // run program, but inject the sampler
    const logArgs = [
      '-r', samplerPath,
      '--trace-events-enabled', '--trace-event-categories', 'v8'
    ]
    const proc = spawn(args[0], args.slice(1), {
      stdio: 'inherit',
      env: Object.assign({}, process.env, {
        NODE_OPTIONS: logArgs.join(' ') + (
          process.env.NODE_OPTIONS ? ' ' + process.env.NODE_OPTIONS : ''
        ),
        NODE_CLINIC_DOCTOR_SAMPLE_INTERVAL: this.sampleInterval
      })
    })

    // get logging directory structure
    const paths = getLoggingPaths({ identifier: proc.pid })

    // relay SIGINT to process
    process.once('SIGINT', () => proc.kill('SIGINT'))

    proc.once('exit', function (code, signal) {
      // the process did not exit normally
      if (code !== 0 && signal !== 'SIGINT') {
        if (code !== null) {
          return callback(
            new Error(`process exited with exit code ${code}`),
            paths['/']
          )
        } else {
          return callback(
            new Error(`process exited by signal ${signal}`),
            paths['/']
          )
        }
      }

      // move trace_event file to logging directory
      fs.rename(
        'node_trace.1.log', paths['/traceevent'],
        function (err) {
          if (err) return callback(err, paths['/'])
          callback(null, paths['/'])
        }
      )
    })
  }

  visualize (dataDirname, outputFilename, callback) {
    const fakeDataPath = path.join(__dirname, 'visualizer', 'data.json')
    const stylePath = path.join(__dirname, 'visualizer', 'style.css')
    const scriptPath = path.join(__dirname, 'visualizer', 'main.js')
    const logoPath = path.join(__dirname, 'visualizer', 'app-logo.svg')

    // Load data
    const paths = getLoggingPaths({ path: dataDirname })
    const SystemInfoReader = fs.createReadStream(paths['/systeminfo'])
      .pipe(new SystemInfoDecoder())
    const traceEventReader = fs.createReadStream(paths['/traceevent'])
      .pipe(new TraceEventDecoder(SystemInfoReader))
    const processStatReader = fs.createReadStream(paths['/processstat'])
      .pipe(new ProcessStatDecoder())

    // create analysis
    const analysisStringified = analysis(traceEventReader, processStatReader)
      .pipe(new stream.Transform({
        readableObjectMode: false,
        writableObjectMode: true,
        transform (data, encoding, callback) {
          callback(null, JSON.stringify(data))
        }
      }))

    const traceEventStringify = traceEventReader.pipe(new Stringify({
      seperator: ',\n',
      stringifier: JSON.stringify
    }))

    const processStatStringify = processStatReader.pipe(new Stringify({
      seperator: ',\n',
      stringifier: JSON.stringify
    }))

    const dataFile = streamTemplate`
      {
        "traceEvent": ${traceEventStringify},
        "processStat": ${processStatStringify},
        "analysis": ${analysisStringified}
      }
    `

    // render recommendations as HTML templates
    const recommendations = new RenderRecommendations()

    // open logo
    const logoFile = fs.createReadStream(logoPath)

    // create script-file stream
    const b = browserify({
      'basedir': __dirname,
      // 'debug': true,
      'noParse': [fakeDataPath]
    })
    b.require(dataFile, {
      'file': fakeDataPath
    })
    b.add(scriptPath)
    b.transform('brfs')
    const scriptFile = b.bundle()

    // create style-file stream
    const styleFile = fs.createReadStream(stylePath)

    // build output file
    const outputFile = streamTemplate`
      <!DOCTYPE html>
      <html lang="en">
      <meta charset="utf8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Clinic Doctor</title>

      <style>${styleFile}</style>

      <div id="banner">
        ${logoFile}
      </div>
      <div id="front-matter">
        <div id="alert"></div>
        <div id="menu"></div>
      </div>
      <div id="graph"></div>
      <div id="recommendation-space"></div>
      <div id="recommendation"></div>

      ${recommendations}

      <script>${scriptFile}</script>
      </html>
    `

    pump(
      outputFile,
      fs.createWriteStream(outputFilename),
      callback
    )
  }
}

module.exports = ClinicDoctor
