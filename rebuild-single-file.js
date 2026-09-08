// Regenera backrooms-single-file.html a partir de index.html + css/style.css + js/*.js
const fs = require('fs');

const css = fs.readFileSync('css/style.css', 'utf8').replace(/\s+$/, '');

const idxHtml = fs.readFileSync('index.html', 'utf8');
// Cabecera tomada de index.html (incluye los CDN de three.js y Paho MQTT),
// sustituyendo la hoja de estilos externa por el CSS embebido
const headRaw = idxHtml.slice(idxHtml.indexOf('<head>'), idxHtml.indexOf('</head>') + '</head>'.length);
const head = '<!DOCTYPE html>\n<html lang="es">\n' +
    headRaw.replace(/<link rel="stylesheet" href="css\/style\.css[^"]*">/, '<style>\n' + css + '\n    </style>');

// Cuerpo sin las etiquetas <script src="js/..."> (el codigo va embebido abajo)
const body = idxHtml.slice(idxHtml.indexOf('<body>'), idxHtml.indexOf('</body>') + '</body>'.length)
    .replace(/<script src="js\/[^"]+"><\/script>\s*/g, '');

const scripts = [
    'js/textures-data.js',
    'js/textures.js',
    'js/audio.js',
    'js/models.js',
    'js/world.js',
    'js/chalk.js',
    'js/entity.js',
    'js/explorer.js',
    'js/net.js',
    'js/game.js'
].map(f => fs.readFileSync(f, 'utf8').replace(/\s+$/, ''));

const out = head + '\n' + body + '\n' +
    scripts.map(s => '    <script>\n' + s + '\n    </script>').join('\n') +
    '\n</body>\n</html>\n';

fs.writeFileSync('backrooms-single-file.html', out);
console.log('backrooms-single-file.html regenerado: ' + out.split('\n').length + ' lineas');