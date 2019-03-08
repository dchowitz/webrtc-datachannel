#!/usr/bin/env node
const fs = require('fs-extra')
const path = require('path')
const Mustache = require('mustache')
const browserify = require('browserify')
const chokidar = require('chokidar')

const destDir = path.join(__dirname, 'dist')
fs.emptyDirSync(destDir)

const watch = process.argv[2] === '--watch'
if (watch) {
  console.log('watch mode')
  chokidar.watch(path.join(__dirname, 'index.html')).on('all', () => {
    console.log('updateIndex')
    updateIndex()
  })
  chokidar.watch(path.join(__dirname, '../dataChannel.js')).on('all', () => {
    console.log('updateDatachannel')
    updateDatachannel()
  })
  const browserSync = require('browser-sync').create()
  browserSync.init({
    watch: true,
    server: destDir,
    ghostMode: false,
    open: true
  })
} else {
  updateIndex()
  updateDatachannel()
}

function updateIndex () {
  fs.writeFileSync(
    path.join(destDir, 'index.html'),
    Mustache.render(
      fs.readFileSync(path.join(__dirname, 'index.html')).toString('utf8'),
      {
        turnserver: process.env.turnserver,
        turnuser: process.env.turnuser,
        turnpassword: process.env.turnpassword
      }
    )
  )
}

function updateDatachannel () {
  browserify(path.join(__dirname, '../dataChannel.js'), {
    standalone: 'datachannel'
  })
    .bundle()
    .pipe(fs.createWriteStream(path.join(destDir, 'datachannel.js')))
}
