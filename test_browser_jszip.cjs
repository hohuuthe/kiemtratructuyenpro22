const fs = require('fs');
const js = require('child_process').execSync('curl -s https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.js').toString();
fs.writeFileSync('jszip.js', js);
const JSZip = require('./jszip.js');
console.log('static loadAsync:', typeof JSZip.loadAsync);
console.log('instance loadAsync:', typeof (new JSZip()).loadAsync);
