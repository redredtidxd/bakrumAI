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

    // NOTAS DE LORE: cada texto solo se recoge UNA vez en toda la partida
    const NOTE_POOL = [
        "Entrada 1: Doblar esquinas me salvo. Esa cosa corre hacia donde te vio por ultima vez, pero si cambias de pasillo, se desorienta.",
        "Entrada 2: El flash de la camara analogica es letal para sus ojos. No corras en vano, preparalo.",
        "Entrada 3: La tiza sobrevive en la moqueta. Dibuja flechas en cada giro para saber de donde venias.",
        "Entrada 4: Los pilares del centro de las salas bloquean su vision. Si te agachas tras ellos, pasara de largo.",
        "Entrada 5: Llevo dias caminando y nunca encuentro una pared exterior. Cada pasillo ancho desemboca en otro estrecho y el amarillo no cambia.",
        "Entrada 6: Los pasillos anchos son mas seguros: hay donde esconderse. Los angostos solo sirven para perderte."
    ];

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
            // Divisor interior: un trozo de pared corto (horizontal o vertical,
            // en posicion aleatoria, nunca centrado) separa el salon sin
            // cerrarlo (deja paso por ambos lados): menos campo abierto y
            // menos simetria
            if (r() < 0.65) {
                const dl = 1 + Math.floor(r() * 2); // 1-2 celdas de largo
                if (w >= 6 && (h < 6 || r() < 0.5)) {
                    const px = hx + 1 + Math.floor(r() * (w - 2 - dl));
                    const pz = hz + 1 + Math.floor(r() * (h - 2));
                    for (let i = 0; i < dl; i++) {
                        if (ch.grid[px + i][pz] === 2) ch.grid[px + i][pz] = 1;
                    }
                } else if (h >= 6) {
                    const px = hx + 1 + Math.floor(r() * (w - 2));
                    const pz = hz + 1 + Math.floor(r() * (h - 2 - dl));
                    for (let i = 0; i < dl; i++) {
                        if (ch.grid[px][pz + i] === 2) ch.grid[px][pz + i] = 1;
                    }
                }
            }
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

            const floorGeo = new THREE.PlaneGeometry(N * C, N * C);
            const fuv = floorGeo.attributes.uv;
            // Cada repeticion de la moqueta (512 px) cubre exactamente una celda
            for (let i = 0; i < fuv.count; i++) {
                fuv.setXY(i, fuv.getX(i) * N, fuv.getY(i) * N);
            }
            fuv.needsUpdate = true;
            const floor = new THREE.Mesh(floorGeo, Materials.floor);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(ox + (N * C) / 2, 0, oz + (N * C) / 2);
            this.scene.add(floor);
            ch.meshes.push(floor);

            const ceilGeo = new THREE.PlaneGeometry(N * C, N * C);
            const cuv = ceilGeo.attributes.uv;
            for (let i = 0; i < cuv.count; i++) {
                cuv.setXY(i, cuv.getX(i) * (N / 2), cuv.getY(i) * (N / 2));
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
            // Tamanio de las esquinas: define la cara enrasada donde la union
            // rectangular toca a cada lamina contigua
            for (let x = 1; x < N - 1; x++) {
                for (let z = 1; z < N - 1; z++) {
                    const k = key(x, z);
                    if (wallKind.get(k) === 'post' && !wallTMap.has(k)) {
                        wallTMap.set(k, 0.35 + ch.rng() * 0.1);
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
                            // Esquina = BLOQUE RECTANGULAR de la celda entera
                            // (2,8 x 2,8 m), enrasado con las laminas contiguas
                            // y con los pasillos (caras en los bordes de celda):
                            // NADA de pilares en las esquinas, la pared continua
                            // sin protuberancias ni huecos. Un poste sin ningun
                            // tramo de pared conectado es flotante y se elimina.
                            const runNeighbor = (dx, dz) => {
                                const nk = wallKind.get(key(x + dx, z + dz));
                                return nk === 'x' || nk === 'z';
                            };
                            if (runNeighbor(1, 0) || runNeighbor(-1, 0) || runNeighbor(0, 1) || runNeighbor(0, -1)) {
                                const jb = { minX: posX - 1.4, maxX: posX + 1.4, minZ: posZ - 1.4, maxZ: posZ + 1.4 };
                                dummy.position.set(posX, WALL_HEIGHT / 2, posZ);
                                dummy.scale.set(2.8, WALL_HEIGHT, 2.8);
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
                            // 1,12 m: supera el hueco 1,4 - r incluso con el poste
                            // minimo (r = 0,35 -> 1,05 exacto) dejando solape
                            if (kind === 'x') {
                                if (pS === 'post') box.maxZ += 1.12; else if (pS === 'border') box.maxZ += 2.45;
                                if (pN === 'post') box.minZ -= 1.12; else if (pN === 'border') box.minZ -= 2.45;
                            } else {
                                if (pE === 'post') box.maxX += 1.12; else if (pE === 'border') box.maxX += 2.45;
                                if (pW === 'post') box.minX -= 1.12; else if (pW === 'border') box.minX -= 2.45;
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
            // ALARGA hacia el poste/borde contiguo (misma extension: 1,12 m a
            // postes, 2,45 m a bordes de chunk). Sin esto, un tramo curvo que
            // terminaba en un borde dejaba un hueco de ~2 m por el que se
            // colaba a la zona de atras de la pared.
            const nk0 = kind === 'x' ? wallKind.get(key(first[0], first[1] - 1)) : wallKind.get(key(first[0] - 1, first[1]));
            const nk1 = kind === 'x' ? wallKind.get(key(last[0], last[1] + 1)) : wallKind.get(key(last[0] + 1, last[1]));
            const extFor = (nk) => nk === 'border' ? 2.45 : (nk === 'post' ? 1.12 : 0);
            const ext0 = extFor(nk0);
            const ext1 = extFor(nk1);
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
                mesh = ModelBuilder.createFloorNote();
                mesh.position.set(p.x, 0.005, p.z);
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
                if (gx === -1 && gz === 0) want.push({ type: 'almond' });
                if (gx === 0 && gz === -1) want.push({ type: 'battery' });
                if (gx === 1 && gz === 1) want.push({ type: 'chalk', color: '#ff3333', colorName: 'ROJO' });

                // Reparto aleatorio de recursos por el infinito (densidad
                // aumentada: antes aparecian muy pocos objetos por chunk)
                if (r() < 0.10) want.push({ type: 'camera' });
                if (r() < 0.20) want.push({ type: 'chalk' });
                if (r() < 0.26) want.push({ type: 'almond' });
                if (r() < 0.34) want.push({ type: 'battery' });
                if (r() < 0.28) want.push({ type: 'note' });

                const chalkColors = ['#ffffff', '#ff3333', '#111111'];
                const chalkNames = ['BLANCO', 'ROJO', 'NEGRO'];

                for (const it of want) {
                    if (it.type === 'note') {
                        const fresh = [];
                        for (let i = 0; i < NOTE_POOL.length; i++) {
                            if (!this.collectedNoteIndices.has(i)) fresh.push(i);
                        }
                        it.noteIndex = fresh.length > 0 ? fresh[Math.floor(r() * fresh.length)] : Math.floor(r() * NOTE_POOL.length);
                    } else if (it.type === 'chalk' && !it.color) {
                        const ci = Math.floor(r() * 3);
                        it.color = chalkColors[ci];
                        it.colorName = chalkNames[ci];
                    }
                    const spot = this.pickupSpot(ch);
                    if (!spot) continue;
                    const data = {
                        type: it.type,
                        x: spot.x,
                        z: spot.z,
                        collected: false,
                        mesh: null,
                        pos: new THREE.Vector3(spot.x, 0, spot.z)
                    };
                    if (it.type === 'chalk') { data.color = it.color; data.colorName = it.colorName; }
                    if (it.type === 'note') { data.noteIndex = it.noteIndex; data.text = NOTE_POOL[it.noteIndex]; }
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
    }