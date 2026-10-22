const JSZip = require('jszip');
console.log('static:', typeof JSZip.loadAsync);
console.log('instance:', typeof (new JSZip()).loadAsync);
