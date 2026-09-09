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
        // Materiales de la cabina de seguridad: no son papel pintado suelto,
        // sino paneles metalicos oscuros con remates visibles. La estructura
        // se monta dentro del bolsillo y sus cajas se anaden a la colision.
        securityWall: new THREE.MeshStandardMaterial({ color: 0x55585a, metalness: 0.48, roughness: 0.68 }),
        securityTrim: new THREE.MeshStandardMaterial({ color: 0x24282b, metalness: 0.78, roughness: 0.38 }),
        securityFloor: new THREE.MeshStandardMaterial({ color: 0x242927, metalness: 0.22, roughness: 0.86 }),
        securityCeiling: new THREE.MeshStandardMaterial({ color: 0x303437, metalness: 0.4, roughness: 0.72 }),
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
    // Las paredes son cajas UNITARIAS escaladas por instancia: con las UVs
    // 0..1 de fabrica, la textura se estiraba una sola vez en cada cara y
    // los postes/tramos cortos mostraban el papel pintado a otra escala que
    // las paredes vecinas ("una parte mal hecha de la textura"). Se escala
    // la UV por el tamanio real de la instancia: el papel se repite cada
    // 2,8 m (una celda) en horizontal y mantiene el zocalo en vertical en
    // TODAS las caras, sea cual sea el largo de la lamina o el poste.
    Materials.wall.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>
            #ifdef USE_INSTANCING
            vec3 _instScale = vec3(
                length(vec3(instanceMatrix[0].x, instanceMatrix[1].x, instanceMatrix[2].x)),
                length(vec3(instanceMatrix[0].y, instanceMatrix[1].y, instanceMatrix[2].y)),
                length(vec3(instanceMatrix[0].z, instanceMatrix[1].z, instanceMatrix[2].z))
            );
            vUv = uv * vec2(_instScale.x / 2.8, _instScale.y / 2.66);
            #endif`
        );
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

    // Colores de pintura de las puertas falsas (señuelos)
    const DOOR_PAINTS = [0x6d7a8a, 0x8a7a5c, 0x5c6d8a, 0x7a5c5c, 0x5c7a6d, 0x8a8a6a];

    // Textura de las FLECHAS-GRAFITI de las paredes: una flecha grande
    // pintada a mano (contorno doble + grano de pintura), sin texto. Se usa
    // en lugar de las antiguas flechas del suelo (que no parecian grafitis y
    // habia que mirar al suelo para seguirlas). Material basico: se ve
    // tambien en las zonas de apagon.
    const wallArrowTexCache = new Map();
    function wallArrowTexture(colorHex) {
        let tex = wallArrowTexCache.get(colorHex);
        if (tex) return tex;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 256, 128);
        const rng = mulberry32(0x5EED + (parseInt(colorHex.slice(1), 16) || 0));
        const draw = (w, style) => {
            ctx.lineWidth = w;
            ctx.strokeStyle = style;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(26, 64);
            ctx.lineTo(196, 64);
            ctx.moveTo(148, 22);
            ctx.lineTo(214, 64);
            ctx.lineTo(148, 106);
            ctx.stroke();
        };
        // Trazo doble desfasado: efecto spray/desgaste
        ctx.save();
        ctx.translate((rng() - 0.5) * 3, (rng() - 0.5) * 3);
        draw(22, 'rgba(10, 10, 8, 0.5)');
        ctx.restore();
        ctx.save();
        ctx.translate((rng() - 0.5) * 3, (rng() - 0.5) * 3);
        draw(14, colorHex);
        ctx.restore();
        // Grano de pintura gastada
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = colorHex;
        for (let i = 0; i < 140; i++) {
            ctx.fillRect((rng() - 0.5) * 230, (rng() - 0.5) * 110, 1 + rng() * 1.8, 1 + rng() * 1.8);
        }
        ctx.globalAlpha = 1;
        tex = new THREE.CanvasTexture(canvas);
        wallArrowTexCache.set(colorHex, tex);
        return tex;
    }

    // Textos de los grafitis-guia hacia las puertas falsas
    const GUIDE_TEXTS = ['SALIDA', 'POR AQUI', 'EXIT', 'ALLI', 'AQUI'];
    const guideTexCache = new Map();
    // La flecha del plano apunta a lo largo de la pared hacia la puerta: si
    // la puerta queda a la IZQUIERDA (flip), la textura se genera ESPEJADA
    // (texto legible a la derecha y flecha apuntando a la izquierda). Antes
    // se rotaba el plano 180 grados y el texto salia boca abajo ("POR AQUI
    // al reves").
    function guideArrowTexture(text, colorHex, flip) {
        const ck = text + '|' + colorHex + (flip ? '|F' : '');
        let tex = guideTexCache.get(ck);
        if (tex) return tex;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 256, 128);
        // Texto a un lado, flecha grande apuntando hacia el otro
        ctx.font = '900 46px "Segoe Print", "Comic Sans MS", "Marker Felt", cursive';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = colorHex;
        if (flip) {
            ctx.textAlign = 'right';
            ctx.globalAlpha = 0.4;
            ctx.fillText(text, 244, 62);
            ctx.globalAlpha = 0.95;
            ctx.fillText(text, 248, 60);
            ctx.globalAlpha = 1;
        } else {
            ctx.textAlign = 'left';
            ctx.globalAlpha = 0.4;
            ctx.fillText(text, 16, 62);
            ctx.globalAlpha = 0.95;
            ctx.fillText(text, 12, 60);
            ctx.globalAlpha = 1;
        }
        const drawArrow = (w, style) => {
            ctx.save();
            if (flip) { ctx.translate(384, 0); ctx.scale(-1, 1); }
            ctx.lineWidth = w;
            ctx.strokeStyle = style;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(150, 64);
            ctx.lineTo(230, 64);
            ctx.moveTo(196, 34);
            ctx.lineTo(234, 64);
            ctx.lineTo(196, 94);
            ctx.stroke();
            ctx.restore();
        };
        drawArrow(15, 'rgba(10, 10, 8, 0.55)');
        drawArrow(10, colorHex);
        tex = new THREE.CanvasTexture(canvas);
        guideTexCache.set(ck, tex);
        return tex;
    }

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
            this._arrowCells = new Set();     // flechas-grafiti de pared ya colocadas (dedup por celda+cara)
            this._arrowDoorCount = new Map(); // flechas colocadas por puerta (limite de 3)
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

        // Mapa compartido: devuelve la disposicion determinista (grid, salas,
        // puertas) de un chunk SIN construir mallas ni cargarlo en la escena.
        // La generacion solo usa el rng del chunk y campos de ruido puros, asi
        // que misma semilla -> mismo layout para todos los jugadores.
        getLayout(cx, cz) {
            const ch = {
                key: cx + ',' + cz,
                cx, cz,
                loaded: false,
                grid: null,
                rooms: [],
                openCells: [],
                doorCells: [],
                rng: mulberry32(hash2(cx, cz))
            };
            this.generateLayout(ch);
            return ch;
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
                    occ: [],            // ocupacion de muebles de ESTE chunk (colocar)
                    arrowKeys: [],      // claves de flechas colocadas (dedup por celda)
                    arrowDoorKeys: [],  // puerta de cada flecha (recuento por puerta)
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
            // Las cajas de colision SE CONSERVAN al descargar: son datos
            // deterministas y el MAPA las dibuja (muros reales tambien en
            // chunks lejanos). Al recargar, buildChunkMeshes las regenera
            // desde cero (las resetea al empezar), asi no se duplican.
            // ch.wallBoxes NO se limpia aqui (antes el mapa caia a la
            // aproximacion por rejilla y dibujaba muros que no existian).
            // Las flechas-grafiti de las paredes las limpia el chunk que las
            // contiene: se liberan sus claves de dedup (celda y recuento de
            // su puerta) para que al recargar se puedan volver a colocar sin
            // apilarse.
            const ak = ch.arrowKeys || [];
            const adk = ch.arrowDoorKeys || [];
            for (let i = 0; i < ak.length; i++) {
                this._arrowCells.delete(ak[i]);
                const dk = adk[i];
                if (dk) {
                    const c = (this._arrowDoorCount.get(dk) || 1) - 1;
                    if (c <= 0) this._arrowDoorCount.delete(dk);
                    else this._arrowDoorCount.set(dk, c);
                }
            }
            ch.arrowKeys = [];
            ch.arrowDoorKeys = [];
            // Los objetos guardan su estado: al recargar el chunk reaparecen
            for (const p of ch.pickupList) {
                if (p.mesh) {
                    // Los objetos de cajon son hijos del cajon, no de la escena
                    (p.mesh.parent || this.scene).remove(p.mesh);
                    p.mesh = null;
                }
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
            // Tabiques inclinados de los chunks cargados (para la IA de la
            // entidad y para la colision EXACTA del jugador)
            this.slantedAABBs = [];
            this.slantedSlabs = [];
            // Cajas-segmento de los tabiques: el jugador y la entidad las
            // SALTAN en su colision AABB (usarian la escalera de cuadrados y
            // se quedarian a ~0,8 m de la cara real; la colision exacta con
            // el rectangulo rotado las sustituye). Set por referencia: son
            // los MISMO objetos que entran en wallBoxes.
            this.slantedBoxSet = new Set();
            this.cameras = [];
            this.securityRooms = [];
            for (const ch of this.chunks.values()) {
                if (!ch.loaded) continue;
                if (ch.slantedAABBs) this.slantedAABBs.push(...ch.slantedAABBs);
                if (ch.slantedWalls) this.slantedSlabs.push(...ch.slantedWalls);
                if (ch.slantedBoxes) for (const b of ch.slantedBoxes) this.slantedBoxSet.add(b);
                if (ch.cameras) this.cameras.push(...ch.cameras);
                if (ch.securityRooms) this.securityRooms.push(...ch.securityRooms);
                // Puerta de metal CERRADA = caja de colision: bloquea al
                // jugador, a los muebles y a la entidad (linea de vision 2D)
                for (const r of ch.securityRooms || []) {
                    if (!r.state.doorOpen && r.doorBox) wallBoxes.push(r.doorBox);
                }
            }
        }

        // True si el punto (mundo, XZ) cae dentro de un tabique inclinado.
        // Prueba EXACTA contra el rectangulo rotado (antes usaba la AABB
        // envolvente del tabique entero: para un tabique a 45 grados la AABB
        // es un cuadrado ~2x mas grande que la pared, y la entidad evitaba
        // las esquinas del cuadrado aunque fueran suelo libre).
        pointInSlab(x, z) {
            const slabs = this.slantedSlabs;
            if (slabs && slabs.length) {
                for (const s of slabs) {
                    const dx = x - s.cx, dz = z - s.cz;
                    const cos = Math.cos(s.ang), sin = Math.sin(s.ang);
                    const lx = dx * cos - dz * sin;
                    const lz = dx * sin + dz * cos;
                    if (Math.abs(lx) <= Math.max(s.T0, s.T1) / 2 && Math.abs(lz) <= s.L / 2) return true;
                }
                return false;
            }
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

            // ---- 3d) SALA DE SEGURIDAD (rara): bolsillo sellado con UNA sola
            // boca, donde va la puerta de metal. Se busca DESPUES de todo el
            // tallado (la conectividad ya esta garantizada: el bolsillo se
            // une por su unica entrada) ----
            this.carveSecurityRoom(ch);

            // ---- 4) Celdas transitables (coordenadas de mundo) ----
            // Se incluyen TAMBIEN las columnas/filas de borde (0 y N-1): son
            // suelo real por el que camina el jugador (las puertas entre
            // chunks se tallan en x=0/15). Antes se saltaban y el grafo de
            // celdas de la ENTIDAD no podia cruzar de un chunk a otro: el
            // BFS se quedaba sin camino en cuanto el destino estaba en otro
            // chunk y la entidad se quedaba QUIETA ("la entidad no se
            // mueve").
            for (let x = 0; x < N; x++) {
                for (let z = 0; z < N; z++) {
                    if (g[x][z] === 0 || g[x][z] === 2) {
                        ch.openCells.push({ x: ch.cx * N + x, z: ch.cz * N + z });
                    }
                }
            }
        }

        // SALA DE SEGURIDAD (estilo FNAF): busca un bolsillo de pared con
        // EXACTAMENTE una celda abierta en el anillo (la futura boca de la
        // puerta de metal) y lo convierte en habitacion sellada. Antes era
        // muy rara (~1 de cada 24 chunks) y el requisito de la boca unica
        // hacia que la mayoria de intentos fracasaran (~1 de cada 40 de
        // verdad). Ahora, si no hay bolsillo con 1 boca, se usa uno
        // totalmente sellado (0 bocas) y se TALLA la puerta en una celda del
        // anillo que de a una celda transitable. Resultado real: ~1 de cada
        // 8-9 chunks. La puerta en si la monta buildSecurityRoom.
        carveSecurityRoom(ch) {
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const r = ch.rng;
            // Las salas pequenas se cuelan en casi cualquier bolsillo de
            // pared: con el 25% de antes salian ~1 de cada 4 chunks (demasiado
            // comunes para un refugio raro). Con 0.15 vuelven a ~1 de cada 7.
            if (r() >= 0.15) return;
            // Cabina PEQUENA y ESTRECHA a proposito: 1x2, 2x1 o 1x3
            // celdas (2,8x5,6 m como maximo). Antes eran 2x2/2x3/3x2 y,
            // al no tener una carcasa propia, parecian una sala abierta con
            // tres pantallas flotando.
            const sizes = [[1, 2], [2, 1], [1, 3]];
            const order = [0, 1, 2];
            for (let i = order.length - 1; i > 0; i--) {
                const j = Math.floor(r() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            for (const oi of order) {
                const [w, h] = sizes[oi];
                const spots = [];    // bolsillos con 1 boca (FNAF perfecto)
                const sealed = [];   // bolsillos sellados con boca tallable
                for (let rx = 3; rx <= N - 3 - w; rx++) {
                    for (let rz = 3; rz <= N - 3 - h; rz++) {
                        let interiorWall = true;
                        for (let dx = 0; dx < w && interiorWall; dx++) {
                            for (let dz = 0; dz < h && interiorWall; dz++) {
                                const v = g[rx + dx][rz + dz];
                                if (v !== 1 && v !== 3) interiorWall = false;
                            }
                        }
                        if (!interiorWall) continue;
                        const ringOpen = [];
                        // Una celda del anillo es esquina si no comparte fila
                        // ni columna con el interior del bolsillo. Una puerta
                        // en esquina quedaria DIAGONAL al interior (callejon
                        // sin salida de 1 celda): prohibida.
                        const cornerOk = (px, pz) => {
                            const inRow = pz >= rz && pz < rz + h;
                            const inCol = px >= rx && px < rx + w;
                            if (px === rx - 1 || px === rx + w) return inRow;
                            if (pz === rz - 1 || pz === rz + h) return inCol;
                            return false;
                        };
                        for (let dx = -1; dx <= w; dx++) {
                            for (let dz = -1; dz <= h; dz++) {
                                if (dx >= 0 && dx < w && dz >= 0 && dz < h) continue;
                                const px = rx + dx, pz = rz + dz;
                                if (px < 1 || px > N - 2 || pz < 1 || pz > N - 2) continue;
                                const v = g[px][pz];
                                if (v === 0 || v === 2) ringOpen.push([px, pz, cornerOk(px, pz)]);
                            }
                        }
                        if (ringOpen.length === 1 && ringOpen[0][2]) {
                            spots.push([rx, rz, w, h, [ringOpen[0][0], ringOpen[0][1]]]);
                        } else if (ringOpen.length === 0 || (ringOpen.length === 1 && !ringOpen[0][2])) {
                            // Sellado (o solo abierto en una esquina, que no
                            // conecta con el interior): tallar la puerta en
                            // una celda NO-esquina del anillo cuya cara
                            // exterior de a una celda transitable (si no, el
                            // jugador no podria entrar)
                            for (let dx = -1; dx <= w; dx++) {
                                for (let dz = -1; dz <= h; dz++) {
                                    if (dx >= 0 && dx < w && dz >= 0 && dz < h) continue;
                                    const px = rx + dx, pz = rz + dz;
                                    if (px < 1 || px > N - 2 || pz < 1 || pz > N - 2) continue;
                                    if (g[px][pz] !== 1 && g[px][pz] !== 3) continue;
                                    if (!cornerOk(px, pz)) continue;
                                    const ox = px < rx ? px - 1 : px >= rx + w ? px + 1 : px;
                                    const oz = pz < rz ? pz - 1 : pz >= rz + h ? pz + 1 : pz;
                                    if (ox < 1 || ox > N - 2 || oz < 1 || oz > N - 2) continue;
                                    const v = g[ox][oz];
                                    if (v === 0 || v === 2) {
                                        sealed.push([rx, rz, w, h, [px, pz]]);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                let chosen = null;
                if (spots.length) chosen = spots[Math.floor(r() * spots.length)];
                else if (sealed.length) chosen = sealed[Math.floor(r() * sealed.length)];
                if (!chosen) continue;
                const [rx2, rz2, rw2, rh2, doorCell] = chosen;
                for (let dx = 0; dx < rw2; dx++) {
                    for (let dz = 0; dz < rh2; dz++) g[rx2 + dx][rz2 + dz] = 2;
                }
                g[doorCell[0]][doorCell[1]] = 0;   // la boca de la puerta
                ch.securityRoom = {
                    rx: rx2, rz: rz2, w: rw2, h: rh2,
                    doorX: doorCell[0], doorZ: doorCell[1],
                    state: { battery: 100, doorOpen: true }
                };
                return;
            }
        }

        rollRoomSize(r) {
            // Zonas PEQUENAS, MEDIANAS y GRANDES bien repartidas: antes la
            // mezcla dejaba demasiadas salas enormes con aire vacio.
            const roll = r();
            if (roll < 0.4) return 3 + Math.floor(r() * 2);   // 3-4 pequena (40%)
            if (roll < 0.8) return 4 + Math.floor(r() * 2);   // 4-5 mediana (40%)
            return 5 + Math.floor(r() * 2);                   // 5-6 grande (20%)
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

        // Pasillo en L entre dos celdas locales. El ancho puede CAMBIAR a
        // mitad de camino: no todos los pasillos tienen el mismo tamano en
        // todo su recorrido (un tramo estrecho puede ensancharse y viceversa).
        carvePath(ch, x0, z0, x1, z1, width) {
            x1 = Math.max(1, Math.min(CHUNK_SIZE - 2, x1));
            z1 = Math.max(1, Math.min(CHUNK_SIZE - 2, z1));
            let w2 = width;
            if (ch.rng() < 0.55) {
                const v = ch.rng();
                if (width === 1) w2 = v < 0.65 ? 1 : 2;
                else if (width === 3) w2 = v < 0.7 ? 3 : 2;
                else w2 = v < 0.35 ? 1 : (v < 0.8 ? 2 : 3);
            }
            let cx = x0, cz = z0;
            this.openCell(ch, cx, cz, width);
            const horizFirst = ch.rng() < 0.5;
            if (horizFirst) {
                while (cx !== x1) { cx += Math.sign(x1 - cx); this.openCell(ch, cx, cz, width); }
                while (cz !== z1) { cz += Math.sign(z1 - cz); this.openCell(ch, cx, cz, w2); }
            } else {
                while (cz !== z1) { cz += Math.sign(z1 - cz); this.openCell(ch, cx, cz, width); }
                while (cx !== x1) { cx += Math.sign(x1 - cx); this.openCell(ch, cx, cz, w2); }
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

            const wall = (x, z) => x >= 2 && x <= N - 3 && z >= 2 && z <= N - 3 && (g[x][z] === 1 || g[x][z] === 3);

            for (const s of starts) {
                const d = s.d;
                const perp = d[0] === 0 ? [1, 0] : [0, 1];
                const variant = r();

                // ---- VARIANTE RECTA (callejon corto de 1-2 celdas) ----
                if (variant < 0.2) {
                    const len = 1 + Math.floor(r() * 2);
                    const cells = [];
                    let ok = true;
                    for (let t = 1; t <= len && ok; t++) {
                        const nx = s.x + d[0] * t, nz = s.z + d[1] * t;
                        if (!wall(nx, nz)) { ok = false; break; }
                        cells.push([nx, nz]);
                    }
                    if (!ok) continue;
                    const tx = cells[cells.length - 1][0], tz = cells[cells.length - 1][1];
                    if (!wall(tx + d[0], tz + d[1])) continue;               // fondo sellado
                    if (!wall(tx + perp[0], tz + perp[1]) || !wall(tx - perp[0], tz - perp[1])) continue;
                    for (const [cx2, cz2] of cells) this.openCell(ch, cx2, cz2, 1);
                    return;
                }

                // ---- VARIANTE EN L: el callejon gira 90 grados antes de morir ----
                if (variant < 0.4) {
                    const len1 = 1 + Math.floor(r() * 2);
                    const len2 = 1 + Math.floor(r() * 2);
                    const sgn = r() < 0.5 ? 1 : -1;
                    const t2 = [perp[0] * sgn, perp[1] * sgn];
                    const leg1 = [], leg2 = [];
                    let ok = true;
                    for (let t = 1; t <= len1 && ok; t++) {
                        const nx = s.x + d[0] * t, nz = s.z + d[1] * t;
                        if (!wall(nx, nz)) { ok = false; break; }
                        leg1.push([nx, nz]);
                    }
                    if (!ok) continue;
                    const bx = leg1[leg1.length - 1][0], bz = leg1[leg1.length - 1][1];
                    for (let t = 1; t <= len2 && ok; t++) {
                        const nx = bx + t2[0] * t, nz = bz + t2[1] * t;
                        if (!wall(nx, nz)) { ok = false; break; }
                        leg2.push([nx, nz]);
                    }
                    if (!ok) continue;
                    const tx = leg2[leg2.length - 1][0], tz = leg2[leg2.length - 1][1];
                    // Fondo de la L sellado: delante, a los lados y en la
                    // diagonal exterior del giro
                    if (!wall(tx + t2[0], tz + t2[1])) continue;
                    if (!wall(tx + perp[0], tz + perp[1]) || !wall(tx - perp[0], tz - perp[1])) continue;
                    if (!wall(bx + t2[0] + perp[0] * -sgn, bz + t2[1] + perp[1] * -sgn)) continue;
                    for (const [cx2, cz2] of leg1) this.openCell(ch, cx2, cz2, 1);
                    for (const [cx2, cz2] of leg2) this.openCell(ch, cx2, cz2, 1);
                    return;
                }

                // ---- VARIANTE ANCHA: pasillo de 2 celdas ----
                if (variant < 0.52) {
                    const len = 1 + Math.floor(r() * 2);
                    const lane = [];
                    let ok = true;
                    for (let t = 1; t <= len && ok; t++) {
                        const a = [s.x + d[0] * t, s.z + d[1] * t];
                        const b = [a[0] + perp[0], a[1] + perp[1]];
                        if (!wall(a[0], a[1]) || !wall(b[0], b[1])) { ok = false; break; }
                        lane.push([a, b]);
                    }
                    if (!ok) continue;
                    const ta = lane[lane.length - 1][0], tb = lane[lane.length - 1][1];
                    if (!wall(ta[0] + d[0], ta[1] + d[1]) || !wall(tb[0] + d[0], tb[1] + d[1])) continue;
                    if (!wall(ta[0] - perp[0], ta[1] - perp[1]) || !wall(tb[0] + perp[0], tb[1] + perp[1])) continue;
                    for (const [a, b] of lane) {
                        this.openCell(ch, a[0], a[1], 1);
                        this.openCell(ch, b[0], b[1], 1);
                    }
                    return;
                }

                // ---- VARIANTE ALCOBA: bolsillo lateral de 2 celdas al fondo ----
                if (variant < 0.68) {
                    const len = 1 + Math.floor(r() * 2);
                    const sgn = r() < 0.5 ? 1 : -1;
                    const cells = [];
                    let ok = true;
                    for (let t = 1; t <= len && ok; t++) {
                        const nx = s.x + d[0] * t, nz = s.z + d[1] * t;
                        if (!wall(nx, nz)) { ok = false; break; }
                        cells.push([nx, nz]);
                    }
                    if (!ok) continue;
                    const tx = cells[cells.length - 1][0], tz = cells[cells.length - 1][1];
                    // La alcoba: dos celdas a un lado del fondo
                    const a1 = [tx + perp[0] * sgn, tz + perp[1] * sgn];
                    const a2 = [a1[0] + d[0], a1[1] + d[1]];
                    if (!wall(a1[0], a1[1]) || !wall(a2[0], a2[1])) continue;
                    if (!wall(tx + d[0], tz + d[1])) continue;                    // fondo
                    if (!wall(a2[0] + d[0], a2[1] + d[1])) continue;            // fondo de la alcoba
                    if (!wall(a2[0] + perp[0] * sgn, a2[1] + perp[1] * sgn)) continue;  // lado exterior
                    for (const [cx2, cz2] of cells) this.openCell(ch, cx2, cz2, 1);
                    this.openCell(ch, a1[0], a1[1], 1);
                    this.openCell(ch, a2[0], a2[1], 1);
                    return;
                }

                // ---- VARIANTE HABITACION MUERTA (3x3/4x4, a veces con pilar
                // dentro: obliga a dar la vuelta rodeandolo) ----
                const len = 1 + Math.floor(r() * 2);
                const cells = [];
                let ok = true;
                for (let t = 1; t <= len && ok; t++) {
                    const nx = s.x + d[0] * t, nz = s.z + d[1] * t;
                    if (!wall(nx, nz)) { ok = false; break; }
                    cells.push([nx, nz]);
                }
                if (!ok) continue;
                const tx = cells[cells.length - 1][0], tz = cells[cells.length - 1][1];
                if (!wall(tx + d[0], tz + d[1])) continue;
                if (!wall(tx + perp[0], tz + perp[1]) || !wall(tx - perp[0], tz - perp[1])) continue;
                for (const [cx2, cz2] of cells) this.openCell(ch, cx2, cz2, 1);
                const rw = r() < 0.5 ? 3 : 4;
                const rh = r() < 0.5 ? 3 : 4;
                const hx = tx + d[0];
                const hz = tz + d[1];
                let roomOk = true;
                for (let dx = -1; dx <= rw && roomOk; dx++) {
                    for (let dz = -1; dz <= rh && roomOk; dz++) {
                        if (dx >= 0 && dx < rw && dz >= 0 && dz < rh) continue;
                        const rx = hx + dx, rz = hz + dz;
                        if (rx < 1 || rx >= N - 1 || rz < 1 || rz >= N - 1) { roomOk = false; break; }
                        if (rx === tx && rz === tz) continue;
                        if (!wall(rx, rz)) roomOk = false;
                    }
                }
                if (roomOk) {
                    for (let dx = 0; dx < rw; dx++) {
                        for (let dz = 0; dz < rh; dz++) g[hx + dx][hz + dz] = 2;
                    }
                    ch.rooms.push({ x: hx, z: hz, w: rw, h: rh });
                    // A veces un pilar dentro: la habitacion te obliga a
                    // rodearlo para volver por donde entraste
                    if (r() < 0.4 && rw >= 4 && rh >= 4) {
                        g[hx + 1 + Math.floor(r() * (rw - 2))][hz + 1 + Math.floor(r() * (rh - 2))] = 3;
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
            // Salones 4-6 (antes 5-7): menos campo abierto, mas mesas/pilares
            const w = 4 + Math.floor(r() * 3);
            const h = 4 + Math.floor(r() * 3);
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

            // Las cajas se regeneran en CADA construccion (tambien en las
            // recargas) y se CONSERVAN al descargar: el mapa las dibuja como
            // muros reales aunque el chunk este lejos.
            ch.wallBoxes = [];
            ch.slantedAABBs = [];
            // Datos de los tabiques inclinados para que el MAPA los dibuje
            // con su angulo real (no como cajas cuadradas): se conservan al
            // descargar, igual que wallBoxes.
            ch.slantedWalls = [];
            // Cajas AABB de colision POR SEGMENTO de los tabiques inclinados:
            // el mapa las SALTA (solo dibuja el rectangulo rotado) y la
            // colision del jugador usa la geometria exacta del tabique.
            ch.slantedBoxes = [];

            // RNG PROPIO DE CADA CONSTRUCCION. La rejilla (generateLayout)
            // se genera UNA sola vez por chunk, pero las MALLAS se
            // reconstruyen en cada carga. Si se usara ch.rng (el mismo de la
            // rejilla), la segunda construccion leia la secuencia YA
            // consumida y los grosores de pared y las curvas cambiaban en
            // cada recarga: el mundo no era estable ("hay paredes y cosas
            // que yo veo y otros no", flechas que se movian solas...).
            const buildRng = mulberry32((hash2(ch.cx, ch.cz) ^ 0x6A09E667) >>> 0);
            ch.buildRng = buildRng;

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

            const wallT = [], cylT = [];
            const frameT = [], capT = [], offB = [], flickB = [], litB = [];   // lamparas: carcasa + casquillos + tubo por estado
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
            // Grosor por tramo recto: celdas contiguas de la misma orientacion
            // comparten T. Variedad por CATEGORIAS: finas (0,3-0,45), normales
            // (0,55-0,85) y gruesas (0,95-1,3) en vez de un grosor uniforme
            // que hace todas las paredes parecidas.
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    const k = key(x, z);
                    const kind = wallKind.get(k);
                    if (!kind || kind === 'border' || kind === 'post' || wallTMap.has(k)) continue;
                    const rv = buildRng();
                    const T = rv < 0.25 ? 0.3 + buildRng() * 0.15    // fina
                        : rv < 0.7 ? 0.55 + buildRng() * 0.3         // normal
                        : 0.95 + buildRng() * 0.35;                  // muy gruesa
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
            // Tamanio de esquinas y FINALES de pared: cada EJE adopta el grosor
            // de la pared que conecta por ese eje (antes se usaba el maximo de
            // los dos, asi que junto a una pared fina el poste sobresalia como
            // un cuadrado). Ahora la union es un rectangulo enrasado con las
            // dos paredes, y un final de pared queda como un remate del mismo
            // grosor que la propia pared. Los postes guardan {rx, rz} (medio
            // grosor por eje); las paredes guardan un numero.
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    const k = key(x, z);
                    if (wallKind.get(k) === 'post' && !wallTMap.has(k)) {
                        let mx = 0, mz = 0;
                        for (const [dx, dz] of [[1, 0], [-1, 0]]) {
                            const nk = wallKind.get(key(x + dx, z + dz));
                            if (nk === 'x' || nk === 'z') mx = Math.max(mx, wallTMap.get(key(x + dx, z + dz)) || 0);
                        }
                        for (const [dx, dz] of [[0, 1], [0, -1]]) {
                            const nk = wallKind.get(key(x + dx, z + dz));
                            if (nk === 'x' || nk === 'z') mz = Math.max(mz, wallTMap.get(key(x + dx, z + dz)) || 0);
                        }
                        // Sin pared en un eje, el remate es cuadrado del mismo
                        // grosor del otro (enrasado); R_POST es solo respaldo
                        const rx = mx > 0 ? mx / 2 : (mz > 0 ? mz / 2 : R_POST);
                        const rz = mz > 0 ? mz / 2 : (mx > 0 ? mx / 2 : R_POST);
                        wallTMap.set(k, { rx, rz });
                    }
                }
            }
            // Medio grosor de un poste en el eje pedido (los postes guardan
            // {rx, rz}; las paredes y juntas guardan un numero)
            const postHalf = (k, axis) => {
                const v = wallTMap.get(k);
                if (v && typeof v === 'object') return axis === 'x' ? v.rx : v.rz;
                return v || 0.4;
            };
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
                if (nk === 'post') { const r = postHalf(key(nx, nz), 'x'); return side === 'west' ? nxc - r + 0.05 : nxc + r - 0.05; }
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
                if (nk === 'post') { const r = postHalf(key(nx, nz), 'z'); return side === 'north' ? nzc - r + 0.05 : nzc + r - 0.05; }
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
                            // (nunca se ve ni se alcanza). PERO si la celda asoma
                            // a una esquina de espacio abierto (sala o pasillo),
                            // el bloque entero sobresaldria ~1,5-2 m dentro de la
                            // sala como un pilar cuadrado: se RECORTA en dos
                            // laminas enrasadas con las paredes contiguas (sus
                            // caras visibles caen en el MISMO plano que las
                            // paredes, asi la esquina queda limpia; el resto de
                            // la celda queda como hueco sellado e invisible).
                            let cut = null;
                            for (const [ddx, ddz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
                                if (open(x + ddx, z + ddz)) { cut = [ddx, ddz]; break; }
                            }
                            if (cut) {
                                const sx = cut[0], sz = cut[1];
                                // Pared A: la celda (x, z+sz) a lo largo de Z;
                                // pared B: la celda (x+sx, z) a lo largo de X.
                                // Solo se recorta si ambas son tramos rectos
                                // reales con grosor conocido.
                                const TA = wallTMap.get(key(x, z + sz));
                                const TB = wallTMap.get(key(x + sx, z));
                                const taO = !!TA && typeof TA === 'object';
                                const tbO = !!TB && typeof TB === 'object';
                                if ((typeof TA === 'number' || taO) && (typeof TB === 'number' || tbO)) {
                                    // Cara de la pared A hacia la sala: misma
                                    // formula que las cajas del bucle principal
                                    // (si la celda es un poste de puerta, su
                                    // cara es posX +/- su medio grosor)
                                    let faceA = null;
                                    if (taO) faceA = posX + (sx === 1 ? TA.rx : -TA.rx);
                                    else if (open(x - 1, z + sz) && open(x + 1, z + sz)) faceA = posX + (sx === 1 ? TA / 2 : -TA / 2);
                                    else if (sx === 1 && open(x + 1, z + sz)) faceA = faceX(x - 1, z + sz, 'east') + TA;
                                    else if (sx === -1 && open(x - 1, z + sz)) faceA = faceX(x + 1, z + sz, 'west') - TA;
                                    // Cara de la pared B hacia la sala
                                    let faceB = null;
                                    if (tbO) faceB = posZ + (sz === 1 ? TB.rz : -TB.rz);
                                    else if (open(x + sx, z - 1) && open(x + sx, z + 1)) faceB = posZ + (sz === 1 ? TB / 2 : -TB / 2);
                                    else if (sz === 1 && open(x + sx, z + 1)) faceB = faceZ(x + sx, z - 1, 'south') + TB;
                                    else if (sz === -1 && open(x + sx, z - 1)) faceB = faceZ(x + sx, z + 1, 'north') - TB;
                                    // Las caras deben caer DENTRO de la celda:
                                    // los tramos pegados a la junta de chunk se
                                    // anclan en la junta y su cara se sale de la
                                    // celda (ahí no se puede recortar)
                                    if (faceA !== null && faceB !== null &&
                                        faceA > posX - C / 2 + 0.05 && faceA < posX + C / 2 - 0.05 &&
                                        faceB > posZ - C / 2 + 0.05 && faceB < posZ + C / 2 - 0.05) {
                                        // Lamina A: toda la celda en Z, de la
                                        // cara A hacia el lado cerrado
                                        box = sx === 1
                                            ? { minX: posX - C / 2, maxX: faceA, minZ: posZ - C / 2, maxZ: posZ + C / 2 }
                                            : { minX: faceA, maxX: posX + C / 2, minZ: posZ - C / 2, maxZ: posZ + C / 2 };
                                        // Lamina B: toda la celda en X, de la
                                        // cara B hacia el lado cerrado
                                        extraBoxes.push(sz === 1
                                            ? { minX: sx === 1 ? faceA : posX - C / 2, maxX: sx === 1 ? posX + C / 2 : faceA, minZ: posZ - C / 2, maxZ: faceB }
                                            : { minX: sx === 1 ? faceA : posX - C / 2, maxX: sx === 1 ? posX + C / 2 : faceA, minZ: faceB, maxZ: posZ + C / 2 });
                                    }
                                }
                            }
                            if (!box) {
                                box = { minX: posX - C / 2, maxX: posX + C / 2, minZ: posZ - C / 2, maxZ: posZ + C / 2 };
                            }
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
                                const pr = wallTMap.get(k) || R_POST;
                                const prx = typeof pr === 'object' ? pr.rx : pr;   // medio grosor en X
                                const prz = typeof pr === 'object' ? pr.rz : pr;   // medio grosor en Z
                                const jb = { minX: posX - prx, maxX: posX + prx, minZ: posZ - prz, maxZ: posZ + prz };
                                dummy.position.set(posX, WALL_HEIGHT / 2, posZ);
                                dummy.scale.set(prx * 2, WALL_HEIGHT - 0.04, prz * 2);
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
                                box.maxZ += extTo(pS, postHalf(key(x, z + 1), 'z'), box.maxZ, posZ, g[x][N - 1] === 1);
                                box.minZ -= extTo(pN, postHalf(key(x, z - 1), 'z'), box.minZ, posZ, g[x][0] === 1);
                            } else {
                                box.maxX += extTo(pE, postHalf(key(x + 1, z), 'x'), box.maxX, posX, g[N - 1][z] === 1);
                                box.minX -= extTo(pW, postHalf(key(x - 1, z), 'x'), box.minX, posX, g[0][z] === 1);
                            }
                            // Extension LATERAL: si la lamina queda anclada en el
                            // borde opuesto de su celda y el poste esta centrado,
                            // aun hay hueco en el eje perpendicular. Se alarga la
                            // lamina hasta tocar la caja del poste.
                            if (kind === 'x') {
                                const TpS = pS === 'post' ? postHalf(key(x, z + 1), 'z') : 0;
                                const TpN = pN === 'post' ? postHalf(key(x, z - 1), 'z') : 0;
                                if (TpS && box.maxX < posX - TpS) box.maxX = posX - TpS + 0.05;
                                if (TpS && box.minX > posX + TpS) box.minX = posX + TpS - 0.05;
                                if (TpN && box.maxX < posX - TpN) box.maxX = posX - TpN + 0.05;
                                if (TpN && box.minX > posX + TpN) box.minX = posX + TpN - 0.05;
                            } else {
                                const TpE = pE === 'post' ? postHalf(key(x + 1, z), 'x') : 0;
                                const TpW = pW === 'post' ? postHalf(key(x - 1, z), 'x') : 0;
                                if (TpE && box.maxZ < posZ - TpE) box.maxZ = posZ - TpE + 0.05;
                                if (TpE && box.minZ > posZ + TpE) box.minZ = posZ + TpE - 0.05;
                                if (TpW && box.maxZ < posZ - TpW) box.maxZ = posZ - TpW + 0.05;
                                if (TpW && box.minZ > posZ + TpW) box.minZ = posZ + TpW - 0.05;
                            }
                        }
                        if (box) {
                            dummy.position.set((box.minX + box.maxX) / 2, WALL_HEIGHT / 2, (box.minZ + box.maxZ) / 2);
                            // 2 cm de aire arriba: el techo esta a WALL_HEIGHT y
                            // una caja de esa altura quedaba COPLANAR con el
                            // plano del techo -> z-fighting en el filo superior
                            // de todas las paredes ("el techo no se ve bien").
                            dummy.scale.set(box.maxX - box.minX, WALL_HEIGHT - 0.04, box.maxZ - box.minZ);
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
                            dummy.scale.set(eb.maxX - eb.minX, WALL_HEIGHT - 0.04, eb.maxZ - eb.minZ);
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
                        dummy.scale.set(round ? r : r * 2, WALL_HEIGHT - 0.04, round ? r : r * 2);
                        dummy.updateMatrix();
                        (round ? cylT : wallT).push(dummy.matrix.clone());
                        ch.wallBoxes.push({ minX: posX - r, maxX: posX + r, minZ: posZ - r, maxZ: posZ + r });
                    }

                    if (type === 0 || type === 2) {
                        // LAMPARA DE TECHO REHECHA: luminaria fluorescente de
                        // superficie. La carcasa metalica queda PEGADA al
                        // techo (sin hueco) y el tubo va HORIZONTAL dentro de
                        // ella, asomando un poco por abajo, con casquillos en
                        // los extremos. Antes era una caja flotando a 7 cm del
                        // techo con un cilindro vertical debajo que no parecia
                        // una bombilla. Las fundidas dejan el tubo colgando.
                        const frameM = new THREE.Matrix4();
                        frameM.makeScale(1.6, 0.12, 0.55);
                        frameM.setPosition(posX, WALL_HEIGHT - 0.06, posZ);   // tope superior a ras del techo
                        frameT.push(frameM);

                        // Casquillos de los extremos (donde se monta el tubo)
                        const capM = new THREE.Matrix4();
                        capM.makeScale(0.14, 0.16, 0.56);
                        capM.setPosition(posX - 0.575, WALL_HEIGHT - 0.13, posZ);
                        capT.push(capM);
                        const capM2 = capM.clone();
                        capM2.setPosition(posX + 0.575, WALL_HEIGHT - 0.13, posZ);
                        capT.push(capM2);

                        // Tubo fluorescente HORIZONTAL a lo largo de la
                        // carcasa (antes era un cilindro corto vertical)
                        const bulbM = new THREE.Matrix4();
                        bulbM.makeRotationZ(Math.PI / 2);
                        bulbM.setPosition(posX, WALL_HEIGHT - 0.14, posZ);
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
                        // Bombillas fundidas MENOS comunes: antes una de cada
                        // ~2 lamparas estaba apagada; ahora ~1 de cada 3. Las
                        // zonas "casi todo encendido" ademas son mas raras
                        // (umbral 0.86) para que no haya zonas lavadas.
                        let offP = 0.3, flickP = 0.3;
                        if (lz < 0.18) { offP = 1; flickP = 0; }          // apagon total
                        else if (lz < 0.38) { offP = 0.6; flickP = 0.24; } // tenue
                        else if (lz < 0.86) { /* normal */ }
                        else { offP = 0.16; flickP = 0.3; }               // casi todo encendido (rara)
                        const lr = ch.rng();
                        if (nearDark(x, z) || lr < offP) {
                            // Fundida: el tubo cuelga torcido (aspecto roto);
                            // un extremo se hunde en la carcasa y el otro
                            // queda colgando hacia abajo
                            const broken = bulbM.clone();
                            broken.makeRotationZ(Math.PI / 2 + (ch.rng() - 0.5) * 0.6);
                            broken.setPosition(posX, WALL_HEIGHT - 0.14, posZ);
                            offB.push(broken);
                        } else if (lr < offP + flickP) {
                            flickB.push(bulbM);
                            ch.lamps.push({
                                pos: new THREE.Vector3(posX, WALL_HEIGHT - 0.14, posZ),
                                state: 2,
                                flickerTimer: ch.rng() * 2,
                                isLitNow: true
                            });
                        } else {
                            litB.push(bulbM);
                            ch.lamps.push({
                                pos: new THREE.Vector3(posX, WALL_HEIGHT - 0.14, posZ),
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
            // Luminaria: carcasa + casquillos de metal para TODAS, y el tubo
            // horizontal por estado (fundido oscuro; encendido/parpadeante
            // emisivo, que brilla a traves de la niebla)
            const tubeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.15, 10);
            addInst(frameT, Materials.lampFrame);
            addInst(capT, Materials.lampFrame);
            addInst(offB, Materials.lampOff, tubeGeo);
            addInst(flickB, Materials.lampFlicker, tubeGeo);
            addInst(litB, Materials.lampLit, tubeGeo);

            // ---- GRAFITI en las paredes (100 variantes, blanco/negro/rojo) ----
            // RNG propio del chunk: no altera la generacion del mundo y, con la
            // misma semilla, toda la sala ve exactamente los mismos grafitis.
            this.placeChunkGraffiti(ch, wallKind, key, curvedCells);

            // ---- PUERTAS FALSAS (señuelos a escala: sencillas, dobles y con
            // grafiti) pegadas a caras de pared, para engañar desde lejos ----
            this.placeChunkFakeDoors(ch, wallKind, key, curvedCells);
            // Grafitis-guia GRANDES (flechas + SALIDA/POR AQUI) en las paredes
            // con linea de vision a la puerta: te guian hacia ella
            this.placeChunkGuideGraffiti(ch, wallKind, key, curvedCells);
            // Flechas-GRAFITI pintadas en las paredes que apuntan el camino
            // a esas puertas (sustituyen a las antiguas flechas del suelo)
            this.placeChunkArrowSigns(ch);

            // ---- SALA DE SEGURIDAD (si este chunk la tiene): puerta de
            // metal con pila, panel de control y monitor de camaras ----
            this.buildSecurityRoom(ch);

            // ---- CAMARAS DE SEGURIDAD en las paredes (raras): vigilan al
            // jugador y su imagen se ve en el monitor de la sala de seguridad ----
            this.placeChunkCameras(ch, wallKind, key, curvedCells);

            // ---- PAREDES INCLINADAS (rectas, en angulo) al final: ya estan
            // todas las cajas de colision de muros y pilares para validar que
            // cada tabique deja paso libre por ambos lados. Tres variantes
            // integradas en la generacion: esquinas recortadas de salas,
            // contrafuertes en pasillos y tabiques sueltos en campo abierto ----
            this.placeChunkSlantedWalls(ch, wallKind, key, curvedCells);

            // Flechas de las PUERTAS FALSAS de los chunks vecinos (hasta 2
            // chunks: el radio de colocacion de las flechas): al reconstruir
            // este chunk se recolocan las que habia perdido. El dedup global
            // evita duplicados y el conjunto es determinista (las rejillas
            // usadas son las de los chunks cargados, que son los mismos para
            // todos los jugadores en la misma posicion).
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const n = this.chunks.get((ch.cx + dx) + ',' + (ch.cz + dz));
                    // Solo vecinos CARGADOS: los chunks cargados son los
                    // mismos para todos los jugadores en la misma posicion,
                    // asi el conjunto de flechas es identico para la sala
                    // (un chunk descargado tendria puertas segun el historial
                    // de cada jugador y las flechas variarian entre ellos)
                    if (n && n.loaded && n.fakeDoors && n.fakeDoors.length) {
                        this.placeChunkArrowSigns(n);
                    }
                }
            }
        }

        // ---- SALA DE SEGURIDAD: construye la puerta de metal (que sube al
        // techo al abrirse), el panel de control con pantalla de pila y el
        // monitor de camaras en la pared opuesta. El estado (pila/puerta)
        // vive en ch.securityRoom.state; game.js lo anima y lo sincroniza.
        buildSecurityRoom(ch) {
            const sr = ch.securityRoom;
            if (!sr) return;
            const N = CHUNK_SIZE;
            const C = CELL_SIZE;
            const ox = ch.cx * N * C;
            const oz = ch.cz * N * C;
            const dc = sr.doorX, doorCellZ = sr.doorZ;
            const dcx0 = ox + dc * C, dcz0 = oz + doorCellZ * C;
            // Limites del bolsillo en el mundo. La cabina se construye dentro
            // de este rectangulo: ya no depende de que las paredes aleatorias
            // del laberinto parezcan cerrar la sala.
            const rmMinX = ox + sr.rx * C, rmMaxX = ox + (sr.rx + sr.w) * C;
            const rmMinZ = oz + sr.rz * C, rmMaxZ = oz + (sr.rz + sr.h) * C;
            const rmCX = (rmMinX + rmMaxX) / 2, rmCZ = (rmMinZ + rmMaxZ) / 2;
            const shellT = 0.16;
            const shellInset = 0.08;
            const shellX0 = rmMinX + shellInset, shellX1 = rmMaxX - shellInset;
            const shellZ0 = rmMinZ + shellInset, shellZ1 = rmMaxZ - shellInset;
            const shellH = WALL_HEIGHT - 0.02;
            // La cabina es deliberadamente estrecha: la puerta no puede
            // ocupar casi toda la pared ni dejar una falsa sensacion de sala
            // abierta. El ancho util de 1,18 m deja jambas y paneles visibles.
            const doorWidth = 1.18;
            const doorHeight = 2.46;
            const hasWideWall = sr.w >= 2 || sr.h >= 2;

            let doorSide = 'W', plane = 'x', doorX = 0, doorZ = 0;
            if (dc === sr.rx - 1) doorSide = 'W';
            else if (dc === sr.rx + sr.w) doorSide = 'E';
            else if (doorCellZ === sr.rz - 1) doorSide = 'N';
            else doorSide = 'S';
            plane = doorSide === 'W' || doorSide === 'E' ? 'x' : 'z';

            // La celda de la boca puede quedar pegada a una esquina. Se
            // centra dentro de la pared de la cabina y se limita para que las
            // jambas nunca tapen la entrada estrecha.
            const tangent0 = plane === 'x' ? shellZ0 : shellX0;
            const tangent1 = plane === 'x' ? shellZ1 : shellX1;
            const rawDoorT = plane === 'x' ? dcz0 + C / 2 : dcx0 + C / 2;
            const doorT = Math.max(tangent0 + doorWidth / 2 + 0.08,
                Math.min(tangent1 - doorWidth / 2 - 0.08, rawDoorT));
            if (plane === 'x') {
                doorX = doorSide === 'W' ? shellX0 : shellX1;
                doorZ = doorT;
            } else {
                doorX = doorT;
                doorZ = doorSide === 'N' ? shellZ0 : shellZ1;
            }

            const doorModel = createMetalDoorModel(doorWidth, doorHeight);
            doorModel.position.set(doorX, 0, doorZ);
            if (plane === 'z') doorModel.rotation.y = Math.PI / 2;
            this.scene.add(doorModel);
            ch.meshes.push(doorModel);

            // ------------------------------------------------------------
            // ESTRUCTURA REAL DE LA SALA: suelo, techo y cuatro paredes de
            // panel metalico. La pared de la puerta se parte en dos; el vano
            // queda verdaderamente vacio cuando la hoja sube al techo.
            // ------------------------------------------------------------
            const addShellPanel = (minX, maxX, minZ, maxZ, mat = Materials.securityWall) => {
                if (maxX - minX < 0.03 || maxZ - minZ < 0.03) return;
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, shellH, maxZ - minZ), mat);
                mesh.position.set((minX + maxX) / 2, shellH / 2, (minZ + maxZ) / 2);
                mesh.userData.isSecurityStructure = true;
                this.scene.add(mesh);
                ch.meshes.push(mesh);
                ch.wallBoxes.push({ minX, maxX, minZ, maxZ, securityStructure: true });
            };
            const addXWall = (x0, x1, z0, z1) => addShellPanel(x0, x1, z0, z1);
            const addZWall = (x0, x1, z0, z1) => addShellPanel(x0, x1, z0, z1);
            const addSplitXWall = (x0, x1) => {
                addXWall(x0, x1, shellZ0, doorT - doorWidth / 2);
                addXWall(x0, x1, doorT + doorWidth / 2, shellZ1);
            };
            const addSplitZWall = (z0, z1) => {
                addZWall(shellX0, doorT - doorWidth / 2, z0, z1);
                addZWall(doorT + doorWidth / 2, shellX1, z0, z1);
            };
            if (doorSide === 'W') addSplitXWall(shellX0, shellX0 + shellT);
            else addXWall(shellX0, shellX0 + shellT, shellZ0, shellZ1);
            if (doorSide === 'E') addSplitXWall(shellX1 - shellT, shellX1);
            else addXWall(shellX1 - shellT, shellX1, shellZ0, shellZ1);
            if (doorSide === 'N') addSplitZWall(shellZ0, shellZ0 + shellT);
            else addZWall(shellX0, shellX1, shellZ0, shellZ0 + shellT);
            if (doorSide === 'S') addSplitZWall(shellZ1 - shellT, shellZ1);
            else addZWall(shellX0, shellX1, shellZ1 - shellT, shellZ1);

            // Suelo tecnico elevado y techo bajo: hacen evidente que es una
            // cabina cerrada, no una coleccion de pantallas en mitad del mapa.
            const innerW = Math.max(0.6, shellX1 - shellX0 - shellT * 2);
            const innerD = Math.max(0.6, shellZ1 - shellZ0 - shellT * 2);
            const floorPanel = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.035, innerD), Materials.securityFloor);
            floorPanel.position.set((shellX0 + shellX1) / 2, 0.018, (shellZ0 + shellZ1) / 2);
            floorPanel.userData.isSecurityStructure = true;
            this.scene.add(floorPanel);
            ch.meshes.push(floorPanel);
            const ceilingPanel = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.04, 0.09, innerD + 0.04), Materials.securityCeiling);
            ceilingPanel.position.set((shellX0 + shellX1) / 2, WALL_HEIGHT - 0.045, (shellZ0 + shellZ1) / 2);
            ceilingPanel.userData.isSecurityStructure = true;
            this.scene.add(ceilingPanel);
            ch.meshes.push(ceilingPanel);

            // Remates horizontales y esquineros: la estructura se lee incluso
            // con la linterna apagada y las juntas no parecen paredes sueltas.
            const addTrim = (w, h, d, x, y, z) => {
                const trim = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Materials.securityTrim);
                trim.position.set(x, y, z);
                trim.userData.isSecurityStructure = true;
                this.scene.add(trim);
                ch.meshes.push(trim);
            };
            addTrim(innerW + shellT * 2, 0.07, 0.07, rmCX, 0.22, shellZ0 + shellT + 0.01);
            addTrim(innerW + shellT * 2, 0.07, 0.07, rmCX, 0.22, shellZ1 - shellT - 0.01);
            addTrim(0.07, 0.07, innerD + shellT * 2, shellX0 + shellT + 0.01, 0.22, rmCZ);
            addTrim(0.07, 0.07, innerD + shellT * 2, shellX1 - shellT - 0.01, 0.22, rmCZ);
            addTrim(innerW + shellT * 2, 0.08, 0.08, rmCX, shellH - 0.16, shellZ0 + shellT + 0.01);
            addTrim(innerW + shellT * 2, 0.08, 0.08, rmCX, shellH - 0.16, shellZ1 - shellT - 0.01);
            addTrim(0.08, 0.08, innerD + shellT * 2, shellX0 + shellT + 0.01, shellH - 0.16, rmCZ);
            addTrim(0.08, 0.08, innerD + shellT * 2, shellX1 - shellT - 0.01, shellH - 0.16, rmCZ);

            // Marcos de la puerta: sus jambas tambien son solidas; el hueco
            // central solo se bloquea con doorBox mientras la hoja esta abajo.
            const frameT = 0.17;
            const addFrameBox = (minX, maxX, minZ, maxZ) => {
                addTrim(maxX - minX, shellH - 0.14, maxZ - minZ,
                    (minX + maxX) / 2, (shellH - 0.14) / 2, (minZ + maxZ) / 2);
                ch.wallBoxes.push({ minX, maxX, minZ, maxZ, securityFrame: true });
            };
            if (plane === 'x') {
                addFrameBox(doorX - 0.09, doorX + 0.09, doorT - doorWidth / 2 - frameT / 2, doorT - doorWidth / 2 + frameT / 2);
                addFrameBox(doorX - 0.09, doorX + 0.09, doorT + doorWidth / 2 - frameT / 2, doorT + doorWidth / 2 + frameT / 2);
            } else {
                addFrameBox(doorT - doorWidth / 2 - frameT / 2, doorT - doorWidth / 2 + frameT / 2, doorZ - 0.09, doorZ + 0.09);
                addFrameBox(doorT + doorWidth / 2 - frameT / 2, doorT + doorWidth / 2 + frameT / 2, doorZ - 0.09, doorZ + 0.09);
            }
            const securityLight = new THREE.PointLight(0xb9c989, 0.42, 8, 2);
            securityLight.position.set(rmCX, 2.12, rmCZ);
            this.scene.add(securityLight);
            ch.meshes.push(securityLight);

            sr.shellMinX = shellX0;
            sr.shellMaxX = shellX1;
            sr.shellMinZ = shellZ0;
            sr.shellMaxZ = shellZ1;
            sr.doorSide = doorSide;
            sr.doorWidth = doorWidth;
            sr.doorHeight = doorHeight;

            // Panel de control (pantalla de pila) en la pared interior, junto
            // a la puerta, mirando hacia dentro de la sala
            const panelCanvas = document.createElement('canvas');
            panelCanvas.width = 96;
            panelCanvas.height = 48;
            const px = panelCanvas.getContext('2d');
            px.fillStyle = '#0a1408';
            px.fillRect(0, 0, 96, 48);
            px.fillStyle = '#9be34a';
            px.font = 'bold 14px Courier New';
            px.textAlign = 'center';
            px.fillText('PILA 100%', 48, 29);
            const panelTex = new THREE.CanvasTexture(panelCanvas);
            panelTex.minFilter = THREE.LinearFilter;
            const panelGroup = new THREE.Group();
            const panelBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.1),
                new THREE.MeshStandardMaterial({ color: 0x33363c, metalness: 0.6, roughness: 0.5 }));
            const panelScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.19),
                new THREE.MeshBasicMaterial({ map: panelTex }));
            panelScreen.position.z = 0.052;
            panelScreen.position.y = 0.02;
            panelBox.add(panelScreen);
            panelGroup.add(panelBox);
            const py = 1.08;
            // Panel de bateria en la pared contigua a la puerta, nunca delante
            // del vano: queda al alcance de la mano nada mas entrar.
            if (doorSide === 'W') {
                panelGroup.position.set(shellX0 + shellT + 0.055, py, shellZ0 + shellT + 0.42);
                panelGroup.rotation.y = Math.PI / 2;
            } else if (doorSide === 'E') {
                panelGroup.position.set(shellX1 - shellT - 0.055, py, shellZ0 + shellT + 0.42);
                panelGroup.rotation.y = -Math.PI / 2;
            } else if (doorSide === 'N') {
                panelGroup.position.set(shellX0 + shellT + 0.42, py, shellZ0 + shellT + 0.055);
                panelGroup.rotation.y = 0;
            } else {
                panelGroup.position.set(shellX0 + shellT + 0.42, py, shellZ1 - shellT - 0.055);
                panelGroup.rotation.y = Math.PI;
            }
            panelGroup.userData.isSecurityPanel = true;
            this.scene.add(panelGroup);
            ch.meshes.push(panelGroup);

            // Monitores de camaras: UNO EN CADA PARED (todas menos la de la
            // puerta). En la sala pequena quedan 3 paredes libres -> 3
            // monitores CRT gruesos, cada uno con su camara DISTINTA y
            // barrido lateral ("en todos lados una pantalla gorda"). Cada
            // monitor mira HACIA DENTRO de la sala (local +z = cara con
            // pantalla): N -> rotY 0, S -> rotY PI, O -> rotY PI/2,
            // E -> rotY -PI/2. (Antes solo habia uno y, con la puerta al
            // norte, se giraba hacia la pared: se veia el dorso.)
            const monitors = [];
            const my = 0.95;
            // El centro se separa del panel por el grosor de la pared: la caja
            // queda embutida y la pantalla sobresale, asi no vuelve a flotar.
            const monitorMount = shellT + 0.155 + 0.012;
            const west = shellX0 + monitorMount, east = shellX1 - monitorMount;
            const north = shellZ0 + monitorMount, south = shellZ1 - monitorMount;
            // En una cabina de una celda no caben tres CRT de 1,5 m: se
            // montan en paredes opuestas/laterales alternas, centrados y sin
            // salir de la carcasa. En las cabinas 1x2/1x3 caben tres, pero
            // nunca se coloca una pantalla sobre la pared del vano.
            const fitMonitor = (wallName, mx, mz, ry) => {
                const roomW = shellX1 - shellX0;
                const roomD = shellZ1 - shellZ0;
                const tooTight = (wallName === 'N' || wallName === 'S') ? roomW < 2.25 : roomD < 2.25;
                if (tooTight) return;
                // En una cabina 1xN solo hay una pared larga util: mas de un
                // CRT en las paredes cortas invade la carcasa y vuelve a
                // parecer flotante. En 2xN sí caben tres pantallas grandes.
                if (!hasWideWall && monitors.length > 0) return;
                addMonitor(mx, mz, ry, wallName);
            };
            const addMonitor = (mx, mz, ry, wallName) => {
                const m = createMonitorScreenModel(monitors.length + 1);
                m.position.set(mx, my, mz);
                m.rotation.y = ry;
                m.userData.isSecurityMonitor = true;
                m.userData.securityWall = wallName;
                this.scene.add(m);
                ch.meshes.push(m);
                monitors.push(m);
            };
            if (doorSide === 'W') {
                // Puerta al OESTE: pantalla opuesta al ESTE y dos laterales.
                fitMonitor('E', east, rmCZ, -Math.PI / 2);
                fitMonitor('N', rmCX, north, 0);
                fitMonitor('S', rmCX, south, Math.PI);
            } else if (doorSide === 'E') {
                fitMonitor('W', west, rmCZ, Math.PI / 2);
                fitMonitor('N', rmCX, north, 0);
                fitMonitor('S', rmCX, south, Math.PI);
            } else if (doorSide === 'N') {
                fitMonitor('S', rmCX, south, Math.PI);
                fitMonitor('W', west, rmCZ, Math.PI / 2);
                fitMonitor('E', east, rmCZ, -Math.PI / 2);
            } else {
                fitMonitor('N', rmCX, north, 0);
                fitMonitor('W', west, rmCZ, Math.PI / 2);
                fitMonitor('E', east, rmCZ, -Math.PI / 2);
            }

            // Caja del vano: solo tapa el hueco de la hoja, no toda la celda.
            // El marco permanece en las dos jambas; esta caja es la hoja
            // deslizante y se incluye solo cuando la puerta esta cerrada.
            const doorBox = plane === 'x'
                ? { minX: doorX - 0.09, maxX: doorX + 0.09, minZ: doorT - doorWidth / 2, maxZ: doorT + doorWidth / 2, securityDoor: true }
                : { minX: doorT - doorWidth / 2, maxX: doorT + doorWidth / 2, minZ: doorZ - 0.09, maxZ: doorZ + 0.09, securityDoor: true };

            sr.id = 'sec:' + ch.cx + ':' + ch.cz + ':' + sr.rx + ':' + sr.rz;
            sr.doorModel = doorModel;
            sr.doorGroup = doorModel.userData.door;
            sr.panelGroup = panelGroup;
            sr.doorBox = doorBox;
            sr.doorWorldX = doorX;
            sr.doorWorldZ = doorZ;
            sr.doorT = doorT;
            sr.panelCanvas = panelCanvas;
            sr.panelTex = panelTex;
            sr.monitors = monitors;
            sr.monitor = monitors[0] || null;
            sr.minX = ox + sr.rx * C;
            sr.maxX = ox + (sr.rx + sr.w) * C;
            sr.minZ = oz + sr.rz * C;
            sr.maxZ = oz + (sr.rz + sr.h) * C;
            sr.centerX = (sr.minX + sr.maxX) / 2;
            sr.centerZ = (sr.minZ + sr.maxZ) / 2;
            // Al recargar el chunk la malla se reconstruye: la lista se
            // resetea para no duplicar la sala (el estado vive en sr)
            if (ch.securityRooms) ch.securityRooms.length = 0;
            else ch.securityRooms = [];
            ch.securityRooms.push(sr);
        }

        // ---- CAMARAS DE SEGURIDAD en las paredes (raras): soporte fijo y
        // cabeza que game.js gira hacia el jugador cuando lo vigila (LED rojo
        // encendido). Su imagen se retransmite al monitor de las salas de
        // seguridad. RNG propio: no altera el resto del mundo.
        placeChunkCameras(ch, wallKind, key, curvedCells) {
            const N = CHUNK_SIZE;
            const C = CELL_SIZE;
            const rng = mulberry32(hash2(ch.cx * 9001 + 7, ch.cz * 7001 + 313));
            // Reset al reconstruir el chunk: sin duplicados al recargar. Una
            // cabina de seguridad siempre obtiene cámaras exteriores para sus
            // monitores; los chunks normales siguen teniendo cámaras raras.
            ch.cameras = [];
            const sr = ch.securityRoom;
            const insideRoom = (x, z) => !!sr && x >= sr.rx && x < sr.rx + sr.w && z >= sr.rz && z < sr.rz + sr.h;
            if (!sr && rng() >= 0.45) return;
            const g = ch.grid;
            const dirs = [[-1, 0, 'W'], [1, 0, 'E'], [0, -1, 'S'], [0, 1, 'N']];
            const cands = [];
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    const k = key(x, z);
                    if (g[x][z] !== 1 || curvedCells.has(k) || insideRoom(x, z)) continue;
                    const kind = wallKind.get(k);
                    if (kind !== 'x' && kind !== 'z') continue;
                    if (ch.graffitiCells && ch.graffitiCells.has(x + ',' + z)) continue;
                    const box = ch.wallFaceMap && ch.wallFaceMap.get(k);
                    if (!box) continue;
                    for (const [dx, dz, d] of dirs) {
                        const nx = x + dx, nz = z + dz;
                        if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                        if (g[nx][nz] !== 0 && g[nx][nz] !== 2) continue;
                        // Una cámara cuyo objetivo sería una celda de la cabina
                        // queda dentro de la sala de seguridad (aunque la pared
                        // original del laberinto siga debajo de la estructura):
                        // está prohibida. Las cámaras solo vigilan el exterior.
                        if (insideRoom(nx, nz)) continue;
                        if ((d === 'W' && x === 0) || (d === 'E' && x === N - 1) ||
                            (d === 'S' && z === 0) || (d === 'N' && z === N - 1)) continue;
                        const faceLen = (d === 'W' || d === 'E') ? (box.maxZ - box.minZ) : (box.maxX - box.minX);
                        if (faceLen < 0.8) continue;
                        cands.push([x, z, d]);
                    }
                }
            }
            if (!cands.length) return;
            // En una cabina se colocan hasta 3 cámaras EXTERIORES; el resto
            // del mundo conserva una sola cámara ocasional por chunk.
            const want = sr ? Math.min(3, cands.length) : 1;
            for (let n = 0; n < want && cands.length; n++) {
                const ci = Math.floor(rng() * cands.length);
                const c = cands.splice(ci, 1)[0];
                const box = ch.wallFaceMap.get(key(c[0], c[1]));
                if (!box) continue;
                const m = createSecurityCameraModel();
                const mx = ch.cx * N * C + (c[0] + 0.5) * C;
                const mz = ch.cz * N * C + (c[1] + 0.5) * C;
                const off = 0.122;
                let ry = 0;
                if (c[2] === 'W') { m.position.set(box.minX - off, 2.28, mz); ry = -Math.PI / 2; }
                else if (c[2] === 'E') { m.position.set(box.maxX + off, 2.28, mz); ry = Math.PI / 2; }
                else if (c[2] === 'S') { m.position.set(mx, 2.28, box.minZ - off); ry = Math.PI; }
                else { m.position.set(mx, 2.28, box.maxZ + off); ry = 0; }
                m.rotation.y = ry;
                m.userData.isExteriorSecurityCamera = !!sr;
                this.scene.add(m);
                ch.meshes.push(m);
                ch.cameras.push({ group: m, x: m.position.x, z: m.position.z, dir: c[2], baseRy: ry, exterior: !!sr });
            }
        }

        // ---- GRAFITI (100 variantes, blanco/negro/rojo) sobre las paredes ----
        // Se eligen caras expuestas de paredes rectas (las curvas se omiten:
        // su superficie no es plana). La cara sale de wallFaceMap, que guarda
        // la caja REAL de cada celda (incluidos los alargues), asi el plano
        // queda pegado a la superficie visible y no flotando.
        placeChunkGraffiti(ch, wallKind, key, curvedCells) {
            const N = CHUNK_SIZE;
            const C = CELL_SIZE;
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
                        if (g[nx][nz] !== 0 && g[nx][nz] !== 2) continue;
                        // Las caras que dan al chunk vecino quedan solapadas por
                        // la junta del vecino: el grafiti se enterraria en el
                        // muro y no se veria completo (o no se veria nada)
                        if (kind === 'border') {
                            if (d === 'W' && x === 0) continue;
                            if (d === 'E' && x === N - 1) continue;
                            if (d === 'S' && z === 0) continue;
                            if (d === 'N' && z === N - 1) continue;
                        }
                        candidates.push([x, z, d]);
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
                (ch.graffitiCells = ch.graffitiCells || new Set()).add(c[0] + ',' + c[1]);
                const box = ch.wallFaceMap.get(key(c[0], c[1]));
                if (!box) continue;
                const color = GRAFFITI_COLORS[Math.floor(rng() * GRAFFITI_COLORS.length)];
                const variant = Math.floor(rng() * GRAFFITI_POOL.length);
                // La cara REAL de la pared, limitada a la CELDA: el alargue de
                // la caja hacia los postes vecinos queda enterrado en el poste,
                // asi que un grafiti centrado en la caja entera se veia cortado
                // a trozos. Solo se usa la parte visible (una celda) y el plano
                // se centra en el centro de la celda, nunca en la caja.
                const faceLen = Math.min(
                    (c[2] === 'W' || c[2] === 'E') ? (box.maxZ - box.minZ) : (box.maxX - box.minX),
                    CELL_SIZE - 0.1
                );
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
                // Centro de la celda (visible), no de la caja (enterrada)
                const mx = ch.cx * N * C + (c[0] + 0.5) * C;
                const mz = ch.cz * N * C + (c[1] + 0.5) * C;
                if (c[2] === 'W') { m.position.set(box.minX - 0.022, m.position.y, mz); m.rotation.y = -Math.PI / 2; }
                else if (c[2] === 'E') { m.position.set(box.maxX + 0.022, m.position.y, mz); m.rotation.y = Math.PI / 2; }
                else if (c[2] === 'S') { m.position.set(mx, m.position.y, box.minZ - 0.022); m.rotation.y = Math.PI; }
                else { m.position.set(mx, m.position.y, box.maxZ + 0.022); m.rotation.y = 0; }
                m.rotation.z = (rng() - 0.5) * 0.22;    // ligeramente torcido
                this.scene.add(m);
                ch.meshes.push(m);
            }
        }

        // ---- PUERTAS FALSAS (señuelos) -----------------------------------
        // Se apoyan en la cara REAL de paredes rectas (wallFaceMap), a escala
        // de puerta (0,9/1,6 m de ancho x 2,05 m de alto), sencillas o
        // dobles, entornadas y a veces con grafiti encima: desde lejos parecen
        // una salida que no existe. RNG propio: no altera el resto del mundo.
        placeChunkFakeDoors(ch, wallKind, key, curvedCells) {
            const N = CHUNK_SIZE;
            const C = CELL_SIZE;
            const rng = mulberry32(hash2(ch.cx * 6151 + 97, ch.cz * 4051 + 701));
            const g = ch.grid;
            const dirs = [[-1, 0, 'W'], [1, 0, 'E'], [0, -1, 'S'], [0, 1, 'N']];
            ch.fakeDoors = [];
            const doorCells = new Set(ch.doorCells.map(d => d.x + ',' + d.z));
            const nearDoor = (x, z) => {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (doorCells.has((x + dx) + ',' + (z + dz))) return true;
                    }
                }
                return false;
            };
            const candidates = [];
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    const k = key(x, z);
                    if (g[x][z] !== 1 || curvedCells.has(k)) continue;
                    const kind = wallKind.get(k);
                    if (kind !== 'x' && kind !== 'z') continue;   // solo tramos rectos
                    if (nearDoor(x, z)) continue;                 // nunca junto a una puerta real
                    if (ch.graffitiCells && ch.graffitiCells.has(x + ',' + z)) continue;
                    const box = ch.wallFaceMap && ch.wallFaceMap.get(k);
                    if (!box) continue;
                    for (const [dx, dz, d] of dirs) {
                        const nx = x + dx, nz = z + dz;
                        if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                        if (g[nx][nz] !== 0 && g[nx][nz] !== 2) continue;
                        if (d === 'W' && x === 0) continue;   // caras de borde: las solapa el vecino
                        if (d === 'E' && x === N - 1) continue;
                        if (d === 'S' && z === 0) continue;
                        if (d === 'N' && z === N - 1) continue;
                        const faceLen = (d === 'W' || d === 'E') ? (box.maxZ - box.minZ) : (box.maxX - box.minX);
                        if (faceLen < 1.8) continue;          // sitio para puerta doble + marco
                        candidates.push([x, z, d]);
                    }
                }
            }
            if (!candidates.length) return;
            const placedCells = new Set();
            // MUY RARAS: ~1 de cada 17 chunks tiene UNA puerta falsa (antes
            // 1 de cada 6 con hasta 2 puertas: aparecian por todas partes y
            // dejaban de sorprender)
            if (rng() >= 0.06) return;
            let budget = 1;
            for (let i = 0; i < budget; i++) {
                if (!candidates.length) break;
                const ci = Math.floor(rng() * candidates.length);
                const c = candidates.splice(ci, 1)[0];
                if (placedCells.has(c[0] + ',' + c[1])) continue;
                placedCells.add(c[0] + ',' + c[1]);
                const box = ch.wallFaceMap.get(key(c[0], c[1]));
                if (!box) continue;
                const double = rng() < 0.34;
                const ajar = (rng() - 0.5) * 0.36;
                const paint = DOOR_PAINTS[Math.floor(rng() * DOOR_PAINTS.length)];
                let graffitiTex = null;
                if (rng() < 0.45) {
                    const color = GRAFFITI_COLORS[Math.floor(rng() * GRAFFITI_COLORS.length)];
                    const variant = Math.floor(rng() * GRAFFITI_POOL.length);
                    graffitiTex = graffitiTexture(variant, color);
                }
                const mesh = createFakeDoorModel({ double, ajar, paint, graffitiTex });
                // Centro de la CELDA (parte visible, nunca el alargue enterrado)
                const mx = ch.cx * N * C + (c[0] + 0.5) * C;
                const mz = ch.cz * N * C + (c[1] + 0.5) * C;
                const off = 0.022 + 0.05;   // junta + mitad del marco
                if (c[2] === 'W') { mesh.position.set(box.minX - off, 0, mz); mesh.rotation.y = -Math.PI / 2; }
                else if (c[2] === 'E') { mesh.position.set(box.maxX + off, 0, mz); mesh.rotation.y = Math.PI / 2; }
                else if (c[2] === 'S') { mesh.position.set(mx, 0, box.minZ - off); mesh.rotation.y = Math.PI; }
                else { mesh.position.set(mx, 0, box.maxZ + off); mesh.rotation.y = 0; }
                this.scene.add(mesh);
                ch.meshes.push(mesh);
                ch.fakeDoors.push({ x: mesh.position.x, z: mesh.position.z });
            }
        }

        // ---- GRAFITIS-GUIA hacia las puertas falsas ---------------------
        // Flechas GRANDES con texto (SALIDA / POR AQUI / EXIT...) pintadas en
        // paredes con linea de vision despejada hacia la puerta, giradas para
        // apuntar en su direccion a lo largo de la pared. Determinista: toda
        // la sala ve las mismas guias. RNG propio, como las demas.
        placeChunkGuideGraffiti(ch, wallKind, key, curvedCells) {
            if (!ch.fakeDoors || !ch.fakeDoors.length) return;
            const N = CHUNK_SIZE, C = CELL_SIZE;
            const rng = mulberry32(hash2(ch.cx * 3187 + 61, ch.cz * 5233 + 919));
            const g = ch.grid;
            const ox = ch.cx * N * C, oz = ch.cz * N * C;
            const dirs = [[-1, 0, 'W'], [1, 0, 'E'], [0, -1, 'S'], [0, 1, 'N']];
            // Tangente horizontal de la pared en el mundo por cara (el local
            // +X del plano del grafiti tras su rotation.y)
            const TANGENT = { W: [0, 0, 1], E: [0, 0, -1], S: [-1, 0, 0], N: [1, 0, 0] };
            const placed = new Set();
            for (const door of ch.fakeDoors) {
                const cands = [];
                for (let x = 1; x < N - 1; x++) {
                    for (let z = 1; z < N - 1; z++) {
                        const k = key(x, z);
                        if (g[x][z] !== 1 || curvedCells.has(k)) continue;
                        if (ch.graffitiCells && ch.graffitiCells.has(x + ',' + z)) continue;
                        const kind = wallKind.get(k);
                        if (kind !== 'x' && kind !== 'z') continue;
                        const box = ch.wallFaceMap && ch.wallFaceMap.get(k);
                        if (!box) continue;
                        for (const [dx, dz, d] of dirs) {
                            const nx = x + dx, nz = z + dz;
                            if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                            if (g[nx][nz] !== 0 && g[nx][nz] !== 2) continue;
                            if (d === 'W' && x === 0) continue;
                            if (d === 'E' && x === N - 1) continue;
                            if (d === 'S' && z === 0) continue;
                            if (d === 'N' && z === N - 1) continue;
                            const faceLen = (d === 'W' || d === 'E') ? (box.maxZ - box.minZ) : (box.maxX - box.minX);
                            if (faceLen < 1.7) continue;
                            const wx = ox + (x + 0.5) * C;
                            const wz = oz + (z + 0.5) * C;
                            const dist = Math.hypot(wx - door.x, wz - door.z);
                            if (dist < 6 || dist > 26) continue;
                            if (!this.lineClear(wx, wz, door.x, door.z)) continue;
                            cands.push({ x, z, d, wx, wz, box, faceLen });
                        }
                    }
                }
                for (let i = cands.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [cands[i], cands[j]] = [cands[j], cands[i]];
                }
                let placedCount = 0;
                for (const c of cands) {
                    if (placedCount >= 1) break;   // UNA guia por puerta (antes 2: demasiado)
                    const fk = c.x + ',' + c.z + c.d;
                    if (placed.has(fk)) continue;
                    // Nada de guias encima de flechas-grafiti ya pintadas (y
                    // al reves: las flechas saltan las celdas de guia). Sin
                    // este dedup mutuo salian 3 grafitis apilados en la misma
                    // pared (texto + flechas encimados). Misma clave que las
                    // flechas: 'cx:celdaX:cz:celdaZ+cara'.
                    if (this._arrowCells.has(ch.cx + ':' + c.x + ':' + ch.cz + ':' + c.z + c.d)) continue;
                    placed.add(fk);
                    const color = GRAFFITI_COLORS[Math.floor(rng() * GRAFFITI_COLORS.length)];
                    const text = GUIDE_TEXTS[Math.floor(rng() * GUIDE_TEXTS.length)];
                    // La flecha del plano apunta a lo largo de la pared hacia
                    // la puerta: si queda detras (local -X), textura ESPEJADA
                    // (antes se rotaba el plano 180 grados: "POR AQUI" al reves)
                    const t = TANGENT[c.d];
                    const along = (door.x - c.wx) * t[0] + (door.z - c.wz) * t[2];
                    const mat = new THREE.MeshBasicMaterial({
                        map: guideArrowTexture(text, color, along < 0),
                        transparent: true
                    });
                    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
                    const w = Math.min(1.45, c.faceLen - 0.2);   // INDICADOR GRANDE
                    const h = 0.85;
                    m.scale.set(w, h, 1);
                    m.position.y = 1.35;
                    if (c.d === 'W') { m.position.set(c.box.minX - 0.022, 1.35, c.wz); m.rotation.y = -Math.PI / 2; }
                    else if (c.d === 'E') { m.position.set(c.box.maxX + 0.022, 1.35, c.wz); m.rotation.y = Math.PI / 2; }
                    else if (c.d === 'S') { m.position.set(c.wx, 1.35, c.box.minZ - 0.022); m.rotation.y = Math.PI; }
                    else { m.position.set(c.wx, 1.35, c.box.maxZ + 0.022); m.rotation.y = 0; }
                    this.scene.add(m);
                    ch.meshes.push(m);
                    (ch.guideCells = ch.guideCells || new Set()).add(c.x + ',' + c.z + c.d);
                    placedCount++;
                }
            }
        }

        // FLECHAS-GRAFITI en las PAREDES que, desde lejos, apuntan el camino
        // hacia las puertas falsas (material basico: se ven tambien en los
        // apagones). Sustituyen a las antiguas flechas del suelo: pintadas en
        // las caras reales de los muros con linea de vision despejada hasta
        // la puerta (5-30 m) y giradas para apuntar a lo largo de la pared.
        // Se buscan paredes en el chunk de la puerta y en sus VECINOS
        // cargados (igual que hacian las flechas del suelo): una puerta sola
        // en su chunk no se queda sin guias.
        placeChunkArrowSigns(ch) {
            if (!ch.fakeDoors || !ch.fakeDoors.length) return;
            const N = CHUNK_SIZE;
            const C = CELL_SIZE;
            const rng = mulberry32(hash2(ch.cx * 3187 + 61, ch.cz * 5233 + 919));
            const dirs = [[-1, 0, 'W'], [1, 0, 'E'], [0, -1, 'S'], [0, 1, 'N']];
            // Tangente horizontal de la pared en el mundo por cara (el local
            // +X del plano del grafiti tras su rotation.y)
            const TANGENT = { W: [0, 0, 1], E: [0, 0, -1], S: [-1, 0, 0], N: [1, 0, 0] };
            // Dedup GLOBAL de sesion (por celda+cara y por puerta): al
            // reconstruir chunks vecinos nunca se apilan flechas ni una
            // puerta pasa de 3.
            const key = (x, z) => x + ',' + z;
            // Chunk donde esta la puerta + vecinos cargados (las rejillas y
            // caras reales vienen de los chunks cargados, los mismos para
            // toda la sala en la misma posicion)
            const searchChunks = [ch];
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const n = this.chunks.get((ch.cx + dx) + ',' + (ch.cz + dz));
                    if (n && n.loaded && n.wallFaceMap) searchChunks.push(n);
                }
            }
            for (let di = 0; di < ch.fakeDoors.length; di++) {
                const door = ch.fakeDoors[di];
                const doorKey = ch.key + '#' + di;
                if ((this._arrowDoorCount.get(doorKey) || 0) >= 2) continue;
                const cands = [];
                for (const lc of searchChunks) {
                    const g = lc.grid;
                    const ox = lc.cx * N * C, oz = lc.cz * N * C;
                    // Se incluyen las celdas de BORDE (x/z = 0 y N-1): su cara
                    // hacia el interior es visible (la cara exterior la cubre
                    // la copia del muro en el chunk vecino y ya se descarta
                    // abajo). Sin esto, una puerta junto al borde del chunk
                    // podia quedarse sin ninguna flecha (toda su zona
                    // despejada caia en la fila N-1, excluida).
                    for (let x = 0; x < N; x++) {
                        for (let z = 0; z < N; z++) {
                            const k = key(x, z);
                            if (g[x][z] !== 1) continue;
                            if (lc.graffitiCells && lc.graffitiCells.has(x + ',' + z)) continue;
                            const box = lc.wallFaceMap && lc.wallFaceMap.get(k);
                            if (!box) continue;
                            for (const [dx, dz, d] of dirs) {
                                const nx = x + dx, nz = z + dz;
                                if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                                if (g[nx][nz] !== 0 && g[nx][nz] !== 2) continue;
                                if (d === 'W' && x === 0) continue;
                                if (d === 'E' && x === N - 1) continue;
                                if (d === 'S' && z === 0) continue;
                                if (d === 'N' && z === N - 1) continue;
                                // Las flechas no pisan las celdas con
                                // grafiti-guia (texto + flecha grande): sin
                                // este dedup mutuo se apilaban 3 graffitis en
                                // la misma pared
                                if (lc.guideCells && lc.guideCells.has(x + ',' + z + d)) continue;
                                const faceLen = (d === 'W' || d === 'E') ? (box.maxZ - box.minZ) : (box.maxX - box.minX);
                                if (faceLen < 1.2) continue;
                                // La linea de vision se mide desde el CENTRO de
                                // la celda de pared (como los grafitis-guia), no
                                // desde la cara: desde la cara, las paredes que
                                // miran al lado contrario de la puerta fallarian
                                // siempre (la primera muestra cae dentro del
                                // muro) y no habria flechas.
                                const wx = ox + (x + 0.5) * C;
                                const wz = oz + (z + 0.5) * C;
                                const dist = Math.hypot(wx - door.x, wz - door.z);
                                // Lejos de la puerta (6-24 m): ni flechas junto
                                // a la puerta ni un campo de flechas infinito
                                if (dist < 6 || dist > 24) continue;
                                if (!this.lineClear(wx, wz, door.x, door.z)) continue;
                                cands.push({ lc, x, z, d, wx, wz, box, faceLen });
                            }
                        }
                    }
                }
                for (let i = cands.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [cands[i], cands[j]] = [cands[j], cands[i]];
                }
                for (const c of cands) {
                    if ((this._arrowDoorCount.get(doorKey) || 0) >= 2) break;
                    // Clave GLOBAL (chunk + celda local + cara): dos chunks
                    // distintos podrian tener la misma celda local
                    const fk = c.lc.cx + ':' + c.x + ':' + c.lc.cz + ':' + c.z + c.d;
                    if (this._arrowCells.has(fk)) continue;
                    this._arrowCells.add(fk);
                    this._arrowDoorCount.set(doorKey, (this._arrowDoorCount.get(doorKey) || 0) + 1);
                    const color = GRAFFITI_COLORS[Math.floor(rng() * GRAFFITI_COLORS.length)];
                    const mat = new THREE.MeshBasicMaterial({
                        map: wallArrowTexture(color),
                        transparent: true
                    });
                    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
                    const w = Math.min(0.95 + rng() * 0.5, c.faceLen - 0.18);
                    const h = 0.5 + rng() * 0.28;
                    m.scale.set(w, h, 1);
                    m.position.y = 1.15 + rng() * 0.95;
                    // Giro para que la flecha apunte a la puerta a lo largo
                    // de la pared (local +X = tangente de la cara)
                    const t = TANGENT[c.d];
                    const along = (door.x - c.wx) * t[0] + (door.z - c.wz) * t[2];
                    m.rotation.z = (rng() - 0.5) * 0.14 + (along < 0 ? Math.PI : 0);
                    if (c.d === 'W') { m.position.set(c.box.minX - 0.022, m.position.y, c.wz); m.rotation.y = -Math.PI / 2; }
                    else if (c.d === 'E') { m.position.set(c.box.maxX + 0.022, m.position.y, c.wz); m.rotation.y = Math.PI / 2; }
                    else if (c.d === 'S') { m.position.set(c.wx, m.position.y, c.box.minZ - 0.022); m.rotation.y = Math.PI; }
                    else { m.position.set(c.wx, m.position.y, c.box.maxZ + 0.022); m.rotation.y = 0; }
                    this.scene.add(m);
                    // El mueble propietario es el chunk de la PARED (ahi se
                    // retira al descargarse)
                    const host = this.chunks.get(c.lc.key) || c.lc;
                    host.meshes.push(m);
                    host.arrowKeys = host.arrowKeys || [];
                    host.arrowKeys.push(fk);
                    host.arrowDoorKeys = host.arrowDoorKeys || [];
                    host.arrowDoorKeys.push(doorKey);
                }
            }
        }

        // Linea de vision 2D entre dos puntos del mundo (misma semilla ->
        // mismo resultado): camina la linea y descarta si cruza un muro.
        // IMPORTANTE: se muestrea hasta 2,4 m ANTES del destino, porque la
        // celda de muro donde se apoya la puerta es maciza y el ultimo tramo
        // de la linea no debe entrar en ella (si no, toda linea fallaria).
        lineClear(ax, az, bx, bz) {
            const C = CELL_SIZE;
            const N = CHUNK_SIZE;
            const CS = N * C;
            const dist = Math.hypot(bx - ax, bz - az);
            const stop = Math.max(0, dist - 2.4);
            const n = Math.max(1, Math.ceil(stop / 1.2));
            // Las muestras dentro de la celda INICIAL no cuentan como muro:
            // el origen puede ser el CENTRO de una celda de pared (grafitis
            // y flechas-guia se miden desde ahi, y la pared real es fina,
            // 0,4-1,2 m, dentro de una celda de 2,8 m). Sin esto, las dos
            // primeras muestras caian siempre dentro de la celda de pared y
            // NINGUNA guia hacia la puerta encontraba linea despejada.
            // OJO: las muestras usan celdas LOCALES de chunk; el inicio
            // tambien debe compararse en ese mismo espacio.
            const startGx = Math.floor(ax / CS), startGz = Math.floor(az / CS);
            const startCx = Math.floor((ax - startGx * CS) / C);
            const startCz = Math.floor((az - startGz * CS) / C);
            for (let i = 1; i <= n; i++) {
                const t = (i / n) * (stop / dist);
                const sx = ax + (bx - ax) * t;
                const sz = az + (bz - az) * t;
                const gx = Math.floor(sx / CS);
                const gz = Math.floor(sz / CS);
                const lc = this.getLayout(gx, gz);
                const cx = Math.floor((sx - gx * CS) / C);
                const cz = Math.floor((sz - gz * CS) / C);
                if (cx < 0 || cx >= N || cz < 0 || cz >= N) continue;
                if (gx === startGx && gz === startGz && cx === startCx && cz === startCz) continue;
                const v = lc.grid[cx][cz];
                if (v === 1 || v === 3) return false;
            }
            return true;
        }

        // Elige (de vez en cuando) UN tramo recto interior para convertirlo
        // en pared curva. Los tramos se detectan como celdas contiguas del
        // mismo kind ('x' corre en Z, 'z' corre en X) y deben tener los
        // lados abiertos consistentes en toda su longitud para que el arco
        // no se meta en ningun hueco raro.
        pickCurvedRuns(ch, wallKind, key) {
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const r = ch.buildRng || ch.rng;
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
                // medio grosor por eje): la curva se alarga hasta tocar su cara
                if (nk === 'post') {
                    const h = wallTMap.get(key(cx2, cz2));
                    const half = h && typeof h === 'object' ? (kind === 'x' ? h.rz : h.rx) : (h || 0.525);
                    return Math.max(0.05, 1.45 - half);
                }
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
            else dir = (ch.buildRng || ch.rng)() < 0.5 ? -1 : 1;
            const cap = C - T / 2 - 1.2;   // el paso nunca baja de ~1,2 m
            const B = Math.min(cap, (0.30 + (ch.buildRng || ch.rng)() * 0.40) * C);

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
            // 2 cm de aire arriba y abajo (igual que los tabiques inclinados):
            // las tapas del suelo/techo de la pared curva quedaban coplanares
            // con el suelo y el techo y producian z-fighting
            const y0 = 0.02, y1 = WALL_HEIGHT - 0.02;
            for (let i = 0; i < n; i++) {
                const A = edges[i], Bb = edges[i + 1];
                const u0 = (i / n) * alongU, u1 = ((i + 1) / n) * alongU;
                // Laterales (+T/2 y -T/2)
                const a = vert(A[1][0], y0, A[1][1], u0, 0), b = vert(Bb[1][0], y0, Bb[1][1], u1, 0);
                const c = vert(Bb[1][0], y1, Bb[1][1], u1, H / C), d = vert(A[1][0], y1, A[1][1], u0, H / C);
                quad(a, b, c, d);
                const e = vert(A[0][0], y0, A[0][1], u0, 0), f = vert(Bb[0][0], y0, Bb[0][1], u1, 0);
                const gg = vert(Bb[0][0], y1, Bb[0][1], u1, H / C), h = vert(A[0][0], y1, A[0][1], u0, H / C);
                quad(h, gg, f, e);
                // Techo y suelo
                quad(d, c, gg, h);
                quad(a, e, f, b);
            }
            // Tapas de los extremos, enrasadas con las paredes rectas vecinas.
            // La tapa abarca TODA la celda de la pared (del borde TRASERO de
            // la celda a la cara del arco): antes solo cubria el grosor T del
            // arco y, al terminar el tramo, quedaba abierto el resto de la
            // celda (hasta ~1 m) por el que se colaba uno DETRAS de la pared
            // curva ("al terminar detras no hay una pared completa").
            const capEdge0 = kind === 'x'
                ? [[fixed0 - dir * C / 2, sweep0], [fixed0 + dir * T / 2, sweep0]]
                : [[sweep0, fixed0 - dir * C / 2], [sweep0, fixed0 + dir * T / 2]];
            const capEdgeN = kind === 'x'
                ? [[fixed0 - dir * C / 2, sweep1], [fixed0 + dir * T / 2, sweep1]]
                : [[sweep1, fixed0 - dir * C / 2], [sweep1, fixed0 + dir * T / 2]];
            const capU = (C / 2 + T / 2) / C;
            {
                const A = capEdge0;
                const a = vert(A[0][0], y0, A[0][1], 0, 0), b = vert(A[1][0], y0, A[1][1], capU, 0);
                const c = vert(A[1][0], y1, A[1][1], capU, H / C), d = vert(A[0][0], y1, A[0][1], 0, H / C);
                quad(a, b, c, d);
                const E = capEdgeN;
                const e = vert(E[0][0], y0, E[0][1], 0, 0), f = vert(E[1][0], y0, E[1][1], capU, 0);
                const gg = vert(E[1][0], y1, E[1][1], capU, H / C), h = vert(E[0][0], y1, E[0][1], 0, H / C);
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
            mesh.userData.isCurvedWall = true;   // util para debug/inspeccion
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
                // La caja se extiende tambien por DETRAS del arco hasta el
                // borde TRASERO de la celda: el hueco que dejaba el arco entre
                // su cara trasera y el final de la celda (hasta ~1 m de ancho,
                // mas que el jugador) era transitable y permitia caminar por
                // detras de la pared curva. Ahora la celda entera de la pared
                // es solida: solo queda abierto el paso del lado del arco.
                const backF = fixed0 - dir * C / 2;
                const bx0 = Math.min(fixed0 + minOff, backF);
                const bx1 = Math.max(fixed0 + maxOff, backF);
                if (kind === 'x') {
                    boxes.push({ minX: bx0, maxX: bx1, minZ: cellStart, maxZ: cellEnd });
                } else {
                    boxes.push({ minX: cellStart, maxX: cellEnd, minZ: bx0, maxZ: bx1 });
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

        placeChunkSlantedWalls(ch, wallKind, key, curvedCells) {
            const rng = mulberry32(hash2(ch.cx * 65407 + 89, ch.cz * 65407 + 137));
            const N = CHUNK_SIZE, C = CELL_SIZE;
            const g = ch.grid;
            const ox = ch.cx * N * C;
            const oz = ch.cz * N * C;
            const open = (x, z) => x >= 0 && x < N && z >= 0 && z < N && (g[x][z] === 0 || g[x][z] === 2);

            // 1) ESQUINAS RECORTADAS: en salas y salones medianos/grandes, una
            // pared inclinada a 45 grados corta la esquina (apoyada en las
            // caras reales de los muros, con bolsillo sellado detras)
            this.placeChunkChamfers(ch, rng, wallKind, key, curvedCells);

            // 2) CONTRAFUERTES: tabiques que NACEN de una pared y se clavan
            // en el pasillo en angulo (paso garantizado). Antes solo en
            // chunks de pasillos; ahora tambien en salas y salones.
            if (rng() < 0.7) {
                this.placeChunkBraces(ch, rng, wallKind, key, curvedCells);
            }

            // 3) TABIQUES SUELTOS en campo abierto: celdas interiores, abiertas
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

            // Cantidad: 1-4 en chunks con salas/salones, ocasional en pasillos
            let n = 0;
            if (ch.rooms.length > 0) {
                if (rng() < 0.9) n = 1 + (rng() < 0.6 ? 1 : 0) + (rng() < 0.25 ? 1 : 0) + (rng() < 0.08 ? 1 : 0);
            } else if (rng() < 0.45) {
                n = 1 + (rng() < 0.3 ? 1 : 0);
            }

            // Los tabiques sueltos compiten con los contrafuertes/esquinas ya
            // colocados: el presupuesto es para TODOS los inclinados del chunk
            let placed = ch.slantedAABBs.length;
            for (const [cx2, cz2] of cands) {
                if (placed >= n) break;
                const wx = ox + (cx2 + 0.5) * C;
                const wz = oz + (cz2 + 0.5) * C;
                const shape = rng() < 0.45 ? 'trap' : 'rect';
                const L = 1.2 + rng() * 8.8;             // 1,2-10 m: tabiques cortos y largos
                const ang = (rng() - 0.5) * 2.6;         // hasta ~±75°
                // Grosor como el de las paredes rectas (0,4-1,2 m): el tabique
                // inclinado se ve como una pared de verdad, no como un adorno
                const T0 = shape === 'trap' ? 0.4 + rng() * 0.3 : 0.4 + rng() * 0.8;
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
                    for (const s of ch.slantedAABBs) {
                        if (aabb.minX - 0.8 < s.maxX && aabb.maxX + 0.8 > s.minX &&
                            aabb.minZ - 0.8 < s.maxZ && aabb.maxZ + 0.8 > s.minZ) { ok = false; break; }
                    }
                }
                if (!ok) continue;

                const built = this.buildSlantedWall(ch, wx, wz, ang, L, T0, T1, shape);
                ch.slantedAABBs.push(aabb);
                ch.wallBoxes.push(...built.boxes);
                ch.meshes.push(built.mesh);
                placed++;
            }
        }

        // ---- ESQUINAS RECORTADAS (chamfers) ------------------------------
        // En vez de una esquina cuadrada de sala, una pared a 45 grados une
        // las dos caras del muro y deja un bolsillo triangular sellado detras
        // (como el boceto: la esquina queda cortada). Se apoya en la cara REAL
        // del poste de la esquina (wallFaceMap) y se valida que las paredes
        // contiguas sean macizas (sin puertas ni tramos curvos): si no, la
        // esquina no quedaria sellada y el bolsillo seria un callejon.
        tryChamfer(ch, rng, cxx, czz, sx, sz, roomMin, wallKind, key, curvedCells, placedAABBs) {
            const C = CELL_SIZE;
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const ox = ch.cx * N * C;
            const oz = ch.cz * N * C;
            if (cxx < 1 || cxx > N - 2 || czz < 1 || czz > N - 2) return null;
            const ck = wallKind.get(key(cxx, czz));
            // Solo esquinas que forman un angulo recto REAL: un poste enrasado
            // o una celda maciza RECORTADA (cuyas laminas caen en el mismo
            // plano que las paredes contiguas). El chequeo de enrasado usa las
            // cajas REALES de las celdas contiguas: si la esquina sobresale o
            // la pared es curva/puerta, no se recorta.
            if (g[cxx][czz] !== 1 || (ck !== 'post' && ck !== 'interior')) return null;
            const box = ch.wallFaceMap.get(key(cxx, czz));
            if (!box) return null;
            // Punto interior de la esquina (la cara REAL) y distancia del
            // corte a lo largo de cada cara
            const boxA = ch.wallFaceMap.get(key(cxx, czz + sz));
            const boxB = ch.wallFaceMap.get(key(cxx + sx, czz));
            if (!boxA || !boxB) return null;
            const faceAx = sx === 1 ? boxA.maxX : boxA.minX;
            const faceBz = sz === 1 ? boxB.maxZ : boxB.minZ;
            // Enrasado medido: la cara REAL de la celda de la esquina (la
            // lamina A de las esquinas recortadas) debe caer en el MISMO plano
            // que la pared contigua. La cara Z de las recortadas queda enrasada
            // por construccion (misma formula que la pared B). Si la esquina
            // sobresale (bloque sin recortar o poste), el tabique flotaria o
            // quedaria enterrado y se descarta.
            const P0x = sx === 1 ? box.maxX : box.minX;
            if (Math.abs(faceAx - P0x) > 0.11) return null;
            const P0z = faceBz;
            const d = Math.min(2.2 + rng() * 2.4, roomMin * 0.42);
            // Las paredes a lo largo de las dos caras (desde la esquina hasta
            // el corte) deben ser muro macizo: sin puertas ni tramos curvos
            const kCells = Math.max(1, Math.ceil(d / C));
            for (let i = 1; i <= kCells; i++) {
                const ka = key(cxx, czz + sz * i);
                const kb = key(cxx + sx * i, czz);
                if (g[cxx][czz + sz * i] !== 1 || curvedCells.has(ka)) return null;
                if (g[cxx + sx * i][czz] !== 1 || curvedCells.has(kb)) return null;
            }
            const T = 0.4 + rng() * 0.2;
            const L = d * Math.SQRT2;
            const ang = Math.atan2(-sx, sz);
            // El eje del tabique va a T/2 hacia la esquina: el lado visible
            // queda exactamente en la linea que une los dos puntos de las caras
            const off = T / (2 * Math.SQRT2);
            const cx = P0x + sx * (d / 2 - off);
            const cz = P0z + sz * (d / 2 - off);
            const pts = this.slabCorners(cx, cz, ang, L, T, T);
            const aabb = {
                minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
                minZ: Math.min(...pts.map(p => p.z)), maxZ: Math.max(...pts.map(p => p.z))
            };
            // Sin pilares cerca, sin puertas ni otras esquinas recortadas
            for (let x = Math.floor((aabb.minX - 0.6 - ox) / C); x <= Math.floor((aabb.maxX + 0.6 - ox) / C); x++) {
                for (let z = Math.floor((aabb.minZ - 0.6 - oz) / C); z <= Math.floor((aabb.maxZ + 0.6 - oz) / C); z++) {
                    if (x >= 0 && x < N && z >= 0 && z < N && g[x][z] === 3) return null;
                }
            }
            for (const b of placedAABBs) {
                if (aabb.minX - 0.8 < b.maxX && aabb.maxX + 0.8 > b.minX &&
                    aabb.minZ - 0.8 < b.maxZ && aabb.maxZ + 0.8 > b.minZ) return null;
            }
            for (const dc of ch.doorCells) {
                const dwx = ox + (dc.x + 0.5) * C, dwz = oz + (dc.z + 0.5) * C;
                if (dwx > aabb.minX - 1.2 && dwx < aabb.maxX + 1.2 &&
                    dwz > aabb.minZ - 1.2 && dwz < aabb.maxZ + 1.2) return null;
            }
            const built = this.buildSlantedWall(ch, cx, cz, ang, L, T, T, 'rect');
            return { mesh: built.mesh, boxes: built.boxes, aabb };
        }

        placeChunkChamfers(ch, rng, wallKind, key, curvedCells) {
            const C = CELL_SIZE;
            // Salas medianas y grandes (antes solo 4+): mas esquinas recortadas
            const rooms = ch.rooms.filter(r => r.w >= 3 && r.h >= 3);
            if (!rooms.length) return;
            for (let i = rooms.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
            }
            const placedAABBs = [];
            let budget = 1 + (rng() < 0.6 ? 1 : 0) + (rng() < 0.3 ? 1 : 0) + (rng() < 0.1 ? 1 : 0);
            for (const room of rooms) {
                if (budget <= 0) break;
                const corners = [
                    { cxx: room.x - 1, czz: room.z - 1, sx: 1, sz: 1 },
                    { cxx: room.x + room.w, czz: room.z - 1, sx: -1, sz: 1 },
                    { cxx: room.x - 1, czz: room.z + room.h, sx: 1, sz: -1 },
                    { cxx: room.x + room.w, czz: room.z + room.h, sx: -1, sz: -1 }
                ];
                for (let i = corners.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [corners[i], corners[j]] = [corners[j], corners[i]];
                }
                const roomMin = Math.min(room.w, room.h) * C;
                for (const c of corners) {
                    if (budget <= 0) break;
                    const r = this.tryChamfer(ch, rng, c.cxx, c.czz, c.sx, c.sz, roomMin, wallKind, key, curvedCells, placedAABBs);
                    if (!r) continue;
                    placedAABBs.push(r.aabb);
                    ch.slantedAABBs.push(r.aabb);
                    ch.wallBoxes.push(...r.boxes);
                    ch.meshes.push(r.mesh);
                    budget--;
                }
            }
        }

        // ---- CONTRAFUERTES DE PASAJILLOS (braces) ------------------------
        // Un tabique que NACE de una pared recta del pasillo (arranque
        // enterrado en el muro: la tapa queda oculta y el nacimiento queda
        // enrasado con la cara) y se clava en el pasillo en angulo. Deja paso
        // garantizado de ~1 m por el lado libre (margen contra las cajas de
        // colision de muros, pilares y otros tabiques).
        tryBrace(ch, rng, wx, wz, side, wallKind, key, curvedCells, placedAABBs) {
            const C = CELL_SIZE;
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const ox = ch.cx * N * C;
            const oz = ch.cz * N * C;
            const open = (x, z) => x >= 0 && x < N && z >= 0 && z < N && (g[x][z] === 0 || g[x][z] === 2);
            const k = key(wx, wz);
            const kind = wallKind.get(k);
            if (kind !== 'x' && kind !== 'z') return null;
            if (curvedCells.has(k)) return null;
            // La pared 'x' corre a lo largo de Z (caras en +/-X); la 'z' al
            // reves. El pasillo debe estar al lado pedido y tener >= 2 celdas
            if (side === 'E' || side === 'W') {
                if (kind !== 'x') return null;
                const dx = side === 'E' ? 1 : -1;
                if (!open(wx + dx, wz) || !open(wx + 2 * dx, wz)) return null;
                if (!open(wx + dx, wz - 1) && !open(wx + dx, wz + 1)) return null;
            } else {
                if (kind !== 'z') return null;
                const dz = side === 'N' ? 1 : -1;
                if (!open(wx, wz + dz) || !open(wx, wz + 2 * dz)) return null;
                if (!open(wx - 1, wz + dz) && !open(wx + 1, wz + dz)) return null;
            }
            const box = ch.wallFaceMap.get(k);
            if (!box) return null;
            const xc = (box.minX + box.maxX) / 2;
            const zc = (box.minZ + box.maxZ) / 2;
            // Punto de arranque sobre la cara REAL del muro, normal hacia el
            // pasillo y tangente a lo largo del muro
            let S, n, t;
            if (side === 'E') { S = { x: box.maxX, z: zc }; n = { x: 1, z: 0 }; t = { x: 0, z: 1 }; }
            else if (side === 'W') { S = { x: box.minX, z: zc }; n = { x: -1, z: 0 }; t = { x: 0, z: 1 }; }
            else if (side === 'N') { S = { x: xc, z: box.maxZ }; n = { x: 0, z: 1 }; t = { x: 1, z: 0 }; }
            else { S = { x: xc, z: box.minZ }; n = { x: 0, z: -1 }; t = { x: 1, z: 0 }; }
            // Angulo ~35-60 grados respecto a la pared: el contrafuerte se ve
            // clavado en el pasillo sin llegar a cruzarlo
            const th = (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.5);
            const u = { x: n.x * Math.cos(th) + t.x * Math.sin(th), z: n.z * Math.cos(th) + t.z * Math.sin(th) };
            const L = 1.5 + rng() * 1.5;
            const T = 0.35 + rng() * 0.2;
            const ang = Math.atan2(u.x, u.z);
            // Eje: arranca enterrado T/2 dentro del muro y se prolonga L hacia
            // el pasillo (el centro de la malla va a L/2 del arranque)
            const cx = S.x - n.x * (T / 2) + u.x * (L / 2);
            const cz = S.z - n.z * (T / 2) + u.z * (L / 2);
            const pts = this.slabCorners(cx, cz, ang, L, T, T);
            const aabb = {
                minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
                minZ: Math.min(...pts.map(p => p.z)), maxZ: Math.max(...pts.map(p => p.z))
            };
            // Paso libre: ~1 m alrededor del tabique. Se excluyen del chequeo
            // las cajas que quedan DETRAS de la cara del muro (el muro al que
            // se pega y todo lo que hay tras el): el pasillo no pasa por ahi.
            const M = 1.0;
            const behind = side === 'E' ? b => b.maxX <= S.x + 0.05
                : side === 'W' ? b => b.minX >= S.x - 0.05
                : side === 'N' ? b => b.maxZ <= S.z + 0.05
                : b => b.minZ >= S.z - 0.05;
            for (const b of ch.wallBoxes) {
                if (behind(b)) continue;
                if (aabb.minX - M < b.maxX && aabb.maxX + M > b.minX &&
                    aabb.minZ - M < b.maxZ && aabb.maxZ + M > b.minZ) return null;
            }
            for (const s of placedAABBs) {
                if (aabb.minX - 0.8 < s.maxX && aabb.maxX + 0.8 > s.minX &&
                    aabb.minZ - 0.8 < s.maxZ && aabb.maxZ + 0.8 > s.minZ) return null;
            }
            for (const dc of ch.doorCells) {
                const dwx = ox + (dc.x + 0.5) * C, dwz = oz + (dc.z + 0.5) * C;
                if (dwx > aabb.minX - 1.5 && dwx < aabb.maxX + 1.5 &&
                    dwz > aabb.minZ - 1.5 && dwz < aabb.maxZ + 1.5) return null;
            }
            const built = this.buildSlantedWall(ch, cx, cz, ang, L, T, T, 'rect');
            return { mesh: built.mesh, boxes: built.boxes, aabb };
        }

        placeChunkBraces(ch, rng, wallKind, key, curvedCells) {
            const N = CHUNK_SIZE;
            const g = ch.grid;
            const cands = [];
            for (let x = 2; x < N - 2; x++) {
                for (let z = 2; z < N - 2; z++) {
                    if (g[x][z] !== 1) continue;
                    if (ch.doorCells.some(d => Math.abs(d.x - x) <= 1 && Math.abs(d.z - z) <= 1)) continue;
                    for (const side of ['E', 'W', 'N', 'S']) cands.push([x, z, side]);
                }
            }
            for (let i = cands.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [cands[i], cands[j]] = [cands[j], cands[i]];
            }
            const placedAABBs = [];
            let budget = 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);
            for (const [wx, wz, side] of cands) {
                if (budget <= 0) break;
                const r = this.tryBrace(ch, rng, wx, wz, side, wallKind, key, curvedCells, placedAABBs);
                if (!r) continue;
                placedAABBs.push(r.aabb);
                ch.slantedAABBs.push(r.aabb);
                ch.wallBoxes.push(...r.boxes);
                ch.meshes.push(r.mesh);
                budget--;
            }
        }

        buildSlantedWall(ch, cx, cz, ang, L, T0, T1, shape) {
            // Registro para el MAPA: se dibuja como un rectangulo rotado con
            // el angulo real, en vez de los cuadraditos AABB de la colision
            if (ch) {
                (ch.slantedWalls = ch.slantedWalls || []).push({ cx, cz, ang, L, T0, T1 });
            }
            // 2 cm de aire arriba y abajo: las tapas del tabique no tocan el
            // plano del suelo ni del techo (antes quedaban COPLANARES y las
            // dos superficies peleaban -> z-fighting en las paredes nuevas)
            const H = WALL_HEIGHT - 0.04;
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
            // El mapa las salta (isSlabBox las busca aqui) y la colision del
            // jugador usa la geometria exacta, pero siguen en wallBoxes para
            // muebles, lineas de vision y como caja conservadora.
            if (ch) {
                const sb = (ch.slantedBoxes = ch.slantedBoxes || []);
                for (const b of boxes) sb.push(b);
            }

            // Malla: las DOS formas usan la geometria de prisma con UVs de
            // papel pintado repetidos cada celda (antes los rectangulares se
            // hacian escalando un BoxGeometry y la textura salia estirada una
            // sola vez en toda la cara: las paredes en diagonal se veian mal)
            const geo = shape === 'rect'
                ? this.trapezoidGeometry(L, H, T0, T0)
                : this.trapezoidGeometry(L, H, T0, T1);
            const mat = Materials.wall.clone();
            // DoubleSide: el tabique se ve SOLIDO desde ambos lados. Antes con
            // FrontSide, quien entraba en el bolsillo detras de un tabique (o
            // lo miraba desde atras) veia ATRAVES de la pared diagonal: el
            // muro desaparecia y se veian las salas y jugadores de detras.
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
        // El prisma se genera CENTRADO en Y (y0..y1) igual que el BoxGeometry:
        // la malla se coloca con position.y = H/2 y asienta en el suelo.
        // (Antes las Y iban de 0 a H y el tabique quedaba colgando del techo.)
        trapezoidGeometry(L, H, T0, T1) {
            const pos = [], uv = [], idx = [];
            const hL = L / 2;
            const y0 = -H / 2, y1 = H / 2;
            const A = [-T0 / 2, y0, -hL], B = [T0 / 2, y0, -hL];
            const C = [-T1 / 2, y0, hL], D = [T1 / 2, y0, hL];
            const E = [-T0 / 2, y1, -hL], F = [T0 / 2, y1, -hL];
            const G = [-T1 / 2, y1, hL], HH = [T1 / 2, y1, hL];
            const vert = (p, u, v) => { pos.push(p[0], p[1], p[2]); uv.push(u, v); return pos.length / 3 - 1; };
            const tri = (a, b, c) => idx.push(a, b, c);
            const u1 = L / CELL_SIZE, v1 = H / CELL_SIZE;
            const t0u = T0 / CELL_SIZE, t1u = T1 / CELL_SIZE;
            // Laterales POR SEGMENTOS (~1 m). Antes toda la cara lateral era
            // UN solo trapezoide con la textura mapeada de esquina a esquina:
            // en los tabiques con un extremo mas grueso el papel pintado
            // salia torcido/estirado en diagonal ("la pared diagonal tiene una
            // parte de su textura mal hecha"). Cada segmento repite el
            // estampado y, como el grosor apenas cambia entre segmentos, el
            // papel queda recto en toda la cara.
            const nSeg = Math.max(2, Math.round(L / 1.0));
            for (let s = 0; s < nSeg; s++) {
                const z0 = -hL + (L / nSeg) * s;
                const z1 = z0 + L / nSeg;
                const t0 = T0 + (T1 - T0) * (s / nSeg);
                const t1 = T0 + (T1 - T0) * ((s + 1) / nSeg);
                const ua = (s / nSeg) * u1, ub = ((s + 1) / nSeg) * u1;
                // Cara x- (lateral izquierda)
                const a = vert([-t0 / 2, y0, z0], ua, 0), b = vert([-t1 / 2, y0, z1], ub, 0);
                const c = vert([-t1 / 2, y1, z1], ub, v1), d = vert([-t0 / 2, y1, z0], ua, v1);
                tri(a, b, c); tri(a, c, d);
                // Cara x+ (lateral derecha)
                const e = vert([t0 / 2, y0, z0], ua, 0), f = vert([t1 / 2, y0, z1], ub, 0);
                const g = vert([t1 / 2, y1, z1], ub, v1), h = vert([t0 / 2, y1, z0], ua, v1);
                tri(f, e, h); tri(f, h, g);
            }
            // Tapas de los extremos (z- y z+): cada tapa usa sus propios
            // vertices con u repartido a lo largo del GROSOR, como una pared
            // de verdad (antes compartian los vertices de las laterales y
            // toda la cara muestreaba la columna u=0 de la textura: una
            // franja estirada de un pixel).
            const na = vert(A, 0, 0), nb = vert(B, t0u, 0), nf = vert(F, t0u, v1), ne = vert(E, 0, v1);
            tri(na, ne, nb); tri(nb, ne, nf);
            const fc = vert(C, 0, 0), fd = vert(D, t1u, 0), fh = vert(HH, t1u, v1), fg = vert(G, 0, v1);
            tri(fc, fg, fd); tri(fd, fg, fh);
            // Suelo (-Y) y techo (+Y): u a lo largo de la pared, v segun el
            // grosor (la franja del zocalo/remate, invisible en la practica).
            const bta = vert(A, 0, 0), btb = vert(B, 0, t0u), btc = vert(C, u1, 0), btd = vert(D, u1, t1u);
            tri(bta, btb, btd); tri(bta, btd, btc);
            const tta = vert(E, 0, v1), ttb = vert(F, 0, v1 + t0u), ttc = vert(G, u1, v1), ttd = vert(HH, u1, v1 + t1u);
            tri(tta, ttb, ttd); tri(tta, ttd, ttc);
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
        // Comprueba si cabe un mueble usando SOLO datos de SU chunk (cajas de
        // muros y ocupacion propia): el resultado no depende de que chunks
        // vecinos esten cargados, asi todos los jugadores colocan los muebles
        // exactamente en los mismos sitios (requisito del multijugador).
        canPlaceFurniture(ch, x, z, radius) {
            for (let box of ch.wallBoxes) {
                if (x + radius > box.minX && x - radius < box.maxX && z + radius > box.minZ && z - radius < box.maxZ) {
                    return false;
                }
            }
            for (let occ of ch.occ) {
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
                        // Poses de mesa: 0 de pie, 1 caida de lado (pata rota),
                        // 2 patas arriba, 3 volcada hacia delante. La mayoria
                        // estan DE PIE (antes 4 de cada 10 nacian tumbadas o
                        // patas arriba: "las mesas estan mal, patas arriba sin
                        // ninguna logica"); las patas arriba son las mas raras.
                        const vr = Math.random();
                        const variant = vr < 0.55 ? 0 : (vr < 0.78 ? 1 : (vr < 0.9 ? 3 : 2));
                        const deskX = rx + (Math.random() - 0.5) * 1.5;
                        const deskZ = rz + (Math.random() - 0.5) * 1.5;
                        if (this.canPlaceFurniture(ch, deskX, deskZ, 0.95)) {
                            const desk = ModelBuilder.createOfficeDesk(variant);
                            desk.position.set(deskX, 0, deskZ);
                            snapToFloor(desk, 0);
                            // Id DETERMINISTA para la sincronizacion por red
                            // (cajones y posiciones globales para la sala)
                            desk.userData.fid = 'f:' + Math.round(deskX * 10) + ':' + Math.round(deskZ * 10);
                            // Cajon: de vez en cuando esconde un objeto. El
                            // tipo se decide AQUI con el rng del chunk: todos
                            // los clientes abren el mismo cajon con el mismo
                            // contenido (y el objeto se reclama por red).
                            // TODAS las mesas tienen cajon abrible (antes las
                            // patas-arriba y volcadas no: "esta mesa no tiene
                            // cajon").
                            const dr = desk.userData.drawer;
                            if (dr && Math.random() < 0.35) {
                                const ir = Math.random();
                                dr.itemType = ir < 0.4 ? 'almond' : (ir < 0.75 ? 'battery' : (ir < 0.9 ? 'chalk' : 'note'));
                                if (dr.itemType === 'chalk') {
                                    const ci = Math.floor(Math.random() * 3);
                                    const chalkColors = ['#ffffff', '#ff3333', '#111111'];
                                    const chalkNames = ['BLANCO', 'ROJO', 'NEGRO'];
                                    dr.chalk = { color: chalkColors[ci], colorName: chalkNames[ci] };
                                }
                                if (dr.itemType === 'note') {
                                    dr.noteIndex = Math.floor(Math.random() * NOTE_POOL.length);
                                }
                            }
                            this.scene.add(desk);
                            this.furnitureMeshes.push(desk);
                            this.dynamicFurniture.push({ mesh: desk, x: deskX, z: deskZ, fid: desk.userData.fid });
                            ch.occ.push({ x: deskX, z: deskZ, radius: 0.95 });
                        }
                    } else if (choice < 0.6) {
                        // Poses de silla: 0 de pie, 1 caida de lado,
                        // 2 patas arriba (pata rota)
                        const vr = Math.random();
                        const variant = vr < 0.6 ? 0 : (vr < 0.85 ? 1 : 2);
                        const chairX = rx + (Math.random() - 0.5) * 1.8;
                        const chairZ = rz + (Math.random() - 0.5) * 1.8;
                        if (this.canPlaceFurniture(ch, chairX, chairZ, 0.55)) {
                            const chair = ModelBuilder.createOfficeChair(variant);
                            chair.position.set(chairX, 0, chairZ);
                            snapToFloor(chair, 0);
                            chair.userData.fid = 'f:' + Math.round(chairX * 10) + ':' + Math.round(chairZ * 10);
                            this.scene.add(chair);
                            this.furnitureMeshes.push(chair);
                            this.dynamicFurniture.push({ mesh: chair, x: chairX, z: chairZ, fid: chair.userData.fid });
                            ch.occ.push({ x: chairX, z: chairZ, radius: 0.55 });
                        }
                    } else if (Math.random() < 0.45) {
                        // Armarios en las salas MENOS comunes (antes 40% de
                        // cada pieza de mobiliario intentaba un armario: las
                        // salas acababan llenas de armarios pegados)
                        this.placeCabinetInRoom(rw, ch);
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

        // Igual que canPlaceFurniture: comprobaciones SOLO contra el chunk
        // propio (muros y ocupacion del chunk), determinista para la sala.
        cabinetSpotFree(ch, cx, cz, r, d) {
            for (const box of ch.wallBoxes) {
                if (d && this.isSupportBox(box, cx, cz, r, d)) continue;
                if (this.circleTouchesBox(cx, cz, r, box)) return false;
            }
            for (const occ of ch.occ) {
                if (Math.hypot(cx - occ.x, cz - occ.z) < r + occ.radius + 0.35) return false;
            }
            return true;
        }

        placeOneCabinet(cx, cz, yaw, style, r, d, ch) {
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
            const ok = this.cabinetSpotFree(ch, bx, bz, occupiedRadius, d);
            if (!ok) {
                this.scene.remove(group);
                return null;
            }
            this.scene.add(group);
            this.furnitureMeshes.push(group);
            group.userData.fid = 'f:' + Math.round(bx * 10) + ':' + Math.round(bz * 10);
            if (ch) ch.occ.push({ x: bx, z: bz, radius: occupiedRadius * 0.9 });
            // Registro para el espaciado entre armarios (celda de mundo aprox.)
            if (ch) (ch.cabinetCells = ch.cabinetCells || []).push([Math.floor(bx / CELL_SIZE), Math.floor(bz / CELL_SIZE)]);
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
        trySpawnCabinetOnWall(faceCoord, d, tanAxis, a, b, poseHint, ch) {
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

                // La pared debe seguir existiendo DETRAS de todo el ancho del
                // armario (antes solo se comprobaba la celda central: si el
                // muro era corto o estaba junto a una puerta, el armario se
                // apoyaba en una pared de 1 celda y sus lados quedaban sobre
                // suelo libre: "armario inclinado en la pared sin pared
                // detras"). Tambien exige cara REAL (nada de celdas curvas).
                const halfW = fallen ? 1.2 : 0.55;
                const wRowX = Math.floor((faceCoord - d[0] * C / 2) / C);
                const wRowZ = Math.floor((faceCoord - d[1] * C / 2) / C);
                let wallOk = true;
                for (let ti = Math.floor((tan - halfW) / C); ti <= Math.floor((tan + halfW) / C); ti++) {
                    const wcx2 = tanAxis === 'x' ? ti : wRowZ;
                    const wcz2 = tanAxis === 'x' ? wRowX : ti;
                    if (this.gridAt(wcx2, wcz2) !== 1 || this.wallFaceAt(wcx2, wcz2, d) === null) {
                        wallOk = false;
                        break;
                    }
                }
                if (!wallOk) continue;

                const gcx = Math.floor(cx / C);
                const gcz = Math.floor(cz / C);
                // Las puertas NO deben quedar cara a la pared: la celda delante
                // de la fachada tiene que estar abierta, asi el armario nunca
                // acaba en un hueco de 1 celda apuntando a la pared de enfrente
                const fcx = gcx + d[0];
                const fcz = gcz + d[1];
                const ftype = this.gridAt(fcx, fcz);
                if (ftype !== 0 && ftype !== 2) continue;
                if (!this.cabinetSpotFree(ch, cx, cz, fallen ? 1.35 : 0.7, d)) continue;

                const g = this.placeOneCabinet(cx, cz, yaw, style, fallen ? 1.35 : 0.7, d, ch);
                if (g) return true;
            }
            return false;
        }

        // Cara de la lamina de pared hacia la direccion d (mundo, en metros).
        // Dos errores corregidos aqui:
        //  1) wallFaceMap guarda claves LOCALES del chunk (0..15), pero aqui
        //     se consultaba con celdas de MUNDO: fuera del chunk (0,0) la
        //     busqueda fallaba SIEMPRE y los armarios no se colocaban en
        //     ningun otro sitio (solo en el chunk (0,0) coincidian por
        //     casualidad).
        //  2) Se devolvia la cara OPUESTA a d (la trasera del muro): el
        //     armario nacía con el cuerpo DENTRO de la pared ("armarios que
        //     atraviesan la pared"). d apunta del muro hacia el suelo libre,
        //     asi que la cara visible es la que mira HACIA d.
        wallFaceAt(wcx, wcz, d) {
            const gcx = Math.floor(wcx / CHUNK_SIZE);
            const gcz = Math.floor(wcz / CHUNK_SIZE);
            const ch = this.chunks.get(gcx + ',' + gcz);
            const box = ch && ch.wallFaceMap && ch.wallFaceMap.get((wcx - gcx * CHUNK_SIZE) + ',' + (wcz - gcz * CHUNK_SIZE));
            if (!box) return null;
            if (d[0] === 1) return box.maxX;
            if (d[0] === -1) return box.minX;
            if (d[1] === 1) return box.maxZ;
            return box.minZ;
        }

        placeCabinetInRoom(r, ch) {
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
                if (this.trySpawnCabinetOnWall(faceCoord, d, tanAxis, a, b, poseHint, ch)) {
                    return true;
                }
            }
            return false;
        }

        placeCorridorCabinets(ch) {
            const C = CELL_SIZE;
            // UN armario de pasillo por chunk como mucho (antes hasta 2 y, con
            // los de las salas, los pasillos quedaban llenos de armarios juntos)
            const target = Math.min(1, Math.floor(ch.openCells.length / 110));
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
                // Los armarios NO se amontonan: nada de otro armario a menos
                // de ~2 celdas (los de las salas ya estan en ch.cabinetCells)
                const cabs = ch.cabinetCells || [];
                let nearCab = false;
                for (const cc of cabs) {
                    if (Math.abs(cc[0] - cx) <= 2 && Math.abs(cc[1] - cz) <= 2) { nearCab = true; break; }
                }
                if (nearCab) continue;

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
                if (this.trySpawnCabinetOnWall(faceCoord, d, tanAxis, centerTan - C / 2, centerTan + C / 2, poseHint, ch)) {
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
                // Separacion minima de otros objetos y muebles del PROPIO
                // chunk (antes se comprobaba el mundo entero y la posicion de
                // cada objeto dependia de que chunks vecinos estuvieran
                // cargados: cada jugador veia los objetos en sitios distintos)
                let ok = true;
                for (const p of ch.pickupList) {
                    if (Math.hypot(p.x - wx, p.z - wz) < CELL_SIZE * 2.2) { ok = false; break; }
                }
                if (ok) {
                    for (const occ of ch.occ) {
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
            const C = CELL_SIZE;
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
                        // Caras que dan al chunk vecino: la junta las solapa
                        if (d === 'W' && x === 0) continue;
                        if (d === 'E' && x === N - 1) continue;
                        if (d === 'S' && z === 0) continue;
                        if (d === 'N' && z === N - 1) continue;
                        const faceLen = (d === 'W' || d === 'E') ? (box.maxZ - box.minZ) : (box.maxX - box.minX);
                        if (faceLen < 0.9) continue;
                        cands.push({ box, d, x, z });
                    }
                }
            }
            if (!cands.length) return null;
            const c = cands[Math.floor(r() * cands.length)];
            const rots = [-0.4, -0.24, -0.1, 0.08, 0.22, 0.38];
            // Posicion ABSOLUTA dentro de la celda (la caja se alarga hacia
            // los postes y esa parte queda enterrada: la nota siempre cae en
            // la parte visible de la pared)
            const cx0 = ch.cx * N * C + (c.x + 0.5) * C;
            const cz0 = ch.cz * N * C + (c.z + 0.5) * C;
            const t = 0.12 + r() * 0.76;
            let px, pz;
            if (c.d === 'W' || c.d === 'E') { px = cx0; pz = cz0 - C / 2 + t * (C - 0.12); }
            else { pz = cz0; px = cx0 - C / 2 + t * (C - 0.12); }
            return {
                box: { minX: c.box.minX, maxX: c.box.maxX, minZ: c.box.minZ, maxZ: c.box.maxZ },
                dir: c.d,
                x: px, z: pz,
                y: 1.1 + r() * 0.8,            // altura sobre el suelo
                variant: Math.floor(r() * 5),  // 0 chincheta, 1 cinta H, 2 cintas diag., 3 rasgada, 4 sola
                aspect: r() < 0.6 ? 'portrait' : 'landscape',
                rot: rots[Math.floor(r() * rots.length)]
            };
        }

        buildPickupMesh(p) {
            let mesh;
            if (p.drawerGroup) {
                // Objeto de cajon: NACE dentro del hueco de la bandeja (no en
                // el suelo) y se desliza con el cajon al abrirlo.
                mesh = this.buildPickupShape(p);
                p.drawerGroup.add(mesh);
                mesh.position.set(0, -0.05, 0);
                mesh.rotation.set(0, 0, 0);
                return mesh;
            }
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
                    let ry = 0;
                    if (p.wall.dir === 'W') { mesh.position.set(b.minX - 0.016, p.wall.y, p.wall.z); ry = -Math.PI / 2; }
                    else if (p.wall.dir === 'E') { mesh.position.set(b.maxX + 0.016, p.wall.y, p.wall.z); ry = Math.PI / 2; }
                    else if (p.wall.dir === 'S') { mesh.position.set(p.wall.x, p.wall.y, b.minZ - 0.016); ry = Math.PI; }
                    else { mesh.position.set(p.wall.x, p.wall.y, b.maxZ + 0.016); ry = 0; }
                    mesh.rotation.y = ry;
                } else {
                    mesh = ModelBuilder.createFloorNote();
                    mesh.position.set(p.x, 0.005, p.z);
                }
            }
            this.scene.add(mesh);
            return mesh;
        }

        // Construye SOLO la malla del pickup (sin posicionar en la escena):
        // el cajon la coloca dentro de su hueco (buildPickupMesh lo re-parenta
        // si p.drawerGroup esta presente).
        buildPickupShape(p) {
            let mesh;
            if (p.type === 'camera') {
                mesh = ModelBuilder.createCameraModel();
                mesh.rotation.z = Math.PI / 2;
            } else if (p.type === 'chalk') {
                mesh = ModelBuilder.createChalkBox(p.color);
            } else if (p.type === 'almond') {
                mesh = ModelBuilder.createAlmondWater();
                mesh.rotation.z = Math.PI / 2;
            } else if (p.type === 'battery') {
                mesh = ModelBuilder.createBattery();
                mesh.rotation.z = Math.PI / 2;
                mesh.rotation.x = (Math.random() - 0.5) * 0.4;
            } else if (p.type === 'note') {
                mesh = ModelBuilder.createFloorNote();
            }
            return mesh || new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
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
                if (r() < 0.33) want.push({ type: 'almond' });
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

        // Objeto escondido en un CAJON abierto: se materializa DENTRO del
        // hueco de la bandeja y se desliza con el cajon (es hijo suyo), de
        // modo que NUNCA cae al suelo: queda visible reposando en el cajon
        // abierto. El id deriva de la posicion determinista de la mesa, asi
        // si otro jugador abre el MISMO cajon y ya se reclamo, nace recogido.
        spawnDrawerPickup(deskGroup, d) {
            if (!d || !d.itemType) return null;
            const id = 'dr:' + Math.round(deskGroup.position.x * 10) + ':' + Math.round(deskGroup.position.z * 10);
            if (this.claimedPickupIds.has(id)) return null;
            const data = {
                id,
                type: d.itemType,
                x: deskGroup.position.x,
                z: deskGroup.position.z,
                collected: false,
                mesh: null,
                pos: null,
                drawerGroup: d.mesh   // el objeto vive DENTRO del cajon
            };
            if (d.itemType === 'chalk') { data.color = d.chalk.color; data.colorName = d.chalk.colorName; }
            if (d.itemType === 'note') { data.noteIndex = d.noteIndex; data.text = NOTE_POOL[d.noteIndex]; }
            this.pickupById.set(data.id, data);
            this.pickupData.push(data);
            const ccx = Math.floor(deskGroup.position.x / (CHUNK_SIZE * CELL_SIZE));
            const ccz = Math.floor(deskGroup.position.z / (CHUNK_SIZE * CELL_SIZE));
            const ch = this.chunks.get(ccx + ',' + ccz);
            if (ch) ch.pickupList.push(data);
            data.mesh = this.buildPickupMesh(data);
            this.rebuildUnions();
            return data;
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
                (p.mesh.parent || this.scene).remove(p.mesh);
                p.mesh = null;
            }
            this.rebuildUnions();
        }
    }