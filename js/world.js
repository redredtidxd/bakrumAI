/* ==========================================================================
   4. MUNDO INFINITO POR CHUNKS: NIVEL 0 PROCEDURAL SIN FIN
   ==========================================================================
   El Nivel 0 es INFINITO: el mundo se genera por trozos (chunks) de 16x16
   celdas alrededor del jugador y los trozos lejanos se descargan. Cada chunk
   se genera con una semilla determinista (misma coordenada -> mismo laberinto)
   y mezcla de todo tipo de espacios:
     - pasillos estrechos (1 celda), medianos (2) y anchos (3) en la misma red      - salas de cualquier tamaño (3x3 ... 8x8) y salones enormes con pilares
      - zonas casi vacias, muy separadas entre si ("void")
      - callejones SIN SALIDA que obligan a dar la vuelta (el infinito no se
        rompe: cada callejon es local y solo conecta con la red por su boca)
   Las puertas entre chunks se calculan a partir del borde COMPARTIDO, asi los
   pasillos siguen siempre conectados hacia el infinito en cualquier direccion.
   Esos vanos NO son puertas reales: son grandes huecos abiertos en la pared
   por los que se pasa caminando, sin hojas ni marcos.
   Los objetos (camera, tiza, agua, pilas, notas) se guardan aunque su chunk
   se descargue: si vuelves, siguen ahi para recogerlos.
   ========================================================================== */
    const CELL_SIZE = 2.8;
    const WALL_HEIGHT = 2.7;
    const CHUNK_SIZE = 16;   // celdas por chunk (44,8 m)
    const LOAD_RADIUS = 1;   // anillo de chunks activos alrededor del jugador

    const wallpaperTex = TextureGenerator.createWallpaperTexture();
    const ceilingTex = TextureGenerator.createCeilingTexture();

    const Materials = {
        wall: new THREE.MeshStandardMaterial({ map: wallpaperTex, roughness: 0.85 }),
        // Moqueta textil exterior (assets/floor-texture.png): mate, sin brillo
        floor: new THREE.MeshStandardMaterial({ map: FloorCarpetTexture, roughness: 0.95 }),
        ceiling: new THREE.MeshStandardMaterial({ map: ceilingTex, roughness: 0.95, metalness: 0.0 }),
        // Tulipas emisivas: los paneles lejanos brillan siempre a traves de la niebla,
        // sin necesidad de cientos de PointLights dinamicos
        lampLit: new THREE.MeshStandardMaterial({
            color: 0xffe69a,
            emissive: new THREE.Color(0xffe38a),
            emissiveIntensity: 0.55,
            roughness: 0.4
        }),
        lampFlicker: new THREE.MeshStandardMaterial({
            color: 0xffe69a,
            emissive: new THREE.Color(0xffe38a),
            emissiveIntensity: 0.55,
            roughness: 0.4
        }),
        lampOff: new THREE.MeshStandardMaterial({ color: 0x11100c, roughness: 0.9 }),
        lampFrame: new THREE.MeshStandardMaterial({ color: 0x2e2c24, metalness: 0.5, roughness: 0.6 })
    };

    // ---- RNG determinista: el mismo chunk siempre genera el mismo laberinto ----
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    // SEMILLA GLOBAL DEL MUNDO: mezclada en hash2, cambia TODO el laberinto
    // manteniendo la determinismo (misma semilla -> mismo mundo infinito).
    let WORLD_SEED = (Math.random() * 0xFFFFFFFF) >>> 0;

    function setWorldSeed(seed) {
        WORLD_SEED = (seed >>> 0) || 1;
    }

    // Convierte una semilla de texto (campo personalizado) en un entero
    function stringSeed(str) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h >>> 0;
    }

    function hash2(x, z) {
        let h = (x * 374761393 + z * 668265263) | 0;
        h = (h ^ WORLD_SEED) >>> 0;
        h = (h ^ (h >>> 13)) | 0;
        h = Math.imul(h, 1274126177) | 0;
        return (h ^ (h >>> 16)) >>> 0;
    }

    // NOTAS DE LORE (50 DE TODO TIPO): cada texto solo se recoge UNA vez en
    // toda la partida. Mezcla de diario (entradas), consejos de juego, avisos,
    // mensajes de otros exploradores y notas de ambiente.
    const NOTE_POOL = [
        "Entrada 1: Doblar esquinas me salvo. Esa cosa corre hacia donde te vio por ultima vez, pero si cambias de pasillo, se desorienta.",
        "Entrada 2: El flash de la camara analogica es letal para sus ojos. No corras en vano, preparalo.",
        "Entrada 3: La tiza sobrevive en la moqueta. Dibuja flechas en cada giro para saber de donde venias.",
        "Entrada 4: Los pilares del centro de las salas bloquean su vision. Si te agachas tras ellos, pasara de largo.",
        "Entrada 5: Llevo dias caminando y nunca encuentro una pared exterior. Cada pasillo ancho desemboca en otro estrecho y el amarillo no cambia.",
        "Entrada 6: Los pasillos anchos son mas seguros: hay donde esconderse. Los angostos solo sirven para perderte.",
        "Entrada 7: El agua de almendras sabe raro pero quita la sed. Nunca bebas de los grifos de las paredes.",
        "Entrada 8: La humedad del techo gotea SIEMPRE en el mismo sitio. Si un dia no gotea, vete.",
        "Entrada 9: Conté 37 salas identicas seguidas. En la 38 habia una silla. Me sente. No debi sentarme.",
        "Entrada 10: Los que vuelven de explorar no son los mismos que se fueron. Aprendi a mirarles las manos.",
        "Entrada 11: Las pilas duran mas si las guardas envueltas en recortes de moqueta.",
        "Entrada 12: La moqueta absorbe el sonido. Todo excepto MIS pasos. Esa cosa tambien camina en silencio.",
        "Entrada 13: Dormir es peligroso pero inevitable. Duermo con la linterna encendida y la espalda contra una esquina.",
        "Entrada 14: El nivel tiene fallos: puertas que no deberian existir, luces que no deberian parpadear. Los fallos son la salida. O la trampa.",
        "CONSEJO: El flash de la camara necesita pilas para recargarse. No lo gastes en cada esquina.",
        "CONSEJO: La tiza negra se ve mejor sobre el papel pintado amarillo.",
        "CONSEJO: Si la luz parpadea cerca de ti, esa cosa ya sabe donde estas.",
        "CONSEJO: Correr hace ruido. A veces conviene andar.",
        "CONSEJO: El agua de almendras recupera la estabilidad mental poco a poco.",
        "CONSEJO: Deja marcas de tiza: las salas se repiten y es facil dar vueltas en circulos.",
        "CONSEJO: La linterna se recarga con pilas. Si se apaga en la oscuridad, no corras: camina.",
        "CONSEJO: Esa cosa no atraviesa paredes. Todavia.",
        "CUIDADO: te persigue mas rapido si corres. Camina y la perderas en el siguiente giro.",
        "CUIDADO: no mires fijamente las luces parpadeantes mas de unos segundos.",
        "CUIDADO: si oyes un zumbido doble, hay DOS.",
        "CUIDADO: los dibujos de las paredes no los hice yo.",
        "CUIDADO: no te fies de las notas que no esten escritas a mano.",
        "CUIDADO: si ves una sala iluminada que deberia estar a oscuras, no entres.",
        "Alguien estuvo aqui: hola, si lees esto, la salida no existe.",
        "Llevo 3 dias aqui. He dejado esta nota en 10 sitios distintos. Nunca encuentro ninguna de las anteriores.",
        "Se llama 'el que vigila'. No le pongas nombre. Lo siento, ya se lo he puesto.",
        "Si encuentras mi camara, el ultimo carrete no es mio.",
        "ME SIGUE. Ya no importa donde me esconda. Que alguien borre esta nota cuando la lea.",
        "La primera regla: no toques el papel pintado.",
        "Estoy bien. Estoy bien. Estoy bien. Estoy bien. Estoy bien.",
        "Hay 128 semillas diferentes y yo las he probado todas. Siempre el mismo amarillo.",
        "El conserje existe. No es amable.",
        "El zumbido de las luces se parece a una cancion. No la silbes.",
        "Ayer encontre mi propia nota de hace una semana. Yo no la escribi.",
        "Las tazas de cafe de las mesas siempre estan calientes. Nunca hay nadie.",
        "Un cartel decia SALIDA. Anduve 3 horas hacia el. Sigue a 3 horas.",
        "La moqueta tiene manchas que cambian de forma cuando apago la linterna.",
        "Hay un punto del techo donde el papel pintado se arruga como una sonrisa.",
        "Conté las lamparas: 100. Luego 100 otra vez. Luego 101.",
        "El que escribio esto ya no esta. Yo sigo aqui. Por ahora.",
        "Dicen que en el nivel 1 hay oficinas con ventanas. No conozco a nadie que lo haya logrado.",
        "El tiempo no pasa aqui: pasa por aqui.",
        "REGLA NO ESCRITA: los objetos del suelo son tuyos o de nadie. No los compartas con la cosa.",
        "P.D.: la linterna tambien la frena si la miras de frente. Pero la pila no dura para siempre.",
        "Ultima nota: si estas leyendo esto, tienes compania. Las notas se ven desde lejos. Eso la atrae."
    ];

    // ---- GRAFITI: 100 variantes (frases y simbolos) de cosas tipicas de los
    // backrooms, pintadas en BLANCO, NEGRO o ROJO sobre las paredes. Cada
    // variante se dibuja en un canvas 256x256 al vuelo (cache por variante +
    // color: solo se generan los que se usan de verdad) y se pega a la pared
    // como un plano transparente. El RNG del chunk decide donde, cual y de
    // que color: todos los jugadores ven exactamente los mismos grafitis. ----
    const GRAFFITI_COLORS = ['#efe9dc', '#151209', '#c23a2b'];
    const GRAFFITI_POOL = [
        { t: 'SMILE!' }, { t: 'RUN.' }, { t: 'NO\nEXIT' }, { t: "DON'T\nBLINK" },
        { t: 'TURN\nBACK' }, { t: 'WHY AM I\nHERE?' }, { t: "THEY'RE IN\nTHE WALLS" }, { t: 'LEVEL 0' },
        { t: 'NOCLIP' }, { t: 'HELP ME' }, { t: "I'M STILL\nHERE" }, { t: "DON'T TRUST\nTHE LIGHTS" },
        { t: 'KEEP\nWALKING' }, { t: "IT'S BEHIND\nYOU" }, { t: 'STAY CALM' }, { t: 'FOLLOW THE\nARROWS' },
        { t: 'ALMOND\nWATER' }, { t: 'PRAY.' }, { t: "DON'T LOOK\nBACK" }, { t: 'OUT OF\nORDER' },
        { t: 'SOMETHING\nFOLLOWS' }, { t: 'BREATHE.' }, { t: 'NOISE\nATTRACTS' }, { t: 'THE CARPET\nHUMS' },
        { t: 'THE HUM\nLIES' }, { t: 'FALSE\nEXIT' }, { t: 'I SAW IT.\nIT SAW ME.' }, { t: 'WALLS BLEED\nYELLOW' },
        { t: 'LEFT. LEFT.\nLEFT. LEFT.' }, { t: 'GO BACK\nWHILE YOU\nCAN' }, { t: 'NOTHING\nWORKS' }, { t: "THIS ISN'T\nREAL" },
        { t: 'CURIOSITY\nKILLED ME' }, { t: 'SORRY.' }, { t: 'WELCOME\nTO HELL' }, { t: 'ENDLESS.' },
        { t: 'IT HIDES IN\nTHE DARK' }, { t: 'STAY IN\nTHE LIGHT' }, { t: 'COVER THE\nDOOR' }, { t: 'SLEEP IS\nDEATH' },
        { t: 'DRINK THE\nALMOND\nWATER' }, { t: 'FIND THE\nCAMERA' }, { t: 'THE FLASH\nSCARES IT' }, { t: 'CHALK\nSAVES' },
        { t: 'LISTEN FOR\nTHE HUM' }, { t: 'REPEAT.' }, { t: 'IS ANYONE\nTHERE?' }, { t: 'HELLO?' },
        { t: 'ANYONE?' }, { t: 'I WAS HERE' }, { t: 'MILK.' }, { t: 'FRED WAS\nHERE' },
        { t: 'NO ESCAPE' }, { t: 'GIVE UP.' }, { t: 'KEEP GOING' }, { t: "DON'T SIT\nON THE\nFLOOR" },
        { t: 'THE CEILING\nIS WATCHING' }, { t: 'IT\nBREATHES' }, { t: 'WE ARE\nALL LOST' }, { t: "SMILE IF\nYOU'RE\nSCARED" },
        { t: 'I COUNTED\n1000 DOORS' }, { t: 'THE SAME\nWALL EVERY\nTIME' }, { t: 'MAYBE THIS\nIS HEAVEN' }, { t: 'MAYBE THIS\nIS HELL' },
        { t: "DON'T." }, { t: 'STOP.' }, { t: 'GO BACK.' }, { t: 'KILL THE\nHUM' },
        { t: 'NOTHING IS\nREAL HERE' },
        { s: 'arrowR' }, { s: 'arrowL' }, { s: 'arrowU' }, { s: 'arrowD' },
        { s: 'spiral' }, { s: 'tally' }, { s: 'tallyX' }, { s: 'xmark' },
        { s: 'smile' }, { s: 'sad' }, { s: 'stick' }, { s: 'warn' },
        { s: 'star' }, { s: 'circle' }, { s: 'nope' }, { s: 'sos' },
        { s: 'heart' }, { s: 'cross' }, { s: 'hash' }, { s: 'eye' },
        { s: 'skull' }, { s: 'qmark' }, { s: 'exclaim' }, { s: 'maze' },
        { s: 'inf' }, { s: 'door' }, { s: 'key' }, { s: 'clock' },
        { s: 'ghost' }, { s: 'crown' }, { s: 'ladder' }
    ];

    const graffitiTexCache = new Map();
    function graffitiTexture(variant, colorHex) {
        const ck = variant + '|' + colorHex;
        let tex = graffitiTexCache.get(ck);
        if (tex) return tex;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const entry = GRAFFITI_POOL[variant % GRAFFITI_POOL.length];
        // Aspecto fijo por variante (mismo dibujo en todas las partidas)
        const rng = mulberry32(variant * 2654435761 + 0x9E3779B9);
        ctx.translate(128, 128);
        ctx.rotate((rng() - 0.5) * 0.18);
        if (entry.t) drawGraffitiText(ctx, entry.t, colorHex, rng);
        else drawGraffitiSymbol(ctx, entry.s, colorHex, rng);
        // Grano de pintura gastada
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = colorHex;
        for (let i = 0; i < 380; i++) {
            ctx.fillRect((rng() - 0.5) * 250, (rng() - 0.5) * 250, 1 + rng() * 1.7, 1 + rng() * 1.7);
        }
        ctx.globalAlpha = 1;
        tex = new THREE.CanvasTexture(canvas);
        graffitiTexCache.set(ck, tex);
        return tex;
    }

    function drawGraffitiText(ctx, text, colorHex, rng) {
        const lines = text.split('\n');
        const fs = 40;
        ctx.font = `900 ${fs}px "Segoe Print", "Comic Sans MS", "Marker Felt", cursive`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = colorHex;
        for (let li = 0; li < lines.length; li++) {
            const y = (li - (lines.length - 1) / 2) * fs * 1.2;
            // Doble pasada desfasada: efecto spray/desgaste
            ctx.globalAlpha = 0.4;
            ctx.fillText(lines[li], (rng() - 0.5) * 3, y + (rng() - 0.5) * 3);
            ctx.globalAlpha = 0.96;
            ctx.fillText(lines[li], 0, y);
        }
        ctx.globalAlpha = 1;
    }

    function drawGraffitiSymbol(ctx, sym, colorHex, rng) {
        ctx.strokeStyle = colorHex;
        ctx.fillStyle = colorHex;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.scale(1.05, 1.05);
        switch (sym) {
            case 'arrowR':
                ctx.beginPath(); ctx.moveTo(-62, 0); ctx.lineTo(58, 0); ctx.moveTo(36, -22); ctx.lineTo(58, 0); ctx.lineTo(36, 22); ctx.stroke(); break;
            case 'arrowL':
                ctx.beginPath(); ctx.moveTo(62, 0); ctx.lineTo(-58, 0); ctx.moveTo(-36, -22); ctx.lineTo(-58, 0); ctx.lineTo(-36, 22); ctx.stroke(); break;
            case 'arrowU':
                ctx.beginPath(); ctx.moveTo(0, 62); ctx.lineTo(0, -58); ctx.moveTo(-22, -36); ctx.lineTo(0, -58); ctx.lineTo(22, -36); ctx.stroke(); break;
            case 'arrowD':
                ctx.beginPath(); ctx.moveTo(0, -62); ctx.lineTo(0, 58); ctx.moveTo(-22, 36); ctx.lineTo(0, 58); ctx.lineTo(22, 36); ctx.stroke(); break;
            case 'spiral': {
                ctx.beginPath();
                for (let a = 0, first = true; a < Math.PI * 9; a += 0.14) {
                    const r = 4 + a * 3.1;
                    const px = Math.cos(a) * r, py = Math.sin(a) * r;
                    if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
                }
                ctx.stroke();
                break;
            }
            case 'tally':
                for (let i = -2; i <= 2; i++) {
                    ctx.beginPath(); ctx.moveTo(i * 22, -58); ctx.lineTo(i * 22, 58); ctx.stroke();
                }
                ctx.beginPath(); ctx.moveTo(-55, -8); ctx.lineTo(55, 8); ctx.stroke();
                break;
            case 'tallyX':
                for (let i = -2; i <= 2; i++) {
                    ctx.beginPath(); ctx.moveTo(i * 22, -58); ctx.lineTo(i * 22, 58); ctx.stroke();
                }
                ctx.beginPath(); ctx.moveTo(-55, -58); ctx.lineTo(55, 58); ctx.moveTo(55, -58); ctx.lineTo(-55, 58); ctx.stroke();
                break;
            case 'xmark':
                ctx.beginPath(); ctx.moveTo(-55, -55); ctx.lineTo(55, 55); ctx.moveTo(55, -55); ctx.lineTo(-55, 55); ctx.stroke(); break;
            case 'smile':
                ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(-24, -16, 7, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(24, -16, 7, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(0, 8, 34, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
                break;
            case 'sad':
                ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(-24, -16, 7, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(24, -16, 7, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(0, 24, 34, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
                break;
            case 'stick': {
                ctx.beginPath(); ctx.arc(0, -48, 18, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(0, 40); ctx.moveTo(0, -14); ctx.lineTo(-34, 14); ctx.moveTo(0, -14); ctx.lineTo(34, 14); ctx.moveTo(0, 40); ctx.lineTo(-26, 62); ctx.moveTo(0, 40); ctx.lineTo(26, 62); ctx.stroke();
                break;
            }
            case 'warn':
                ctx.beginPath(); ctx.moveTo(0, -62); ctx.lineTo(56, 54); ctx.lineTo(-56, 54); ctx.closePath(); ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 22, 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillRect(-4, -34, 8, 40);
                break;
            case 'star': {
                ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    const r = i % 2 === 0 ? 62 : 26;
                    const a = -Math.PI / 2 + i * Math.PI / 5;
                    const px = Math.cos(a) * r, py = Math.sin(a) * r;
                    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                ctx.closePath(); ctx.fill();
                break;
            }
            case 'circle':
                ctx.beginPath(); ctx.arc(0, 0, 56, 0, Math.PI * 2); ctx.stroke(); break;
            case 'nope':
                ctx.beginPath(); ctx.arc(0, 0, 56, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-42, -42); ctx.lineTo(42, 42); ctx.stroke();
                break;
            case 'sos':
                ctx.font = '900 56px "Courier New", monospace';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('SOS', 0, 4);
                break;
            case 'heart': {
                ctx.beginPath();
                ctx.moveTo(0, 52);
                ctx.bezierCurveTo(-66, 8, -42, -58, 0, -18);
                ctx.bezierCurveTo(42, -58, 66, 8, 0, 52);
                ctx.fill();
                break;
            }
            case 'cross':
                ctx.fillRect(-16, -60, 32, 120);
                ctx.fillRect(-60, -16, 120, 32);
                break;
            case 'hash':
                ctx.beginPath();
                ctx.moveTo(-14, -62); ctx.lineTo(-14, 62);
                ctx.moveTo(14, -62); ctx.lineTo(14, 62);
                ctx.moveTo(-62, -14); ctx.lineTo(62, -14);
                ctx.moveTo(-62, 14); ctx.lineTo(62, 14);
                ctx.stroke();
                break;
            case 'eye':
                ctx.beginPath();
                ctx.moveTo(-62, 0);
                ctx.quadraticCurveTo(0, -52, 62, 0);
                ctx.quadraticCurveTo(0, 52, -62, 0);
                ctx.closePath(); ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
                break;
            case 'skull':
                ctx.beginPath(); ctx.arc(0, -4, 46, 0, Math.PI * 2); ctx.fill();
                ctx.fillRect(-26, 26, 52, 16);
                ctx.globalCompositeOperation = 'destination-out';
                ctx.beginPath(); ctx.arc(-18, -16, 9, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(18, -16, 9, 0, Math.PI * 2); ctx.fill();
                ctx.fillRect(-8, 30, 5, 12); ctx.fillRect(3, 30, 5, 12);
                ctx.globalCompositeOperation = 'source-over';
                break;
            case 'qmark':
                ctx.font = '900 120px "Arial Black", Arial, sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('?', 0, -6);
                break;
            case 'exclaim':
                ctx.font = '900 120px "Arial Black", Arial, sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('!', 0, -6);
                break;
            case 'maze': {
                ctx.beginPath();
                for (const [x, y] of [[-52, -52], [0, -52], [52, -52], [-52, 0], [52, 0], [-52, 52], [0, 52], [52, 52]]) {
                    ctx.rect(x, y, 26, 26);
                }
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(-26, 0); ctx.lineTo(0, 0); ctx.lineTo(0, -26);
                ctx.stroke();
                break;
            }
            case 'inf':
                ctx.beginPath();
                ctx.arc(-26, 0, 34, 0.5 * Math.PI, 2.5 * Math.PI);
                ctx.arc(26, 0, 34, -0.5 * Math.PI, 0.5 * Math.PI);
                ctx.stroke();
                break;
            case 'door':
                ctx.strokeRect(-46, -60, 92, 120);
                ctx.beginPath(); ctx.arc(34, 0, 5, 0, Math.PI * 2); ctx.fill();
                break;
            case 'key':
                ctx.beginPath(); ctx.arc(-34, 0, 26, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(56, 0); ctx.moveTo(44, 0); ctx.lineTo(44, 20); ctx.moveTo(30, 0); ctx.lineTo(30, 14); ctx.stroke();
                break;
            case 'clock':
                ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -36); ctx.moveTo(0, 0); ctx.lineTo(28, 10); ctx.stroke();
                ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
                break;
            case 'ghost':
                ctx.beginPath();
                ctx.moveTo(-52, 56);
                ctx.lineTo(-52, -20);
                ctx.quadraticCurveTo(-52, -62, 0, -62);
                ctx.quadraticCurveTo(52, -62, 52, -20);
                ctx.lineTo(52, 56);
                ctx.lineTo(34, 40); ctx.lineTo(17, 56); ctx.lineTo(0, 40); ctx.lineTo(-17, 56); ctx.lineTo(-34, 40);
                ctx.closePath(); ctx.stroke();
                ctx.beginPath(); ctx.arc(-18, -18, 7, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(18, -18, 7, 0, Math.PI * 2); ctx.fill();
                break;
            case 'crown':
                ctx.beginPath();
                ctx.moveTo(-52, 30); ctx.lineTo(-52, -12);
                ctx.lineTo(-26, 22); ctx.lineTo(0, -34); ctx.lineTo(26, 22); ctx.lineTo(52, -12); ctx.lineTo(52, 30);
                ctx.closePath(); ctx.fill();
                break;
            case 'ladder':
                ctx.beginPath();
                ctx.moveTo(-30, -58); ctx.lineTo(-30, 58);
                ctx.moveTo(30, -58); ctx.lineTo(30, 58);
                for (let y = -44; y <= 44; y += 22) {
                    ctx.moveTo(-30, y); ctx.lineTo(30, y);
                }
                ctx.stroke();
                break;
        }
    }

    class WorldGridSystem {
        constructor(scene) {
            this.scene = scene;
            this.chunks = new Map();          // clave "cx,cz" -> chunk (cargado o en memoria)
            this.wallBoxes = [];              // union: muros/pilares cargados + muebles cercanos
            this.lamps = [];                  // union de lamparas de los chunks cargados
            this.pickups = [];                // union de objetos materializados sin recoger
            this.pickupData = [];             // datos persistentes de TODOS los objetos (recogidos o no)
            this.walkableCells = [];          // union de celdas transitables cargadas
            this.occupiedFurnitureBoxes = []; // muebles: centros ocupados (mundo)
            this.furnitureBoxes = [];         // muebles: cajas solidas (mundo, persistentes)
            this.dynamicFurniture = [];       // muebles con fisica (mundo)
            this.furnitureMeshes = [];        // mallas de muebles en la escena (para reconstruir)
            this.collectedNoteIndices = new Set();
            this.pickupById = new Map();      // id persistente -> datos del objeto
            this.claimedPickupIds = new Set(); // objetos reclamados por CUALQUIER jugador
            this._lcx = undefined;
            this._lcz = undefined;
            this._playerPos = new THREE.Vector3(0, 0, 0);

            this.update(new THREE.Vector3(0, 0, 0));
        }

        // ================================================================
        //  CARGA / DESCARGA DE CHUNKS (mundo infinito)
        // ================================================================
        update(playerPos) {
            const ccx = Math.floor(playerPos.x / (CHUNK_SIZE * CELL_SIZE));
            const ccz = Math.floor(playerPos.z / (CHUNK_SIZE * CELL_SIZE));
            if (ccx === this._lcx && ccz === this._lcz && this._lcx !== undefined) return;
            this._lcx = ccx;
            this._lcz = ccz;
            this._playerPos.copy(playerPos);

            // Descargar los chunks que quedaron fuera del radio
            for (const [key, ch] of [...this.chunks]) {
                if (ch.loaded && (Math.abs(ch.cx - ccx) > LOAD_RADIUS || Math.abs(ch.cz - ccz) > LOAD_RADIUS)) {
                    this.unloadChunk(ch);
                }
            }
            // Cargar (o recargar) los chunks del anillo
            for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
                for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
                    const key = (ccx + dx) + ',' + (ccz + dz);
                    const ch = this.chunks.get(key);
                    if (!ch || !ch.loaded) this.loadChunk(ccx + dx, ccz + dz);
                }
            }
        }

        loadChunk(cx, cz) {
            const key = cx + ',' + cz;
            let ch = this.chunks.get(key);
            if (!ch) {
                ch = {
                    key, cx, cz,
                    loaded: false,
                    grid: null,
                    rooms: [],          // salas en celdas locales {x,z,w,h}
                    openCells: [],      // celdas transitables en celdas de MUNDO {x,z}
                    doorCells: [],      // celdas interiores de las puertas (locales)
                    wallBoxes: [],      // cajas de muros/pilares (mundo)
                    slantedAABBs: [],   // cajas envolventes de tabiques inclinados
                    lamps: [],
                    meshes: [],
                    pickupList: [],
                    furnitureDone: false,
                    pickupsDone: false,
                    rng: mulberry32(hash2(cx, cz))
                };
                this.chunks.set(key, ch);
                this.generateLayout(ch);
            }
            ch.loaded = true;
            this.buildChunkMeshes(ch);
            this.rebuildUnions();
            this.placeChunkFurniture(ch);
            this.spawnChunkPickups(ch);
            this.rebuildUnions();
        }

        // Regenera TODO el mundo con otra semilla (campo personalizado del
        // menu inicial): descarga todos los chunks, retira los muebles de la
        // escena y vuelve a generar alrededor del jugador.
        rebuild(seed) {
            setWorldSeed(seed);
            for (const ch of [...this.chunks.values()]) this.unloadChunk(ch);
            this.chunks.clear();
            for (const m of this.furnitureMeshes) this.scene.remove(m);
            this.furnitureMeshes = [];
            this.wallBoxes = [];
            this.lamps = [];
            this.pickups = [];
            this.pickupData = [];
            this.walkableCells = [];
            this.occupiedFurnitureBoxes = [];
            this.furnitureBoxes = [];
            this.dynamicFurniture = [];
            this.collectedNoteIndices = new Set();
            this.pickupById = new Map();
            this.claimedPickupIds = new Set();
            this._lcx = undefined;
            this._lcz = undefined;
            this.update(this._playerPos);
            this.rebuildUnions();
        }

        unloadChunk(ch) {
            if (!ch.loaded) return;
            ch.loaded = false;
            for (const m of ch.meshes) this.scene.remove(m);
            ch.meshes = [];
            ch.wallBoxes = [];
            ch.lamps = [];
            // Los objetos guardan su estado: al recargar el chunk reaparecen
            for (const p of ch.pickupList) {
                if (p.mesh) { this.scene.remove(p.mesh); p.mesh = null; }
            }
            this.rebuildUnions();
        }

        // Reconstruye los arrays publicos a partir de los chunks cargados
        rebuildUnions() {
            const wallBoxes = [];
            const lamps = [];
            const walkable = [];
            const pickups = [];
            const px = this._playerPos.x;
            const pz = this._playerPos.z;
            const keepDist = LOAD_RADIUS * CHUNK_SIZE * CELL_SIZE * 2.2; // ~99 m

            for (const ch of this.chunks.values()) {
                if (!ch.loaded) continue;
                wallBoxes.push(...ch.wallBoxes);
                lamps.push(...ch.lamps);
                walkable.push(...ch.openCells);
                for (const p of ch.pickupList) {
                    if (!p.collected && p.mesh) pickups.push(p);
                }
            }
            // Muebles persistentes: solo los cercanos al jugador entran en colision
            for (const box of this.furnitureBoxes) {
                if (Math.hypot(box.minX - px, box.minZ - pz) < keepDist) wallBoxes.push(box);
            }
            this.wallBoxes = wallBoxes;
            this.lamps = lamps;
            this.walkableCells = walkable;
            this.pickups = pickups;
            // Tabiques inclinados de los chunks cargados (para la IA de la entidad)
            this.slantedAABBs = [];
            for (const ch of this.chunks.values()) {
                if (ch.loaded && ch.slantedAABBs) this.slantedAABBs.push(...ch.slantedAABBs);
            }
        }

        // True si el punto (mundo, XZ) cae dentro de un tabique inclinado
        pointInSlab(x, z) {
            for (const b of this.slantedAABBs) {
                if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
            }
            return false;
        }

        // Tipo de chunk CONTINUO por logica, no por azar de chunk: el tipo se
        // lee de un campo de ruido suave sobre el plano (cx,cz). Asi dos chunks
        // vecinos SIEMPRE tienen tipos parecidos y los cambios de ambiente
        // (salas -> pasillos -> salon -> vacio) son graduales, en lugar de saltar
        // de golpe al cruzar un borde de chunk (que delata la rejilla y no parece
        // un backroom real).
        typeField(cx, cz) {
            const REGION = 3;              // la malla de ruido se espacia ~3 chunks
            const smooth = (t) => t * t * (3 - 2 * t);
            const fx = (cx + 0.5) / REGION;   // centrado: ningun chunk cae en una esquina
            const fz = (cz + 0.5) / REGION;
            const x0 = Math.floor(fx), z0 = Math.floor(fz);
            const u = smooth(fx - x0), v = smooth(fz - z0);
            const lat = (x, z) => (hash2(x * 131 + 71, z * 131 + 113) >>> 0) / 4294967296;
            const a = lat(x0, z0), b = lat(x0 + 1, z0);
            const c = lat(x0, z0 + 1), d = lat(x0 + 1, z0 + 1);
            return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
        }

        // Nivel de luz del chunk: campo suave independiente del tipo de chunk.
        // Produce zonas contiguas de oscuridad (apagones) en lugar de lamparas
        // al azar: dos chunks vecinos tienen casi siempre luz parecida.
        lightField(cx, cz) {
            return this.typeField(cx + 10000, cz - 5000);
        }

        // Tipo de celda en coordenadas de celda de MUNDO (null si el chunk no esta cargado)
        cellTypeAt(wcx, wcz) {
            const ch = this.chunks.get(Math.floor(wcx / CHUNK_SIZE) + ',' + Math.floor(wcz / CHUNK_SIZE));
            if (!ch || !ch.loaded) return null;
            const lx = wcx - ch.cx * CHUNK_SIZE;
            const lz = wcz - ch.cz * CHUNK_SIZE;
            if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return null;
            return ch.grid[lx][lz];
        }

        gridAt(wcx, wcz) {
            return this.cellTypeAt(wcx, wcz);
        }

        // ================================================================
        //  GENERADOR DE LABERINTO POR CHUNK (16x16 celdas, tipo de la semilla)
        // ================================================================
        // Puertas de un borde compartido: Este y Sur siempre tienen >= 1 puerta,
        // Oeste y Norte heredan las del vecino. Mismo borde -> misma semilla.
        edgeDoors(cx, cz, side) {
            const seed = side === 'east' ? hash2(cx * 2 + 1, cz) : hash2(cx, cz * 2 + 1);
            const r = mulberry32(seed);
            const count = r() < 0.4 ? 1 : 2;
            const doors = [];
            for (let i = 0; i < count; i++) {
                let placed = false;
                for (let a = 0; a < 8 && !placed; a++) {
                    // Vanos ANCHOS: no son puertas reales, son grandes huecos en la pared
                    const w = r() < 0.35 ? 1 : (r() < 0.8 ? 2 : 3);
                    const p = 1 + Math.floor(r() * (CHUNK_SIZE - 3 - w));
                    if (doors.every(d => p >= d.p + d.w || d.p >= p + w)) {
                        doors.push({ p, w });
                        placed = true;
                    }
                }
            }
            return doors;
        }

        generateLayout(ch) {
            const N = CHUNK_SIZE;
            const g = ch.grid = Array.from({ length: N }, () => new Array(N).fill(1));
            const r = ch.rng;

            // ---- 1) Puertas en los 4 bordes (conectan siempre con el vecino) ----
            const carveDoor = (x, z) => { g[x][z] = 0; };
            for (const d of this.edgeDoors(ch.cx - 1, ch.cz, 'east')) {      // oeste
                for (let z = d.p; z < d.p + d.w; z++) { carveDoor(0, z); carveDoor(1, z); }
                ch.doorCells.push({ x: 1, z: d.p + Math.floor(d.w / 2) });
            }
            for (const d of this.edgeDoors(ch.cx, ch.cz - 1, 'south')) {     // norte
                for (let x = d.p; x < d.p + d.w; x++) { carveDoor(x, 0); carveDoor(x, 1); }
                ch.doorCells.push({ x: d.p + Math.floor(d.w / 2), z: 1 });
            }
            for (const d of this.edgeDoors(ch.cx, ch.cz, 'east')) {          // este
                for (let z = d.p; z < d.p + d.w; z++) { carveDoor(N - 1, z); carveDoor(N - 2, z); }
                ch.doorCells.push({ x: N - 2, z: d.p + Math.floor(d.w / 2) });
            }
            for (const d of this.edgeDoors(ch.cx, ch.cz, 'south')) {         // sur
                for (let x = d.p; x < d.p + d.w; x++) { carveDoor(x, N - 1); carveDoor(x, N - 2); }
                ch.doorCells.push({ x: d.p + Math.floor(d.w / 2), z: N - 2 });
            }

            // ---- 2) Interior segun el tipo CONTINUO del chunk ----
            // El tipo sale de un campo de ruido suave (vecinos parecidos), no de
            // un azar por chunk: las paredes y el suelo cambian por logica
            // Umbrales calibrados sobre la CDF del campo de ruido para que la
            // mezcla de ambientes conserve las proporciones de diseno (~30%
            // salas, ~25% salon, ~33% pasillos, ~12% vacio)
            const t = this.typeField(ch.cx, ch.cz);
            if (t < 0.39) this.carveRooms(ch);
            else if (t < 0.53) this.carveHall(ch);
            else if (t < 0.78) this.carveCorridors(ch);
            else this.carveVoid(ch);

            // ---- 3) Conectividad garantizada: nada queda inaccesible ----
            this.connectChunk(ch);

            // ---- 3b) Pilares de salas y salones: se colocan DESPUES de
            // conectar (ni los pasillos de union ni los puentes pueden
            // borrarlos: antes las salas quedaban a menudo sin pilar) y antes
            // del retoque de paredes finas, que solo toca muros ----
            for (const room of ch.rooms) this.placeRoomPillars(ch, room);

            // ---- 3b) Paredes finas: los macizos se reducen a 1 celda ----
            this.thinWalls(ch);

            // ---- 3c) Pilares NUNCA pegados a una pared: se retira cualquier
            // pilar adyacente (o diagonal) a una pared, p.ej. si un puente de
            // conectividad lo dejo junto a un muro ----
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    if (g[x][z] !== 3) continue;
                    let near = false;
                    for (let dx = -1; dx <= 1 && !near; dx++) {
                        for (let dz = -1; dz <= 1 && !near; dz++) {
                            if (dx === 0 && dz === 0) continue;
                            if (g[x + dx][z + dz] === 1) near = true;
                        }
                    }
                    if (near) g[x][z] = 0;
                }
            }

            // ---- 4) Celdas transitables (coordenadas de mundo) ----
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    if (g[x][z] === 0 || g[x][z] === 2) {
                        ch.openCells.push({ x: ch.cx * N + x, z: ch.cz * N + z });
                    }
                }
            }
        }

        rollRoomSize(r) {
            const roll = r();
            if (roll < 0.35) return 3 + Math.floor(r() * 2);   // 3-4 pequena
            if (roll < 0.8) return 4 + Math.floor(r() * 2);    // 4-5 mediana
            return 5 + Math.floor(r() * 2);                    // 5-6 grande (menos campo abierto)
        }

        rollWidth(r) {
            const v = r();
            return v < 0.30 ? 1 : (v < 0.9 ? 2 : 3);   // pasillos de 3 celdas ahora raros
        }

        // Pincel cuadrado de ancho variable; nunca pisa habitaciones (2) ni pilares (3)
        openCell(ch, x, z, width) {
            const N = CHUNK_SIZE;
            const half = Math.floor((width - 1) / 2);
            for (let dx = -half; dx <= width - 1 - half; dx++) {
                for (let dz = -half; dz <= width - 1 - half; dz++) {
                    const px = x + dx;
                    const pz = z + dz;
                    if (px < 1 || px >= N - 1 || pz < 1 || pz >= N - 1) continue;
                    const t = ch.grid[px][pz];
                    if (t === 1 || t === 3) ch.grid[px][pz] = 0;
                }
            }
        }

        // Pasillo en L entre dos celdas locales, con ancho por tramo
        carvePath(ch, x0, z0, x1, z1, width) {
            x1 = Math.max(1, Math.min(CHUNK_SIZE - 2, x1));
            z1 = Math.max(1, Math.min(CHUNK_SIZE - 2, z1));
            let cx = x0, cz = z0;
            this.openCell(ch, cx, cz, width);
            const horizFirst = ch.rng() < 0.5;
            if (horizFirst) {
                while (cx !== x1) { cx += Math.sign(x1 - cx); this.openCell(ch, cx, cz, width); }
                while (cz !== z1) { cz += Math.sign(z1 - cz); this.openCell(ch, cx, cz, width); }
            } else {
                while (cz !== z1) { cz += Math.sign(z1 - cz); this.openCell(ch, cx, cz, width); }
                while (cx !== x1) { cx += Math.sign(x1 - cx); this.openCell(ch, cx, cz, width); }
            }
        }

        // Callejon sin salida GARANTIZADO: antes de tallar nada se comprueba que
        // el tramo entero atraviesa pared y que el fondo queda sellado (pared por
        // delante y a ambos lados de la punta), asi el callejon muere de verdad y
        // obliga a dar la vuelta. El mundo sigue siendo infinito: cada callejon
        // es local y solo conecta con la red por su boca. A veces el fondo abre
        // una salita muerta (3x3) sin otra salida.
        addStub(ch) {
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const r = ch.rng;
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

            // Candidatos: TODAS las celdas abiertas con pared justo al lado
            const starts = [];
            for (let x = 2; x <= N - 3; x++) {
                for (let z = 2; z <= N - 3; z++) {
                    if (g[x][z] !== 0 && g[x][z] !== 2) continue;
                    for (const d of dirs) {
                        const sx = x + d[0], sz = z + d[1];
                        if (g[sx][sz] === 1 || g[sx][sz] === 3) starts.push({ x, z, d });
                    }
                }
            }
            for (let i = starts.length - 1; i > 0; i--) {
                const j = Math.floor(r() * (i + 1));
                [starts[i], starts[j]] = [starts[j], starts[i]];
            }

            for (const s of starts) {
                const d = s.d;
                const len = 1 + Math.floor(r() * 2);   // 1-2 celdas (callejon corto)
                const perp = d[0] === 0 ? [1, 0] : [0, 1];

                // Comprobar el tramo completo antes de tallar nada
                let ok = true;
                const cells = [];
                for (let t = 1; t <= len && ok; t++) {
                    const nx = s.x + d[0] * t;
                    const nz = s.z + d[1] * t;
                    if (nx < 2 || nx > N - 3 || nz < 2 || nz > N - 3) { ok = false; break; }
                    if (g[nx][nz] !== 1 && g[nx][nz] !== 3) { ok = false; break; }
                    cells.push([nx, nz]);
                }
                if (!ok) continue;

                // El fondo debe quedar sellado: pared delante y a ambos lados de la punta
                const tx = cells[cells.length - 1][0];
                const tz = cells[cells.length - 1][1];
                const capX = tx + d[0], capZ = tz + d[1];
                if (capX < 2 || capX > N - 3 || capZ < 2 || capZ > N - 3) continue;
                if (g[capX][capZ] !== 1 && g[capX][capZ] !== 3) continue;
                for (const sgn of [-1, 1]) {
                    const lx = tx + perp[0] * sgn;
                    const lz = tz + perp[1] * sgn;
                    if (g[lx][lz] !== 1 && g[lx][lz] !== 3) { ok = false; break; }
                }
                if (!ok) continue;

                // Tallar el callejon (ancho 1)
                for (const [cx2, cz2] of cells) this.openCell(ch, cx2, cz2, 1);

                // Fondo del callejon: casi siempre una HABITACION muerta
                // (3x3 o 4x4) rodeada de pared, en vez de un pasillo largo
                if (r() < 0.75) {
                    const rw = r() < 0.5 ? 3 : 4;
                    const rh = r() < 0.5 ? 3 : 4;
                    const hx = tx + d[0];
                    const hz = tz + d[1];
                    let roomOk = true;
                    for (let dx = -1; dx <= rw && roomOk; dx++) {
                        for (let dz = -1; dz <= rh && roomOk; dz++) {
                            if (dx >= 0 && dx < rw && dz >= 0 && dz < rh) continue; // interior
                            const rx = hx + dx, rz = hz + dz;
                            if (rx < 1 || rx >= N - 1 || rz < 1 || rz >= N - 1) { roomOk = false; break; }
                            if (rx === tx && rz === tz) continue; // la boca del callejon
                            const t = g[rx][rz];
                            if (t !== 1 && t !== 3) roomOk = false;
                        }
                    }
                    if (roomOk) {
                        for (let dx = 0; dx < rw; dx++) {
                            for (let dz = 0; dz < rh; dz++) g[hx + dx][hz + dz] = 2;
                        }
                        ch.rooms.push({ x: hx, z: hz, w: rw, h: rh });
                    }
                }
                return;
            }
        }

        carveRooms(ch) {
            const N = CHUNK_SIZE;
            const r = ch.rng;
            const nRooms = 1 + (r() < 0.55 ? 1 : 0) + (r() < 0.12 ? 1 : 0);
            const rects = [];
            for (let i = 0; i < nRooms; i++) {
                const w = this.rollRoomSize(r);
                const h = this.rollRoomSize(r);
                let ok = false, rx = 0, rz = 0;
                for (let a = 0; a < 12 && !ok; a++) {
                    rx = 1 + Math.floor(r() * (N - 2 - w));
                    rz = 1 + Math.floor(r() * (N - 2 - h));
                    ok = rects.every(e =>
                        rx + w + 2 <= e.x || e.x + e.w + 2 <= rx ||
                        rz + h + 2 <= e.z || e.z + e.h + 2 <= rz);
                }
                if (!ok) continue;
                for (let x = rx; x < rx + w; x++) {
                    for (let z = rz; z < rz + h; z++) ch.grid[x][z] = 2;
                }
                rects.push({ x: rx, z: rz, w, h });
                ch.rooms.push({ x: rx, z: rz, w, h });
            }

            // Conecta salas entre si y con las puertas
            const targets = ch.doorCells.slice().map(c => ({ x: c.x, z: c.z }));
            for (const rect of rects) targets.push({ x: rect.x + Math.floor(rect.w / 2), z: rect.z + Math.floor(rect.h / 2) });
            this.connectTargets(ch, targets);
            // Callejones sin salida: obligan a dar la vuelta
            this.addStub(ch);
            if (r() < 0.7) this.addStub(ch);
        }

        // Pilares ASIMETRICOS (bloquean la vista de la entidad): finos, en
        // posiciones aleatorias por TODA la sala (antes solo la franja central,
        // que dejaba las salas con aire simetrico). Cantidad aleatoria
        // proporcional al tamano; toda sala amplia (4+ celdas) garantiza al
        // menos uno. El pase 3c retira los que quedan pegados a una pared.
        placeRoomPillars(ch, room) {
            const { x: rx, z: rz, w, h } = room;
            if (w < 4 || h < 4) return;
            const r = ch.rng;
            const cands = [];
            for (let px = rx + 1; px <= rx + w - 2; px++) {
                for (let pz = rz + 1; pz <= rz + h - 2; pz++) {
                    cands.push([px, pz]);
                }
            }
            for (let i = cands.length - 1; i > 0; i--) {
                const j = Math.floor(r() * (i + 1));
                [cands[i], cands[j]] = [cands[j], cands[i]];
            }
            const area = w * h;
            const maxPillars = area >= 30 ? 4 : (area >= 16 ? 3 : 2);
            const n = Math.min(cands.length, 1 + Math.floor(r() * maxPillars));
            for (let i = 0; i < n; i++) {
                ch.grid[cands[i][0]][cands[i][1]] = 3;
            }
        }

        carveHall(ch) {
            const N = CHUNK_SIZE;
            const r = ch.rng;
            const w = 5 + Math.floor(r() * 3);   // salones 5-7 (antes 7-10): menos campo abierto
            const h = 5 + Math.floor(r() * 3);
            const hx = 1 + Math.floor(r() * (N - 2 - w));
            const hz = 1 + Math.floor(r() * (N - 2 - h));
            for (let x = hx; x < hx + w; x++) {
                for (let z = hz; z < hz + h; z++) ch.grid[x][z] = 2;
            }
            ch.rooms.push({ x: hx, z: hz, w, h });
            // A veces una salita lateral pequeña, separada del salon
            if (r() < 0.5) {
                const sw = 3 + Math.floor(r() * 2);
                const sh = 3 + Math.floor(r() * 2);
                let ok = false, sx = 0, sz = 0;
                for (let a = 0; a < 10 && !ok; a++) {
                    sx = 1 + Math.floor(r() * (N - 2 - sw));
                    sz = 1 + Math.floor(r() * (N - 2 - sh));
                    ok = sx + sw + 2 <= hx || hx + w + 2 <= sx || sz + sh + 2 <= hz || hz + h + 2 <= sz;
                }
                if (ok) {
                    for (let x = sx; x < sx + sw; x++) {
                        for (let z = sz; z < sz + sh; z++) ch.grid[x][z] = 2;
                    }
                    const sr = { x: sx, z: sz, w: sw, h: sh };
                    ch.rooms.push(sr);
                }
            }
            // El salon conecta con todas las puertas (pasillos anchos de acceso)
            const center = { x: hx + Math.floor(w / 2), z: hz + Math.floor(h / 2) };
            for (const d of ch.doorCells) this.carvePath(ch, d.x, d.z, center.x, center.z, 2 + Math.floor(r() * 2));
            const targets = ch.doorCells.slice().map(c => ({ x: c.x, z: c.z }));
            targets.push(center);
            this.connectTargets(ch, targets);
            this.addStub(ch);
            if (r() < 0.6) this.addStub(ch);
        }

        carveCorridors(ch) {
            const N = CHUNK_SIZE;
            const r = ch.rng;
            const nNodes = 3 + Math.floor(r() * 2);
            const nodes = [];
            for (let i = 0; i < nNodes; i++) {
                let nx = 0, nz = 0, ok = false;
                for (let a = 0; a < 15 && !ok; a++) {
                    nx = 3 + Math.floor(r() * (N - 6));
                    nz = 3 + Math.floor(r() * (N - 6));
                    ok = nodes.every(n => Math.max(Math.abs(n.x - nx), Math.abs(n.z - nz)) >= 4);
                }
                nodes.push({ x: nx, z: nz });
            }
            // Red de pasillos entre nodos y hacia las puertas, con anchos mixtos
            const targets = ch.doorCells.slice().map(c => ({ x: c.x, z: c.z })).concat(nodes);
            this.connectTargets(ch, targets);
            // Callejones sin salida (objetos escondidos y giros en falso)
            const nStubs = 3 + Math.floor(r() * 3);
            for (let i = 0; i < nStubs; i++) this.addStub(ch);
        }

        carveVoid(ch) {
            const N = CHUNK_SIZE;
            const r = ch.rng;
            // Pasadizo serpenteante casi solitario: el chunk es casi todo pared
            let x = ch.doorCells.length ? ch.doorCells[0].x : 8;
            let z = ch.doorCells.length ? ch.doorCells[0].z : 8;
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            let dir = Math.floor(r() * 4);
            const steps = 20 + Math.floor(r() * 12);
            for (let i = 0; i < steps; i++) {
                this.openCell(ch, x, z, r() < 0.3 ? 2 : 1);
                if (r() < 0.35) dir = Math.floor(r() * 4);
                x += dirs[dir][0];
                z += dirs[dir][1];
                if (x < 2 || x > N - 3 || z < 2 || z > N - 3) {
                    x = Math.max(2, Math.min(N - 3, x));
                    z = Math.max(2, Math.min(N - 3, z));
                    dir = Math.floor(r() * 4);
                }
            }
            // A veces una celda-habitacion escondida en el camino
            if (r() < 0.6) {
                const w = 2 + Math.floor(r() * 2);
                const h = 2 + Math.floor(r() * 2);
                for (let dx = 0; dx < w; dx++) {
                    for (let dz = 0; dz < h; dz++) {
                        const px = x + dx - 1, pz = z + dz - 1;
                        if (px > 1 && px < N - 2 && pz > 1 && pz < N - 2) ch.grid[px][pz] = 2;
                    }
                }
                ch.rooms.push({ x: x - 1, z: z - 1, w, h });
            }

            // Callejon sin salida: el pasadizo tambien engana a veces
            if (r() < 0.8) this.addStub(ch);

            // Conecta el pasadizo con las puertas del chunk
            const targets = ch.doorCells.slice().map(c => ({ x: c.x, z: c.z }));
            targets.push({ x, z });
            this.connectTargets(ch, targets);
        }

        // Une una lista de puntos con pasillos de ancho aleatorio
        connectTargets(ch, targets) {
            const r = ch.rng;
            for (let i = 0; i < targets.length - 1; i++) {
                this.carvePath(ch, targets[i].x, targets[i].z, targets[i + 1].x, targets[i + 1].z, this.rollWidth(r));
            }
        }

        // Flood-fill + puentes: TODAS las zonas abiertas quedan conectadas entre si
        connectChunk(ch) {
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const isOpen = (x, z) => x >= 0 && x < N && z >= 0 && z < N && (g[x][z] === 0 || g[x][z] === 2);
            const compId = new Int16Array(N * N).fill(-1);
            const comps = [];
            let nextComp = 0;
            for (let x = 0; x < N; x++) {
                for (let z = 0; z < N; z++) {
                    if (!isOpen(x, z) || compId[x * N + z] !== -1) continue;
                    const cells = [];
                    const q = [[x, z]];
                    compId[x * N + z] = nextComp;
                    while (q.length) {
                        const [px, pz] = q.pop();
                        cells.push([px, pz]);
                        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                            const nx = px + dx, nz = pz + dz;
                            if (isOpen(nx, nz) && compId[nx * N + nz] === -1) {
                                compId[nx * N + nz] = nextComp;
                                q.push([nx, nz]);
                            }
                        }
                    }
                    comps.push(cells);
                    nextComp++;
                }
            }
            if (comps.length <= 1) return;

            // Para cada componente extra, BFS a traves de paredes hasta la principal
            // y excava el camino mas corto.
            const mainId = 0;
            for (let ci = 1; ci < comps.length; ci++) {
                const parent = new Int16Array(N * N).fill(-2);
                const q = [];
                for (const [x, z] of comps[ci]) { parent[x * N + z] = -1; q.push([x, z]); }
                let target = null;
                for (let qi = 0; qi < q.length && target === null; qi++) {
                    const [px, pz] = q[qi];
                    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nx = px + dx, nz = pz + dz;
                        if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                        const idx = nx * N + nz;
                        if (parent[idx] !== -2) continue;
                        const t = g[nx][nz];
                        if (t === 1 || t === 3) {
                            parent[idx] = px * N + pz;
                            q.push([nx, nz]);
                        } else if ((t === 0 || t === 2) && compId[idx] === mainId) {
                            parent[idx] = px * N + pz;
                            target = idx;
                            break;
                        }
                    }
                }
                if (target === null) continue; // no deberia ocurrir en un chunk finito
                let cur = target;
                while (cur !== -1) {
                    // el indice es x*N+z: la x es el cociente y la z el resto
                    const cx2 = Math.floor(cur / N), cz2 = cur % N;
                    if (g[cx2][cz2] === 1 || g[cx2][cz2] === 3) g[cx2][cz2] = 0;
                    cur = parent[cur];
                }
            }
        }

        // Reduce los macizos de pared a UNA capa visible: cuando dos suelos
        // quedan separados por 2 celdas de pared, se conserva la capa de MENOR
        // indice como lamina y la otra se abre (empate deterministico). El
        // interior de los macizos mas gruesos (3+ celdas) se queda como bloques
        // macizos invisibles: buildChunkMeshes apoya las laminas contra ellos
        // y nunca quedan huecos internos accesibles.
        thinWalls(ch) {
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const isOpen = (x, z) => x >= 0 && x < N && z >= 0 && z < N && (g[x][z] === 0 || g[x][z] === 2);
            const isWall = (x, z) => x >= 0 && x < N && z >= 0 && z < N && g[x][z] === 1;
            // Capa con suelo solo a un lado, sin suelo en la otra orientacion
            const sameX = (ex, ez) => (isOpen(ex - 1, ez) || isOpen(ex + 1, ez)) && !isOpen(ex, ez - 1) && !isOpen(ex, ez + 1);
            const sameZ = (ex, ez) => (isOpen(ex, ez - 1) || isOpen(ex, ez + 1)) && !isOpen(ex - 1, ez) && !isOpen(ex + 1, ez);
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    if (g[x][z] !== 1) continue;
                    const ox1 = isOpen(x - 1, z), ox2 = isOpen(x + 1, z);
                    const oz1 = isOpen(x, z - 1), oz2 = isOpen(x, z + 1);
                    if (ox1 && !ox2 && !oz1 && !oz2 && x + 1 < N - 1 && isWall(x + 1, z) && sameX(x + 1, z)) g[x + 1][z] = 0;
                    else if (oz1 && !oz2 && !ox1 && !ox2 && z + 1 < N - 1 && isWall(x, z + 1) && sameZ(x, z + 1)) g[x][z + 1] = 0;
                }
            }
            // Pase 3: paredes/postes SUELTOS sin ninguna funcion (suelo por los
            // 4 lados) se eliminan: quedarian como bloques gordos innecesarios
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    if (g[x][z] === 1 && isOpen(x - 1, z) && isOpen(x + 1, z) && isOpen(x, z - 1) && isOpen(x, z + 1)) {
                        g[x][z] = 0;
                    }
                }
            }
        }

        // ================================================================
        //  CONSTRUCCION 3D DEL CHUNK (suelo, techo, muros, pilares, luces)
        // ================================================================
        buildChunkMeshes(ch) {
            const N = CHUNK_SIZE;
            const C = CELL_SIZE;
            const ox = ch.cx * N * C;
            const oz = ch.cz * N * C;
            const g = ch.grid;

            // Suelo y techo se solapan 0,12 m con los chunks vecinos: las losas
            // contiguas (misma altura, misma textura y misma fase de azulejo)
            // quedan selladas sin la grieta de un pixel que delataba la rejilla
            // de chunks en la moqueta y el techo.
            const OVERLAP = 0.12;
            const floorGeo = new THREE.PlaneGeometry(N * C + OVERLAP * 2, N * C + OVERLAP * 2);
            const fuv = floorGeo.attributes.uv;
            // Cada repeticion de la moqueta (512 px) cubre exactamente una celda;
            // el solape mantiene la fase: mismo patron a ambos lados del borde
            for (let i = 0; i < fuv.count; i++) {
                fuv.setXY(i, fuv.getX(i) * (N + (OVERLAP * 2) / C), fuv.getY(i) * (N + (OVERLAP * 2) / C));
            }
            fuv.needsUpdate = true;
            const floor = new THREE.Mesh(floorGeo, Materials.floor);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(ox + (N * C) / 2, 0, oz + (N * C) / 2);
            this.scene.add(floor);
            ch.meshes.push(floor);

            const ceilGeo = new THREE.PlaneGeometry(N * C + OVERLAP * 2, N * C + OVERLAP * 2);
            const cuv = ceilGeo.attributes.uv;
            for (let i = 0; i < cuv.count; i++) {
                cuv.setXY(i, cuv.getX(i) * (N / 2 + OVERLAP / C), cuv.getY(i) * (N / 2 + OVERLAP / C));
            }
            cuv.needsUpdate = true;
            const ceiling = new THREE.Mesh(ceilGeo, Materials.ceiling);
            ceiling.rotation.x = Math.PI / 2;
            ceiling.position.set(ox + (N * C) / 2, WALL_HEIGHT, oz + (N * C) / 2);
            this.scene.add(ceiling);
            ch.meshes.push(ceiling);

            const wallT = [], cylT = [], offL = [], flickL = [], litL = [];
            const dummy = new THREE.Object3D();

            // ---- Paredes finas (0,4-1,2 m) en lugar de celdas macizas ----
            // Cada tramo recto de pared es una lamina con un grosor T compartido;
            // la junta entre chunks es una lamina fina compartida con el vecino
            // (misma semilla -> mismo grosor a cada lado) y las esquinas son
            // uniones rectangulares enrasadas con las laminas (nunca pilares).
            // El suelo sobrante alrededor de cada lamina queda transitable:
            // los pasillos se ensanchan solos.
            const T_MIN = 0.4, T_MAX = 1.2;
            // Postes de esquinas y FINALES de pared: adoptan el grosor de la
            // pared que conectan (ver mas abajo); 0,525 es solo el respaldo.
            // Antes eran bloques fijos de 2,8 x 2,8 m, luego cuadrados de
            // 1,05 m que sobresalian junto a paredes de 0,4-0,6 m.
            const R_POST = 0.525;
            const key = (x, z) => x + ',' + z;
            const open = (x, z) => x >= 0 && x < N && z >= 0 && z < N && (g[x][z] === 0 || g[x][z] === 2);
            const wallKind = new Map();   // 'border' | 'post' | 'x' | 'z'
            const wallTMap = new Map();
            for (let x = 0; x < N; x++) {
                for (let z = 0; z < N; z++) {
                    if (g[x][z] !== 1) continue;
                    const k = key(x, z);
                    if (x === 0 || x === N - 1 || z === 0 || z === N - 1) { wallKind.set(k, 'border'); continue; }
                    const oX = open(x - 1, z) || open(x + 1, z);
                    const oZ = open(x, z - 1) || open(x, z + 1);
                    if (oX && oZ) wallKind.set(k, 'post');
                    else if (oX) wallKind.set(k, 'x');
                    else if (oZ) wallKind.set(k, 'z');
                    else wallKind.set(k, 'interior');
                }
            }
            // Grosor por tramo recto: celdas contiguas de la misma orientacion comparten T
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    const k = key(x, z);
                    const kind = wallKind.get(k);
                    if (!kind || kind === 'border' || kind === 'post' || wallTMap.has(k)) continue;
                    const T = T_MIN + ch.rng() * (T_MAX - T_MIN);
                    const q = [[x, z]];
                    wallTMap.set(k, T);
                    while (q.length) {
                        const [cx, cz] = q.pop();
                        for (const [dx, dz] of kind === 'x' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]) {
                            const nk = key(cx + dx, cz + dz);
                            if (wallKind.get(nk) === kind && !wallTMap.has(nk)) {
                                wallTMap.set(nk, T);
                                q.push([cx + dx, cz + dz]);
                            }
                        }
                    }
                }
            }
            // Tamanio de esquinas y FINALES de pared: el poste adopta el grosor
            // de la pared/paredes que conecta (la mitad del grosor de la mas
            // gruesa). Asi el final de una pared queda ENRASADO, del mismo
            // tamano que el resto (antes era un cuadrado fijo de 1,05 m que se
            // veia mas grande junto a paredes de 0,4-0,6 m).
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    const k = key(x, z);
                    if (wallKind.get(k) === 'post' && !wallTMap.has(k)) {
                        let m = 0;
                        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                            const nk = wallKind.get(key(x + dx, z + dz));
                            if (nk === 'x' || nk === 'z') m = Math.max(m, wallTMap.get(key(x + dx, z + dz)) || 0);
                        }
                        wallTMap.set(k, m > 0 ? m / 2 : R_POST);
                    }
                }
            }
            // Grosor de la junta entre chunks (misma semilla que edgeDoors:
            // el vecino genera exactamente la misma lamina en su lado)
            const edgeT = (side) => {
                const seed = side === 'east' ? hash2(ch.cx * 2 + 1, ch.cz)
                    : side === 'west' ? hash2((ch.cx - 1) * 2 + 1, ch.cz)
                    : side === 'south' ? hash2(ch.cx, ch.cz * 2 + 1)
                    : hash2(ch.cx, (ch.cz - 1) * 2 + 1);
                return 0.4 + 0.2 * mulberry32(seed)();
            };
            // Cara (en metros) de la caja de una celda vecina hacia la celda dada
            const faceX = (nx, nz, side) => {
                const nk = wallKind.get(key(nx, nz));
                const nxc = ox + (nx + 0.5) * C;
                // Los postes se tocan con un pequeno solape (5 cm) para que la
                // union pared-poste quede sellada de verdad
                if (nk === 'post') { const r = wallTMap.get(key(nx, nz)) || 0.4; return side === 'west' ? nxc - r + 0.05 : nxc + r - 0.05; }
                if (nk === 'border') {
                    if (nx === 0) return side === 'west' ? nxc - C / 2 : nxc - C / 2 + edgeT('west');
                    if (nx === N - 1) return side === 'west' ? nxc + C / 2 - edgeT('east') : nxc + C / 2;
                }
                return side === 'west' ? nxc - C / 2 : nxc + C / 2;
            };
            const faceZ = (nx, nz, side) => {
                const nk = wallKind.get(key(nx, nz));
                const nzc = oz + (nz + 0.5) * C;
                // Los postes se tocan con un pequeno solape (5 cm) para que la
                // union pared-poste quede sellada de verdad
                if (nk === 'post') { const r = wallTMap.get(key(nx, nz)) || 0.4; return side === 'north' ? nzc - r + 0.05 : nzc + r - 0.05; }
                if (nk === 'border') {
                    if (nz === 0) return side === 'north' ? nzc - C / 2 : nzc - C / 2 + edgeT('north');
                    if (nz === N - 1) return side === 'north' ? nzc + C / 2 - edgeT('south') : nzc + C / 2;
                }
                return side === 'north' ? nzc - C / 2 : nzc + C / 2;
            };
            ch.wallFaceMap = new Map();

            // ---- Paredes curvas ocasionales: de vez en cuando un tramo recto
            // se convierte en UNA sola pared lisa que se arquea hacia un lado
            // (una malla continua, NO dividida en celdas, con un arco dinamico
            // de lado y amplitud aleatorios por chunk) ----
            const curved = this.pickCurvedRuns(ch, wallKind, key);
            const curvedCells = new Set();
            for (const run of curved) {
                const built = this.buildCurvedWall(ch, run, wallTMap, key, wallKind);
                for (const c of built.cells) curvedCells.add(key(c[0], c[1]));
                ch.wallBoxes.push(...built.boxes);
            }

            for (let x = 0; x < N; x++) {
                for (let z = 0; z < N; z++) {
                    const posX = ox + (x + 0.5) * C;
                    const posZ = oz + (z + 0.5) * C;
                    const type = g[x][z];
                    let box = null;
                    const extraBoxes = [];

                    if (type === 1) {
                        const k = key(x, z);
                        if (curvedCells.has(k)) continue;   // la pared curva ya se construyo
                        const kind = wallKind.get(k);
                        const T = wallTMap.get(k) || 0.8;
                        if (kind === 'border') {
                            // Junta entre chunks: lamina fina COMPARTIDA con el
                            // vecino (misma semilla -> mismo grosor a cada lado)
                            const tW = edgeT('west'), tE = edgeT('east');
                            const tN = edgeT('north'), tS = edgeT('south');
                            let x0 = posX - C / 2, x1 = posX + C / 2;
                            if (x === 0) x1 = x0 + tW;
                            else if (x === N - 1) x0 = x1 - tE;
                            let z0 = posZ - C / 2, z1 = posZ + C / 2;
                            if (z === 0) z1 = z0 + tN;
                            else if (z === N - 1) z0 = z1 - tS;
                            box = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
                            // Esquinas del chunk: la celda de la esquina solo
                            // cubria un trocito del borde y la junta quedaba
                            // abierta ~2,2 m con ese trozo flotando como un
                            // pilar. Se anaden las dos franjas completas de la
                            // celda para sellar el borde entero.
                            if ((x === 0 || x === N - 1) && (z === 0 || z === N - 1)) {
                                const fx0 = posX - C / 2, fx1 = posX + C / 2;
                                const fz0 = posZ - C / 2, fz1 = posZ + C / 2;
                                // franja a lo largo del borde norte/sur
                                extraBoxes.push({
                                    minX: fx0, maxX: fx1,
                                    minZ: z === 0 ? fz0 : fz1 - tS,
                                    maxZ: z === 0 ? fz0 + tN : fz1
                                });
                                // franja a lo largo del borde este/oeste
                                extraBoxes.push({
                                    minX: x === 0 ? fx0 : fx1 - tE,
                                    maxX: x === 0 ? fx0 + tW : fx1,
                                    minZ: fz0, maxZ: fz1
                                });
                            }
                        } else if (kind === 'interior') {
                            // Nucleo macizo del interior: bloque solido invisible
                            // (nunca se ve ni se alcanza)
                            box = { minX: posX - C / 2, maxX: posX + C / 2, minZ: posZ - C / 2, maxZ: posZ + C / 2 };
                        } else if (kind === 'post') {
                            // Esquina/final de pared = COLUMNA del mismo grosor
                            // que la pared que la toca (wallTMap guarda su medio
                            // grosor), centrada en la celda y enrasada con las
                            // laminas contiguas (que se alargan hasta tocarla).
                            // Antes era un bloque de 2,8 x 2,8 m y luego un
                            // cuadrado fijo de 1,05 m que sobresalia junto a
                            // paredes finas. Un poste sin ningun tramo de pared
                            // conectado es flotante y se elimina.
                            const runNeighbor = (dx, dz) => {
                                const nk = wallKind.get(key(x + dx, z + dz));
                                return nk === 'x' || nk === 'z';
                            };
                            if (runNeighbor(1, 0) || runNeighbor(-1, 0) || runNeighbor(0, 1) || runNeighbor(0, -1)) {
                                const rp = wallTMap.get(k) || R_POST;   // medio grosor del poste
                                const jb = { minX: posX - rp, maxX: posX + rp, minZ: posZ - rp, maxZ: posZ + rp };
                                dummy.position.set(posX, WALL_HEIGHT / 2, posZ);
                                dummy.scale.set(rp * 2, WALL_HEIGHT, rp * 2);
                                dummy.updateMatrix();
                                wallT.push(dummy.matrix.clone());
                                ch.wallBoxes.push(jb);
                                if (!ch.wallFaceMap.has(k)) ch.wallFaceMap.set(k, jb);
                            }
                        } else if (kind === 'x') {
                            const wOpen = open(x - 1, z);
                            const eOpen = open(x + 1, z);
                            let x0, x1;
                            if (wOpen && eOpen) { x0 = posX - T / 2; x1 = posX + T / 2; }
                            else if (wOpen) { x1 = faceX(x + 1, z, 'west'); x0 = x1 - T; }
                            else if (eOpen) { x0 = faceX(x - 1, z, 'east'); x1 = x0 + T; }
                            else { x0 = posX - C / 2; x1 = posX + C / 2; }
                            box = { minX: x0, maxX: x1, minZ: posZ - C / 2, maxZ: posZ + C / 2 };
                        } else { // 'z'
                            const nOpen = open(x, z - 1);
                            const sOpen = open(x, z + 1);
                            let z0, z1;
                            if (nOpen && sOpen) { z0 = posZ - T / 2; z1 = posZ + T / 2; }
                            else if (nOpen) { z1 = faceZ(x, z + 1, 'north'); z0 = z1 - T; }
                            else if (sOpen) { z0 = faceZ(x, z - 1, 'south'); z1 = z0 + T; }
                            else { z0 = posZ - C / 2; z1 = posZ + C / 2; }
                            box = { minX: posX - C / 2, maxX: posX + C / 2, minZ: z0, maxZ: z1 };
                        }
                        if (kind === 'x' || kind === 'z') {
                            // La lamina se extiende hacia el poste/borde contiguo
                            // a lo largo del tramo: las esquinas quedan SOLIDAS
                            // (antes quedaba un hueco de ~1 m entre la pared y
                            // el poste, que parecia una esquina sin completar
                            // con un pilar suelto al lado)
                            const pS = wallKind.get(key(x, z + 1));
                            const pN = wallKind.get(key(x, z - 1));
                            const pE = wallKind.get(key(x + 1, z));
                            const pW = wallKind.get(key(x - 1, z));
                            // La lamina se alarga hasta tocar la cara del poste
                            // vecino (1,45 m - su medio grosor) o la junta de
                            // chunk. Si la celda del borde es una PUERTA (hueco
                            // abierto), NO se extiende: antes el alargue entraba
                            // hasta 2,45 m en el vano y delataba el borde del
                            // chunk con un muro fantasma.
                            const extTo = (nk, half, end, pos, borderCellWall) => {
                                if (nk === 'post') return Math.max(0.05, 1.45 - half);
                                // Junta de chunk: la lamina se alarga solo hasta
                                // tocar la lamina del borde (interior a 0,4-0,6 m
                                // del filo); si la cara ya llego (faceZ/borde) no
                                // se anade nada y no se sale del chunk.
                                if (nk === 'border') return borderCellWall ? Math.max(0, C * 1.5 - 0.55 - Math.abs(end - pos)) : 0;
                                return 0;
                            };
                            if (kind === 'x') {
                                box.maxZ += extTo(pS, wallTMap.get(key(x, z + 1)) || 0.4, box.maxZ, posZ, g[x][N - 1] === 1);
                                box.minZ -= extTo(pN, wallTMap.get(key(x, z - 1)) || 0.4, box.minZ, posZ, g[x][0] === 1);
                            } else {
                                box.maxX += extTo(pE, wallTMap.get(key(x + 1, z)) || 0.4, box.maxX, posX, g[N - 1][z] === 1);
                                box.minX -= extTo(pW, wallTMap.get(key(x - 1, z)) || 0.4, box.minX, posX, g[0][z] === 1);
                            }
                            // Extension LATERAL: si la lamina queda anclada en el
                            // borde opuesto de su celda y el poste esta centrado,
                            // aun hay hueco en el eje perpendicular. Se alarga la
                            // lamina hasta tocar la caja del poste.
                            if (kind === 'x') {
                                const TpS = pS === 'post' ? (wallTMap.get(key(x, z + 1)) || 0.4) : 0;
                                const TpN = pN === 'post' ? (wallTMap.get(key(x, z - 1)) || 0.4) : 0;
                                if (TpS && box.maxX < posX - TpS) box.maxX = posX - TpS + 0.05;
                                if (TpS && box.minX > posX + TpS) box.minX = posX + TpS - 0.05;
                                if (TpN && box.maxX < posX - TpN) box.maxX = posX - TpN + 0.05;
                                if (TpN && box.minX > posX + TpN) box.minX = posX + TpN - 0.05;
                            } else {
                                const TpE = pE === 'post' ? (wallTMap.get(key(x + 1, z)) || 0.4) : 0;
                                const TpW = pW === 'post' ? (wallTMap.get(key(x - 1, z)) || 0.4) : 0;
                                if (TpE && box.maxZ < posZ - TpE) box.maxZ = posZ - TpE + 0.05;
                                if (TpE && box.minZ > posZ + TpE) box.minZ = posZ + TpE - 0.05;
                                if (TpW && box.maxZ < posZ - TpW) box.maxZ = posZ - TpW + 0.05;
                                if (TpW && box.minZ > posZ + TpW) box.minZ = posZ + TpW - 0.05;
                            }
                        }
                        if (box) {
                            dummy.position.set((box.minX + box.maxX) / 2, WALL_HEIGHT / 2, (box.minZ + box.maxZ) / 2);
                            dummy.scale.set(box.maxX - box.minX, WALL_HEIGHT, box.maxZ - box.minZ);
                            dummy.updateMatrix();
                            wallT.push(dummy.matrix.clone());
                        }
                        if (box) {
                            ch.wallBoxes.push(box);
                            ch.wallFaceMap.set(k, box);
                        }
                        // Mallas y cajas extra (franjas de las esquinas del chunk)
                        for (const eb of extraBoxes) {
                            dummy.position.set((eb.minX + eb.maxX) / 2, WALL_HEIGHT / 2, (eb.minZ + eb.maxZ) / 2);
                            dummy.scale.set(eb.maxX - eb.minX, WALL_HEIGHT, eb.maxZ - eb.minZ);
                            dummy.updateMatrix();
                            wallT.push(dummy.matrix.clone());
                            ch.wallBoxes.push(eb);
                        }
                    } else if (type === 3) {
                        // Pilar fino (radio 0,35-0,45 m): mezcla de cilindricos
                        // y cuadrados
                        const r = 0.35 + ch.rng() * 0.1;
                        const round = ch.rng() < 0.5;
                        dummy.position.set(posX, WALL_HEIGHT / 2, posZ);
                        dummy.scale.set(round ? r : r * 2, WALL_HEIGHT, round ? r : r * 2);
                        dummy.updateMatrix();
                        (round ? cylT : wallT).push(dummy.matrix.clone());
                        ch.wallBoxes.push({ minX: posX - r, maxX: posX + r, minZ: posZ - r, maxZ: posZ + r });
                    }

                    if (type === 0 || type === 2) {
                        dummy.position.set(posX, WALL_HEIGHT - 0.02, posZ);
                        dummy.scale.set(1.6, 0.04, 0.6);
                        dummy.updateMatrix();
                        // Zona de luz del chunk (campo suave, como el tipo de
                        // chunk): hay sitios con TODOS los focos fundidos donde
                        // solo alumbra la linterna, zonas tenues, lo normal y
                        // raramente zonas casi todo encendido. El campo suave
                        // hace que la oscuridad sea por zonas contiguas.
                        // La luz de una zona vecina encendida no debe colarse a
                        // traves de las paredes finas: los focos pegados al
                        // borde de una zona oscura se funden tambien.
                        const nearDark = (x, z) => {
                            const dark = (cx2, cz2) => this.lightField(cx2, cz2) < 0.38;
                            if (x <= 1 && dark(ch.cx - 1, ch.cz)) return true;
                            if (x >= N - 2 && dark(ch.cx + 1, ch.cz)) return true;
                            if (z <= 1 && dark(ch.cx, ch.cz - 1)) return true;
                            if (z >= N - 2 && dark(ch.cx, ch.cz + 1)) return true;
                            return false;
                        };
                        const lz = this.lightField(ch.cx, ch.cz);
                        let offP = 0.44, flickP = 0.32;
                        if (lz < 0.18) { offP = 1; flickP = 0; }          // apagon total
                        else if (lz < 0.38) { offP = 0.72; flickP = 0.2; } // tenue
                        else if (lz < 0.8) { /* normal */ }
                        else { offP = 0.3; flickP = 0.4; }                // casi todo encendido
                        const lr = ch.rng();
                        if (nearDark(x, z) || lr < offP) {
                            offL.push(dummy.matrix.clone());
                        } else if (lr < offP + flickP) {
                            flickL.push(dummy.matrix.clone());
                            ch.lamps.push({
                                pos: new THREE.Vector3(posX, WALL_HEIGHT - 0.12, posZ),
                                state: 2,
                                flickerTimer: ch.rng() * 2,
                                isLitNow: true
                            });
                        } else {
                            litL.push(dummy.matrix.clone());
                            ch.lamps.push({
                                pos: new THREE.Vector3(posX, WALL_HEIGHT - 0.12, posZ),
                                state: 1
                            });
                        }
                    }
                }
            }

            const boxGeo = new THREE.BoxGeometry(1, 1, 1);
            const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
            const addInst = (arr, mat, geo = boxGeo) => {
                if (arr.length === 0) return;
                const m = new THREE.InstancedMesh(geo, mat, arr.length);
                arr.forEach((mx, i) => m.setMatrixAt(i, mx));
                m.instanceMatrix.needsUpdate = true;
                this.scene.add(m);
                ch.meshes.push(m);
            };
            addInst(wallT, Materials.wall);
            addInst(cylT, Materials.wall, cylGeo);
            addInst(offL, Materials.lampOff);
            addInst(flickL, Materials.lampFlicker);
            addInst(litL, Materials.lampLit);

            // ---- GRAFITI en las paredes (100 variantes, blanco/negro/rojo) ----
            // RNG propio del chunk: no altera la generacion del mundo y, con la
            // misma semilla, toda la sala ve exactamente los mismos grafitis.
            this.placeChunkGraffiti(ch, wallKind, key, curvedCells);

            // ---- PAREDES INCLINADAS (rectas, en angulo) al final: ya estan
            // todas las cajas de colision de muros y pilares para validar que
            // cada tabique deja paso libre por ambos lados ----
            this.placeChunkSlantedWalls(ch);
        }

        // ---- GRAFITI (100 variantes, blanco/negro/rojo) sobre las paredes ----
        // Se eligen caras expuestas de paredes rectas (las curvas se omiten:
        // su superficie no es plana). La cara sale de wallFaceMap, que guarda
        // la caja REAL de cada celda (incluidos los alargues), asi el plano
        // queda pegado a la superficie visible y no flotando.
        placeChunkGraffiti(ch, wallKind, key, curvedCells) {
            const N = CHUNK_SIZE;
            const rng = mulberry32(hash2(ch.cx * 7919 + 101, ch.cz * 104729 + 503));
            const g = ch.grid;
            const dirs = [[-1, 0, 'W'], [1, 0, 'E'], [0, -1, 'S'], [0, 1, 'N']];
            const candidates = [];
            for (let x = 0; x < N; x++) {
                for (let z = 0; z < N; z++) {
                    const k = key(x, z);
                    if (g[x][z] !== 1 || curvedCells.has(k)) continue;
                    const kind = wallKind.get(k);
                    if (kind !== 'x' && kind !== 'z' && kind !== 'post' && kind !== 'border') continue;
                    for (const [dx, dz, d] of dirs) {
                        const nx = x + dx, nz = z + dz;
                        if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                        if (g[nx][nz] === 0 || g[nx][nz] === 2) candidates.push([x, z, d]);
                    }
                }
            }
            if (!candidates.length) return;
            const geo = new THREE.PlaneGeometry(1, 1);
            const placed = new Set();
            const count = 3 + Math.floor(rng() * 6);   // 3-8 grafitis por chunk
            for (let i = 0; i < count; i++) {
                const c = candidates[Math.floor(rng() * candidates.length)];
                const fk = c[0] + ',' + c[1] + c[2];
                if (placed.has(fk)) continue;
                placed.add(fk);
                const box = ch.wallFaceMap.get(key(c[0], c[1]));
                if (!box) continue;
                const color = GRAFFITI_COLORS[Math.floor(rng() * GRAFFITI_COLORS.length)];
                const variant = Math.floor(rng() * GRAFFITI_POOL.length);
                // La cara real de la pared: el grafiti NUNCA puede sobresalir de
                // ella. Antes media hasta 1,7 m y se colocaba tambien sobre
                // postes y juntas diminutas de esquina, asi que quedaba parte
                // del plano volando fuera de la pared.
                const faceLen = (c[2] === 'W' || c[2] === 'E') ? (box.maxZ - box.minZ) : (box.maxX - box.minX);
                if (faceLen < 1.0) continue;            // caras demasiado cortas: nada de grafiti volador
                // Sin luces (como la tiza): el grafiti se ve tambien en las
                // zonas de apagon, no solo bajo lamparas encendidas
                const mat = new THREE.MeshBasicMaterial({
                    map: graffitiTexture(variant, color),
                    transparent: true
                });
                const m = new THREE.Mesh(geo, mat);
                const w = Math.min(0.85 + rng() * 0.85, faceLen - 0.14); // 0,85-1,7 m, nunca mas ancho que la pared
                const h = 0.5 + rng() * 0.55;           // 0,5-1,05 m de alto
                m.scale.set(w, h, 1);
                // Altura limitada para que el grafiti quede DENTRO de la pared
                // (antes el borde superior podia asomar por encima del techo)
                const y = Math.max(0.3 + h / 2, Math.min(1.05 + rng() * 1.15, WALL_HEIGHT - 0.07 - h / 2));
                m.position.y = y;
                const mx = (box.minX + box.maxX) / 2;
                const mz = (box.minZ + box.maxZ) / 2;
                if (c[2] === 'W') { m.position.set(box.minX - 0.022, m.position.y, mz); m.rotation.y = -Math.PI / 2; }
                else if (c[2] === 'E') { m.position.set(box.maxX + 0.022, m.position.y, mz); m.rotation.y = Math.PI / 2; }
                else if (c[2] === 'S') { m.position.set(mx, m.position.y, box.minZ - 0.022); m.rotation.y = Math.PI; }
                else { m.position.set(mx, m.position.y, box.maxZ + 0.022); m.rotation.y = 0; }
                m.rotation.z = (rng() - 0.5) * 0.22;    // ligeramente torcido
                this.scene.add(m);
                ch.meshes.push(m);
            }
        }

        // Elige (de vez en cuando) UN tramo recto interior para convertirlo
        // en pared curva. Los tramos se detectan como celdas contiguas del
        // mismo kind ('x' corre en Z, 'z' corre en X) y deben tener los
        // lados abiertos consistentes en toda su longitud para que el arco
        // no se meta en ningun hueco raro.
        pickCurvedRuns(ch, wallKind, key) {
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const r = ch.rng;
            const open = (x, z) => x >= 0 && x < N && z >= 0 && z < N && (g[x][z] === 0 || g[x][z] === 2);
            // "De vez en cuando": ~1 de cada 5 chunks tiene una pared curva
            if (r() >= 0.2) return [];

            const runs = [];
            const visited = new Set();
            for (let x = 2; x < N - 2; x++) {
                for (let z = 2; z < N - 2; z++) {
                    const k = key(x, z);
                    if (visited.has(k)) continue;
                    const kind = wallKind.get(k);
                    if (kind !== 'x' && kind !== 'z') continue;
                    const cells = [[x, z]];
                    visited.add(k);
                    const q = [[x, z]];
                    while (q.length) {
                        const [cx, cz] = q.pop();
                        for (const [dx, dz] of kind === 'x' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]) {
                            const nk = key(cx + dx, cz + dz);
                            if (wallKind.get(nk) === kind && !visited.has(nk)) {
                                visited.add(nk);
                                cells.push([cx + dx, cz + dz]);
                                q.push([cx + dx, cz + dz]);
                            }
                        }
                    }
                    if (cells.length < 3) continue;
                    // Lados abiertos consistentes en todo el tramo
                    let wAll = true, wAny = false, eAll = true, eAny = false;
                    for (const [cx, cz] of cells) {
                        const w = kind === 'x' ? open(cx - 1, cz) : open(cx, cz - 1);
                        const e = kind === 'x' ? open(cx + 1, cz) : open(cx, cz + 1);
                        wAll = wAll && w; wAny = wAny || w;
                        eAll = eAll && e; eAny = eAny || e;
                    }
                    if (wAny !== wAll || eAny !== eAll) continue;
                    runs.push({ kind, cells });
                }
            }
            if (!runs.length) return [];
            // Un solo tramo curvo por chunk
            return [runs[Math.floor(r() * runs.length)]];
        }

        // Construye la pared curva: una malla unica de seccion rectangular
        // (grosor T) barrida a lo largo de un arco suave sin(pi*t), enrasada
        // en sus extremos con las paredes rectas vecinas. El arco se abre
        // hacia el lado abierto del pasillo (o a un lado al azar si la pared
        // es un tabique libre) y su amplitud se limita para que el paso nunca
        // quede por debajo de ~1,2 m. Devuelve las celdas sustituidas y las
        // cajas de colision (una por celda, centradas en la curva).
        buildCurvedWall(ch, run, wallTMap, key, wallKind) {
            const C = CELL_SIZE;
            const H = WALL_HEIGHT;
            const N = CHUNK_SIZE;
            const ox = ch.cx * N * C;
            const oz = ch.cz * N * C;
            const g = ch.grid;
            const open = (x, z) => x >= 0 && x < N && z >= 0 && z < N && (g[x][z] === 0 || g[x][z] === 2);
            const kind = run.kind;
            const cells = run.cells.slice().sort(kind === 'x' ? (a, b) => a[1] - b[1] : (a, b) => a[0] - b[0]);
            const first = cells[0], last = cells[cells.length - 1];
            const T = wallTMap.get(key(first[0], first[1])) || 0.8;

            // Extension del tramo en el mundo: de borde de celda a borde de
            // celda (la pared curva ocupa exactamente las celdas que sustituye)
            const along0 = kind === 'x' ? oz + first[1] * C : ox + first[0] * C;
            const along1 = kind === 'x' ? oz + (last[1] + 1) * C : ox + (last[0] + 1) * C;
            const fixed0 = kind === 'x' ? ox + (first[0] + 0.5) * C : oz + (first[1] + 0.5) * C;

            // Sellado de extremos: como las paredes rectas, la pared curva se
            // ALARGA hacia el poste/borde contiguo: hasta tocar la cara del
            // poste (1,45 m menos su medio grosor) o 2,45 m a bordes de chunk.
            // Sin esto, un tramo curvo que terminaba en un borde dejaba un
            // hueco de ~2 m por el que se colaba a la zona de atras de la pared.
            const nk0 = kind === 'x' ? wallKind.get(key(first[0], first[1] - 1)) : wallKind.get(key(first[0] - 1, first[1]));
            const nk1 = kind === 'x' ? wallKind.get(key(last[0], last[1] + 1)) : wallKind.get(key(last[0] + 1, last[1]));
            // Sellado de extremos solo contra muro real: si la celda vecina es
            // una PUERTA del borde de chunk (hueco abierto), la curva termina
            // justa en su borde y no se mete en el vano.
            const extFor = (nk, cx2, cz2) => {
                // El poste adopta el grosor de su pared (wallTMap guarda su
                // medio grosor): la curva se alarga hasta tocar su cara
                if (nk === 'post') return Math.max(0.05, 1.45 - (wallTMap.get(key(cx2, cz2)) || 0.525));
                if (nk === 'border' && g[cx2] && g[cx2][cz2] === 1) return 2.45;
                return 0;
            };
            const ext0 = kind === 'x' ? extFor(nk0, first[0], first[1] - 1) : extFor(nk0, first[0] - 1, first[1]);
            const ext1 = kind === 'x' ? extFor(nk1, last[0], last[1] + 1) : extFor(nk1, last[0] + 1, last[1]);
            const sweep0 = along0 - ext0;
            const sweep1 = along1 + ext1;

            // Lado del arco: hacia el pasillo abierto (o al azar si esta libre)
            let wOpen = false, eOpen = false;
            for (const [cx, cz] of cells) {
                wOpen = wOpen || (kind === 'x' ? open(cx - 1, cz) : open(cx, cz - 1));
                eOpen = eOpen || (kind === 'x' ? open(cx + 1, cz) : open(cx, cz + 1));
            }
            let dir;
            if (wOpen && !eOpen) dir = -1;
            else if (eOpen && !wOpen) dir = 1;
            else dir = ch.rng() < 0.5 ? -1 : 1;
            const cap = C - T / 2 - 1.2;   // el paso nunca baja de ~1,2 m
            const B = Math.min(cap, (0.30 + ch.rng() * 0.40) * C);

            // Muestras a lo largo del tramo (~0,5 m) para que el arco se vea liso
            const n = Math.max(6, Math.ceil((sweep1 - sweep0) / 0.5));
            const pos = [], uv = [], idx = [];
            const vert = (x, y, z, u, vv) => { pos.push(x, y, z); uv.push(u, vv); return pos.length / 3 - 1; };
            const quad = (a, b, c, d) => { idx.push(a, b, c, a, c, d); };

            // Barrido: cada muestra es una seccion rectangular de grosor T. El
            // arco (sinusoide) solo se aplica entre along0 y along1; las colas
            // rectas de los extremos alargan la pared hasta el poste/borde.
            const edges = [];
            for (let i = 0; i <= n; i++) {
                const t = i / n;
                const along = sweep0 + t * (sweep1 - sweep0);
                const tt = Math.min(1, Math.max(0, (along - along0) / (along1 - along0)));
                const off = dir * B * Math.sin(Math.PI * tt);
                if (kind === 'x') {
                    const f = fixed0 + off;
                    edges.push([[f - T / 2, along], [f + T / 2, along]]);
                } else {
                    const f = fixed0 + off;
                    edges.push([[along, f - T / 2], [along, f + T / 2]]);
                }
            }
            const alongU = (sweep1 - sweep0) / C;   // textura ~1 vez por celda
            for (let i = 0; i < n; i++) {
                const A = edges[i], Bb = edges[i + 1];
                const u0 = (i / n) * alongU, u1 = ((i + 1) / n) * alongU;
                // Laterales (+T/2 y -T/2)
                const a = vert(A[1][0], 0, A[1][1], u0, 0), b = vert(Bb[1][0], 0, Bb[1][1], u1, 0);
                const c = vert(Bb[1][0], H, Bb[1][1], u1, H / C), d = vert(A[1][0], H, A[1][1], u0, H / C);
                quad(a, b, c, d);
                const e = vert(A[0][0], 0, A[0][1], u0, 0), f = vert(Bb[0][0], 0, Bb[0][1], u1, 0);
                const gg = vert(Bb[0][0], H, Bb[0][1], u1, H / C), h = vert(A[0][0], H, A[0][1], u0, H / C);
                quad(h, gg, f, e);
                // Techo y suelo
                quad(d, c, gg, h);
                quad(a, e, f, b);
            }
            // Tapas de los extremos, enrasadas con las paredes rectas vecinas
            {
                const A = edges[0];
                const a = vert(A[0][0], 0, A[0][1], 0, 0), b = vert(A[1][0], 0, A[1][1], T / C, 0);
                const c = vert(A[1][0], H, A[1][1], T / C, H / C), d = vert(A[0][0], H, A[0][1], 0, H / C);
                quad(a, b, c, d);
                const E = edges[n];
                const e = vert(E[0][0], 0, E[0][1], 0, 0), f = vert(E[1][0], 0, E[1][1], T / C, 0);
                const gg = vert(E[1][0], H, E[1][1], T / C, H / C), h = vert(E[0][0], H, E[0][1], 0, H / C);
                quad(f, e, h, gg);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mat = Materials.wall.clone();
            mat.side = THREE.DoubleSide;
            const mesh = new THREE.Mesh(geo, mat);
            this.scene.add(mesh);
            ch.meshes.push(mesh);

            // Colision: una caja por celda sustituida que cubre TODO el barrido
            // del arco dentro de la celda. Antes la caja se centraba en el punto
            // central de la celda: el arco sobresalia hasta ~0,5 m por los
            // bordes de cada celda y se podia ATRAVESAR la pared curva por esos
            // huecos ("una puertecita para entrar por detras de la pared").
            // Se muestrea la curva en el inicio, centro y fin de cada celda
            // (la sinusoide es monotona entre medias) y la caja abarca el
            // minimo y el maximo: cubre exactamente la malla.
            const boxes = [];
            const offAt = (t) => dir * B * Math.sin(Math.PI * t);
            for (const [cx, cz] of cells) {
                let cellStart = kind === 'x' ? oz + cz * C : ox + cx * C;
                let cellEnd = kind === 'x' ? oz + (cz + 1) * C : ox + (cx + 1) * C;
                // Colas de sellado en las celdas de los extremos
                if (kind === 'x') {
                    if (cz === first[1]) cellStart -= ext0;
                    if (cz === last[1]) cellEnd += ext1;
                } else {
                    if (cx === first[0]) cellStart -= ext0;
                    if (cx === last[0]) cellEnd += ext1;
                }
                const t0 = (cellStart - along0) / (along1 - along0);
                const t1 = (cellEnd - along0) / (along1 - along0);
                // En las colas rectas (fuera del tramo curvo) el arco no se
                // aplica: las muestras se limitan al rango real de la curva
                const tt0 = Math.min(1, Math.max(0, t0));
                const tt1 = Math.min(1, Math.max(0, t1));
                const offs = [offAt(tt0), offAt((tt0 + tt1) / 2), offAt(tt1)];
                if (tt0 < 0.5 && tt1 > 0.5) offs.push(offAt(0.5)); // pico de la curva
                const minOff = Math.min(...offs) - T / 2;
                const maxOff = Math.max(...offs) + T / 2;
                if (kind === 'x') {
                    boxes.push({ minX: fixed0 + minOff, maxX: fixed0 + maxOff, minZ: cellStart, maxZ: cellEnd });
                } else {
                    boxes.push({ minX: cellStart, maxX: cellEnd, minZ: fixed0 + minOff, maxZ: fixed0 + maxOff });
                }
            }
            return { cells, boxes, kind, along0, along1, sweep0, sweep1, fixed0, dir, B, T, ext0, ext1 };
        }

        // ================================================================
        //  PAREDES INCLINADAS: tabiques RECTOS colocados en angulo dentro de
        //  salas, salones y a veces pasillos. Dos formas (como el boceto):
        //  rectangulares y trapezoidales (un extremo mas grueso que el otro),
        //  con largo, angulo y grosor aleatorios por chunk. RNG propio del
        //  chunk: determinista, toda la sala ve los mismos tabiques.
        //  Colision por segmentos AABB a lo largo del tabique (el jugador y
        //  los muebles chocan con el angulo real, no con su caja envolvente
        //  entera). Se exige paso libre de ~0,75 m a cada lado contra muros,
        //  pilares y otros tabiques: nunca sellan un pasillo.
        // ================================================================
        slabCorners(cx, cz, ang, L, T0, T1) {
            const cos = Math.cos(ang), sin = Math.sin(ang);
            const half = L / 2;
            return [
                [-T0 / 2, -half], [T0 / 2, -half],
                [-T1 / 2, half], [T1 / 2, half]
            ].map(([lx, lz]) => ({ x: cx + lx * cos + lz * sin, z: cz - lx * sin + lz * cos }));
        }

        placeChunkSlantedWalls(ch) {
            const rng = mulberry32(hash2(ch.cx * 65407 + 89, ch.cz * 65407 + 137));
            const N = CHUNK_SIZE, C = CELL_SIZE;
            const g = ch.grid;
            const ox = ch.cx * N * C;
            const oz = ch.cz * N * C;
            const open = (x, z) => x >= 0 && x < N && z >= 0 && z < N && (g[x][z] === 0 || g[x][z] === 2);

            // Celdas candidatas: interiores (nunca en vanos de borde), abiertas
            // y con los 4 vecinos abiertos (campo libre alrededor del centro)
            const cands = [];
            for (let x = 3; x < N - 3; x++) {
                for (let z = 3; z < N - 3; z++) {
                    if (!open(x, z)) continue;
                    if (!open(x - 1, z) || !open(x + 1, z) || !open(x, z - 1) || !open(x, z + 1)) continue;
                    cands.push([x, z]);
                }
            }
            for (let i = cands.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [cands[i], cands[j]] = [cands[j], cands[i]];
            }

            // Cantidad: 0-2 en chunks con salas/salones, ocasional en pasillos
            let n = 0;
            if (ch.rooms.length > 0) {
                if (rng() < 0.6) n = 1 + (rng() < 0.45 ? 1 : 0);
            } else if (rng() < 0.25) {
                n = 1;
            }

            const placed = [];
            for (const [cx2, cz2] of cands) {
                if (placed.length >= n) break;
                const wx = ox + (cx2 + 0.5) * C;
                const wz = oz + (cz2 + 0.5) * C;
                const shape = rng() < 0.45 ? 'trap' : 'rect';
                const L = 1.8 + rng() * 2.8;             // 1,8-4,6 m de largo
                const ang = (rng() - 0.5) * 2.6;         // hasta ~±75°
                const T0 = shape === 'trap' ? 0.2 + rng() * 0.12 : 0.22 + rng() * 0.2;
                const T1 = shape === 'trap' ? T0 + 0.3 + rng() * 0.35 : T0;

                const pts = this.slabCorners(wx, wz, ang, L, T0, T1);
                const aabb = {
                    minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
                    minZ: Math.min(...pts.map(p => p.z)), maxZ: Math.max(...pts.map(p => p.z))
                };
                // Paso libre garantizado: ~0,75 m de aire a cada lado del
                // tabique (el tabique vive dentro de su AABB, asi que el paso
                // real nunca es menor que el margen comprobado)
                const M = 0.75;
                let ok = true;
                for (const b of ch.wallBoxes) {
                    if (aabb.minX - M < b.maxX && aabb.maxX + M > b.minX &&
                        aabb.minZ - M < b.maxZ && aabb.maxZ + M > b.minZ) { ok = false; break; }
                }
                if (ok) {
                    for (const s of placed) {
                        if (aabb.minX - 0.8 < s.maxX && aabb.maxX + 0.8 > s.minX &&
                            aabb.minZ - 0.8 < s.maxZ && aabb.maxZ + 0.8 > s.minZ) { ok = false; break; }
                    }
                }
                if (!ok) continue;

                const built = this.buildSlantedWall(ch, wx, wz, ang, L, T0, T1, shape);
                placed.push(aabb);
                ch.slantedAABBs.push(aabb);
                ch.wallBoxes.push(...built.boxes);
                ch.meshes.push(built.mesh);
            }
        }

        buildSlantedWall(ch, cx, cz, ang, L, T0, T1, shape) {
            const H = WALL_HEIGHT;
            const cos = Math.cos(ang), sin = Math.sin(ang);
            const half = L / 2;

            // Colision: cajas por segmentos (~1,1 m) a lo largo del tabique.
            // Cada caja es el AABB del segmento rotado, asi la colision sigue
            // el angulo real en vez de bloquear todo el rectangulo envolvente.
            const nSeg = Math.max(2, Math.round(L / 1.1));
            const boxes = [];
            for (let i = 0; i < nSeg; i++) {
                const z0 = -half + (L / nSeg) * i;
                const z1 = z0 + L / nSeg;
                const m = Math.max(T0, T1) / 2;   // el grosor crece de forma lineal: el maximo acota el segmento
                const pts = [
                    { x: cx - m * cos + z0 * sin, z: cz + m * sin + z0 * cos },
                    { x: cx + m * cos + z0 * sin, z: cz - m * sin + z0 * cos },
                    { x: cx - m * cos + z1 * sin, z: cz + m * sin + z1 * cos },
                    { x: cx + m * cos + z1 * sin, z: cz - m * sin + z1 * cos }
                ];
                boxes.push({
                    minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
                    minZ: Math.min(...pts.map(p => p.z)), maxZ: Math.max(...pts.map(p => p.z))
                });
            }

            // Malla
            let geo;
            if (shape === 'rect') {
                geo = new THREE.BoxGeometry(1, 1, 1);
                geo.scale(T0, H, L);
            } else {
                geo = this.trapezoidGeometry(L, H, T0, T1);
            }
            const mat = Materials.wall.clone();
            mat.side = THREE.DoubleSide;
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cx, H / 2, cz);
            mesh.rotation.y = ang;
            this.scene.add(mesh);
            return { mesh, boxes };
        }

        // Prisma trapezoidal vertical: un extremo mas grueso que el otro
        // (como el tabique afinado del boceto). UVs: la textura se repite
        // cada celda a lo largo y en vertical.
        trapezoidGeometry(L, H, T0, T1) {
            const pos = [], uv = [], idx = [];
            const hL = L / 2;
            const A = [-T0 / 2, 0, -hL], B = [T0 / 2, 0, -hL];
            const C = [-T1 / 2, 0, hL], D = [T1 / 2, 0, hL];
            const E = [-T0 / 2, H, -hL], F = [T0 / 2, H, -hL];
            const G = [-T1 / 2, H, hL], HH = [T1 / 2, H, hL];
            const vert = (p, u, v) => { pos.push(p[0], p[1], p[2]); uv.push(u, v); return pos.length / 3 - 1; };
            const tri = (a, b, c) => idx.push(a, b, c);
            const u0 = 0, u1 = L / CELL_SIZE, v0 = 0, v1 = H / CELL_SIZE;
            const a = vert(A, u0, v0), b = vert(B, u0, v0);
            const c = vert(C, u1, v0), d = vert(D, u1, v0);
            const e = vert(E, u0, v1), f = vert(F, u0, v1);
            const g = vert(G, u1, v1), h = vert(HH, u1, v1);
            // Suelo (-Y) y techo (+Y)
            tri(a, d, c); tri(a, b, d);
            tri(f, g, h); tri(f, e, g);
            // Laterales (x- y x+)
            tri(a, g, e); tri(a, c, g);
            tri(b, f, h); tri(b, f, d);
            // Tapas de los extremos (z- y z+)
            tri(a, e, b); tri(b, e, f);
            tri(d, h, g); tri(d, g, c);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            return geo;
        }

        // ================================================================
        //  MUEBLES (permanecen en el mundo aunque el chunk se descargue)
        // ================================================================
        canPlaceFurniture(x, z, radius) {
            for (let box of this.wallBoxes) {
                if (x + radius > box.minX && x - radius < box.maxX && z + radius > box.minZ && z - radius < box.maxZ) {
                    return false;
                }
            }
            for (let occ of this.occupiedFurnitureBoxes) {
                if (Math.hypot(x - occ.x, z - occ.z) < radius + occ.radius + 0.45) {
                    return false;
                }
            }
            return true;
        }

        // Ejecuta un bloque con Math.random sustituido por un generador
        // DETERMINISTA del chunk (muebles, armarios, escombros y detalles de
        // los modelos). Antes usaban Math.random global: con la misma semilla
        // cada partida colocaba muebles distintos y parecía otro backroom.
        // Ahora el mismo chunk con la misma semilla SIEMPRE genera el mismo
        // mobiliario (requisito también del multijugador: todos comparten
        // exactamente el mismo mundo).
        withChunkRng(ch, fn) {
            const rng = mulberry32(hash2(ch.cx * 262147 + 17, ch.cz * 262147 + 31));
            const saved = Math.random;
            Math.random = rng;
            try {
                return fn();
            } finally {
                Math.random = saved;
            }
        }

        placeChunkFurniture(ch) {
            if (ch.furnitureDone) return;
            ch.furnitureDone = true;
            this.withChunkRng(ch, () => this.placeChunkFurnitureInner(ch));
        }

        placeChunkFurnitureInner(ch) {
            for (const r of ch.rooms) {
                // Coordenadas de mundo para la sala
                const rw = { x: ch.cx * CHUNK_SIZE + r.x, z: ch.cz * CHUNK_SIZE + r.z, w: r.w, h: r.h };
                const rx = (rw.x + Math.floor(rw.w / 2)) * CELL_SIZE;
                const rz = (rw.z + Math.floor(rw.h / 2)) * CELL_SIZE;
                const area = rw.w * rw.h;

                let pieces = 1;
                if (area >= 9 && Math.random() < 0.6) pieces++;
                if (area >= 20 && Math.random() < 0.5) pieces++;

                for (let p = 0; p < pieces; p++) {
                    const choice = Math.random();
                    if (choice < 0.35) {
                        const variant = Math.random() < 0.5 ? 2 : 1;
                        const deskX = rx + (Math.random() - 0.5) * 1.5;
                        const deskZ = rz + (Math.random() - 0.5) * 1.5;
                        if (this.canPlaceFurniture(deskX, deskZ, 0.95)) {
                            const desk = ModelBuilder.createOfficeDesk(variant);
                            desk.position.set(deskX, 0, deskZ);
                            snapToFloor(desk, 0);
                            this.scene.add(desk);
                            this.furnitureMeshes.push(desk);
                            this.dynamicFurniture.push({ mesh: desk, x: deskX, z: deskZ });
                            this.occupiedFurnitureBoxes.push({ x: deskX, z: deskZ, radius: 0.95 });
                        }
                    } else if (choice < 0.6) {
                        const chairX = rx + (Math.random() - 0.5) * 1.8;
                        const chairZ = rz + (Math.random() - 0.5) * 1.8;
                        const variant = Math.random() < 0.6 ? 1 : 2;
                        if (this.canPlaceFurniture(chairX, chairZ, 0.55)) {
                            const chair = ModelBuilder.createOfficeChair(variant);
                            chair.position.set(chairX, 0, chairZ);
                            snapToFloor(chair, 0);
                            this.scene.add(chair);
                            this.furnitureMeshes.push(chair);
                            this.dynamicFurniture.push({ mesh: chair, x: chairX, z: chairZ });
                            this.occupiedFurnitureBoxes.push({ x: chairX, z: chairZ, radius: 0.55 });
                        }
                    } else {
                        this.placeCabinetInRoom(rw);
                    }
                }
            }

            // Armarios de pasillo contra las paredes de los tramos rectos
            this.placeCorridorCabinets(ch);
        }

        _CABDIM = { w: 1.0, h: 2.2, d: 0.56 };

        rollCabinetStyle(poseHint) {
            let pose = poseHint;
            if (!pose) {
                const r = Math.random();
                pose = r < 0.45 ? 'stand' : (r < 0.68 ? 'lean' : (Math.random() < 0.5 ? 'back' : 'side'));
            }
            let doorState;
            if (pose === 'stand') {
                doorState = Math.random() < 0.35 ? 0 : (Math.random() < 0.65 ? 1 : 2);
            } else if (pose === 'lean') {
                doorState = Math.random() < 0.3 ? 0 : (Math.random() < 0.6 ? 1 : 2);
            } else {
                doorState = Math.random() < 0.72 ? 0 : (Math.random() < 0.9 ? 1 : 2);
            }
            const filled = (pose === 'stand' || pose === 'lean') ? Math.random() < 0.6 : Math.random() < 0.3;
            return { pose, doorState, filled };
        }

        scatterDebris(debris, cx, cz, yaw) {
            const cosY = Math.cos(yaw);
            const sinY = Math.sin(yaw);
            const added = [];
            for (const d of debris) {
                const o = d.userData.offset || { x: 0, z: 0.6, rot: 0 };
                const wx = cx + o.x * cosY + o.z * sinY;
                const wz = cz - o.x * sinY + o.z * cosY;
                const gx = Math.floor(wx / CELL_SIZE);
                const gz = Math.floor(wz / CELL_SIZE);
                const cell = this.gridAt(gx, gz);
                if (cell !== 0 && cell !== 2) continue;
                d.position.set(wx, 0, wz);
                d.rotation.y = yaw + (o.rot || 0);
                this.scene.add(d);
                added.push(d);
            }
            return added;
        }

        circleTouchesBox(cx, cz, r, box) {
            const nx = Math.max(box.minX, Math.min(cx, box.maxX));
            const nz = Math.max(box.minZ, Math.min(cz, box.maxZ));
            const dx = cx - nx, dz = cz - nz;
            return (dx * dx + dz * dz) < r * r;
        }

        // La caja esta "detras" de la pared contra la que se apoya el armario
        isSupportBox(box, cx, cz, r, d) {
            const vx = (box.minX + box.maxX) / 2 - cx;
            const vz = (box.minZ + box.maxZ) / 2 - cz;
            const proj = vx * d[0] + vz * d[1];
            if (proj > -0.05) return false;
            const behind = -proj;
            if (behind > CELL_SIZE * 1.4) return false;
            const tx = vx - d[0] * proj;
            const tz = vz - d[1] * proj;
            return Math.hypot(tx, tz) < r + 0.5;
        }

        cabinetSpotFree(cx, cz, r, d) {
            for (const box of this.wallBoxes) {
                if (d && this.isSupportBox(box, cx, cz, r, d)) continue;
                if (this.circleTouchesBox(cx, cz, r, box)) return false;
            }
            for (const occ of this.occupiedFurnitureBoxes) {
                if (Math.hypot(cx - occ.x, cz - occ.z) < r + occ.radius + 0.35) return false;
            }
            return true;
        }

        placeOneCabinet(cx, cz, yaw, style, r, d) {
            const opts = Object.assign({}, style);
            if (style.pose === 'lean') {
                opts.lean = 0.13 + Math.random() * 0.07;
            }
            const built = ModelBuilder.createOfficeCabinet(opts);
            const group = built.group;
            group.position.set(cx, 0, cz);
            group.rotation.y = yaw;
            snapToFloor(group, 0);

            group.updateMatrixWorld(true);
            const bb = new THREE.Box3().setFromObject(group);
            const bx = (bb.min.x + bb.max.x) / 2;
            const bz = (bb.min.z + bb.max.z) / 2;
            const hx = (bb.max.x - bb.min.x) / 2;
            const hz = (bb.max.z - bb.min.z) / 2;

            const occupiedRadius = Math.max(r, Math.hypot(hx, hz));
            const ok = this.cabinetSpotFree(bx, bz, occupiedRadius, d);
            if (!ok) {
                this.scene.remove(group);
                return null;
            }
            this.scene.add(group);
            this.furnitureMeshes.push(group);
            this.occupiedFurnitureBoxes.push({ x: bx, z: bz, radius: occupiedRadius * 0.9 });
            this.furnitureBoxes.push({
                minX: bb.min.x - 0.04, maxX: bb.max.x + 0.04,
                minZ: bb.min.z - 0.04, maxZ: bb.max.z + 0.04
            });
            const debris = this.scatterDebris(built.debris, bx, bz, yaw);
            this.furnitureMeshes.push(...debris);
            group.userData.cabinet = Object.assign({}, style, { x: bx, z: bz, yaw });
            return group;
        }

        // Armario apoyado en una pared (sala o pasillo), coordenadas de mundo
        trySpawnCabinetOnWall(faceCoord, d, tanAxis, a, b, poseHint) {
            const C = CELL_SIZE;
            const style = this.rollCabinetStyle(poseHint);
            const fallen = style.pose === 'back' || style.pose === 'face' || style.pose === 'side';
            const halfTan = fallen ? 1.15 : 0.62;
            const lo = a + halfTan;
            const hi = b - halfTan;
            if (hi <= lo) return false;

            for (let t = 0; t < 8; t++) {
                const tan = lo + Math.random() * (hi - lo);
                // Celda de pared detras del punto elegido (la lamina fina)
                const wcx = tanAxis === 'x' ? Math.floor(tan / C) : Math.floor((faceCoord - d[0] * C / 2) / C);
                const wcz = tanAxis === 'z' ? Math.floor(tan / C) : Math.floor((faceCoord - d[1] * C / 2) / C);
                if (this.gridAt(wcx, wcz) !== 1) continue;
                // Cara REAL de la lamina hacia el suelo: la pared ya no ocupa
                // la celda entera, los armarios se apoyan en la superficie fina
                const face = this.wallFaceAt(wcx, wcz, d);
                if (face === null) continue;

                let cx, cz, yaw;
                if (style.pose === 'stand') {
                    cx = (tanAxis === 'x' ? tan : face) + d[0] * (this._CABDIM.d / 2 + 0.04);
                    cz = (tanAxis === 'x' ? face : tan) + d[1] * (this._CABDIM.d / 2 + 0.04);
                    yaw = Math.atan2(d[0], d[1]);
                } else if (style.pose === 'lean') {
                    const leanA = 0.13 + Math.random() * 0.07;
                    style.lean = leanA;
                    const need = this._CABDIM.h * Math.sin(leanA) + (this._CABDIM.d / 2) * Math.cos(leanA) + 0.02;
                    cx = (tanAxis === 'x' ? tan : face) + d[0] * need;
                    cz = (tanAxis === 'x' ? face : tan) + d[1] * need;
                    yaw = Math.atan2(d[0], d[1]);
                } else {
                    cx = (tanAxis === 'x' ? tan : face) + d[0] * 0.62;
                    cz = (tanAxis === 'x' ? face : tan) + d[1] * 0.62;
                    const tangentX = tanAxis === 'x' ? 1 : 0;
                    const tangentZ = tanAxis === 'x' ? 0 : 1;
                    if (style.pose === 'back') {
                        yaw = Math.atan2(tangentX, tangentZ);
                    } else if (style.pose === 'face') {
                        yaw = Math.atan2(-tangentX, -tangentZ);
                    } else {
                        yaw = -Math.atan2(tangentZ, tangentX);
                    }
                }

                const gcx = Math.floor(cx / C);
                const gcz = Math.floor(cz / C);
                // Las puertas NO deben quedar cara a la pared: la celda delante
                // de la fachada tiene que estar abierta, asi el armario nunca
                // acaba en un hueco de 1 celda apuntando a la pared de enfrente
                const fcx = gcx + d[0];
                const fcz = gcz + d[1];
                const ftype = this.gridAt(fcx, fcz);
                if (ftype !== 0 && ftype !== 2) continue;
                if (!this.cabinetSpotFree(cx, cz, fallen ? 1.35 : 0.7, d)) continue;

                const g = this.placeOneCabinet(cx, cz, yaw, style, fallen ? 1.35 : 0.7, d);
                if (g) return true;
            }
            return false;
        }

        // Cara de la lamina de pared hacia la direccion d (mundo, en metros)
        wallFaceAt(wcx, wcz, d) {
            const ch = this.chunks.get(Math.floor(wcx / CHUNK_SIZE) + ',' + Math.floor(wcz / CHUNK_SIZE));
            const box = ch && ch.wallFaceMap && ch.wallFaceMap.get(wcx + ',' + wcz);
            if (!box) return null;
            if (d[0] === 1) return box.minX;
            if (d[0] === -1) return box.maxX;
            if (d[1] === 1) return box.minZ;
            return box.maxZ;
        }

        placeCabinetInRoom(r) {
            const C = CELL_SIZE;
            const sides = ['n', 's', 'e', 'w'].sort(() => Math.random() - 0.5);
            for (const side of sides) {
                const poseRoll = Math.random();
                const fallenPoses = ['back', 'side', 'face'];
                const poseHint = poseRoll < 0.45 ? 'stand' : (poseRoll < 0.68 ? 'lean' : fallenPoses[Math.floor(Math.random() * 3)]);
                let faceCoord, d, tanAxis, a, b;
                if (side === 'n') {
                    faceCoord = r.z * C;
                    d = [0, 1];
                    tanAxis = 'x';
                    a = (r.x + 0.5) * C;
                    b = (r.x + r.w - 0.5) * C;
                } else if (side === 's') {
                    faceCoord = (r.z + r.h) * C;
                    d = [0, -1];
                    tanAxis = 'x';
                    a = (r.x + 0.5) * C;
                    b = (r.x + r.w - 0.5) * C;
                } else if (side === 'e') {
                    faceCoord = (r.x + r.w) * C;
                    d = [-1, 0];
                    tanAxis = 'z';
                    a = (r.z + 0.5) * C;
                    b = (r.z + r.h - 0.5) * C;
                } else {
                    faceCoord = r.x * C;
                    d = [1, 0];
                    tanAxis = 'z';
                    a = (r.z + 0.5) * C;
                    b = (r.z + r.h - 0.5) * C;
                }
                if (this.trySpawnCabinetOnWall(faceCoord, d, tanAxis, a, b, poseHint)) {
                    return true;
                }
            }
            return false;
        }

        placeCorridorCabinets(ch) {
            const C = CELL_SIZE;
            const target = Math.min(2, Math.floor(ch.openCells.length / 110));
            let placedCount = 0;

            const cells = ch.openCells.slice();
            for (let i = cells.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [cells[i], cells[j]] = [cells[j], cells[i]];
            }

            for (const cell of cells) {
                if (placedCount >= target) break;
                const cx = cell.x, cz = cell.z;
                if (this.gridAt(cx, cz) !== 0) continue;

                // Solo tramos rectos: exactamente UNA pared vecina
                const dirs = [];
                if (this.gridAt(cx, cz + 1) === 1) dirs.push([0, 1]);
                if (this.gridAt(cx, cz - 1) === 1) dirs.push([0, -1]);
                if (this.gridAt(cx + 1, cz) === 1) dirs.push([1, 0]);
                if (this.gridAt(cx - 1, cz) === 1) dirs.push([-1, 0]);
                if (dirs.length !== 1) continue;

                let faceCoord, d, tanAxis;
                if (dirs[0][0] === 0 && dirs[0][1] === 1) {
                    faceCoord = (cz + 1) * C;
                    d = [0, -1];
                    tanAxis = 'x';
                } else if (dirs[0][0] === 0 && dirs[0][1] === -1) {
                    faceCoord = cz * C;
                    d = [0, 1];
                    tanAxis = 'x';
                } else if (dirs[0][0] === 1) {
                    faceCoord = (cx + 1) * C;
                    d = [-1, 0];
                    tanAxis = 'z';
                } else {
                    faceCoord = cx * C;
                    d = [1, 0];
                    tanAxis = 'z';
                }

                // La pared debe ser recta a ambos lados del armario
                let wallOk = true;
                if (tanAxis === 'x') {
                    const wallRow = d[1] > 0 ? cz - 1 : cz + 1;
                    for (const off of [-0.7, 0.7]) {
                        const col = Math.floor(((cx + 0.5) * C + off) / C);
                        if (this.gridAt(col, wallRow) !== 1) { wallOk = false; break; }
                    }
                } else {
                    const wallCol = d[0] > 0 ? cx - 1 : cx + 1;
                    for (const off of [-0.7, 0.7]) {
                        const row = Math.floor(((cz + 0.5) * C + off) / C);
                        if (this.gridAt(wallCol, row) !== 1) { wallOk = false; break; }
                    }
                }
                if (!wallOk) continue;

                const poseRoll = Math.random();
                const fallenPoses = ['back', 'side', 'face'];
                const poseHint = poseRoll < 0.55 ? 'stand' : (poseRoll < 0.75 ? 'lean' : fallenPoses[Math.floor(Math.random() * 3)]);
                const centerTan = tanAxis === 'x' ? (cx + 0.5) * C : (cz + 0.5) * C;
                if (this.trySpawnCabinetOnWall(faceCoord, d, tanAxis, centerTan - C / 2, centerTan + C / 2, poseHint)) {
                    placedCount++;
                }
            }
        }

        // ================================================================
        //  OBJETOS RECOGIBLES: los datos persisten aunque el chunk se vaya
        // ================================================================
        pickupSpot(ch) {
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const r = ch.rng;
            const dead = [], corner = [], open = [];
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    if (g[x][z] !== 0 && g[x][z] !== 2) continue;
                    let walls = 0;
                    if (g[x + 1][z] === 1 || g[x + 1][z] === 3) walls++;
                    if (g[x - 1][z] === 1 || g[x - 1][z] === 3) walls++;
                    if (g[x][z + 1] === 1 || g[x][z + 1] === 3) walls++;
                    if (g[x][z - 1] === 1 || g[x][z - 1] === 3) walls++;
                    const entry = [x, z];
                    if (walls >= 3) dead.push(entry);
                    else if (walls >= 2) corner.push(entry);
                    else open.push(entry);
                }
            }
            const pool = dead.length ? dead : (corner.length ? corner : open);
            // Baraja con el rng del chunk
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(r() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            for (const [lx, lz] of pool) {
                const wx = (ch.cx * N + lx + 0.5) * CELL_SIZE;
                const wz = (ch.cz * N + lz + 0.5) * CELL_SIZE;
                // Separacion minima de otros objetos y muebles
                let ok = true;
                for (const p of this.pickupData) {
                    if (Math.hypot(p.x - wx, p.z - wz) < CELL_SIZE * 2.2) { ok = false; break; }
                }
                if (ok) {
                    for (const occ of this.occupiedFurnitureBoxes) {
                        if (Math.hypot(occ.x - wx, occ.z - wz) < occ.radius + 1.2) { ok = false; break; }
                    }
                }
                if (!ok) continue;
                const ang = r() * Math.PI * 2;
                const mag = 0.35 + r() * 0.5;
                return { x: wx + Math.cos(ang) * mag, z: wz + Math.sin(ang) * mag };
            }
            return null;
        }

        // Punto de una nota PEGADA A LA PARED: elige una cara expuesta de un
        // muro recto (misma logica que los grafitis) y guarda todo lo que hace
        // falta para materializarla: caja de la cara, direccion, posicion a lo
        // largo de la pared, altura, variante de fijacion, orientacion y giro.
        pickWallNoteSpot(ch) {
            const N = CHUNK_SIZE;
            const r = ch.rng;
            const g = ch.grid;
            const dirs = [[-1, 0, 'W'], [1, 0, 'E'], [0, -1, 'S'], [0, 1, 'N']];
            const cands = [];
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    const k = x + ',' + z;
                    if (g[x][z] !== 1) continue;
                    const box = ch.wallFaceMap && ch.wallFaceMap.get(k);
                    if (!box) continue;   // paredes curvas no tienen cara plana
                    for (const [dx, dz, d] of dirs) {
                        const nx = x + dx, nz = z + dz;
                        if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                        if (g[nx][nz] !== 0 && g[nx][nz] !== 2) continue;
                        const faceLen = (d === 'W' || d === 'E') ? (box.maxZ - box.minZ) : (box.maxX - box.minX);
                        if (faceLen < 0.9) continue;
                        cands.push({ box, d, faceLen });
                    }
                }
            }
            if (!cands.length) return null;
            const c = cands[Math.floor(r() * cands.length)];
            const rots = [-0.4, -0.24, -0.1, 0.08, 0.22, 0.38];
            return {
                box: { minX: c.box.minX, maxX: c.box.maxX, minZ: c.box.minZ, maxZ: c.box.maxZ },
                dir: c.d,
                t: 0.12 + r() * 0.76,          // donde, a lo largo de la pared
                y: 1.1 + r() * 0.8,            // altura sobre el suelo
                variant: Math.floor(r() * 5),  // 0 chincheta, 1 cinta H, 2 cintas diag., 3 rasgada, 4 sola
                aspect: r() < 0.6 ? 'portrait' : 'landscape',
                rot: rots[Math.floor(r() * rots.length)]
            };
        }

        buildPickupMesh(p) {
            let mesh;
            if (p.type === 'camera') {
                mesh = ModelBuilder.createCameraModel();
                mesh.rotation.z = Math.PI / 2;
                mesh.position.set(p.x, 0, p.z);
                snapToFloor(mesh, 0.01);
            } else if (p.type === 'chalk') {
                mesh = ModelBuilder.createChalkBox(p.color);
                mesh.position.set(p.x, 0, p.z);
                snapToFloor(mesh, 0.01);
            } else if (p.type === 'almond') {
                mesh = ModelBuilder.createAlmondWater();
                mesh.rotation.z = Math.PI / 2;
                mesh.position.set(p.x, 0, p.z);
                snapToFloor(mesh, 0.01);
            } else if (p.type === 'battery') {
                mesh = ModelBuilder.createBattery();
                mesh.rotation.z = Math.PI / 2;
                mesh.rotation.x = (Math.random() - 0.5) * 0.4;
                mesh.position.set(p.x, 0, p.z);
                snapToFloor(mesh, 0.01);
            } else if (p.type === 'note') {
                if (p.wall) {
                    // Nota pegada a la pared: el plano se apoya en la cara real
                    // del muro (wallFaceMap) en la posicion/altura elegidas
                    mesh = ModelBuilder.createWallNote(p.wall);
                    const b = p.wall.box;
                    const bx = b.minX + (b.maxX - b.minX) * p.wall.t;
                    const bz = b.minZ + (b.maxZ - b.minZ) * p.wall.t;
                    let ry = 0;
                    if (p.wall.dir === 'W') { mesh.position.set(b.minX - 0.016, p.wall.y, bz); ry = -Math.PI / 2; }
                    else if (p.wall.dir === 'E') { mesh.position.set(b.maxX + 0.016, p.wall.y, bz); ry = Math.PI / 2; }
                    else if (p.wall.dir === 'S') { mesh.position.set(bx, p.wall.y, b.minZ - 0.016); ry = Math.PI; }
                    else { mesh.position.set(bx, p.wall.y, b.maxZ + 0.016); ry = 0; }
                    mesh.rotation.y = ry;
                } else {
                    mesh = ModelBuilder.createFloorNote();
                    mesh.position.set(p.x, 0.005, p.z);
                }
            }
            this.scene.add(mesh);
            return mesh;
        }

        spawnChunkPickups(ch) {
            // El materializado de objetos tambien usa el RNG del chunk: las
            // rotaciones de pilas y notas son identicas para todos los clientes
            this.withChunkRng(ch, () => this.spawnChunkPickupsInner(ch));
        }

        spawnChunkPickupsInner(ch) {
            if (!ch.pickupsDone) {
                ch.pickupsDone = true;
                const r = ch.rng;
                const want = [];
                const gx = ch.cx, gz = ch.cz;

                // Arranque garantizado cerca del origen: camara, tizas, agua, pilas
                if (gx === 0 && gz === 0) want.push({ type: 'camera' }, { type: 'chalk', color: '#ffffff', colorName: 'BLANCO' }, { type: 'note', noteIndex: 0 });
                if (gx === 1 && gz === 0) want.push({ type: 'almond' }, { type: 'battery' });
                if (gx === 0 && gz === 1) want.push({ type: 'battery' }, { type: 'note', noteIndex: 1 });
                if (gx === -1 && gz === 0) want.push({ type: 'almond' }, { type: 'note', noteIndex: 2 });
                if (gx === 0 && gz === -1) want.push({ type: 'battery' }, { type: 'note', noteIndex: 3 });
                if (gx === 1 && gz === 1) want.push({ type: 'chalk', color: '#ff3333', colorName: 'ROJO' });

                // Reparto aleatorio de recursos por el infinito (densidad
                // aumentada: antes aparecian muy pocos objetos por chunk)
                if (r() < 0.10) want.push({ type: 'camera' });
                if (r() < 0.20) want.push({ type: 'chalk' });
                if (r() < 0.26) want.push({ type: 'almond' });
                if (r() < 0.34) want.push({ type: 'battery' });
                if (r() < 0.32) want.push({ type: 'note' });

                const chalkColors = ['#ffffff', '#ff3333', '#111111'];
                const chalkNames = ['BLANCO', 'ROJO', 'NEGRO'];

                for (const it of want) {
                    if (it.type === 'note') {
                        const fresh = [];
                        for (let i = 0; i < NOTE_POOL.length; i++) {
                            if (!this.collectedNoteIndices.has(i)) fresh.push(i);
                        }
                        it.noteIndex = fresh.length > 0 ? fresh[Math.floor(r() * fresh.length)] : Math.floor(r() * NOTE_POOL.length);
                        // Una parte de las notas va PEGADA A LA PARED, en
                        // distintas variantes (chincheta, cintas, rasgada,
                        // orientaciones y giros distintos)
                        if (r() < 0.45) {
                            const wall = this.pickWallNoteSpot(ch);
                            if (wall) it.wall = wall;
                        }
                    } else if (it.type === 'chalk' && !it.color) {
                        const ci = Math.floor(r() * 3);
                        it.color = chalkColors[ci];
                        it.colorName = chalkNames[ci];
                    }
                    let spot = this.pickupSpot(ch);
                    if (!spot) continue;
                    // Los objetos nunca caen DENTRO de un tabique inclinado
                    if (ch.slantedAABBs && ch.slantedAABBs.length) {
                        let bad = false;
                        for (const b of ch.slantedAABBs) {
                            if (spot.x > b.minX - 0.1 && spot.x < b.maxX + 0.1 &&
                                spot.z > b.minZ - 0.1 && spot.z < b.maxZ + 0.1) { bad = true; break; }
                        }
                        if (bad) continue;
                    }
                    // Id persistente y DETERMINISTA (misma semilla -> mismo id en
                    // todos los clientes): sirve para reclamar el objeto por red.
                    const data = {
                        id: gx + ',' + gz + '#' + ch.pickupList.length,
                        type: it.type,
                        x: spot.x,
                        z: spot.z,
                        collected: false,
                        mesh: null,
                        pos: new THREE.Vector3(spot.x, 0, spot.z)
                    };
                    // Si otro jugador ya lo reclamo antes de generar este chunk,
                    // nace directamente recogido para este cliente
                    if (this.claimedPickupIds.has(data.id)) data.collected = true;
                    this.pickupById.set(data.id, data);
                    if (it.type === 'chalk') { data.color = it.color; data.colorName = it.colorName; }
                    if (it.type === 'note') { data.noteIndex = it.noteIndex; data.text = NOTE_POOL[it.noteIndex]; data.wall = it.wall || null; }
                    this.pickupData.push(data);
                    ch.pickupList.push(data);
                }
            }

            // Materializa los que aun no se han recogido
            for (const p of ch.pickupList) {
                if (p.collected || p.mesh) continue;
                p.mesh = this.buildPickupMesh(p);
            }
        }

        // Un objeto reclamado por red (otro jugador lo recogio): desaparece
        // para todos. Si el chunk aun no se ha generado, el id queda marcado y
        // el objeto nace recogido cuando se cree.
        markPickupCollected(id) {
            if (id == null) return;
            this.claimedPickupIds.add(id);
            const p = this.pickupById.get(id);
            if (!p || p.collected) return;
            p.collected = true;
            if (p.mesh) {
                this.scene.remove(p.mesh);
                p.mesh = null;
            }
            this.rebuildUnions();
        }
    }