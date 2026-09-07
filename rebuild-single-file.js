// Regenera backrooms-single-file.html a partir de index.html + css/style.css + js/*.js
const fs = require('fs');

const old = fs.readFileSync('backrooms-single-file.html', 'utf8').split('\n');
const head = old.slice(0, 8).join('\n');   // doctype/head/three.js CDN

const css = fs.readFileSync('css/style.css', 'utf8').replace(/\s+$/, '');

const idxHtml = fs.readFileSync('index.html', 'utf8');
const body = idxHtml.slice(idxHtml.indexOf('<body>'), idxHtml.indexOf('</body>') + '</body>'.length);

const scripts = [
    'js/textures-data.js',
    'js/textures.js',
    'js/audio.js',
    'js/models.js',
    'js/world.js',
    'js/chalk.js',
    'js/entity.js',
    'js/game.js'
].map(f => fs.readFileSync(f, 'utf8').replace(/\s+$/, ''));

const out = head + '\n' +
    '    <style>\n' + css + '\n    </style>\n' +
    '</head>\n' + body + '\n' +
    scripts.map(s => '    <script>\n' + s + '\n    </script>').join('\n') +
    '\n</body>\n</html>\n';

fs.writeFileSync('backrooms-single-file.html', out);
console.log('backrooms-single-file.html regenerado: ' + out.split('\n').length + ' lineas');